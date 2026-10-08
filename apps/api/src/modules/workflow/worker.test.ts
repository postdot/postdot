import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
    ChannelProfileDefinition,
    DeclarativeHttpExecutionContract,
    SchedulerTimers,
} from '@herald/core'
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
import { auditEvents, providerMediaDeliveries, publications } from '@herald/db/schema'
import {
    createLinkedInImagePublisher,
    createLinkedInVideoPublisher,
    createLinkedInTextPublisher,
    linkedinChannelProfile,
} from '@herald/linkedin'
import {
    createMastodonPublisher,
    mastodonChannelProfile,
    mastodonImageChannelProfile,
} from '@herald/mastodon'
import { createLocalMediaStore } from '@herald/media'
import { clientSecretPost, type OAuthAuthorizationServer } from '@herald/oauth'
import { eq } from 'drizzle-orm'

import { assessWorkingDraftMedia } from '../../../../../packages/db/src/manual-store/publication-media'
import { createMediaPublicDelivery } from '../media/public-delivery'
import { createNotificationProjectionRuntime } from '../notifications/runtime'
import { linkedInPublisherConnectionPolicy } from '../publishers/providers/linkedin'
import { mastodonPublisherConnectionPolicy } from '../publishers/providers/mastodon'
import { createLinkedInProviderAdapter } from './providers/linkedin'
import { createMastodonProviderAdapter } from './providers/mastodon'
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

