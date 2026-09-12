import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChannelProfileDefinition, DeclarativeHttpExecutionContract } from '@herald/core'
import { createCustomHttpTransport } from '@herald/custom-http'
import {
    closeDatabase,
    createDatabase,
    createManualStore,
    createMediaAssetStore,
    createNotificationStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
    createProviderMediaDeliveryStore,
    runMigrations,
} from '@herald/db'
import { providerMediaDeliveries, publications } from '@herald/db/schema'
import {
    createLinkedInImagePublisher,
    createLinkedInTextPublisher,
    linkedinChannelProfile,
} from '@herald/linkedin'
import { createLocalMediaStore } from '@herald/media'
import { clientSecretPost, type OAuthAuthorizationServer } from '@herald/oauth'
import { eq } from 'drizzle-orm'

import { createMediaPublicDelivery } from '../media/public-delivery'
import { createNotificationProjectionRuntime } from '../notifications/runtime'
import { linkedInPublisherConnectionPolicy } from '../publishers/providers/linkedin'
import { createLinkedInProviderAdapter } from './providers/linkedin'
import { createBuiltInProviderRegistry } from './providers/registry'
import { createPublicationWorker } from './worker'

const now = 1_800_000_000_000
const encryptionKey = new Uint8Array(32).fill(11)

