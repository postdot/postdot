import { describe, expect, it } from 'bun:test'

import { createAuth } from '@herald/auth'
import type { ChannelProfileDefinition } from '@herald/core'
import { closeDatabase, createDatabase, runMigrations } from '@herald/db'
import { publications, publisherCredentials, user as authUser } from '@herald/db/schema'
import { createLinkedInMemberProfileClient } from '@herald/linkedin'
import type { OAuthAuthorizationServer } from '@herald/oauth'
import { eq } from 'drizzle-orm'

import { createApp } from './app'
import { createPublisherRuntime, type PublisherRuntimeOptions } from './modules/publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

const customWebhookProfile: ChannelProfileDefinition = {
    id: 'custom-webhook',
    version: 1,
    profileHash: 'sha256:custom-webhook-profile-v1',
    schemaHash: 'sha256:custom-webhook-schema-v1',
    origin: 'custom',
    contentSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { body: { type: 'string', minLength: 1, maxLength: 1_000 } },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
    capabilities: {
        revision: 'custom-webhook-v1',
        textFields: [
            {
                bindingId: 'body',
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

function createFixture(options: { readonly linkedin?: PublisherRuntimeOptions['linkedin'] } = {}) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey,
        publisherEncryptionKeyId: 'test-v1',
        linkedin: options.linkedin,
    })
    const auth = createAuth(database, { baseURL, secret })
    const app = createApp({ auth, database, publisher, manualStore: { now: () => now } })

    return { app, database, publisher }
}

async function signUp(app: ReturnType<typeof createApp>, email = 'operator@herald.local') {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                origin: baseURL,
            },
            body: JSON.stringify({
                email,
                name: 'Herald Operator',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    expect(response.status).toBe(200)
    expect(cookie).toBeDefined()
    return cookie ?? ''
}

async function jsonRequest(
    app: ReturnType<typeof createApp>,
    path: string,
    cookie: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    headers.set('cookie', cookie)
    if (init.body !== undefined) headers.set('content-type', 'application/json')

    return app.handle(
        new Request(`${baseURL}${path}`, {
            ...init,
            headers,
        })
    )
}

describe('Herald API', () => {
    it('reports health publicly and mounts Better Auth', async () => {
        const { app, database } = createFixture()

        try {
            const healthResponse = await app.handle(new Request(`${baseURL}/health`))
            expect(healthResponse.status).toBe(200)
            expect(await healthResponse.json()).toEqual({ status: 'ok' })

            const authResponse = await app.handle(new Request(`${baseURL}/api/auth/ok`))
            expect(authResponse.status).toBe(200)
            expect(await authResponse.json()).toEqual({ ok: true })
        } finally {
            closeDatabase(database)
        }
    })

    it('publishes an OpenAPI inventory for the typed Herald routes', async () => {
        const { app, database } = createFixture()

        try {
            const response = await app.handle(new Request(`${baseURL}/openapi/json`))
            expect(response.status).toBe(200)

            const specification = (await response.json()) as {
                readonly paths: Record<string, { readonly get?: { readonly operationId?: string } }>
            }
            expect(Object.keys(specification.paths)).toEqual([
                '/health',
                '/api/projects',
                '/api/projects/{projectId}/channels',
                '/api/projects/{projectId}/channels/{channelId}/profile',
                '/api/projects/{projectId}/channels/{channelId}/profile-drafts',
                '/api/projects/{projectId}/channels/{channelId}/profile-drafts/{profileVersionId}/preview',
                '/api/projects/{projectId}/channels/{channelId}/profile-drafts/{profileVersionId}/activate',
                '/api/projects/{projectId}/publishers',
                '/api/projects/{projectId}/channels/{channelId}/publisher/custom-http/connect',
                '/api/projects/{projectId}/channels/{channelId}/publisher/linkedin/connect',
                '/api/oauth/linkedin/callback',
                '/api/projects/{projectId}/channels/{channelId}/publisher',
                '/api/projects/{projectId}/posts',
                '/api/projects/{projectId}/publications/due',
                '/api/projects/{projectId}/publications/{publicationId}/publish',
                '/api/projects/{projectId}/publications/{publicationId}/reconcile',
                '/api/projects/{projectId}/audit-events',
            ])
            expect(specification.paths['/health']?.get?.operationId).toBe('getHealth')
        } finally {
            closeDatabase(database)
        }
    })

    it('creates, previews, and activates a channel profile draft through the API', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'profile-operator@herald.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Profile API Project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }

            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Profile API Channel' }),
                }
            )
            const channelBody = (await channelResponse.json()) as { channel: { id: string } }

            const stateResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/profile`,
                cookie
            )
            expect(stateResponse.status).toBe(200)
            const stateBody = (await stateResponse.json()) as {
                active: { version: number; profile: Record<string, unknown> }
                draft: unknown
            }
            expect(stateBody.active.version).toBe(1)
            expect(stateBody.draft).toBeNull()

            const profile = structuredClone(stateBody.active.profile)
            const contentSchema = profile.contentSchema as {
                properties: { body: { maxLength: number } }
            }
            contentSchema.properties.body.maxLength = 100
            const capabilities = profile.capabilities as {
                revision: string
                textFields: Array<{ maxLength: number }>
            }
            capabilities.revision = 'manual-message-v2'
            capabilities.textFields[0]!.maxLength = 100
            profile.profileHash = 'sha256:herald-manual-message-v2'
            profile.schemaHash = 'sha256:herald-manual-message-schema-v2'

            const draftResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/profile-drafts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ profile }),
                }
            )
            expect(draftResponse.status).toBe(200)
            const draftBody = (await draftResponse.json()) as {
                profile: { id: string; version: number; state: string; revision: number }
            }
            expect(draftBody.profile).toMatchObject({ version: 2, state: 'draft', revision: 1 })

            const previewResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/profile-drafts/${draftBody.profile.id}/preview`,
                cookie,
                { method: 'POST', body: JSON.stringify({}) }
            )
            expect(previewResponse.status).toBe(200)
            expect(
                (await previewResponse.json()) as { assessment: { hasReviewRequired: boolean } }
            ).toEqual({
                assessment: expect.objectContaining({ hasReviewRequired: false }),
            })

            const activateResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/profile-drafts/${draftBody.profile.id}/activate`,
                cookie,
                { method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) }
            )
            expect(activateResponse.status).toBe(200)
            const activationBody = (await activateResponse.json()) as {
                channel: { profileVersionId: string }
                profile: { id: string; state: string; version: number }
            }
            expect(activationBody.profile).toMatchObject({
                id: draftBody.profile.id,
                state: 'active',
                version: 2,
            })
            expect(activationBody.channel.profileVersionId).toBe(draftBody.profile.id)
        } finally {
            closeDatabase(database)
        }
    })

    it('creates a project-owned custom HTTP connection without exposing its secret', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'custom-http-operator@herald.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Custom HTTP Project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        name: 'Custom Receiver',
                        profile: customWebhookProfile,
                    }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as { channel: { id: string } }
            const secret = 'custom-http-secret-with-at-least-32-characters'

            const connectionResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/custom-http/connect`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        endpointUrl: 'https://receiver.example.test',
                        authentication: { kind: 'none' },
                        externalAccountName: 'Project receiver',
                        secret,
                    }),
                }
            )

            expect(connectionResponse.status).toBe(200)
            const connectionBody = (await connectionResponse.json()) as {
                connection: Record<string, unknown>
            }
            expect(connectionBody.connection).toMatchObject({
                kind: 'custom_http',
                endpointUrl: 'https://receiver.example.test',
                authentication: { kind: 'none' },
            })
            expect(JSON.stringify(connectionBody)).not.toContain(secret)
        } finally {
            closeDatabase(database)
        }
    })

    it('protects project resources and completes the manual publication flow', async () => {
        const { app, database } = createFixture()

        try {
            const unauthorizedResponse = await app.handle(new Request(`${baseURL}/api/projects`))
            expect(unauthorizedResponse.status).toBe(401)

            const cookie = await signUp(app)

            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Herald Launch' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as {
                project: { id: string }
            }

            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Custom Manual Destination' }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as {
                channel: { id: string }
            }

            const secondChannelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Secondary Destination' }),
                }
            )
            const secondChannelBody = (await secondChannelResponse.json()) as {
                channel: { id: string }
            }

            const postResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/posts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        title: 'Herald is ready',
                        sourceContent: {
                            body: {
                                text: 'A source post for multiple destinations.',
                                format: 'plain_text',
                            },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channelBody.channel.id,
                                targetContent: { body: 'Manual copy', media: [] },
                                deliveryMode: 'manual',
                                scheduledAt: now,
                            },
                            {
                                channelId: secondChannelBody.channel.id,
                                targetContent: { body: 'Second copy', media: [] },
                                deliveryMode: 'manual',
                            },
                        ],
                    }),
                }
            )
            expect(postResponse.status).toBe(201)
            const postBody = (await postResponse.json()) as {
                publications: Array<{ id: string; state: string }>
            }
            expect(postBody.publications.map(publication => publication.state)).toEqual([
                'scheduled',
                'draft',
            ])

            const dueResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/due`,
                cookie
            )
            expect(dueResponse.status).toBe(200)
            const dueBody = (await dueResponse.json()) as {
                publications: Array<{ id: string; channelName: string }>
            }
            expect(dueBody.publications).toHaveLength(1)
            expect(dueBody.publications[0]?.channelName).toBe('Custom Manual Destination')

            const publishResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${dueBody.publications[0]?.id}/publish`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ externalId: 'manual-1' }),
                }
            )
            expect(publishResponse.status).toBe(200)
            const publishBody = (await publishResponse.json()) as {
                publication: { state: string; publishedByActorId: string | null }
            }
            expect(publishBody.publication.state).toBe('published')
            expect(publishBody.publication.publishedByActorId).toBeString()

            const auditResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/audit-events`,
                cookie
            )
            expect(auditResponse.status).toBe(200)
            const auditBody = (await auditResponse.json()) as {
                events: Array<{ action: string }>
            }
            expect(auditBody.events.map(event => event.action)).toContain('publication.published')
        } finally {
            closeDatabase(database)
        }
    })

    it('completes LinkedIn OAuth into a project-owned credential and connection', async () => {
        const provider = Bun.serve({
            port: 0,
            async fetch(request) {
                const url = new URL(request.url)
                if (url.pathname === '/token') {
                    const body = new URLSearchParams(await request.text())
                    expect(body.get('grant_type')).toBe('authorization_code')
                    expect(body.get('client_id')).toBe('linkedin-client-id')
                    expect(body.get('client_secret')).toBe('linkedin-client-secret')
                    expect(body.get('code')).toBe('authorization-code')
                    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
                    return Response.json({
                        access_token: 'linkedin-access-token',
                        refresh_token: 'linkedin-refresh-token',
                        expires_in: 3600,
                        scope: 'openid profile w_member_social',
                        token_type: 'Bearer',
                    })
                }
                if (url.pathname === '/v2/userinfo') {
                    expect(request.headers.get('authorization')).toBe(
                        'Bearer linkedin-access-token'
                    )
                    return Response.json({ sub: 'member-42', name: 'Herald Operator' })
                }
                return new Response('not found', { status: 404 })
            },
        })
        const providerOrigin = provider.url.origin
        const authorizationServer: OAuthAuthorizationServer = {
            issuer: providerOrigin,
            authorizationEndpoint: new URL('/authorize', provider.url).toString(),
            tokenEndpoint: new URL('/token', provider.url).toString(),
        }
        const { app, database } = createFixture({
            linkedin: {
                clientId: 'linkedin-client-id',
                clientSecret: 'linkedin-client-secret',
                authorizationServer,
                profileClient: createLinkedInMemberProfileClient({ baseUrl: providerOrigin }),
            },
        })

        try {
            const cookie = await signUp(app)
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'LinkedIn Project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as {
                project: { id: string }
            }

            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'LinkedIn Member', profile: 'linkedin' }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as {
                channel: { id: string }
            }

            const missingChannelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/missing-channel/publisher/linkedin/connect`,
                cookie,
                { method: 'POST' }
            )
            expect(missingChannelResponse.status).toBe(404)

            const connectionStartResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/linkedin/connect`,
                cookie,
                { method: 'POST' }
            )
            expect(connectionStartResponse.status).toBe(200)
            const connectionStartBody = (await connectionStartResponse.json()) as {
                provider: string
                scopes: string[]
                authorizationUrl: string
            }
            expect(connectionStartBody.provider).toBe('linkedin')
            expect(connectionStartBody.scopes).toEqual(['openid', 'profile', 'w_member_social'])
            const authorizationUrl = new URL(connectionStartBody.authorizationUrl)
            expect(authorizationUrl.searchParams.get('scope')).toBe(
                'openid profile w_member_social'
            )
            const state = authorizationUrl.searchParams.get('state')
            expect(state).toBeString()

            const callbackResponse = await app.handle(
                new Request(
                    `${baseURL}/api/oauth/linkedin/callback?code=authorization-code&state=${encodeURIComponent(state ?? '')}`,
                    { headers: { cookie } }
                )
            )
            expect(callbackResponse.status).toBe(303)
            expect(callbackResponse.headers.get('location')).toBe(
                'http://localhost:5173/dashboard?publisher=connected'
            )

            const storedAttempt = database.$client
                .query<{ stateDigest: Uint8Array; verifier: Uint8Array | null }, []>(`
                    select state_digest as stateDigest,
                           pkce_verifier_ciphertext as verifier
                    from oauth_authorization_attempts
                `)
                .get()
            expect(storedAttempt?.verifier).toBeNull()
            expect(storedAttempt?.stateDigest).toBeInstanceOf(Uint8Array)

            const listResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publishers`,
                cookie
            )
            expect(listResponse.status).toBe(200)
            const listBody = (await listResponse.json()) as {
                connections: Array<Record<string, unknown>>
            }
            expect(listBody.connections).toHaveLength(1)
            expect(listBody.connections[0]).toMatchObject({
                externalAccountId: 'member-42',
                externalAccountName: 'Herald Operator',
                kind: 'linkedin',
                providerId: 'linkedin',
                scopes: ['openid', 'profile', 'w_member_social'],
                state: 'active',
            })
            expect(listBody.connections[0]).not.toHaveProperty('accessToken')
            expect(listBody.connections[0]).not.toHaveProperty('refreshToken')

            expect(
                database.$client
                    .query<{ providerId: string }, []>(
                        `select provider_id as providerId from account`
                    )
                    .all()
            ).toEqual([{ providerId: 'credential' }])

            const duplicateResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/linkedin/connect`,
                cookie,
                { method: 'POST' }
            )
            expect(duplicateResponse.status).toBe(409)

            database.delete(authUser).run()
            expect(database.select().from(publisherCredentials).all()).toHaveLength(1)

            const disconnectResponse = await app.handle(
                new Request(
                    `${baseURL}/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher`,
                    { method: 'DELETE', headers: { cookie } }
                )
            )
            expect(disconnectResponse.status).toBe(401)
            expect(
                database
                    .select({ state: publisherCredentials.state })
                    .from(publisherCredentials)
                    .all()
            ).toEqual([{ state: 'active' }])
        } finally {
            provider.stop()
            closeDatabase(database)
        }
    })

    it('exposes an explicit reconciliation path for an ambiguous publication', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'reconciler@herald.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Reconciliation Project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Manual Channel' }),
                }
            )
            const channelBody = (await channelResponse.json()) as { channel: { id: string } }
            const postResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/posts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent: {
                            body: {
                                text: 'A publication requiring reconciliation',
                                format: 'plain_text',
                            },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channelBody.channel.id,
                                deliveryMode: 'manual',
                                scheduledAt: now,
                            },
                        ],
                    }),
                }
            )
            const postBody = (await postResponse.json()) as {
                publications: Array<{ id: string }>
            }
            const publicationId = postBody.publications[0]?.id
            expect(publicationId).toBeString()
            if (publicationId === undefined) throw new Error('The test publication is missing')

            database
                .update(publications)
                .set({ state: 'ambiguous', errorMessage: 'The external response was lost' })
                .where(eq(publications.id, publicationId))
                .run()

            const response = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${publicationId}/reconcile`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        resolution: 'failed',
                        errorMessage: 'Operator verified that no remote post exists',
                    }),
                }
            )
            expect(response.status).toBe(200)
            expect(await response.json()).toMatchObject({
                publication: {
                    state: 'failed',
                    errorMessage: 'Operator verified that no remote post exists',
                },
            })
        } finally {
            closeDatabase(database)
        }
    })
})