const customMappedRetryProfile: ChannelProfileDefinition = {
    ...customWebhookProfile,
    id: 'custom-mapped-retry',
    profileHash: 'sha256:custom-mapped-retry-profile-v1',
    schemaHash: 'sha256:custom-mapped-retry-schema-v1',
    execution: {
        kind: 'declarative_http',
        contractId: 'custom-mapped-retry',
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
                    },
                },
            },
            response: {
                successStatuses: [200, 201],
                retryableStatuses: [429, 503],
                rejectedStatuses: [400],
                ambiguousStatuses: [500],
            },
        },
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
            const runObservations: Array<{
                readonly outcome: 'success' | 'failure'
                readonly durationSeconds: number
            }> = []
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
                onRunCompleted: observation => runObservations.push(observation),
            })

            await worker.processDueEvents(now + 3)

            expect(runObservations).toHaveLength(1)
            expect(runObservations[0]?.outcome).toBe('success')
            expect(runObservations[0]?.durationSeconds).toBeGreaterThanOrEqual(0)

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

    it('retries a rejected custom HTTP publication and projects the final outcome', async () => {
        let attempt = 0
        const receivedBodies: unknown[] = []
        const receiver = Bun.serve({
            port: 0,
            async fetch(request) {
                receivedBodies.push(await request.json())
                attempt += 1
                return Response.json(
                    { accepted: attempt === 2 },
                    { status: attempt === 1 ? 400 : 201 }
                )
            },
        })
        const receiverPort = receiver.port
        if (receiverPort === undefined) throw new Error('The retry receiver has no port')
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
                name: 'Custom HTTP Retry Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Retry Receiver',
                profile: customMappedRetryProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The retry channel was not created')

            const credential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'custom_http',
                externalAccountId: 'retry-receiver',
                externalAccountName: 'Retry Receiver',
                scopes: [],
                accessToken: 'custom-http-retry-secret-with-at-least-32-characters',
                expiresAt: null,
            })
            expect(credential.kind).toBe('created')
            if (credential.kind !== 'created')
                throw new Error('The retry credential was not created')

            const connection = publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                kind: 'custom_http',
                credentialId: credential.credential.id,
                endpointUrl: `http://127.0.0.1:${receiverPort}`,
                authentication: { kind: 'none' },
            })
            expect(connection.kind).toBe('created')

            const created = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Retry this rejected publication', format: 'plain_text' },
                    media: [],
                },
                publications: [
                    { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now },
                ],
            })
            expect(created).not.toBeNull()
            if (created === null || created.publications[0] === undefined) {
                throw new Error('The retry publication was not created')
            }
            const publication = created.publications[0]

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
                            port: receiverPort,
                            schemes: ['http'],
                        },
                    ],
                }),
                now: () => now,
            })

            await worker.processDueEvents(now)
            expect(attempt).toBe(1)
            expect(readPublicationState(database, publication.id)).toBe('failed')

            const retried = manualStore.retryFailedPublication({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
            })
            expect(retried).toMatchObject({
                kind: 'retried',
                publication: { id: publication.id, state: 'ready' },
            })

            await worker.processDueEvents(now)
            expect(attempt).toBe(2)
            expect(readPublicationState(database, publication.id)).toBe('published')
            expect(receivedBodies).toEqual([
                { commentary: 'Retry this rejected publication' },
                { commentary: 'Retry this rejected publication' },
            ])

            const publicationAudit = database
                .select({
                    action: auditEvents.action,
                    entityId: auditEvents.entityId,
                    id: auditEvents.id,
                    metadataJson: auditEvents.metadataJson,
                })
                .from(auditEvents)
                .where(eq(auditEvents.entityId, publication.id))
                .all()
            expect(publicationAudit.map(event => event.action)).toEqual(
                expect.arrayContaining([
                    'publication.execution.failed',
                    'publication.retry_requested',
                    'publication.execution.succeeded',
                ])
            )
            const retryEvent = publicationAudit.find(
                event => event.action === 'publication.retry_requested'
            )
            expect(retryEvent).toBeDefined()
            expect(JSON.parse(retryEvent?.metadataJson ?? '{}')).toMatchObject({
                fromState: 'failed',
                toState: 'ready',
                previousAttempts: 1,
                retryAt: now,
            })

            const failedEvent = publicationAudit.find(
                event => event.action === 'publication.execution.failed'
            )
            const succeededEvent = publicationAudit.find(
                event => event.action === 'publication.execution.succeeded'
            )
            const notifications = createNotificationStore(database, { now: () => now })
            const notificationProjection = createNotificationProjectionRuntime(notifications)
            notificationProjection.runNow()
            const publicationNotifications = notifications
                .list({ projectId: project.project.id, subjectId: 'user-1' })
                ?.items.filter(item => item.subject.id === publication.id)
            expect(publicationNotifications).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        kind: 'publication_failed',
                        sourceEventId: failedEvent?.id,
                    }),
                    expect.objectContaining({
                        kind: 'publication_published',
                        sourceEventId: succeededEvent?.id,
                    }),
                ])
            )
        } finally {
            receiver.stop()
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

    it.each([
        [1, 'retry'],
        [3, 'retry'],
        [3, 'ambiguous'],
    ] as const)(
        'uploads %i LinkedIn images with durable %s handling',
        async (imageCount, failureMode) => {
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
                    cipher: createPublisherCredentialCipher({
                        keyId: 'test-v1',
                        key: encryptionKey,
                    }),
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
                const profile = JSON.parse(JSON.stringify(linkedinChannelProfile))
                if (imageCount === 1) {
                    profile.version = 2
                    profile.profileHash = 'sha256:herald-linkedin-member-post-v2'
                    profile.schemaHash = 'sha256:herald-linkedin-member-post-schema-v2'
                    profile.execution.revision = 'member-post-v2'
                    profile.capabilities.revision = 'linkedin-member-post-v2'
                    profile.contentSchema.properties.media.maxItems = 1
                    profile.capabilities.mediaFields[0].maxItems = 1
                }
                const channel = manualStore.createChannel({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    name: 'LinkedIn Member',
                    profile,
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
                const assets: string[] = []
                for (let index = 0; index < imageCount; index += 1) {
                    const reservation = media.reserveUpload({
                        projectId: project.project.id,
                        subjectId: 'user-1',
                        originalFilename: `announcement-${index}.png`,
                        defaultAccessibilityText: `Herald image ${index}`,
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

                    assets.push(reservation.asset.id)
                }

                const post = manualStore.createPost({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    sourceContent: {
                        body: { text: 'A LinkedIn image publication', format: 'plain_text' },
                        media: assets.map(assetId => ({ assetId })),
                    },
                    publications: [
                        { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now },
                    ],
                })
                expect(post).not.toBeNull()

                const requests: Array<{
                    readonly input: string
                    readonly init: RequestInit | undefined
                }> = []
                const uploadedBytes: Uint8Array[] = []
                let registrations = 0
                let uploads = 0
                let postAttempts = 0
                const imagePublisher = createLinkedInImagePublisher({
                    baseUrl: 'https://linkedin.test',
                    fetcher: async (url, init) => {
                        requests.push({ input: url.toString(), init })
                        if (url.toString().includes('initializeUpload')) {
                            registrations += 1
                            return Response.json({
                                value: {
                                    uploadUrl: `https://uploads.linkedin.test/image-${registrations}`,
                                    image: `urn:li:image:worker-${registrations}`,
                                },
                            })
                        }
                        if (init?.method === 'PUT') {
                            uploads += 1
                            uploadedBytes.push(
                                new Uint8Array(await new Response(init.body ?? null).arrayBuffer())
                            )
                            if (imageCount === 3 && uploads === 2)
                                return new Response('image response', {
                                    status: failureMode === 'ambiguous' ? 500 : 429,
                                })
                            return new Response(null, { status: 201 })
                        }
                        postAttempts += 1
                        if (postAttempts === 1)
                            return new Response('retry final post', { status: 429 })
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
                        createLinkedInProviderAdapter({
                            imagePublisher,
                            revision: profile.execution.revision,
                        }),
                    ]),
                    providerMediaDeliveryStore,
                    createClaimToken: () => 'image-worker-claim',
                    retryPolicy: {
                        nextRunAt: ({ failedAt }) => failedAt + 1,
                    },
                    now: () => now,
                })

                await worker.processDueEvents(now)
                expect(requests).toHaveLength(imageCount === 1 ? 3 : 4)
                expect(postAttempts).toBe(imageCount === 1 ? 1 : 0)
                if (failureMode === 'ambiguous') {
                    expect(
                        database.$client
                            .query('select state from publications where project_id = ?')
                            .all(project.project.id)
                    ).toEqual([{ state: 'ambiguous' }])
                    expect(
                        database.$client
                            .query('select state from provider_media_deliveries order by rowid')
                            .all()
                    ).toEqual([{ state: 'uploaded' }, { state: 'ambiguous' }])
                    await worker.processDueEvents(now + 60_000)
                    expect(uploads).toBe(2)
                    expect(postAttempts).toBe(0)
                    return
                }

                expect(
                    database
                        .select({ state: publications.state })
                        .from(publications)
                        .where(eq(publications.projectId, project.project.id))
                        .all()
                ).toEqual([{ state: 'ready' }])

                await worker.processDueEvents(now + 1)

                if (imageCount === 3) {
                    expect(postAttempts).toBe(1)
                    await worker.processDueEvents(now + 2)
                }
                expect(postAttempts).toBe(2)
                expect(registrations).toBe(imageCount === 1 ? 1 : 4)
                expect(uploads).toBe(registrations)
                for (const uploaded of uploadedBytes) expect(uploaded).toEqual(bytes)
                const last = requests.at(-1)
                expect(last?.input).toBe('https://linkedin.test/rest/posts')
                const expectedImages =
                    imageCount === 1
                        ? [{ id: 'urn:li:image:worker-1', altText: 'Herald image 0' }]
                        : [
                              { id: 'urn:li:image:worker-1', altText: 'Herald image 0' },
                              { id: 'urn:li:image:worker-3', altText: 'Herald image 1' },
                              { id: 'urn:li:image:worker-4', altText: 'Herald image 2' },
                          ]
                expect(JSON.parse(String(last?.init?.body))).toMatchObject({
                    author: 'urn:li:person:member-42',
                    commentary: 'A LinkedIn image publication',
                    content:
                        imageCount === 1
                            ? { media: expectedImages[0] }
                            : { multiImage: { images: expectedImages } },
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
                ).toEqual(
                    expectedImages.map(image => ({ state: 'uploaded', remoteMediaId: image.id }))
                )
            } finally {
                closeDatabase(database)
                await rm(rootDirectory, { recursive: true, force: true })
            }
        }
    )

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

    it('runs scheduled work through the worker scheduler and a local provider sandbox', async () => {
        let currentTime = now
        const attempts = new Map<string, number>()
        const timeoutRequests: number[] = []
        const deliveries: Array<{
            readonly label: string
            readonly attempt: number
            readonly status: number
        }> = []
        const receiver = Bun.serve({
            port: 0,
            async fetch(request) {
                const envelope = (await request.json()) as {
                    readonly content?: { readonly commentary?: string }
                    readonly commentary?: string
                }
                const label = envelope.content?.commentary ?? envelope.commentary ?? 'unknown'
                const attempt = (attempts.get(label) ?? 0) + 1
                attempts.set(label, attempt)

                if (label === 'timeout') {
                    timeoutRequests.push(attempt)
                    if (attempt === 1) {
                        await new Promise(resolve => setTimeout(resolve, 25))
                        return Response.json({ accepted: true }, { status: 201 })
                    }
                }

                const status =
                    label === 'retry'
                        ? attempt === 1
                            ? 429
                            : 201
                        : label === 'retry-5xx'
                          ? attempt === 1
                              ? 503
                              : 201
                          : label === 'failed'
                            ? 400
                            : label === 'ambiguous'
                              ? 500
                              : 201
                deliveries.push({ label, attempt, status })
                return Response.json({ accepted: status === 201 }, { status })
            },
        })
        const receiverPort = receiver.port
        if (receiverPort === undefined) throw new Error('The provider sandbox has no port')
        const timers = new WorkerFakeTimers()
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
                name: 'Worker Scheduler Sandbox Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Local Provider Sandbox',
                profile: customWebhookProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The provider sandbox channel was not created')

            const credential = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'custom_http',
                externalAccountId: 'worker-sandbox',
                externalAccountName: 'Local Provider Sandbox',
                scopes: [],
                accessToken: 'worker-sandbox-secret-with-at-least-32-characters',
                expiresAt: null,
            })
            expect(credential.kind).toBe('created')
            if (credential.kind !== 'created')
                throw new Error('The provider sandbox credential was not created')

            const connection = publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                kind: 'custom_http',
                credentialId: credential.credential.id,
                endpointUrl: `http://127.0.0.1:${receiverPort}`,
                authentication: { kind: 'none' },
            })
            expect(connection.kind).toBe('created')

            const mappedChannel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Mapped Provider Sandbox',
                profile: customMappedRetryProfile,
            })
            expect(mappedChannel).not.toBeNull()
            if (mappedChannel === null)
                throw new Error('The mapped provider sandbox channel was not created')

            const mappedConnection = publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: mappedChannel.id,
                subjectId: 'user-1',
                kind: 'custom_http',
                credentialId: credential.credential.id,
                endpointUrl: `http://127.0.0.1:${receiverPort}`,
                authentication: { kind: 'none' },
            })
            expect(mappedConnection.kind).toBe('created')

            const createSandboxPublication = (
                label: string,
                scheduledAt: number,
                publicationChannelId = channel.id
            ) => {
                const created = manualStore.createPost({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    sourceContent: {
                        body: { text: label, format: 'plain_text' },
                        media: [],
                    },
                    publications: [
                        {
                            channelId: publicationChannelId,
                            deliveryMode: 'automatic',
                            scheduledAt,
                        },
                    ],
                })
                expect(created).not.toBeNull()
                if (created === null || created.publications[0] === undefined) {
                    throw new Error(`The ${label} sandbox publication was not created`)
                }
                return created.publications[0]
            }

            const successful = createSandboxPublication('success', now + 100)
            const cancelled = createSandboxPublication('cancelled', now + 200)
            const worker = createPublicationWorker({
                database,
                publisherStore,
                publisherCredentialStore: credentialStore,
                builtInProviderRegistry: createBuiltInProviderRegistry([]),
                customHttpTransport: createCustomHttpTransport({
                    now: () => currentTime,
                    privateDestinations: [
                        {
                            kind: 'cidr',
                            cidr: '127.0.0.0/8',
                            port: receiverPort,
                            schemes: ['http'],
                        },
                    ],
                    timeoutMs: 5,
                }),
                now: () => currentTime,
                retryPolicy: { nextRunAt: ({ failedAt }) => failedAt + 100 },
                timers,
                createClaimToken: (() => {
                    let sequence = 0
                    return () => `sandbox-claim-${++sequence}`
                })(),
            })

            worker.start()
            expect(worker.scheduler.scheduledAt).toBe(now + 100)
            expect(
                manualStore.cancelPublications({
                    projectId: project.project.id,
                    publicationIds: [cancelled.id],
                    subjectId: 'user-1',
                })
            ).not.toBeNull()
            worker.replan()
            expect(worker.scheduler.scheduledAt).toBe(now + 100)

            currentTime = now + 100
            await timers.fireOnly()
            expect(deliveries).toEqual([{ label: 'success', attempt: 1, status: 201 }])
            expect(readPublicationState(database, successful.id)).toBe('published')
            expect(readPublicationState(database, cancelled.id)).toBe('cancelled')

            const retry = createSandboxPublication('retry', now + 200)
            const retryFiveHundredThree = createSandboxPublication(
                'retry-5xx',
                now + 200,
                mappedChannel.id
            )
            const failed = createSandboxPublication('failed', now + 200)
            const ambiguous = createSandboxPublication('ambiguous', now + 200)
            const timeout = createSandboxPublication('timeout', now + 200)
            worker.replan()
            expect(worker.scheduler.scheduledAt).toBe(now + 200)

            currentTime = now + 200
            await timers.fireOnly()
            expect(deliveries).toHaveLength(5)
            expect(deliveries).toEqual(
                expect.arrayContaining([
                    { label: 'success', attempt: 1, status: 201 },
                    { label: 'retry', attempt: 1, status: 429 },
                    { label: 'retry-5xx', attempt: 1, status: 503 },
                    { label: 'failed', attempt: 1, status: 400 },
                    { label: 'ambiguous', attempt: 1, status: 500 },
                ])
            )
            expect(readPublicationState(database, retry.id)).toBe('ready')
            expect(readPublicationState(database, retryFiveHundredThree.id)).toBe('ready')
            expect(readPublicationState(database, failed.id)).toBe('failed')
            expect(readPublicationState(database, ambiguous.id)).toBe('ambiguous')
            expect(readPublicationState(database, timeout.id)).toBe('ambiguous')
            expect(timeoutRequests).toEqual([1])
            expect(worker.scheduler.scheduledAt).toBe(now + 300)

            const reconciledTimeout = manualStore.reconcileAmbiguousPublication({
                projectId: project.project.id,
                publicationId: timeout.id,
                subjectId: 'user-1',
                resolution: 'failed',
                errorMessage: 'Operator verified that the provider did not accept the request',
            })
            expect(reconciledTimeout).toMatchObject({
                kind: 'reconciled',
                publication: { state: 'failed' },
            })
            expect(
                manualStore.retryFailedPublication({
                    projectId: project.project.id,
                    publicationId: timeout.id,
                    subjectId: 'user-1',
                })
            ).toMatchObject({ kind: 'retried', publication: { state: 'ready' } })
            worker.replan()
            expect(worker.scheduler.scheduledAt).toBe(now + 200)

            currentTime = now + 200
            await timers.fireOnly()
            expect(readPublicationState(database, timeout.id)).toBe('published')
            expect(timeoutRequests).toEqual([1, 2])
            expect(attempts.get('timeout')).toBe(2)
            expect(worker.scheduler.scheduledAt).toBe(now + 300)

            currentTime = now + 300
            await timers.fireOnly()
            expect(deliveries).toHaveLength(8)
            expect(deliveries).toEqual(
                expect.arrayContaining([
                    { label: 'retry', attempt: 2, status: 201 },
                    { label: 'retry-5xx', attempt: 2, status: 201 },
                ])
            )
            expect(attempts.get('retry')).toBe(2)
            expect(attempts.get('retry-5xx')).toBe(2)
            expect(attempts.get('failed')).toBe(1)
            expect(attempts.get('ambiguous')).toBe(1)
            expect(attempts.get('timeout')).toBe(2)
            expect(readPublicationState(database, retry.id)).toBe('published')
            expect(worker.scheduler.scheduledAt).toBeNull()

            await worker.stop()
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

