import { describe, expect, it } from 'bun:test'

import { createAuth } from '@herald/auth'
import type { ChannelProfileDefinition } from '@herald/core'
import {
    closeDatabase,
    createDatabase,
    createProjectAccessTokenStore,
    runMigrations,
} from '@herald/db'
import { publications, publisherCredentials, user as authUser } from '@herald/db/schema'
import {
    createLinkedInMemberProfileClient,
    createLinkedInOrganizationClient,
} from '@herald/linkedin'
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

type HealthRuntime = NonNullable<Parameters<typeof createApp>[0]['runtime']>
type OpenApiResponse = {
    readonly description?: string
    readonly content?: {
        readonly 'application/json'?: {
            readonly schema?: {
                readonly allOf?: readonly {
                    readonly properties?: {
                        readonly status?: { readonly const?: string }
                    }
                }[]
            }
        }
    }
}

type OpenApiOperation = {
    readonly operationId?: string
    readonly responses?: Record<string, OpenApiResponse>
    readonly security?: readonly Record<string, readonly string[]>[]
}

function createFixture(
    options: {
        readonly linkedin?: PublisherRuntimeOptions['linkedin']
        readonly runtime?: HealthRuntime
    } = {}
) {
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
    const accessTokens = createProjectAccessTokenStore(database, { now: () => now })
    const app = createApp({
        auth,
        database,
        publisher,
        manualStore: { now: () => now },
        runtime: options.runtime,
        accessTokens,
    })

    return { accessTokens, app, database, publisher }
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

async function bearerRequest(
    app: ReturnType<typeof createApp>,
    path: string,
    token: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
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

    it('reports readiness only when the database and runtimes are active', async () => {
        const { app, database } = createFixture()

        try {
            const response = await app.handle(new Request(`${baseURL}/ready`))
            expect(response.status).toBe(503)
            expect(await response.json()).toEqual({
                status: 'not_ready',
                checks: {
                    database: 'ok',
                    scheduler: 'not_configured',
                    mediaMaintenance: 'not_configured',
                },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('reports ready for an active scheduler and media runtime', async () => {
        const { app, database } = createFixture({
            runtime: {
                scheduler: { state: 'started' },
                mediaMaintenance: { state: 'started' },
            },
        })

        try {
            const response = await app.handle(new Request(`${baseURL}/ready`))
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({
                status: 'ready',
                checks: {
                    database: 'ok',
                    scheduler: 'started',
                    mediaMaintenance: 'started',
                },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('reports runtime failure without hiding the live HTTP process', async () => {
        const { app, database } = createFixture({
            runtime: {
                scheduler: { state: 'failed' },
                mediaMaintenance: { state: 'started' },
            },
        })

        try {
            const response = await app.handle(new Request(`${baseURL}/health`))
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ status: 'ok' })

            const readinessResponse = await app.handle(new Request(`${baseURL}/ready`))
            expect(readinessResponse.status).toBe(503)
            expect(await readinessResponse.json()).toEqual({
                status: 'not_ready',
                checks: {
                    database: 'ok',
                    scheduler: 'failed',
                    mediaMaintenance: 'started',
                },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('reports a database failure as not ready', async () => {
        const { app, database } = createFixture({
            runtime: {
                scheduler: { state: 'started' },
                mediaMaintenance: { state: 'started' },
            },
        })
        closeDatabase(database)

        const response = await app.handle(new Request(`${baseURL}/ready`))
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({
            status: 'not_ready',
            checks: {
                database: 'failed',
                scheduler: 'started',
                mediaMaintenance: 'started',
            },
        })
    })

    it('publishes an OpenAPI inventory for the typed Herald routes', async () => {
        const { app, database } = createFixture()

        try {
            const response = await app.handle(new Request(`${baseURL}/openapi/json`))
            expect(response.status).toBe(200)

            const specification = (await response.json()) as {
                readonly components?: {
                    readonly securitySchemes?: Record<string, Record<string, unknown>>
                }
                readonly security?: readonly Record<string, readonly string[]>[]
                readonly paths: Record<
                    string,
                    {
                        readonly delete?: OpenApiOperation
                        readonly get?: OpenApiOperation
                        readonly patch?: OpenApiOperation
                        readonly post?: OpenApiOperation
                        readonly put?: OpenApiOperation
                    }
                >
            }
            expect(Object.keys(specification.paths)).toEqual([
                '/health',
                '/ready',
                '/api/projects',
                '/api/projects/{projectId}/access-tokens',
                '/api/projects/{projectId}/access-tokens/{tokenId}',
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
                '/api/projects/{projectId}/publications',
                '/api/projects/{projectId}/publications/due',
                '/api/projects/{projectId}/publications/{publicationId}/editor',
                '/api/projects/{projectId}/publications/{publicationId}/draft',
                '/api/projects/{projectId}/publications/{publicationId}/draft/rebase',
                '/api/projects/{projectId}/publications/{publicationId}/draft/promote',
                '/api/projects/{projectId}/publications/{publicationId}/publish',
                '/api/projects/{projectId}/publications/{publicationId}/reconcile',
                '/api/projects/{projectId}/media/uploads',
                '/api/projects/{projectId}/media/uploads/{intentId}',
                '/api/projects/{projectId}/media/uploads/{intentId}/finalize',
                '/api/projects/{projectId}/media',
                '/api/projects/{projectId}/media/{assetId}/content',
                '/api/projects/{projectId}/media/{assetId}',
                '/api/projects/{projectId}/audit-events',
            ])
            expect(specification.paths['/health']?.get?.operationId).toBe('getHealth')
            expect(specification.paths['/ready']?.get?.operationId).toBe('getReadiness')
            expect(specification.components?.securitySchemes).toEqual({
                bearerAuth: {
                    bearerFormat: 'Herald project access token',
                    description:
                        'A project-scoped machine token sent as Authorization: Bearer <token>.',
                    scheme: 'bearer',
                    type: 'http',
                },
                sessionCookie: {
                    description:
                        'The Better Auth email/password session cookie used by the web application.',
                    in: 'cookie',
                    name: 'better-auth.session_token',
                    type: 'apiKey',
                },
            })
            expect(specification.security).toEqual([{ bearerAuth: [] }, { sessionCookie: [] }])
            expect(specification.paths['/health']?.get?.security).toEqual([])
            expect(specification.paths['/api/projects']?.get?.security).toBeUndefined()
            expect(
                specification.paths['/api/projects/{projectId}/access-tokens']?.post?.security
            ).toEqual([{ sessionCookie: [] }])
            expect(
                Object.keys(
                    specification.paths['/api/projects/{projectId}/access-tokens']?.post
                        ?.responses ?? {}
                )
            ).toEqual(expect.arrayContaining(['400', '401', '403', '404', '422', '503']))
            expect(Object.keys(specification.paths['/ready']?.get?.responses ?? {})).toEqual([
                '200',
                '503',
            ])
            expect(readOpenApiStatus(specification.paths['/ready']?.get?.responses?.['200'])).toBe(
                'ready'
            )
            expect(readOpenApiStatus(specification.paths['/ready']?.get?.responses?.['503'])).toBe(
                'not_ready'
            )
        } finally {
            closeDatabase(database)
        }
    })

    it('reports unavailable media storage through the typed media surface', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'media-unavailable-operator@herald.local')
            const response = await jsonRequest(app, '/api/projects/project-id/media', cookie)

            expect(response.status).toBe(503)
            expect(await response.json()).toEqual({
                error: {
                    code: 'media_unavailable',
                    message: 'Media storage is not configured for this instance',
                },
            })
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

    it('creates and authenticates project tokens without impersonating their creator', async () => {
        const { accessTokens, app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'access-token-operator@herald.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Machine access project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const projectId = projectBody.project.id

            const createTokenResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/access-tokens`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Release agent' }),
                }
            )
            expect(createTokenResponse.status).toBe(201)
            const createdBody = (await createTokenResponse.json()) as {
                accessToken: { id: string; name: string; tokenPrefix: string }
                token: string
            }
            expect(createdBody.accessToken).toMatchObject({
                name: 'Release agent',
                tokenPrefix: expect.stringMatching(/^herald_pat_v1_[A-Za-z0-9_-]{12}$/),
            })
            expect(createdBody.token.length).toBeGreaterThan(40)

            const listedResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/access-tokens`,
                cookie
            )
            expect(listedResponse.status).toBe(200)
            const listedBody = await listedResponse.json()
            expect(listedBody).toEqual({
                accessTokens: [
                    expect.objectContaining({
                        id: createdBody.accessToken.id,
                        name: 'Release agent',
                        tokenPrefix: createdBody.accessToken.tokenPrefix,
                        revokedAt: null,
                    }),
                ],
            })
            expect(JSON.stringify(listedBody)).not.toContain(createdBody.token)

            const authentication = accessTokens.authenticate(createdBody.token)
            expect(authentication).not.toBeNull()

            const projectListResponse = await bearerRequest(app, '/api/projects', createdBody.token)
            expect(projectListResponse.status).toBe(200)
            expect(await projectListResponse.json()).toEqual({
                projects: [expect.objectContaining({ id: projectId })],
            })

            const channelResponse = await bearerRequest(
                app,
                `/api/projects/${projectId}/channels`,
                createdBody.token,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Agent destination' }),
                }
            )
            expect(channelResponse.status).toBe(201)

            const auditResponse = await bearerRequest(
                app,
                `/api/projects/${projectId}/audit-events`,
                createdBody.token
            )
            expect(auditResponse.status).toBe(200)
            const auditBody = (await auditResponse.json()) as {
                events: Array<{ action: string; actorId: string }>
            }
            expect(
                auditBody.events.find(event => event.action === 'channel.created')?.actorId
            ).toBe(authentication?.actorId)

            const tokenListResponse = await bearerRequest(
                app,
                `/api/projects/${projectId}/access-tokens`,
                createdBody.token
            )
            expect(tokenListResponse.status).toBe(403)

            const projectCreationResponse = await bearerRequest(
                app,
                '/api/projects',
                createdBody.token,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Should not be created by a token' }),
                }
            )
            expect(projectCreationResponse.status).toBe(403)

            const invalidBearerHeaders = new Headers({
                authorization: 'Bearer invalid-token',
                cookie,
            })
            const invalidBearerResponse = await app.handle(
                new Request(`${baseURL}/api/projects`, { headers: invalidBearerHeaders })
            )
            expect(invalidBearerResponse.status).toBe(401)

            const revokeResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/access-tokens/${createdBody.accessToken.id}`,
                cookie,
                { method: 'DELETE' }
            )
            expect(revokeResponse.status).toBe(200)
            expect(
                (await revokeResponse.json()) as {
                    accessToken: { revokedAt: number | null }
                }
            ).toEqual({ accessToken: expect.objectContaining({ revokedAt: now }) })
            expect(accessTokens.authenticate(createdBody.token)).toBeNull()

            const revokedResponse = await bearerRequest(app, '/api/projects', createdBody.token)
            expect(revokedResponse.status).toBe(401)
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

            const publicationId = postBody.publications[0]?.id
            const secondPublicationId = postBody.publications[1]?.id
            expect(publicationId).toBeString()
            expect(secondPublicationId).toBeString()
            const editorResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${publicationId}/editor`,
                cookie
            )
            expect(editorResponse.status).toBe(200)
            const editorBody = (await editorResponse.json()) as {
                editor: {
                    post: { sourceRevision: number; sourceContent: { body?: { text: string } } }
                    draft: { revision: number; content: Record<string, unknown> }
                    selectedTarget: { content: Record<string, unknown> } | null
                }
            }
            expect(editorBody.editor).toMatchObject({
                post: {
                    sourceRevision: 1,
                    sourceContent: {
                        body: { text: 'A source post for multiple destinations.' },
                    },
                },
                draft: { revision: 1, content: { body: 'Manual copy', media: [] } },
                selectedTarget: { content: { body: 'Manual copy', media: [] } },
            })

            const listResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications`,
                cookie
            )
            expect(listResponse.status).toBe(200)
            expect(
                (await listResponse.json()) as {
                    publications: Array<{ id: string; draftDiffersFromTarget: boolean }>
                }
            ).toMatchObject({
                publications: [
                    { id: publicationId, draftDiffersFromTarget: false },
                    expect.objectContaining({ draftDiffersFromTarget: true }),
                ],
            })

            const saveResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${publicationId}/draft`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        expectedRevision: 1,
                        sourceContent: {
                            body: {
                                text: 'An edited source post for multiple destinations.',
                                format: 'plain_text',
                            },
                            media: [],
                        },
                        targetContent: { body: 'Edited manual copy', media: [] },
                    }),
                }
            )
            expect(saveResponse.status).toBe(200)
            const savedEditor = (await saveResponse.json()) as {
                editor: {
                    post: { sourceRevision: number }
                    draft: { revision: number; content: Record<string, unknown> }
                    selectedTarget: { content: Record<string, unknown> } | null
                }
            }
            expect(savedEditor.editor).toMatchObject({
                post: { sourceRevision: 2 },
                draft: { revision: 2, content: { body: 'Edited manual copy', media: [] } },
                selectedTarget: { content: { body: 'Manual copy', media: [] } },
            })

            const siblingEditorResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${secondPublicationId}/editor`,
                cookie
            )
            expect(siblingEditorResponse.status).toBe(200)
            const siblingEditorBody = (await siblingEditorResponse.json()) as {
                editor: {
                    post: { sourceRevision: number }
                    draft: {
                        revision: number
                        sourceRevision: number
                        baseSourceContent: { body?: { text: string } }
                        content: Record<string, unknown>
                    }
                }
            }
            expect(siblingEditorBody.editor).toMatchObject({
                post: { sourceRevision: 2 },
                draft: {
                    revision: 1,
                    sourceRevision: 1,
                    baseSourceContent: {
                        body: { text: 'A source post for multiple destinations.' },
                    },
                    content: { body: 'Second copy', media: [] },
                },
            })

            const staleSiblingSaveResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${secondPublicationId}/draft`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        expectedRevision: 1,
                        targetContent: { body: 'Stale sibling copy', media: [] },
                    }),
                }
            )
            expect(staleSiblingSaveResponse.status).toBe(409)

            const rebaseResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${secondPublicationId}/draft/rebase`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ expectedRevision: 1 }),
                }
            )
            expect(rebaseResponse.status).toBe(200)
            const rebasedEditor = (await rebaseResponse.json()) as {
                editor: {
                    post: { sourceRevision: number }
                    draft: {
                        revision: number
                        sourceRevision: number
                        baseSourceContent: { body?: { text: string } }
                        content: Record<string, unknown>
                    }
                }
            }
            expect(rebasedEditor.editor).toMatchObject({
                post: { sourceRevision: 2 },
                draft: {
                    revision: 2,
                    sourceRevision: 2,
                    baseSourceContent: {
                        body: { text: 'An edited source post for multiple destinations.' },
                    },
                    content: { body: 'Second copy', media: [] },
                },
            })

            const idempotentRebaseResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${secondPublicationId}/draft/rebase`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ expectedRevision: 2 }),
                }
            )
            expect(idempotentRebaseResponse.status).toBe(200)
            expect(
                (
                    (await idempotentRebaseResponse.json()) as {
                        editor: { draft: { revision: number; sourceRevision: number } }
                    }
                ).editor.draft
            ).toMatchObject({ revision: 2, sourceRevision: 2 })

            const invalidRebaseResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${secondPublicationId}/draft/rebase`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ expectedRevision: 0 }),
                }
            )
            expect(invalidRebaseResponse.status).toBe(422)

            const staleSaveResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${publicationId}/draft`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        expectedRevision: 1,
                        targetContent: { body: 'Stale copy', media: [] },
                    }),
                }
            )
            expect(staleSaveResponse.status).toBe(409)

            const promoteResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${publicationId}/draft/promote`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ expectedRevision: 2, scheduledAt: now }),
                }
            )
            expect(promoteResponse.status).toBe(200)
            const promotedEditor = (await promoteResponse.json()) as {
                editor: {
                    publication: { targetRevisionId: string | null }
                    draft: { revision: number }
                    selectedTarget: { id: string; content: Record<string, unknown> } | null
                }
            }
            expect(promotedEditor.editor).toMatchObject({
                draft: { revision: 2 },
                selectedTarget: { content: { body: 'Edited manual copy', media: [] } },
            })
            expect(promotedEditor.editor.publication.targetRevisionId).toBeString()
            if (promotedEditor.editor.publication.targetRevisionId === null) {
                throw new Error('The promoted target revision is missing')
            }
            expect(promotedEditor.editor.selectedTarget?.id).toBe(
                promotedEditor.editor.publication.targetRevisionId
            )

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
            expect(auditBody.events.map(event => event.action)).toContain(
                'publication.draft.rebased'
            )
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
                    expect(body.get('code_verifier')).toBeNull()
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
            pkce: 'disabled',
        }
        const { accessTokens, app, database } = createFixture({
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

            const accessTokenResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/access-tokens`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'LinkedIn automation agent' }),
                }
            )
            expect(accessTokenResponse.status).toBe(201)
            const accessTokenBody = (await accessTokenResponse.json()) as { token: string }
            expect(accessTokens.authenticate(accessTokenBody.token)).not.toBeNull()

            const tokenConnectionStartResponse = await bearerRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/linkedin/connect`,
                accessTokenBody.token,
                { method: 'POST' }
            )
            expect(tokenConnectionStartResponse.status).toBe(403)

            const tokenCallbackResponse = await bearerRequest(
                app,
                '/api/oauth/linkedin/callback',
                accessTokenBody.token
            )
            expect(tokenCallbackResponse.status).toBe(303)
            expect(tokenCallbackResponse.headers.get('location')).toBe(
                'http://localhost:5173/dashboard?publisher=invalid_callback'
            )

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

    it('verifies and stores an explicit LinkedIn organization destination', async () => {
        const provider = Bun.serve({
            port: 0,
            async fetch(request) {
                const url = new URL(request.url)
                if (url.pathname === '/token') {
                    return Response.json({
                        access_token: 'linkedin-organization-access-token',
                        refresh_token: 'linkedin-organization-refresh-token',
                        expires_in: 3600,
                        scope: 'openid profile w_organization_social rw_organization_admin',
                        token_type: 'Bearer',
                    })
                }
                if (url.pathname === '/v2/userinfo') {
                    return Response.json({ sub: 'member-42', name: 'Herald Operator' })
                }
                if (url.pathname === '/rest/organizations/12345') {
                    expect(request.headers.get('authorization')).toBe(
                        'Bearer linkedin-organization-access-token'
                    )
                    return Response.json({ id: 12345, localizedName: 'Tala Web' })
                }
                return new Response('not found', { status: 404 })
            },
        })
        const providerOrigin = provider.url.origin
        const authorizationServer: OAuthAuthorizationServer = {
            issuer: providerOrigin,
            authorizationEndpoint: new URL('/authorize', provider.url).toString(),
            tokenEndpoint: new URL('/token', provider.url).toString(),
            pkce: 'disabled',
        }
        const { app, database } = createFixture({
            linkedin: {
                clientId: 'linkedin-client-id',
                clientSecret: 'linkedin-client-secret',
                authorizationServer,
                profileClient: createLinkedInMemberProfileClient({ baseUrl: providerOrigin }),
                organizationClient: createLinkedInOrganizationClient({ baseUrl: providerOrigin }),
            },
        })

        try {
            const cookie = await signUp(app, 'organization-operator@herald.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Organization Project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Tala Web Page', profile: 'linkedin' }),
                }
            )
            const channelBody = (await channelResponse.json()) as { channel: { id: string } }

            const startResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/linkedin/connect`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        destination: { type: 'organization', id: '12345' },
                    }),
                }
            )
            expect(startResponse.status).toBe(200)
            const startBody = (await startResponse.json()) as {
                scopes: string[]
                authorizationUrl: string
            }
            expect(startBody.scopes).toEqual([
                'openid',
                'profile',
                'rw_organization_admin',
                'w_organization_social',
            ])
            const authorizationUrl = new URL(startBody.authorizationUrl)
            expect(authorizationUrl.searchParams.get('scope')).toBe(
                'openid profile rw_organization_admin w_organization_social'
            )
            const state = authorizationUrl.searchParams.get('state')
            expect(state).toBeString()

            const callbackResponse = await app.handle(
                new Request(
                    `${baseURL}/api/oauth/linkedin/callback?code=organization-authorization-code&state=${encodeURIComponent(state ?? '')}`,
                    { headers: { cookie } }
                )
            )
            expect(callbackResponse.status).toBe(303)
            expect(callbackResponse.headers.get('location')).toBe(
                'http://localhost:5173/dashboard?publisher=connected'
            )

            const listResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publishers`,
                cookie
            )
            expect(listResponse.status).toBe(200)
            const listBody = (await listResponse.json()) as {
                connections: Array<Record<string, unknown>>
            }
            expect(listBody.connections[0]).toMatchObject({
                externalAccountId: 'member-42',
                destination: {
                    type: 'organization',
                    id: '12345',
                    name: 'Tala Web',
                },
                scopes: ['openid', 'profile', 'rw_organization_admin', 'w_organization_social'],
            })
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

function readOpenApiStatus(response: OpenApiResponse | undefined): string | undefined {
    return response?.content?.['application/json']?.schema?.allOf?.find(
        part => part.properties?.status !== undefined
    )?.properties?.status?.const
}