const customWebhookProfile: ChannelProfileDefinition = {
    id: 'custom-webhook',
    version: 1,
    profileHash: 'sha256:custom-webhook-profile-v1',
    schemaHash: 'sha256:custom-webhook-schema-v1',
    origin: 'custom',
    contentSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { commentary: { type: 'string', minLength: 1, maxLength: 1_000 } },
        required: ['commentary'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'commentary', semantic: 'primary_text', path: '/commentary' }],
    capabilities: {
        revision: 'custom-webhook-v1',
        textFields: [
            {
                bindingId: 'commentary',
                acceptedSourceFormats: ['plain_text'],
                maxLength: 1_000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: {
        kind: 'declarative_http',
        contractId: 'custom-webhook',
        revision: '1',
        mode: 'herald_webhook',
    },
}

const customMappedMediaProfile: ChannelProfileDefinition = {
    id: 'custom-mapped-media',
    version: 1,
    profileHash: 'sha256:custom-mapped-media-profile-v1',
    schemaHash: 'sha256:custom-mapped-media-schema-v1',
    origin: 'custom',
    contentSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
            commentary: { type: 'string', minLength: 1, maxLength: 1_000 },
            media: {
                type: 'array',
                maxItems: 1,
                items: {
                    type: 'object',
                    properties: { assetId: { type: 'string', minLength: 1, maxLength: 255 } },
                    required: ['assetId'],
                    additionalProperties: false,
                },
            },
        },
        required: ['commentary', 'media'],
        additionalProperties: false,
    },
    fieldBindings: [
        { id: 'commentary', semantic: 'primary_text', path: '/commentary' },
        {
            id: 'media',
            semantic: 'ordered_media',
            path: '/media',
            item: { assetIdPath: '/assetId' },
        },
    ],
    capabilities: {
        revision: 'custom-mapped-media-v1',
        textFields: [
            {
                bindingId: 'commentary',
                acceptedSourceFormats: ['plain_text'],
                maxLength: 1_000,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/png'],
                maxItems: 1,
                publicUrlRequired: true,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'declarative_http',
        contractId: 'custom-mapped-media',
        revision: '1',
        mode: 'mapped_http',
        request: {
            method: 'POST',
            path: [],
            body: {
                kind: 'json',
                value: {
                    kind: 'object',
                    properties: {
                        commentary: { kind: 'content', pointer: '/commentary' },
                        media: { kind: 'media_urls', pointer: '/media' },
                    },
                },
            },
            response: {
                successStatuses: [200, 201],
                retryableStatuses: [429],
                rejectedStatuses: [400],
                ambiguousStatuses: [500],
            },
        },
    },
}

const customMultipartMediaProfile: ChannelProfileDefinition = {
    ...customMappedMediaProfile,
    id: 'custom-multipart-media',
    profileHash: 'sha256:custom-multipart-media-profile-v1',
    schemaHash: 'sha256:custom-multipart-media-schema-v1',
    capabilities: {
        ...customMappedMediaProfile.capabilities,
        mediaFields: [
            {
                ...customMappedMediaProfile.capabilities.mediaFields[0]!,
                publicUrlRequired: false,
            },
        ],
    },
    execution: {
        ...(customMappedMediaProfile.execution as DeclarativeHttpExecutionContract),
        contractId: 'custom-multipart-media',
        request: {
            ...(customMappedMediaProfile.execution as DeclarativeHttpExecutionContract).request!,
            body: {
                kind: 'multipart',
                fields: { commentary: { kind: 'content', pointer: '/commentary' } },
                media: [{ fieldName: 'media', pointer: '/media' }],
            },
        },
    },
}

function createPng(width = 4, height = 3): Uint8Array {
    const bytes = new Uint8Array(33)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
    bytes[16] = (width >>> 24) & 0xff
    bytes[17] = (width >>> 16) & 0xff
    bytes[18] = (width >>> 8) & 0xff
    bytes[19] = width & 0xff
    bytes[20] = (height >>> 24) & 0xff
    bytes[21] = (height >>> 16) & 0xff
    bytes[22] = (height >>> 8) & 0xff
    bytes[23] = height & 0xff
    return bytes
}

describe('publication worker', () => {
    it('executes scheduled LinkedIn publications, persists outcomes, and projects notifications', async () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => now })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => now,
            })
            const publisherStore = createPublisherStore(database, {
                credentialRevoker: credentialStore,
                connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
                now: () => now,
            })
            const project = manualStore.createProject({
                name: 'LinkedIn Worker Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn Member',
                profile: linkedinChannelProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The test channel was not created')

            const credential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-42',
                scopes: ['openid', 'profile', 'w_organization_social', 'rw_organization_admin'],
                accessToken: 'linkedin-access-token',
            })
            expect(credential.kind).toBe('created')
            if (credential.kind !== 'created')
                throw new Error('The test credential was not created')

            expect(
                publisherStore.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: credential.credential.id,
                    destination: {
                        type: 'organization',
                        id: '12345',
                        name: 'Tala Web',
                    },
                }).kind
            ).toBe('created')

            const first = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'First LinkedIn publication', format: 'plain_text' },
                    media: [],
                },
                publications: [
                    { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now },
                ],
            })
            const second = createPostAt(manualStore, project.project.id, channel.id, now + 1)
            const third = createPostAt(manualStore, project.project.id, channel.id, now + 2)
            const fourth = createPostAt(manualStore, project.project.id, channel.id, now + 3)
            expect(first).not.toBeNull()
            expect(second).not.toBeNull()
            expect(third).not.toBeNull()
            expect(fourth).not.toBeNull()

            const responses = [
                new Response(null, {
                    status: 201,
                    headers: { 'x-restli-id': 'urn:li:post:published' },
                }),
                new Response(JSON.stringify({ message: 'slow down' }), {
                    status: 429,
                    headers: { 'content-type': 'application/json' },
                }),
                new Response(JSON.stringify({ message: 'upstream failure' }), {
                    status: 503,
                    headers: { 'content-type': 'application/json' },
                }),
                new Response(JSON.stringify({ message: 'token linkedin-access-token expired' }), {
                    status: 401,
                    headers: { 'content-type': 'application/json' },
                }),
            ]
            const requests: Array<{ readonly headers: Headers; readonly body: string }> = []
            const publisher = createLinkedInTextPublisher({
                baseUrl: 'https://linkedin.test',
                fetcher: async (_input, init) => {
                    requests.push({
                        headers: new Headers(init?.headers),
                        body: typeof init?.body === 'string' ? init.body : '',
                    })
                    const response = responses.shift()
                    if (response === undefined) throw new Error('The test response queue is empty')
                    return response
                },
            })
            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                createClaimToken: (() => {
                    let sequence = 0
                    return () => `worker-claim-${++sequence}`
                })(),
                builtInProviderRegistry: createBuiltInProviderRegistry([
                    createLinkedInProviderAdapter({ textPublisher: publisher }),
                ]),
                retryPolicy: {
                    nextRunAt: ({ attempts, failedAt }) =>
                        attempts === 1 ? failedAt + 60_000 : null,
                },
            })

            await worker.processDueEvents(now + 3)

            const notifications = createNotificationStore(database, { now: () => now + 4 })
            const notificationProjection = createNotificationProjectionRuntime(notifications)
            notificationProjection.runNow()
            const inbox = notifications.list({
                projectId: project.project.id,
                subjectId: 'user-1',
            })
            expect(inbox).not.toBeNull()
            expect(inbox?.items).toHaveLength(3)
            expect(inbox?.items).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        kind: 'publication_published',
                        title: 'Publication delivered',
                    }),
                    expect.objectContaining({
                        kind: 'publication_failed',
                        title: 'Publication failed',
                    }),
                    expect.objectContaining({
                        kind: 'publication_ambiguous',
                        title: 'Publication outcome unknown',
                    }),
                ])
            )

            expect(requests).toHaveLength(4)
            expect(
                requests.every(
                    request =>
                        request.headers.get('authorization') === 'Bearer linkedin-access-token'
                )
            ).toBe(true)
            expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({
                author: 'urn:li:organization:12345',
                commentary: 'First LinkedIn publication',
            })

            const publicationRows = database
                .select({
                    state: publications.state,
                    externalId: publications.externalId,
                    errorMessage: publications.errorMessage,
                })
                .from(publications)
                .where(eq(publications.projectId, project.project.id))
                .all()
            expect(publicationRows).toContainEqual({
                state: 'published',
                externalId: 'urn:li:post:published',
                errorMessage: null,
            })
            expect(publicationRows.filter(row => row.state === 'ready')).toHaveLength(1)
            expect(publicationRows.filter(row => row.state === 'ambiguous')).toHaveLength(1)
            expect(publicationRows.filter(row => row.state === 'failed')).toHaveLength(1)
            expect(
                publicationRows
                    .flatMap(row => row.errorMessage ?? [])
                    .join(' ')
                    .includes('linkedin-access-token')
            ).toBe(false)

            const jobRows = database.$client
                .query<{ state: string; runAt: number; errorMessage: string | null }, []>(`
                    select state, run_at as runAt, error_message as errorMessage
                    from jobs
                    order by run_at, id
                `)
                .all()
            expect(jobRows).toContainEqual({
                state: 'pending',
                runAt: now + 3 + 60_000,
                errorMessage: null,
            })
            expect(jobRows.filter(row => row.state === 'succeeded')).toHaveLength(1)
            expect(jobRows.filter(row => row.state === 'failed')).toHaveLength(2)
            expect(
                credentialStore.getPublisherCredential(project.project.id, credential.credential.id)
            ).toMatchObject({ state: 'reconnect_required' })
        } finally {
            closeDatabase(database)
        }
    })

    it('services due projects in a round-robin order', async () => {
        let currentTime = now
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => currentTime })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => currentTime,
            })
            const publisherStore = createPublisherStore(database, {
                credentialRevoker: credentialStore,
                connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
                now: () => currentTime,
            })

            async function createLinkedInProject(name: string, externalAccountId: string) {
                const project = manualStore.createProject({
                    name,
                    subjectId: 'user-1',
                    displayName: 'Herald Operator',
                })
                const channel = manualStore.createChannel({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    name: `${name} channel`,
                    profile: linkedinChannelProfile,
                })
                expect(channel).not.toBeNull()
                if (channel === null) throw new Error(`The ${name} channel was not created`)

                const credential = await credentialStore.createPublisherCredential({
                    projectId: project.project.id,
                    connectedByActorId: project.actor.id,
                    providerId: 'linkedin',
                    externalAccountId,
                    scopes: ['openid', 'profile', 'w_member_social'],
                    accessToken: `${externalAccountId}-access-token`,
                })
                expect(credential.kind).toBe('created')
                if (credential.kind !== 'created')
                    throw new Error(`The ${name} credential was not created`)
                expect(
                    publisherStore.createPublisherConnection({
                        projectId: project.project.id,
                        channelId: channel.id,
                        subjectId: 'user-1',
                        kind: 'linkedin',
                        credentialId: credential.credential.id,
                    }).kind
                ).toBe('created')

                return { channel, project }
            }

            const busyProject = await createLinkedInProject('Busy project', 'busy-member')
            currentTime = now + 1
            const quietProject = await createLinkedInProject('Quiet project', 'quiet-member')
            currentTime = now

            function createPublication(projectId: string, channelId: string, text: string): void {
                expect(
                    manualStore.createPost({
                        projectId,
                        subjectId: 'user-1',
                        sourceContent: {
                            body: { text, format: 'plain_text' },
                            media: [],
                        },
                        publications: [{ channelId, deliveryMode: 'automatic', scheduledAt: now }],
                    })
                ).not.toBeNull()
            }

            createPublication(busyProject.project.project.id, busyProject.channel.id, 'busy-1')
            createPublication(busyProject.project.project.id, busyProject.channel.id, 'busy-2')
            createPublication(busyProject.project.project.id, busyProject.channel.id, 'busy-3')
            createPublication(quietProject.project.project.id, quietProject.channel.id, 'quiet-1')

            const delivered: string[] = []
            let externalId = 0
            const publisher = createLinkedInTextPublisher({
                baseUrl: 'https://linkedin.test',
                fetcher: async (_input, init) => {
                    const body = JSON.parse(String(init?.body)) as { commentary: string }
                    delivered.push(body.commentary)
                    externalId += 1
                    return new Response(null, {
                        status: 201,
                        headers: { 'x-restli-id': `urn:li:post:fair-${externalId}` },
                    })
                },
            })
            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                builtInProviderRegistry: createBuiltInProviderRegistry([
                    createLinkedInProviderAdapter({ textPublisher: publisher }),
                ]),
                createClaimToken: (() => {
                    let sequence = 0
                    return () => `fair-claim-${++sequence}`
                })(),
                now: () => currentTime,
            })

            await worker.processDueEvents(now)

            expect(delivered).toHaveLength(4)
            expect(delivered[1]).toBe('quiet-1')
            expect(delivered.filter(text => text.startsWith('busy-'))).toHaveLength(3)
            expect(
                database.$client
                    .query<{ count: number }, []>(
                        `select count(*) as count from publications where state = 'published'`
                    )
                    .get()?.count
            ).toBe(4)
        } finally {
            closeDatabase(database)
        }
    })

    it('uses a fresh processing time for each event in a long-running batch', async () => {
        let currentTime = now
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => currentTime })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => currentTime,
            })
            const publisherStore = createPublisherStore(database, {
                credentialRevoker: credentialStore,
                connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
                now: () => currentTime,
            })
            const project = manualStore.createProject({
                name: 'Worker Clock Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn Member',
                profile: linkedinChannelProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The worker clock channel was not created')

            const credential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-42',
                scopes: ['openid', 'profile', 'w_member_social'],
                accessToken: 'linkedin-access-token',
            })
            expect(credential.kind).toBe('created')
            if (credential.kind !== 'created')
                throw new Error('The worker clock credential was not created')

            expect(
                publisherStore.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: credential.credential.id,
                }).kind
            ).toBe('created')

            expect(createPostAt(manualStore, project.project.id, channel.id, now)).not.toBeNull()
            expect(createPostAt(manualStore, project.project.id, channel.id, now)).not.toBeNull()

            let requestCount = 0
            const publisher = createLinkedInTextPublisher({
                baseUrl: 'https://linkedin.test',
                fetcher: async () => {
                    requestCount += 1
                    if (requestCount === 1) currentTime = now + 60_000
                    return new Response(null, {
                        status: 201,
                        headers: { 'x-restli-id': `urn:li:post:clock-${requestCount}` },
                    })
                },
            })
            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                builtInProviderRegistry: createBuiltInProviderRegistry([
                    createLinkedInProviderAdapter({ textPublisher: publisher }),
                ]),
                now: () => currentTime,
                leaseDuration: 5 * 60_000,
                createClaimToken: (() => {
                    let sequence = 0
                    return () => `clock-claim-${++sequence}`
                })(),
            })

            await worker.processDueEvents(now)

            expect(
                database.$client
                    .query<{ claimedAt: number; completedAt: number }, []>(`
                        select claimed_at as claimedAt,
                               completed_at as completedAt
                        from jobs
                        order by started_at, id
                    `)
                    .all()
            ).toEqual([
                {
                    claimedAt: now,
                    completedAt: now + 60_000,
                },
                {
                    claimedAt: now + 60_000,
                    completedAt: now + 60_000,
                },
            ])
        } finally {
            closeDatabase(database)
        }
    })

    it('uploads and publishes a LinkedIn image through the real worker and SQLite state', async () => {
        const rootDirectory = await mkdtemp(join(tmpdir(), 'herald-worker-linkedin-image-'))
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const media = createMediaAssetStore(
                database,
                createLocalMediaStore({
                    storeId: 'local-test',
                    rootDirectory,
                    maxObjectBytes: 2_000_000,
                }),
                { now: () => now, deletionGracePeriodMs: 0 }
            )
            const manualStore = createManualStore(database, { now: () => now, media })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => now,
            })
            const publisherStore = createPublisherStore(database, {
                credentialRevoker: credentialStore,
                connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
                now: () => now,
            })
            const project = manualStore.createProject({
                name: 'LinkedIn Image Worker Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn Member',
                profile: linkedinChannelProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The LinkedIn image channel was not created')

            const credential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-42',
                scopes: ['openid', 'profile', 'w_member_social'],
                accessToken: 'linkedin-image-access-token',
            })
            expect(credential.kind).toBe('created')
            if (credential.kind !== 'created')
                throw new Error('The LinkedIn image credential was not created')

            expect(
                publisherStore.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: credential.credential.id,
                }).kind
            ).toBe('created')

            const bytes = createPng()
            const reservation = media.reserveUpload({
                projectId: project.project.id,
                subjectId: 'user-1',
                originalFilename: 'announcement.png',
                defaultAccessibilityText: 'Herald announcement image',
                expectedSize: bytes.byteLength,
                contentType: 'image/png',
            })
            expect(reservation).not.toBeNull()
            if (reservation === null)
                throw new Error('The LinkedIn image reservation was not created')
            expect(
                await media.upload({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    intentId: reservation.intent.id,
                    source: new Blob([bytes]).stream(),
                })
            ).toMatchObject({ kind: 'uploaded' })
            expect(
                await media.finalizeUpload({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    intentId: reservation.intent.id,
                })
            ).toMatchObject({ kind: 'ready' })

            const post = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'A LinkedIn image publication', format: 'plain_text' },
                    media: [{ assetId: reservation.asset.id }],
                },
                publications: [
                    { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now },
                ],
            })
            expect(post).not.toBeNull()

            const imageId = 'urn:li:image:worker-image-42'
            const requests: Array<{
                readonly input: string
                readonly init: RequestInit | undefined
            }> = []
            let uploadedBytes: Uint8Array | undefined
            const imagePublisher = createLinkedInImagePublisher({
                baseUrl: 'https://linkedin.test',
                fetcher: async (input, init) => {
                    requests.push({ input: input.toString(), init })
                    if (requests.length === 1) {
                        return Response.json({
                            value: {
                                uploadUrl:
                                    'https://uploads.linkedin.test/worker-image-42?signature=secret',
                                image: imageId,
                            },
                        })
                    }
                    if (requests.length === 2) {
                        uploadedBytes = new Uint8Array(
                            await new Response(init?.body ?? null).arrayBuffer()
                        )
                        return new Response(null, { status: 201 })
                    }
                    if (requests.length === 3) {
                        return new Response('retry the final post', { status: 429 })
                    }
                    return new Response(null, {
                        status: 201,
                        headers: { 'x-restli-id': 'urn:li:post:worker-image-42' },
                    })
                },
            })
            const providerMediaDeliveryStore = createProviderMediaDeliveryStore(database, {
                now: () => now + 1,
            })
            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                media,
                builtInProviderRegistry: createBuiltInProviderRegistry([
                    createLinkedInProviderAdapter({ imagePublisher }),
                ]),
                providerMediaDeliveryStore,
                createClaimToken: () => 'image-worker-claim',
                retryPolicy: {
                    nextRunAt: ({ failedAt }) => failedAt + 1,
                },
                now: () => now,
            })

            await worker.processDueEvents(now)
            expect(requests).toHaveLength(3)
            expect(
                database
                    .select({ state: publications.state })
                    .from(publications)
                    .where(eq(publications.projectId, project.project.id))
                    .all()
            ).toEqual([{ state: 'ready' }])

            await worker.processDueEvents(now + 1)

            expect(requests).toHaveLength(4)
            expect(uploadedBytes).toEqual(bytes)
            expect(requests[3]?.input).toBe('https://linkedin.test/rest/posts')
            expect(JSON.parse(String(requests[3]?.init?.body))).toMatchObject({
                author: 'urn:li:person:member-42',
                commentary: 'A LinkedIn image publication',
                content: {
                    media: { id: imageId, altText: 'Herald announcement image' },
                },
            })
            expect(
                database
                    .select({
                        state: publications.state,
                        externalId: publications.externalId,
                    })
                    .from(publications)
                    .where(eq(publications.projectId, project.project.id))
                    .all()
            ).toEqual([{ state: 'published', externalId: 'urn:li:post:worker-image-42' }])
            expect(
                database
                    .select({
                        state: providerMediaDeliveries.state,
                        remoteMediaId: providerMediaDeliveries.remoteMediaId,
                    })
                    .from(providerMediaDeliveries)
                    .all()
            ).toEqual([{ state: 'uploaded', remoteMediaId: imageId }])
        } finally {
            closeDatabase(database)
            await rm(rootDirectory, { recursive: true, force: true })
        }
    })

    it('delivers a custom HTTP webhook through the real worker and local HTTP server', async () => {
        let receivedBody: string | null = null
        let receivedSignature: string | null = null
        const receiver = Bun.serve({
            port: 0,
            async fetch(request) {
                receivedBody = await request.text()
                receivedSignature = request.headers.get('x-herald-signature')
                return Response.json({ accepted: true }, { status: 201 })
            },
        })
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => now })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => now,
            })
            const publisherStore = createPublisherStore(database, {
                credentialRevoker: credentialStore,
                connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
                now: () => now,
            })
            const project = manualStore.createProject({
                name: 'Custom HTTP Worker Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Local Receiver',
                profile: customWebhookProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The custom HTTP test channel was not created')

            const secret = 'custom-http-worker-secret-with-at-least-32-characters'
            const credential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'custom_http',
                externalAccountId: 'receiver-1',
                externalAccountName: 'Local Receiver',
                scopes: [],
                accessToken: secret,
                expiresAt: null,
            })
            expect(credential.kind).toBe('created')
            if (credential.kind !== 'created')
                throw new Error('The custom HTTP credential was not created')

            const connection = publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                kind: 'custom_http',
                credentialId: credential.credential.id,
                endpointUrl: `http://127.0.0.1:${new URL(receiver.url).port}`,
                authentication: { kind: 'none' },
            })
            expect(connection.kind).toBe('created')

            const post = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Delivered by the custom channel', format: 'plain_text' },
                    media: [],
                },
                publications: [
                    { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now },
                ],
            })
            expect(post).not.toBeNull()

            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                builtInProviderRegistry: createBuiltInProviderRegistry([]),
                customHttpTransport: createCustomHttpTransport({
                    privateDestinations: [
                        {
                            kind: 'cidr',
                            cidr: '127.0.0.0/8',
                            port: receiver.port ?? Number(new URL(receiver.url).port),
                            schemes: ['http'],
                        },
                    ],
                }),
                now: () => now,
            })

            await worker.processDueEvents(now)

            expect(receivedBody).not.toBeNull()
            expect(receivedSignature).toMatch(/^sha256=[0-9a-f]{64}$/)
            expect(JSON.parse(receivedBody ?? '{}')).toMatchObject({
                event: 'publication.delivery',
                content: { commentary: 'Delivered by the custom channel' },
            })
            expect(
                database
                    .select({ state: publications.state })
                    .from(publications)
                    .where(eq(publications.projectId, project.project.id))
                    .all()
            ).toEqual([{ state: 'published' }])
        } finally {
            receiver.stop()
            closeDatabase(database)
        }
    })

    it('delivers signed public media URLs through a mapped custom HTTP channel', async () => {
        const rootDirectory = await mkdtemp(join(tmpdir(), 'herald-worker-public-media-'))
        let receivedBody: string | null = null
        const receiver = Bun.serve({
            port: 0,
            async fetch(request) {
                receivedBody = await request.text()
                return Response.json({ accepted: true }, { status: 201 })
            },
        })
        const receiverPort = receiver.port
        if (receiverPort === undefined) throw new Error('The public media receiver has no port')
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const media = createMediaAssetStore(
                database,
                createLocalMediaStore({
                    storeId: 'local-test',
                    rootDirectory,
                    maxObjectBytes: 2_000_000,
                }),
                { now: () => now, deletionGracePeriodMs: 0 }
            )
            const manualStore = createManualStore(database, {
                now: () => now,
                media,
                publicMediaUrlAvailable: true,
            })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => now,
            })
            const publisherStore = createPublisherStore(database, {
                credentialRevoker: credentialStore,
                connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
                now: () => now,
            })
            const project = manualStore.createProject({
                name: 'Mapped Public Media Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const bytes = createPng()
            const reservation = media.reserveUpload({
                projectId: project.project.id,
                subjectId: 'user-1',
                originalFilename: 'cover.png',
                expectedSize: bytes.byteLength,
                contentType: 'image/png',
            })
            expect(reservation).not.toBeNull()
            if (reservation === null)
                throw new Error('The public media reservation was not created')

            const uploaded = await media.upload({
                projectId: project.project.id,
                subjectId: 'user-1',
                intentId: reservation.intent.id,
                source: new Blob([bytes]).stream(),
            })
            expect(uploaded.kind).toBe('uploaded')
            const finalized = await media.finalizeUpload({
                projectId: project.project.id,
                subjectId: 'user-1',
                intentId: reservation.intent.id,
            })
            expect(finalized.kind).toBe('ready')

            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Mapped Public Media Receiver',
                profile: customMappedMediaProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The mapped media channel was not created')

            const publisherCredential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'custom_http',
                externalAccountId: 'mapped-media-receiver',
                externalAccountName: 'Mapped Public Media Receiver',
                scopes: [],
                accessToken: 'custom-http-public-media-secret-with-at-least-32-characters',
                expiresAt: null,
            })
            expect(publisherCredential.kind).toBe('created')
            if (publisherCredential.kind !== 'created')
                throw new Error('The mapped media credential was not created')

            const connection = publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                kind: 'custom_http',
                credentialId: publisherCredential.credential.id,
                endpointUrl: `http://127.0.0.1:${receiverPort}`,
                authentication: { kind: 'none' },
            })
            expect(connection.kind).toBe('created')

            const post = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Mapped media delivery', format: 'plain_text' },
                    media: [{ assetId: reservation.asset.id }],
                },
                publications: [
                    { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now },
                ],
            })
            expect(post).not.toBeNull()

            const publicDelivery = createMediaPublicDelivery({
                baseURL: 'https://herald.example.test',
                signingSecret: 'media-public-delivery-secret-with-at-least-32-bytes',
                lifetimeMs: 60_000,
                now: () => now,
            })
            let publicUrl: string | null = null
            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                builtInProviderRegistry: createBuiltInProviderRegistry([]),
                media,
                customHttpTransport: createCustomHttpTransport({
                    privateDestinations: [
                        {
                            kind: 'cidr',
                            cidr: '127.0.0.0/8',
                            port: receiverPort,
                            schemes: ['http'],
                        },
                    ],
                }),
                resolveCustomHttpMediaUrl: (mediaReference, context) => {
                    publicUrl = publicDelivery.createUrl({
                        projectId: context.projectId,
                        assetId: mediaReference.assetId,
                        representationId: mediaReference.representationId,
                    })
                    return publicUrl
                },
                now: () => now,
            })

            await worker.processDueEvents(now)

            expect(receivedBody).not.toBeNull()
            const deliveredUrl = publicUrl
            if (deliveredUrl === null) throw new Error('The custom HTTP media URL was not created')
            expect(deliveredUrl).toStartWith('https://herald.example.test/api/media/public/')
            const body = JSON.parse(receivedBody ?? '{}') as {
                commentary: string
                media: string[]
            }
            expect(body.commentary).toBe('Mapped media delivery')
            expect(body.media).toEqual([deliveredUrl])
            const token = new URL(deliveredUrl).pathname.split('/').at(-1)!
            expect(publicDelivery.resolve(token, now)).toMatchObject({
                projectId: project.project.id,
                assetId: reservation.asset.id,
                representationId:
                    finalized.kind === 'ready' ? finalized.reservation.representation.id : '',
            })

            expect(
                database
                    .select({ state: publications.state })
                    .from(publications)
                    .where(eq(publications.projectId, project.project.id))
                    .all()
            ).toEqual([{ state: 'published' }])
        } finally {
            receiver.stop()
            closeDatabase(database)
            await rm(rootDirectory, { recursive: true, force: true })
        }
    })

    it('rejects changed custom HTTP media bytes before making a request', async () => {
        const rootDirectory = await mkdtemp(join(tmpdir(), 'herald-worker-custom-media-checksum-'))
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const media = createMediaAssetStore(
                database,
                createLocalMediaStore({
                    storeId: 'local-test',
                    rootDirectory,
                    maxObjectBytes: 2_000_000,
                }),
                { now: () => now, deletionGracePeriodMs: 0 }
            )
            const manualStore = createManualStore(database, { now: () => now, media })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => now,
            })
            const publisherStore = createPublisherStore(database, {
                credentialRevoker: credentialStore,
                connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
                now: () => now,
            })
            const project = manualStore.createProject({
                name: 'Custom HTTP Checksum Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const bytes = createPng()
            const reservation = media.reserveUpload({
                projectId: project.project.id,
                subjectId: 'user-1',
                originalFilename: 'image.png',
                expectedSize: bytes.byteLength,
                contentType: 'image/png',
            })
            expect(reservation).not.toBeNull()
            if (reservation === null)
                throw new Error('The checksum test reservation was not created')
            expect(
                (
                    await media.upload({
                        projectId: project.project.id,
                        subjectId: 'user-1',
                        intentId: reservation.intent.id,
                        source: new Blob([bytes]).stream(),
                    })
                ).kind
            ).toBe('uploaded')
            const finalized = await media.finalizeUpload({
                projectId: project.project.id,
                subjectId: 'user-1',
                intentId: reservation.intent.id,
            })
            expect(finalized.kind).toBe('ready')
            if (finalized.kind !== 'ready') throw new Error('The checksum test media was not ready')

            const changedBytes = new Uint8Array(bytes)
            changedBytes[changedBytes.length - 1]! ^= 0xff
            await Bun.write(
                join(rootDirectory, ...finalized.reservation.representation.objectKey.split('/')),
                changedBytes
            )

            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Custom HTTP Checksum Receiver',
                profile: customMultipartMediaProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The checksum test channel was not created')
            const credential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'custom_http',
                externalAccountId: 'checksum-receiver',
                externalAccountName: 'Custom HTTP Checksum Receiver',
                scopes: [],
                accessToken: 'custom-http-checksum-secret-with-at-least-32-characters',
                expiresAt: null,
            })
            expect(credential.kind).toBe('created')
            if (credential.kind !== 'created')
                throw new Error('The checksum test credential was not created')
            expect(
                publisherStore.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'user-1',
                    kind: 'custom_http',
                    credentialId: credential.credential.id,
                    endpointUrl: 'https://receiver.example.test',
                    authentication: { kind: 'none' },
                }).kind
            ).toBe('created')
            const post = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Checksum guarded delivery', format: 'plain_text' },
                    media: [{ assetId: reservation.asset.id }],
                },
                publications: [
                    { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now },
                ],
            })
            expect(post).not.toBeNull()

            const requests: unknown[] = []
            const requester = {
                request: async (request: unknown) => {
                    requests.push(request)
                    return { status: 201, headers: {}, body: '', bodyTruncated: false }
                },
            }
            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                builtInProviderRegistry: createBuiltInProviderRegistry([]),
                media,
                customHttpTransport: createCustomHttpTransport({
                    requester,
                    resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }],
                }),
                now: () => now,
            })
            await worker.processDueEvents(now)

            expect(requests).toHaveLength(0)
            expect(
                database
                    .select({ state: publications.state })
                    .from(publications)
                    .where(eq(publications.projectId, project.project.id))
                    .all()
            ).toEqual([{ state: 'failed' }])
        } finally {
            closeDatabase(database)
            await rm(rootDirectory, { recursive: true, force: true })
        }
    })

    it('refreshes an expired project credential before executing the external effect', async () => {
        const provider = Bun.serve({
            port: 0,
            async fetch(request) {
                const body = new URLSearchParams(await request.text())
                expect(body.get('grant_type')).toBe('refresh_token')
                expect(body.get('refresh_token')).toBe('old-refresh-token')
                expect(body.get('client_id')).toBe('linkedin-client-id')
                expect(body.get('client_secret')).toBe('linkedin-client-secret')
                return Response.json({
                    access_token: 'refreshed-access-token',
                    expires_in: 3600,
                    token_type: 'Bearer',
                })
            },
        })
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => now })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => now,
            })
            const publisherStore = createPublisherStore(database, {
                credentialRevoker: credentialStore,
                connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
                now: () => now,
            })
            const project = manualStore.createProject({
                name: 'Refresh Worker Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn Member',
                profile: linkedinChannelProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The refresh test channel was not created')

            const credential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-42',
                scopes: ['openid', 'profile', 'w_member_social'],
                accessToken: 'expired-access-token',
                refreshToken: 'old-refresh-token',
                expiresAt: now - 1,
            })
            expect(credential.kind).toBe('created')
            if (credential.kind !== 'created')
                throw new Error('The expired credential was not created')

            expect(
                publisherStore.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: credential.credential.id,
                }).kind
            ).toBe('created')

            const post = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Publication after token refresh', format: 'plain_text' },
                    media: [],
                },
                publications: [
                    { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now },
                ],
            })
            expect(post).not.toBeNull()

            let publishedAccessToken: string | null = null
            const publisher = createLinkedInTextPublisher({
                baseUrl: 'https://linkedin.test',
                fetcher: async (_input, init) => {
                    publishedAccessToken = new Headers(init?.headers).get('authorization')
                    return new Response(null, {
                        status: 201,
                        headers: { 'x-restli-id': 'urn:li:post:refreshed' },
                    })
                },
            })
            const authorizationServer: OAuthAuthorizationServer = {
                issuer: provider.url.origin,
                authorizationEndpoint: new URL('/authorize', provider.url).toString(),
                tokenEndpoint: new URL('/token', provider.url).toString(),
            }
            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                builtInProviderRegistry: createBuiltInProviderRegistry([
                    createLinkedInProviderAdapter({
                        oauth: {
                            authorizationServer,
                            clientId: 'linkedin-client-id',
                            clientAuthentication: clientSecretPost('linkedin-client-secret'),
                        },
                        textPublisher: publisher,
                    }),
                ]),
                now: () => now,
            })

            await worker.processDueEvents(now)

            expect(publishedAccessToken as string | null).toBe('Bearer refreshed-access-token')
            await expect(
                credentialStore.resolvePublisherCredentialSecrets(
                    project.project.id,
                    credential.credential.id
                )
            ).resolves.toEqual({
                accessToken: 'refreshed-access-token',
                refreshToken: 'old-refresh-token',
                providerSession: null,
            })
            expect(
                credentialStore.getPublisherCredential(project.project.id, credential.credential.id)
            ).toMatchObject({
                state: 'active',
                expiresAt: now + 3_600_000,
            })
            expect(
                database
                    .select({ state: publications.state, externalId: publications.externalId })
                    .from(publications)
                    .where(eq(publications.projectId, project.project.id))
                    .all()
            ).toEqual([{ state: 'published', externalId: 'urn:li:post:refreshed' }])
        } finally {
            provider.stop()
            closeDatabase(database)
        }
    })
})

function createPostAt(
    store: ReturnType<typeof createManualStore>,
    projectId: string,
    channelId: string,
    scheduledAt: number
) {
    return store.createPost({
        projectId,
        subjectId: 'user-1',
        sourceContent: {
            body: { text: `LinkedIn publication at ${scheduledAt}`, format: 'plain_text' },
            media: [],
        },
        publications: [{ channelId, deliveryMode: 'automatic', scheduledAt }],
    })
}