class WorkerFakeTimers implements SchedulerTimers {
    #nextId = 1
    readonly active = new Map<
        number,
        { readonly callback: () => void | Promise<void>; readonly delay: number }
    >()

    set(callback: () => void | Promise<void>, delay: number): number {
        const id = this.#nextId
        this.#nextId += 1
        this.active.set(id, { callback, delay })
        return id
    }

    clear(handle: unknown): void {
        this.active.delete(handle as number)
    }

    async fireOnly(): Promise<void> {
        const entries = [...this.active.entries()]
        if (entries.length !== 1) throw new Error(`Expected one timer, received ${entries.length}`)

        const [id, timer] = entries[0]!
        this.active.delete(id)
        await timer.callback()
    }
}

function readPublicationState(
    database: ReturnType<typeof createDatabase>,
    publicationId: string
): string | undefined {
    return database
        .select({ state: publications.state })
        .from(publications)
        .where(eq(publications.id, publicationId))
        .all()[0]?.state
}

it('releases the worker during video processing and resumes without uploading or consuming failure attempts', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'herald-worker-linkedin-video-'))
    const database = createDatabase(':memory:')
    let clock = now
    try {
        runMigrations(database)
        const media = createMediaAssetStore(
            database,
            createLocalMediaStore({
                storeId: 'local-test',
                rootDirectory,
                maxObjectBytes: 2_000_000,
            }),
            { now: () => clock }
        )
        const manualStore = createManualStore(database, { now: () => clock, media })
        const credentials = createPublisherCredentialStore(database, {
            cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
            now: () => clock,
        })
        const publishers = createPublisherStore(database, {
            credentialRevoker: credentials,
            connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
            now: () => clock,
        })
        const project = manualStore.createProject({
            name: 'Video project',
            subjectId: 'video-user',
            displayName: 'Video editor',
        })!
        const channel = manualStore.createChannel({
            projectId: project.project.id,
            subjectId: 'video-user',
            name: 'LinkedIn video',
            profile: linkedinChannelProfile,
        })!
        const credential = await credentials.createPublisherCredential({
            projectId: project.project.id,
            connectedByActorId: project.actor.id,
            providerId: 'linkedin',
            externalAccountId: 'member-42',
            scopes: ['openid', 'profile', 'w_member_social'],
            accessToken: 'video-secret',
        })
        if (credential.kind !== 'created') throw new Error('Credential fixture failed')
        expect(
            publishers.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'video-user',
                kind: 'linkedin',
                credentialId: credential.credential.id,
            }).kind
        ).toBe('created')
        const bytes = await Bun.file(
            new URL('../../../../../packages/db/src/fixtures/video-h264.mp4', import.meta.url)
        ).bytes()
        const reserved = media.reserveUpload({
            projectId: project.project.id,
            subjectId: 'video-user',
            originalFilename: 'video.mp4',
            contentType: 'video/mp4',
            expectedSize: bytes.length,
        })!
        expect(
            await media.upload({
                projectId: project.project.id,
                subjectId: 'video-user',
                intentId: reserved.intent.id,
                source: new Blob([bytes]).stream(),
            })
        ).toMatchObject({ kind: 'uploaded' })
        expect(
            await media.finalizeUpload({
                projectId: project.project.id,
                subjectId: 'video-user',
                intentId: reserved.intent.id,
            })
        ).toMatchObject({ kind: 'ready' })
        const imageBytes = createPng()
        const image = media.reserveUpload({
            projectId: project.project.id,
            subjectId: 'video-user',
            originalFilename: 'image.png',
            contentType: 'image/png',
            expectedSize: imageBytes.length,
        })!
        await media.upload({
            projectId: project.project.id,
            subjectId: 'video-user',
            intentId: image.intent.id,
            source: new Blob([imageBytes]).stream(),
        })
        expect(
            await media.finalizeUpload({
                projectId: project.project.id,
                subjectId: 'video-user',
                intentId: image.intent.id,
            })
        ).toMatchObject({ kind: 'ready' })
        expect(
            assessWorkingDraftMedia(
                linkedinChannelProfile,
                {
                    commentary: 'Mixed media',
                    media: [{ assetId: reserved.asset.id }, { assetId: image.asset.id }],
                },
                project.project.id,
                'video-user',
                media,
                false
            )
        ).toEqual([
            expect.objectContaining({
                code: 'profile.media_incompatible',
                message: expect.stringContaining('cannot mix'),
            }),
        ])
        expect(
            assessWorkingDraftMedia(
                linkedinChannelProfile,
                {
                    commentary: 'Too many videos',
                    media: [{ assetId: reserved.asset.id }, { assetId: reserved.asset.id }],
                },
                project.project.id,
                'video-user',
                media,
                false
            )
        ).toEqual([
            expect.objectContaining({ message: expect.stringContaining('at most 1 video') }),
        ])
        const post = manualStore.createPost({
            projectId: project.project.id,
            subjectId: 'video-user',
            sourceContent: {
                body: { text: 'Native video', format: 'plain_text' },
                media: [{ assetId: reserved.asset.id }],
            },
            publications: [
                { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: clock },
            ],
        })!
        expect(post).not.toBeNull()
        let registrations = 0
        let transfers = 0
        let finalizations = 0
        let posts = 0
        let ready = false
        const publisher = createLinkedInVideoPublisher({
            fetcher: async (url, init) => {
                const path = String(url)
                if (path.includes('initializeUpload')) {
                    registrations++
                    return Response.json({
                        value: {
                            video: 'urn:li:video:worker',
                            uploadToken: 'private-session',
                            uploadInstructions: [
                                {
                                    firstByte: 0,
                                    lastByte: bytes.length - 1,
                                    uploadUrl: 'https://www.linkedin.com/video-part',
                                },
                            ],
                        },
                    })
                }
                if (init?.method === 'PUT') {
                    transfers++
                    expect(new Uint8Array(await new Response(init.body).arrayBuffer())).toEqual(
                        bytes
                    )
                    return new Response(null, { status: 201, headers: { etag: 'one' } })
                }
                if (path.includes('finalizeUpload')) {
                    finalizations++
                    return new Response(null, { status: 200 })
                }
                if (path.endsWith('/rest/posts')) {
                    posts++
                    return new Response(null, {
                        status: 201,
                        headers: { 'x-restli-id': 'urn:li:share:video' },
                    })
                }
                return Response.json({
                    id: 'urn:li:video:worker',
                    status: ready ? 'AVAILABLE' : 'PROCESSING',
                })
            },
        })
        const worker = createPublicationWorker({
            database,
            publisherStore: publishers,
            publisherCredentialStore: credentials,
            media,
            builtInProviderRegistry: createBuiltInProviderRegistry([
                createLinkedInProviderAdapter({ videoPublisher: publisher }),
            ]),
            now: () => clock,
        })
        for (let index = 0; index < 5; index++) {
            await worker.processDueEvents(clock)
            expect(database.$client.query('select state, attempts from jobs').all()).toEqual([
                { state: 'pending', attempts: 0 },
            ])
            expect(posts).toBe(0)
            clock += 60_000
        }
        ready = true
        await worker.processDueEvents(clock)
        expect({ registrations, transfers, finalizations, posts }).toEqual({
            registrations: 1,
            transfers: 1,
            finalizations: 1,
            posts: 1,
        })
        expect(database.$client.query('select state from publications').all()).toEqual([
            { state: 'published' },
        ])
        expect(
            database.$client
                .query('select state, remote_media_id as id from provider_media_deliveries')
                .all()
        ).toEqual([{ state: 'uploaded', id: 'urn:li:video:worker' }])
    } finally {
        closeDatabase(database)
        await rm(rootDirectory, { recursive: true, force: true })
    }
})

