import { describe, expect, it } from 'bun:test'

import type { ChannelProfileDefinition } from '@herald/core'
import { createCustomHttpTransport } from '@herald/custom-http'
import {
    closeDatabase,
    createDatabase,
    createManualStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
    runMigrations,
} from '@herald/db'
import { publications } from '@herald/db/schema'
import { createLinkedInTextPublisher, linkedinTextChannelProfile } from '@herald/linkedin'
import { clientSecretPost, type OAuthAuthorizationServer } from '@herald/oauth'
import { eq } from 'drizzle-orm'

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

describe('publication worker', () => {
    it('executes scheduled LinkedIn publications through a project credential and persists outcomes', async () => {
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
                profile: linkedinTextChannelProfile,
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The test channel was not created')

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
                throw new Error('The test credential was not created')

            expect(
                publisherStore.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: credential.credential.id,
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
                linkedInPublisher: publisher,
                retryPolicy: {
                    nextRunAt: ({ attempts, failedAt }) =>
                        attempts === 1 ? failedAt + 60_000 : null,
                },
            })

            await worker.processDueEvents(now + 3)

            expect(requests).toHaveLength(4)
            expect(
                requests.every(
                    request =>
                        request.headers.get('authorization') === 'Bearer linkedin-access-token'
                )
            ).toBe(true)
            expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({
                author: 'urn:li:person:member-42',
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
                profile: linkedinTextChannelProfile,
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
                linkedinOAuth: {
                    authorizationServer,
                    clientId: 'linkedin-client-id',
                    clientAuthentication: clientSecretPost('linkedin-client-secret'),
                },
                linkedInPublisher: publisher,
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