for (const scenario of [
    'processing',
    'instance-limit',
    'provider-failure',
    'upload-ambiguous',
    'timeout',
] as const) {
    it(`executes native Mastodon video with durable ${scenario} handling`, async () => {
        const rootDirectory = await mkdtemp(join(tmpdir(), 'herald-worker-mastodon-video-'))
        const database = createDatabase(':memory:')
        let clock = now
        try {
            runMigrations(database)
            const media = createMediaAssetStore(
                database,
                createLocalMediaStore({
                    storeId: 'local-test',
                    rootDirectory,
                    maxObjectBytes: 2_000_000,
                }),
                { now: () => clock }
            )
            const manualStore = createManualStore(database, { now: () => clock, media })
            const credentials = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
                now: () => clock,
            })
            const publishers = createPublisherStore(database, {
                credentialRevoker: credentials,
                connectionPolicies: { mastodon: mastodonPublisherConnectionPolicy },
                now: () => clock,
            })
            const project = manualStore.createProject({
                name: 'Video project',
                subjectId: 'video-user',
                displayName: 'Video editor',
            })!
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'video-user',
                name: 'Mastodon video',
                profile: mastodonChannelProfile,
            })!
            const credential = await credentials.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'mastodon',
                externalAccountId: 'account-42',
                scopes: ['read:accounts', 'write:media', 'write:statuses'],
                providerSession: JSON.stringify({
                    version: 1,
                    instanceUrl: 'https://mastodon.example',
                    clientId: 'client-one',
                    clientSecret: 'client-secret',
                }),
                accessToken: 'video-secret',
            })
            if (credential.kind !== 'created') throw new Error('Credential fixture failed')
            expect(
                publishers.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'video-user',
                    kind: 'mastodon',
                    endpointUrl: 'https://mastodon.example',
                    credentialId: credential.credential.id,
                }).kind
            ).toBe('created')
            const bytes = await Bun.file(
                new URL('../../../../../packages/db/src/fixtures/video-h264.mp4', import.meta.url)
            ).bytes()
            const reserved = media.reserveUpload({
                projectId: project.project.id,
                subjectId: 'video-user',
                originalFilename: 'video.mp4',
                contentType: 'video/mp4',
                expectedSize: bytes.length,
            })!
            expect(
                await media.upload({
                    projectId: project.project.id,
                    subjectId: 'video-user',
                    intentId: reserved.intent.id,
                    source: new Blob([bytes]).stream(),
                })
            ).toMatchObject({ kind: 'uploaded' })
            expect(
                await media.finalizeUpload({
                    projectId: project.project.id,
                    subjectId: 'video-user',
                    intentId: reserved.intent.id,
                })
            ).toMatchObject({ kind: 'ready' })

            expect(
                assessWorkingDraftMedia(
                    mastodonImageChannelProfile,
                    {
                        text: 'Historical',
                        media: [{ assetId: reserved.asset.id, accessibilityText: 'Moving scene' }],
                    },
                    project.project.id,
                    'video-user',
                    media,
                    false
                )
            ).not.toEqual([])
            expect(
                assessWorkingDraftMedia(
                    mastodonChannelProfile,
                    {
                        text: 'Too many',
                        media: [
                            { assetId: reserved.asset.id, accessibilityText: 'Moving scene' },
                            { assetId: reserved.asset.id, accessibilityText: 'Moving scene' },
                        ],
                    },
                    project.project.id,
                    'video-user',
                    media,
                    false
                )
            ).not.toEqual([])
            const post = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'video-user',
                sourceContent: {
                    body: { text: 'Native Mastodon video', format: 'plain_text' },
                    media: [{ assetId: reserved.asset.id, accessibilityText: 'Moving scene' }],
                },
                publications: [
                    { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: clock },
                ],
            })!
            expect(post).not.toBeNull()
            let transfers = 0
            let posts = 0
            let ready = false
            const publisher = createMastodonPublisher({
                baseUrl: 'https://mastodon.example',
                fetcher: async (url, init) => {
                    const path = String(url)
                    if (path.endsWith('/v2/instance'))
                        return Response.json({
                            configuration: {
                                media_attachments: {
                                    supported_mime_types: ['video/mp4'],
                                    video_size_limit:
                                        scenario === 'instance-limit' ? 1 : 100_000_000,
                                    video_matrix_limit: 8_294_400,
                                },
                            },
                        })
                    if (path.endsWith('/v2/media')) {
                        transfers++
                        const form = await new Response(init?.body, {
                            headers: {
                                'content-type': new Headers(init?.headers).get('content-type')!,
                            },
                        }).formData()
                        expect(
                            new Uint8Array(await (form.get('file') as File).arrayBuffer())
                        ).toEqual(bytes)
                        expect(form.get('description')).toBe('Moving scene')
                        if (scenario === 'upload-ambiguous')
                            throw new Error('secret echo video-secret')
                        return Response.json(
                            { id: 'video-one', type: 'video', url: null },
                            { status: 202 }
                        )
                    }
                    if (path.endsWith('/v1/statuses')) {
                        posts++
                        const payload = new URLSearchParams(String(init?.body))
                        expect(payload.getAll('media_ids[]')).toEqual(['video-one'])
                        expect(new Headers(init?.headers).get('idempotency-key')).toContain(':')
                        return Response.json({
                            id: 'status-one',
                            url: 'https://mastodon.example/@account/status-one',
                        })
                    }
                    if (scenario === 'provider-failure')
                        return Response.json({ error: 'Processing failed' }, { status: 422 })
                    return ready
                        ? Response.json({
                              id: 'video-one',
                              type: 'video',
                              url: 'https://mastodon.example/video.mp4',
                          })
                        : new Response(null, { status: 206 })
                },
            })
            const worker = createPublicationWorker({
                database,
                publisherStore: publishers,
                publisherCredentialStore: credentials,
                media,
                builtInProviderRegistry: createBuiltInProviderRegistry([
                    createMastodonProviderAdapter({ createPublisher: () => publisher }),
                ]),
                now: () => clock,
            })
            if (scenario === 'processing' || scenario === 'timeout') {
                for (let index = 0; index < 5; index++) {
                    await worker.processDueEvents(clock)
                    expect(
                        database.$client.query('select state, attempts from jobs').all()
                    ).toEqual([{ state: 'pending', attempts: 0 }])
                    expect(posts).toBe(0)
                    clock += 60_000
                }
                if (scenario === 'timeout') clock += 31 * 60_000
                else ready = true
            }
            await worker.processDueEvents(clock)
            expect(transfers).toBe(scenario === 'instance-limit' ? 0 : 1)
            expect(posts).toBe(scenario === 'processing' ? 1 : 0)
            expect(database.$client.query('select state from publications').all()).toEqual([
                {
                    state:
                        scenario === 'processing'
                            ? 'published'
                            : scenario === 'upload-ambiguous'
                              ? 'ambiguous'
                              : 'failed',
                },
            ])
            const deliveries = database.$client
                .query('select state, remote_media_id as id from provider_media_deliveries')
                .all()
            if (scenario === 'processing')
                expect(deliveries).toEqual([{ state: 'uploaded', id: 'video-one' }])
            if (scenario === 'upload-ambiguous')
                expect(deliveries).toEqual([{ state: 'ambiguous', id: null }])
            if (scenario === 'timeout') expect(transfers).toBe(1)
        } finally {
            closeDatabase(database)
            await rm(rootDirectory, { recursive: true, force: true })
        }
    })
}
