import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import { createAuth } from '@postdot/auth'
import type { ChannelProfileDefinition } from '@postdot/core'
import {
    closeDatabase,
    createInstallationEmailSettingsStore,
    createSecretCipher,
    createAccessStore,
    createDatabase,
    createEventJournalStore,
    createNotificationStore,
    createNotificationEmailStore,
    runMigrations,
} from '@postdot/db'
import { publications, publisherCredentials, user as authUser } from '@postdot/db/schema'
import {
    createLinkedInMemberProfileClient,
    createLinkedInOrganizationClient,
} from '@postdot/linkedin'
import type { OAuthAuthorizationServer } from '@postdot/oauth'
import type { Registry } from '@prometheus-io/client'
import { eq } from 'drizzle-orm'

import { createApp } from './app'
import { createEmailSettingsService, type EmailSettingsService } from './modules/email/settings'
import { createPostdotMetrics } from './modules/metrics/metrics'
import { createNotificationProjectionRuntime } from './modules/notifications/runtime'
import type { ChannelListItemResponse } from './modules/projects/models'
import { createPublisherRuntime, type PublisherRuntimeOptions } from './modules/publishers/runtime'
import type { RecoveryService } from './recovery'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'
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
        mode: 'postdot_webhook',
    },
}

const customPathProfile: ChannelProfileDefinition = {
    ...customWebhookProfile,
    id: 'custom-path',
    profileHash: 'sha256:custom-path-profile-v1',
    schemaHash: 'sha256:custom-path-schema-v1',
    execution: {
        kind: 'declarative_http',
        contractId: 'custom-path',
        revision: '1',
        mode: 'mapped_http',
        request: {
            method: 'POST',
            path: ['hooks', { kind: 'secret' }, 'publish'],
            body: {
                kind: 'json',
                value: { kind: 'content', pointer: '/body' },
            },
            response: {
                successStatuses: [202],
                retryableStatuses: [429],
                rejectedStatuses: [400],
                ambiguousStatuses: [500],
            },
        },
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
        readonly 'text/plain'?: {
            readonly schema?: { readonly type?: string }
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
        readonly recovery?: RecoveryService
        readonly emailSettings?: EmailSettingsService
        readonly emailAlerts?: boolean
        readonly linkedin?: PublisherRuntimeOptions['linkedin']
        readonly x?: PublisherRuntimeOptions['x']
        readonly apiOrigin?: string
        readonly webOrigin?: string
        readonly runtime?: HealthRuntime
        readonly metrics?: {
            readonly registry: Registry
            readonly bearerToken: string
        }
        readonly allowAdditionalSignups?: boolean
    } = {}
) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const publisher = createPublisherRuntime(database, {
        apiOrigin: options.apiOrigin ?? baseURL,
        webOrigin: options.webOrigin ?? 'http://localhost:5173',
        publisherEncryptionKey,
        publisherEncryptionKeyId: 'test-v1',
        linkedin: options.linkedin,
        x: options.x,
        bluesky: {
            clientMetadataUrl: 'https://postdot.example.test/oauth/bluesky/client-metadata.json',
            handleResolver: 'https://bsky.social',
        },
    })
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, {
        baseURL,
        secret,
        access,
        allowAdditionalSignups: options.allowAdditionalSignups,
    })
    const notifications = createNotificationStore(database, { now: () => now + 1_000 })
    const app = createApp({
        auth,
        access,
        database,
        publisher,
        manualStore: { now: () => now },
        runtime: options.runtime,
        metrics: options.metrics,
        notifications,
        recovery: options.recovery,
        emailSettings: options.emailSettings,
        emailAlerts:
            options.emailAlerts === undefined
                ? undefined
                : { store: createNotificationEmailStore(database), available: options.emailAlerts },
    })

    return { access, app, auth, database, notifications, publisher }
}

async function signUp(app: ReturnType<typeof createApp>, email = 'operator@postdot.local') {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                origin: baseURL,
            },
            body: JSON.stringify({
                email,
                name: 'Postdot Operator',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    expect(response.status).toBe(200)
    expect(cookie).toBeDefined()
    return cookie ?? ''
}

/**
 * Test-only helper for a second user. The fixture must opt into the explicit
 * additional-signup seam; production keeps public signup closed after bootstrap.
 */
async function signUpFixtureAdditionalUser(app: ReturnType<typeof createApp>, email: string) {
    return signUp(app, email)
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

async function readStreamChunk(response: Response) {
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    if (reader === undefined) throw new Error('The response body is not readable')
    // Every stream opens with a comment frame so the connection is established
    // immediately; the assertions below are about the first event after it.
    await reader.read()
    const result = await reader.read()
    await reader.cancel()
    return {
        done: result.done,
        text: result.value === undefined ? '' : new TextDecoder().decode(result.value),
    }
}

describe('Postdot API', () => {
    it('applies source copy only with the reviewed source and draft revisions', async () => {
        const { app, database } = createFixture()
        try {
            const cookie = await signUp(app)
            const request = (path: string, body: unknown, method = 'POST') =>
                jsonRequest(app, path, cookie, { method, body: JSON.stringify(body) })
            const { project } = (await (
                await request('/api/projects', { name: 'Source review' })
            ).json()) as { project: { id: string } }
            const { channel } = (await (
                await request(`/api/projects/${project.id}/channels`, { name: 'Destination' })
            ).json()) as { channel: { id: string } }
            const created = await request(`/api/projects/${project.id}/posts`, {
                sourceContent: { body: { text: 'Source', format: 'plain_text' }, media: [] },
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'manual',
                        targetContent: { body: 'Adapted destination', language: 'fr', media: [] },
                    },
                ],
            })
            expect(created.status).toBe(201)
            const { publications } = (await created.json()) as { publications: { id: string }[] }
            const path = `/api/projects/${project.id}/publications/${publications[0]!.id}/draft/rebase`
            expect(
                (await request(path, { expectedRevision: 1, replaceContent: true })).status
            ).toBe(400)
            expect(
                (
                    await request(path, {
                        expectedRevision: 1,
                        expectedSourceRevision: 2,
                        replaceContent: true,
                    })
                ).status
            ).toBe(409)
            const applied = await request(path, {
                expectedRevision: 1,
                expectedSourceRevision: 1,
                replaceContent: true,
            })
            expect(applied.status).toBe(200)
            const body = (await applied.json()) as {
                editor: {
                    draft: { revision: number; content: unknown }
                    publication: { state: string }
                }
            }
            expect(body.editor.draft).toMatchObject({
                revision: 2,
                content: { body: 'Source', language: 'fr', media: [] },
            })
            expect(body.editor.publication.state).toBe('draft')
            expect(
                (
                    await request(path, {
                        expectedRevision: 1,
                        expectedSourceRevision: 1,
                        replaceContent: true,
                    })
                ).status
            ).toBe(409)
        } finally {
            closeDatabase(database)
        }
    })

    it('returns safe profile field issues for malformed drafts without changing saved state', async () => {
        const { app, database } = createFixture()
        try {
            const cookie = await signUp(app)
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Profile validation' }),
            })
            const { project } = (await projectResponse.json()) as { project: { id: string } }
            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${project.id}/channels`,
                cookie,
                { method: 'POST', body: JSON.stringify({ name: 'Validation channel' }) }
            )
            const { channel } = (await channelResponse.json()) as { channel: { id: string } }
            const path = `/api/projects/${project.id}/channels/${channel.id}`
            const original = (await (await jsonRequest(app, `${path}/profile`, cookie)).json()) as {
                active: { profile: Record<string, unknown> }
            }
            for (const [field, value, issuePath] of [
                ['capabilities', null, '/capabilities'],
                ['fieldBindings', {}, '/fieldBindings'],
                ['execution', null, '/execution'],
            ] as const) {
                const response = await jsonRequest(app, `${path}/profile-drafts`, cookie, {
                    method: 'POST',
                    body: JSON.stringify({
                        profile: { ...original.active.profile, [field]: value },
                    }),
                })
                expect(response.status).toBe(400)
                const body = (await response.json()) as {
                    error: { code: string; issues: { path: string; code: string }[] }
                }
                expect(body.error.code).toBe('invalid_content')
                expect(body.error.issues).toContainEqual(
                    expect.objectContaining({ path: issuePath })
                )
                expect(await (await jsonRequest(app, `${path}/profile`, cookie)).json()).toEqual(
                    original
                )
            }
            const invalid = structuredClone(original.active.profile)
            const capabilities = invalid.capabilities as { textFields: { bindingId: string }[] }
            capabilities.textFields[0]!.bindingId = 'FAKE_SENTINEL'
            const rejected = await jsonRequest(app, `${path}/profile-drafts`, cookie, {
                method: 'POST',
                body: JSON.stringify({ profile: invalid }),
            })
            expect(rejected.status).toBe(400)
            const text = await rejected.text()
            expect(text).not.toContain('FAKE_SENTINEL')
            expect(JSON.parse(text).error.issues).toContainEqual({
                path: '/capabilities/textFields/0/bindingId',
                code: 'capability.binding_missing',
            })
            const valid = await jsonRequest(app, `${path}/profile-drafts`, cookie, {
                method: 'POST',
                body: JSON.stringify({ profile: original.active.profile }),
            })
            expect(valid.status).toBe(200)
            const saved = (await valid.json()) as { profile: { revision: number } }
            const savedState = await (await jsonRequest(app, `${path}/profile`, cookie)).json()
            const invalidUpdate = await jsonRequest(app, `${path}/profile-drafts`, cookie, {
                method: 'POST',
                body: JSON.stringify({
                    profile: invalid,
                    expectedRevision: saved.profile.revision,
                }),
            })
            expect(invalidUpdate.status).toBe(400)
            expect(await (await jsonRequest(app, `${path}/profile`, cookie)).json()).toEqual(
                savedState
            )
            const conflict = await jsonRequest(app, `${path}/profile-drafts`, cookie, {
                method: 'POST',
                body: JSON.stringify({
                    profile: original.active.profile,
                    expectedRevision: saved.profile.revision - 1,
                }),
            })
            expect(conflict.status).toBe(409)
            const conflictBody = (await conflict.json()) as {
                error: { code: string; issues?: unknown }
            }
            expect(conflictBody.error.code).toBe('write_conflict')
            expect(conflictBody.error.issues).toBeUndefined()
        } finally {
            closeDatabase(database)
        }
    })

    it('derives creation fingerprints and returns structured definition feedback', async () => {
        const { app, database } = createFixture()
        try {
            const cookie = await signUp(app)
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Creation feedback' }),
            })
            expect(projectResponse.status).toBe(201)
            const { project } = (await projectResponse.json()) as { project: { id: string } }
            const channelsPath = `/api/projects/${project.id}/channels`
            const listCount = async () =>
                (
                    (await (await jsonRequest(app, channelsPath, cookie)).json()) as {
                        channels: unknown[]
                    }
                ).channels.length
            const baseProfile = {
                id: 'custom-creation',
                version: 1,
                origin: 'custom',
                contentSchema: {
                    $schema: 'https://json-schema.org/draft/2020-12/schema',
                    type: 'object',
                    properties: { body: { type: 'string', minLength: 1, maxLength: 1000 } },
                    required: ['body'],
                    additionalProperties: false,
                },
                fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
                capabilities: {
                    revision: 'postdot-custom-v1',
                    textFields: [
                        {
                            bindingId: 'body',
                            acceptedSourceFormats: ['plain_text'],
                            maxLength: 1000,
                        },
                    ],
                    mediaFields: [],
                    relations: [],
                },
                execution: { kind: 'manual' },
            }
            expect(await listCount()).toBe(0)

            const created = await jsonRequest(app, channelsPath, cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Derived channel', profile: baseProfile }),
            })
            expect(created.status).toBe(201)
            const firstId = ((await created.json()) as { channel: { id: string } }).channel.id
            const firstState = (await (
                await jsonRequest(app, `${channelsPath}/${firstId}/profile`, cookie)
            ).json()) as { active: { profile: Record<string, unknown> } }
            expect(firstState.active.profile.id).toBe('custom-creation')
            expect(firstState.active.profile.version).toBe(1)
            const listed = await jsonRequest(app, channelsPath, cookie)
            expect(listed.status).toBe(200)
            const listedBody = (await listed.json()) as { channels: ChannelListItemResponse[] }
            expect(listedBody.channels[0]!.execution).toEqual({ kind: 'manual' })
            expect(listedBody.channels[0]!.profileVersionId).toBeTruthy()
            expect(listedBody.channels[0]).not.toHaveProperty('profileJson')
            expect(listedBody.channels[0]).not.toHaveProperty('contentSchema')

            expect(firstState.active.profile.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
            expect(firstState.active.profile.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)

            const legacy = await jsonRequest(app, channelsPath, cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Legacy hashes replaced',
                    profile: {
                        ...structuredClone(baseProfile),
                        id: 'custom-legacy',
                        profileHash: 'sha256:operator-chosen-abc',
                        schemaHash: 'sha256:operator-chosen-schema',
                    },
                }),
            })
            expect(legacy.status).toBe(201)
            const legacyId = ((await legacy.json()) as { channel: { id: string } }).channel.id
            const legacyState = (await (
                await jsonRequest(app, `${channelsPath}/${legacyId}/profile`, cookie)
            ).json()) as { active: { profile: Record<string, unknown> } }
            expect(legacyState.active.profile.profileHash).not.toBe('sha256:operator-chosen-abc')
            expect(legacyState.active.profile.schemaHash).not.toBe('sha256:operator-chosen-schema')

            const identical = await jsonRequest(app, channelsPath, cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Identical reuse',
                    profile: structuredClone(baseProfile),
                }),
            })
            expect(identical.status).toBe(201)

            const altered = structuredClone(baseProfile)
            ;(altered.contentSchema.properties as { body: { maxLength: number } }).body.maxLength =
                900
            const alteredResponse = await jsonRequest(app, channelsPath, cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Altered reuse', profile: altered }),
            })
            expect(alteredResponse.status).toBe(201)
            const alteredId = ((await alteredResponse.json()) as { channel: { id: string } })
                .channel.id
            const alteredState = (await (
                await jsonRequest(app, `${channelsPath}/${alteredId}/profile`, cookie)
            ).json()) as { active: { profile: Record<string, unknown> } }
            expect(alteredState.active.profile.schemaHash).not.toBe(
                firstState.active.profile.schemaHash
            )

            const malformed = structuredClone(baseProfile) as Record<string, unknown>
            malformed.capabilities = null
            const malformedResponse = await jsonRequest(app, channelsPath, cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Malformed channel', profile: malformed }),
            })
            expect(malformedResponse.status).toBe(400)
            const malformedBody = (await malformedResponse.json()) as {
                error: {
                    code: string
                    issues: { path: string; code: string }[]
                    issueCount: number
                }
            }
            expect(malformedBody.error.code).toBe('invalid_content')
            expect(malformedBody.error.issues).toContainEqual({
                path: '/capabilities',
                code: 'profile.object_required',
            })

            const semantic = structuredClone(baseProfile)
            semantic.capabilities.textFields[0]!.bindingId = 'FAKE_SENTINEL'
            const semanticResponse = await jsonRequest(app, channelsPath, cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Semantic channel', profile: semantic }),
            })
            expect(semanticResponse.status).toBe(400)
            const semanticText = await semanticResponse.text()
            expect(semanticText).not.toContain('FAKE_SENTINEL')
            expect(JSON.parse(semanticText).error.issues).toContainEqual({
                path: '/capabilities/textFields/0/bindingId',
                code: 'capability.binding_missing',
            })
            expect(await listCount()).toBe(4)

            const builtin = await jsonRequest(app, channelsPath, cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Built-in channel', profile: 'manual-message' }),
            })
            expect(builtin.status).toBe(201)
            expect(await listCount()).toBe(5)
        } finally {
            closeDatabase(database)
        }
    })

    it('serves authenticated Prometheus scrapes over HTTP and reflects worker updates', async () => {
        const metrics = createPostdotMetrics()
        metrics.bindScheduler({ state: 'running' })
        metrics.observeWorkerRun({ outcome: 'success', durationSeconds: 0.25 })
        const bearerToken = 'postdot-test-monitoring-token-with-more-than-32-characters'
        const { app, database } = createFixture({
            metrics: { registry: metrics.registry, bearerToken },
        })
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: request => app.handle(request),
        })

        try {
            const metricsUrl = new URL('/metrics', server.url)
            const anonymousResponse = await fetch(metricsUrl)
            expect(anonymousResponse.status).toBe(401)
            expect(anonymousResponse.headers.get('www-authenticate')).toContain('Bearer')

            const invalidTokenResponse = await fetch(metricsUrl, {
                headers: { authorization: 'Bearer invalid-monitoring-token' },
            })
            expect(invalidTokenResponse.status).toBe(401)

            const response = await fetch(metricsUrl, {
                headers: { authorization: `Bearer ${bearerToken}` },
            })
            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toBe(metrics.registry.contentType)
            const firstExposition = await response.text()
            expect(firstExposition).toContain('postdot_process_memory_bytes{type="rss"}')
            expect(firstExposition).toContain(
                'postdot_publication_scheduler_state{state="running"} 1'
            )
            expect(firstExposition).toContain(
                'postdot_publication_worker_runs_total{outcome="success"} 1'
            )
            expect(firstExposition).toContain(
                'postdot_publication_worker_run_duration_seconds_bucket{le="0.5",outcome="success"} 1'
            )

            metrics.observeWorkerRun({ outcome: 'failure', durationSeconds: 2 })
            const updatedResponse = await fetch(metricsUrl, {
                headers: { authorization: `Bearer ${bearerToken}` },
            })
            expect(updatedResponse.status).toBe(200)
            const updatedExposition = await updatedResponse.text()
            expect(updatedExposition).toContain(
                'postdot_publication_worker_runs_total{outcome="failure"} 1'
            )
            expect(updatedExposition).toContain(
                'postdot_publication_worker_run_duration_seconds_bucket{le="5",outcome="failure"} 1'
            )

            const openApiResponse = await app.handle(new Request(`${baseURL}/openapi/json`))
            const openApi = (await openApiResponse.json()) as {
                readonly paths: Record<string, { readonly get?: OpenApiOperation }>
                readonly components?: {
                    readonly securitySchemes?: Record<string, unknown>
                }
            }
            expect(openApi.paths['/metrics']?.get?.security).toEqual([{ metricsBearerAuth: [] }])
            expect(openApi.components?.securitySchemes?.metricsBearerAuth).toMatchObject({
                scheme: 'bearer',
                type: 'http',
            })
        } finally {
            await server.stop(true)
            closeDatabase(database)
        }
    })

    it('does not expose the metrics route when monitoring is disabled', async () => {
        const { app, database } = createFixture()

        try {
            const response = await app.handle(new Request(`${baseURL}/metrics`))
            expect(response.status).toBe(404)
        } finally {
            closeDatabase(database)
        }
    })

    it('reports health publicly and mounts Better Auth', async () => {
        const { app, database } = createFixture()

        try {
            const healthResponse = await app.handle(new Request(`${baseURL}/health`))
            expect(healthResponse.status).toBe(200)
            expect(await healthResponse.json()).toEqual({ status: 'ok' })

            const metadataResponse = await app.handle(
                new Request(`${baseURL}/oauth/bluesky/client-metadata.json`)
            )
            expect(metadataResponse.status).toBe(200)
            expect(await metadataResponse.json()).toMatchObject({
                client_id: 'https://postdot.example.test/oauth/bluesky/client-metadata.json',
                redirect_uris: [`${baseURL}/api/oauth/bluesky/callback`],
                token_endpoint_auth_method: 'none',
                dpop_bound_access_tokens: true,
            })

            const authResponse = await app.handle(new Request(`${baseURL}/api/auth/ok`))
            expect(authResponse.status).toBe(200)
            expect(await authResponse.json()).toEqual({ ok: true })
        } finally {
            closeDatabase(database)
        }
    })

    it('preserves Better Auth session cookies through the Elysia mount', async () => {
        const { app, database } = createFixture()
        const email = 'elysia-auth-mount@postdot.local'

        try {
            const cookie = await signUp(app, email)
            const response = await app.handle(
                new Request(`${baseURL}/api/auth/get-session`, {
                    headers: { cookie },
                })
            )

            expect(response.status).toBe(200)
            expect(await response.json()).toMatchObject({ user: { email } })
        } finally {
            closeDatabase(database)
        }
    })

    for (const providerId of ['linkedin', 'instagram'] as const) {
        it(`${providerId}: manages runtime provider applications without exposing client secrets`, async () => {
            const { app, database } = createFixture()
            const clientSecret = `${providerId}-client-secret`

            try {
                const cookie = await signUp(app, 'provider-applications@postdot.local')
                const createResponse = await jsonRequest(
                    app,
                    '/api/settings/provider-applications',
                    cookie,
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            providerId,
                            name: `Postdot ${providerId}`,
                            clientId:
                                providerId === 'instagram' ? '123456789' : 'linkedin-client-id',
                            clientSecret: clientSecret,
                        }),
                    }
                )
                expect(createResponse.status).toBe(201)
                const created = (await createResponse.json()) as {
                    application: {
                        id: string
                        providerId: string
                        isDefault: boolean
                        hasClientSecret: boolean
                    }
                }
                expect(created.application).toMatchObject({
                    providerId,
                    isDefault: true,
                    hasClientSecret: true,
                })
                expect(JSON.stringify(created)).not.toContain(clientSecret)

                const listResponse = await jsonRequest(
                    app,
                    '/api/settings/provider-applications',
                    cookie
                )
                expect(listResponse.status).toBe(200)
                expect(await listResponse.json()).toEqual({
                    applications: [created.application],
                    xCallbackUri: `${baseURL}/api/oauth/x/callback`,
                    facebookCallbackUri: `${baseURL}/api/oauth/facebook/callback`,
                    instagramCallbackUri: `${baseURL}/api/oauth/instagram/callback`,
                })

                const disableResponse = await jsonRequest(
                    app,
                    `/api/settings/provider-applications/${created.application.id}`,
                    cookie,
                    {
                        method: 'PATCH',
                        body: JSON.stringify({ state: 'disabled' }),
                    }
                )
                expect(disableResponse.status).toBe(200)
                expect(await disableResponse.json()).toMatchObject({
                    application: {
                        id: created.application.id,
                        state: 'disabled',
                        isDefault: false,
                        hasClientSecret: true,
                    },
                })
            } finally {
                closeDatabase(database)
            }
        })
    }

    it('lists provider-owned channel profile presets for authenticated clients', async () => {
        const { app, database } = createFixture()

        try {
            const unauthenticatedResponse = await app.handle(
                new Request(`${baseURL}/api/channel-profile-presets`)
            )
            expect(unauthenticatedResponse.status).toBe(401)

            const cookie = await signUp(app, 'channel-profile-presets@postdot.local')
            const response = await jsonRequest(app, '/api/channel-profile-presets', cookie)
            expect(response.status).toBe(200)

            const body = (await response.json()) as {
                presets: Array<{
                    id: string
                    version: number
                    profile: {
                        id: string
                        version: number
                        origin: string
                    }
                }>
            }
            expect(body.presets.map(preset => preset.id)).toEqual([
                'manual-message',
                'linkedin',
                'bluesky',
                'mastodon',
                'discord',
                'telegram',
                'facebook',
                'instagram',
                'devto',
                'x',
            ])
            for (const preset of body.presets) {
                expect(preset.profile).toMatchObject({
                    id: preset.id,
                    version: preset.version,
                    origin: 'built_in',
                })
            }
        } finally {
            closeDatabase(database)
        }
    })

    it('accepts a local Bluesky application without exposing public metadata', async () => {
        const { app, database } = createFixture({
            apiOrigin: 'http://127.0.0.1:3000',
            webOrigin: 'http://127.0.0.1:5173',
        })

        try {
            const cookie = await signUp(app, 'provider-applications-loopback@postdot.local')
            const createResponse = await jsonRequest(
                app,
                '/api/settings/provider-applications',
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        providerId: 'bluesky',
                        name: 'Postdot Bluesky local',
                        clientMetadataUrl: null,
                    }),
                }
            )
            expect(createResponse.status).toBe(201)
            expect(await createResponse.json()).toMatchObject({
                application: {
                    providerId: 'bluesky',
                    clientMetadataUrl: null,
                    oauthMode: 'loopback',
                },
            })

            const metadataResponse = await app.handle(
                new Request(`${baseURL}/oauth/bluesky/client-metadata.json`)
            )
            expect(metadataResponse.status).toBe(404)
        } finally {
            closeDatabase(database)
        }
    })

    it('uses a persisted provider application immediately for OAuth initiation', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'runtime-oauth@postdot.local')
            const applicationResponse = await jsonRequest(
                app,
                '/api/settings/provider-applications',
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        providerId: 'linkedin',
                        name: 'Runtime LinkedIn',
                        clientId: 'runtime-linkedin-client-id',
                        clientSecret: 'runtime-linkedin-client-secret',
                    }),
                }
            )
            expect(applicationResponse.status).toBe(201)
            const applicationBody = (await applicationResponse.json()) as {
                application: { id: string }
            }
            const secondaryApplicationResponse = await jsonRequest(
                app,
                '/api/settings/provider-applications',
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        providerId: 'linkedin',
                        name: 'Secondary LinkedIn',
                        clientId: 'secondary-linkedin-client-id',
                        clientSecret: 'secondary-linkedin-client-secret',
                    }),
                }
            )
            expect(secondaryApplicationResponse.status).toBe(201)
            const secondaryApplicationBody = (await secondaryApplicationResponse.json()) as {
                application: { id: string }
            }

            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Runtime OAuth Project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Runtime LinkedIn Channel', profile: 'linkedin' }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as { channel: { id: string } }

            const connectResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/linkedin/connect`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        providerApplicationId: secondaryApplicationBody.application.id,
                    }),
                }
            )
            expect(connectResponse.status).toBe(200)
            const connection = (await connectResponse.json()) as { authorizationUrl: string }
            expect(new URL(connection.authorizationUrl).searchParams.get('client_id')).toBe(
                'secondary-linkedin-client-id'
            )

            const attempt = database.$client
                .query<{ providerApplicationId: string | null }, []>(
                    `select provider_application_id as providerApplicationId
                     from oauth_authorization_attempts`
                )
                .get()
            expect(attempt?.providerApplicationId).toBe(secondaryApplicationBody.application.id)
            expect(attempt?.providerApplicationId).not.toBe(applicationBody.application.id)
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
                    notifications: 'not_configured',
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
                notifications: { state: 'started' },
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
                    notifications: 'started',
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
                notifications: { state: 'started' },
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
                    notifications: 'started',
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
                notifications: { state: 'started' },
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
                notifications: 'started',
            },
        })
    })

    it('publishes an OpenAPI inventory for the typed Postdot routes', async () => {
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
                '/api/recovery/status',
                '/api/version',
                '/health',
                '/ready',
                '/api/account/avatar',
                '/api/account/avatars/{id}',
                '/api/instance/status',
                '/api/access/invitations/{token}',
                '/api/settings/recovery',
                '/api/settings/recovery/resume',
                '/api/settings/email',
                '/api/settings/email/test',
                '/api/access',
                '/api/access/members',
                '/api/access/members/{userId}',
                '/api/access/invitations',
                '/api/access/invitations/{invitationId}',
                '/api/access/invitations/accept',
                '/api/api-keys',
                '/api/api-keys/{keyId}',
                '/api/workspaces',
                '/api/workspaces/{workspaceId}',
                '/api/workspaces/{workspaceId}/members/{memberId}',
                '/api/workspaces/{workspaceId}/teams',
                '/api/workspaces/{workspaceId}/teams/{teamId}',
                '/api/workspaces/{workspaceId}/teams/{teamId}/members',
                '/api/workspaces/{workspaceId}/teams/{teamId}/members/{userId}',
                '/api/workspaces/{workspaceId}/invitations',
                '/api/workspaces/{workspaceId}/invitations/{invitationId}',
                '/api/workspaces/{workspaceId}/invitations/{invitationId}/accept',
                '/api/workspaces/{workspaceId}/channels',
                '/api/workspaces/{workspaceId}/channels/{channelId}/attachments',
                '/api/workspaces/{workspaceId}/channels/{channelId}/withdraw',
                '/api/workspaces/{workspaceId}/channels/{channelId}/management',
                '/api/workspaces/{workspaceId}/channels/{channelId}/cadence',
                '/api/settings/provider-applications',
                '/api/settings/provider-applications/{applicationId}',
                '/api/channel-profile-presets',
                '/api/resource-removals',
                '/api/projects/{projectId}/lifecycle/state',
                '/api/projects/{projectId}/lifecycle',
                '/api/projects/{projectId}/lifecycle/archive',
                '/api/projects/{projectId}/lifecycle/restore',
                '/api/workspaces/{workspaceId}/lifecycle',
                '/api/workspaces/{workspaceId}/lifecycle/archive',
                '/api/workspaces/{workspaceId}/lifecycle/restore',
                '/api/projects',
                '/api/projects/{projectId}',
                '/api/search',
                '/api/projects/{projectId}/membership',
                '/api/projects/{projectId}/members',
                '/api/projects/{projectId}/invitations',
                '/api/projects/{projectId}/invitations/{invitationId}',
                '/api/projects/{projectId}/invitations/{invitationId}/resend',
                '/api/projects/{projectId}/members/{memberId}',
                '/api/projects/{projectId}/user-grants',
                '/api/projects/{projectId}/user-grants/{userId}',
                '/api/projects/{projectId}/team-grants',
                '/api/projects/{projectId}/team-grants/{teamId}',
                '/api/categories',
                '/api/categories/{categoryId}',
                '/api/categories/{categoryId}/archive',
                '/api/categories/{categoryId}/restore',
                '/api/projects/{projectId}/category',
                '/api/projects/{projectId}/tags',
                '/api/projects/{projectId}/tags/{tagId}',
                '/api/projects/{projectId}/tags/{tagId}/archive',
                '/api/projects/{projectId}/tags/{tagId}/restore',
                '/api/projects/{projectId}/publications/{publicationId}/tags',
                '/api/projects/{projectId}/channels/{channelId}/cadence',
                '/api/projects/{projectId}/channels',
                '/api/projects/{projectId}/channels/{channelId}',
                '/api/projects/{projectId}/channels/{channelId}/archive',
                '/api/projects/{projectId}/channels/{channelId}/restore',
                '/api/projects/{projectId}/channel-occupancy',
                '/api/projects/{projectId}/channels/{channelId}/sharing',
                '/api/projects/{projectId}/channels/{channelId}/attachments',
                '/api/projects/{projectId}/channels/{channelId}/attachments/{attachedProjectId}/withdraw',
                '/api/projects/{projectId}/channels/{channelId}/management',
                '/api/projects/{projectId}/channels/{channelId}/profile',
                '/api/projects/{projectId}/channels/{channelId}/profile-drafts',
                '/api/projects/{projectId}/channels/{channelId}/profile-drafts/{profileVersionId}/preview',
                '/api/projects/{projectId}/channels/{channelId}/profile-drafts/{profileVersionId}/activate',
                '/api/projects/{projectId}/publishers',
                '/api/projects/{projectId}/channels/{channelId}/publisher/custom-http/connect',
                '/api/projects/{projectId}/channels/{channelId}/publisher/facebook/connect',
                '/api/oauth/facebook/callback',
                '/api/projects/{projectId}/channels/{channelId}/publisher/facebook/pages',
                '/api/projects/{projectId}/channels/{channelId}/publisher/facebook/select',
                '/api/projects/{projectId}/channels/{channelId}/publisher/instagram/connect',
                '/api/oauth/instagram/callback',
                '/api/projects/{projectId}/channels/{channelId}/publisher/linkedin/connect',
                '/api/oauth/linkedin/callback',
                '/api/projects/{projectId}/channels/{channelId}/publisher/telegram/connect',
                '/api/projects/{projectId}/channels/{channelId}/publisher/bluesky/connect',
                '/api/oauth/bluesky/callback',
                '/api/projects/{projectId}/channels/{channelId}/publisher/devto/connect',
                '/api/projects/{projectId}/channels/{channelId}/publisher/discord/connect',
                '/api/projects/{projectId}/channels/{channelId}/publisher/mastodon/connect',
                '/api/oauth/mastodon/callback',
                '/api/projects/{projectId}/channels/{channelId}/publisher/x/connect',
                '/api/oauth/x/callback',
                '/api/projects/{projectId}/channels/{channelId}/publisher',
                '/api/projects/{projectId}/posts/{postId}',
                '/api/projects/{projectId}/posts/{postId}/destinations',
                '/api/projects/{projectId}/posts',
                '/api/projects/{projectId}/publications/{publicationId}/move',
                '/api/projects/{projectId}/publications/{publicationId}/cadence',
                '/api/projects/{projectId}/publications/{publicationId}/cadence-override',
                '/api/projects/{projectId}/publications/{publicationId}/destination',
                '/api/projects/{projectId}/publications/{publicationId}/confirm-destination',
                '/api/projects/{projectId}/publication-composer-draft',
                '/api/projects/{projectId}/publications',
                '/api/projects/{projectId}/publications/due',
                '/api/projects/{projectId}/publications/approval-requests',
                '/api/projects/{projectId}/publications/schedule',
                '/api/projects/{projectId}/publications/cancel',
                '/api/projects/{projectId}/publications/{publicationId}',
                '/api/projects/{projectId}/publications/{publicationId}/duplicate',
                '/api/projects/{projectId}/publications/{publicationId}/approval-request',
                '/api/projects/{projectId}/publications/{publicationId}/approval-request/approve',
                '/api/projects/{projectId}/publications/{publicationId}/approval-request/reject',
                '/api/projects/{projectId}/publications/{publicationId}/editor',
                '/api/projects/{projectId}/publications/{publicationId}/draft',
                '/api/projects/{projectId}/publications/{publicationId}/draft/adoptions',
                '/api/projects/{projectId}/publications/{publicationId}/draft/assess-adoption',
                '/api/projects/{projectId}/publications/{publicationId}/draft/adopt-profile',
                '/api/projects/{projectId}/publications/{publicationId}/draft/rebase',
                '/api/projects/{projectId}/publications/{publicationId}/draft/promote',
                '/api/projects/{projectId}/publications/{publicationId}/publish',
                '/api/projects/{projectId}/publications/{publicationId}/retry',
                '/api/projects/{projectId}/publications/{publicationId}/reconcile',
                '/api/projects/{projectId}/media/uploads',
                '/api/projects/{projectId}/media/uploads/{intentId}',
                '/api/projects/{projectId}/media/uploads/{intentId}/finalize',
                '/api/projects/{projectId}/media/imports/url',
                '/api/projects/{projectId}/media/upload-policy',
                '/api/projects/{projectId}/media/sources',
                '/api/projects/{projectId}/media',
                '/api/projects/{projectId}/media/{assetId}/usage',
                '/api/projects/{projectId}/media/{assetId}/content',
                '/api/projects/{projectId}/media/{assetId}',
                '/api/projects/{projectId}/media/deletion-requests',
                '/api/projects/{projectId}/media/{assetId}/permanent',
                '/api/projects/{projectId}/media/{assetId}/restore',
                '/api/projects/{projectId}/email-alerts',
                '/api/notifications',
                '/api/notifications/{notificationId}/read',
                '/api/notifications/{notificationId}/archive',
                '/api/notification-preferences',
                '/api/notification-preferences/{kind}',
                '/api/projects/{projectId}/notifications',
                '/api/projects/{projectId}/notifications/{notificationId}/read',
                '/api/projects/{projectId}/notifications/{notificationId}/archive',
                '/api/projects/{projectId}/notification-preferences',
                '/api/projects/{projectId}/notification-preferences/{kind}',
                '/api/projects/{projectId}/analytics',
                '/api/projects/{projectId}/analytics/provider/bluesky',
                '/api/projects/{projectId}/analytics/provider/bluesky/latest',
                '/api/projects/{projectId}/analytics/provider/bluesky/collect',
                '/api/projects/{projectId}/analytics/provider/devto',
                '/api/projects/{projectId}/analytics/provider/devto/latest',
                '/api/projects/{projectId}/analytics/provider/devto/collect',
                '/api/projects/{projectId}/analytics/provider/mastodon',
                '/api/projects/{projectId}/analytics/provider/mastodon/latest',
                '/api/projects/{projectId}/analytics/provider/mastodon/collect',
                '/api/projects/{projectId}/publications/{publicationId}/comments',
                '/api/projects/{projectId}/publications/{publicationId}/comments/refresh',
                '/api/projects/{projectId}/publications/{publicationId}/comments/replies',
                '/api/projects/{projectId}/publications/{publicationId}/first-comment',
                '/api/projects/{projectId}/publications/{publicationId}/first-comment/cancel',
                '/api/projects/{projectId}/audit-events',
                '/api/projects/{projectId}/events',
                '/api/notifications/events',
            ])
            const firstCommentPath =
                '/api/projects/{projectId}/publications/{publicationId}/first-comment'
            expect(specification.paths[firstCommentPath]?.get?.operationId).toBe(
                'getPublicationFirstComment'
            )
            expect(specification.paths[firstCommentPath]?.put?.operationId).toBe(
                'savePublicationFirstComment'
            )
            expect(specification.paths[`${firstCommentPath}/cancel`]?.post?.operationId).toBe(
                'cancelPublicationFirstComment'
            )
            expect(specification.paths['/health']?.get?.operationId).toBe('getHealth')
            expect(specification.paths['/ready']?.get?.operationId).toBe('getReadiness')
            expect(specification.paths['/api/channel-profile-presets']?.get?.operationId).toBe(
                'listChannelProfilePresets'
            )
            expect(
                specification.paths['/api/projects/{projectId}/media/{assetId}/restore']?.post
                    ?.operationId
            ).toBe('restoreProjectMedia')
            expect(
                specification.paths['/api/projects/{projectId}/analytics/provider/devto']?.get
                    ?.operationId
            ).toBe('getDevtoProviderAnalytics')
            expect(
                specification.paths['/api/projects/{projectId}/analytics/provider/devto/collect']
                    ?.post?.operationId
            ).toBe('collectDevtoProviderAnalytics')
            expect(specification.paths['/api/projects/{projectId}/members']?.get?.operationId).toBe(
                'listProjectMembers'
            )
            expect(
                specification.paths['/api/projects/{projectId}/invitations']?.post?.operationId
            ).toBe('createProjectInvitation')
            expect(
                specification.paths['/api/projects/{projectId}/invitations/{invitationId}/resend']
                    ?.post?.operationId
            ).toBe('resendProjectInvitation')
            expect(
                specification.paths['/api/projects/{projectId}/publications/schedule']?.patch
                    ?.operationId
            ).toBe('reschedulePublications')
            expect(
                specification.paths['/api/projects/{projectId}/publications/cancel']?.patch
                    ?.operationId
            ).toBe('cancelPublications')
            expect(
                specification.paths['/api/projects/{projectId}/publications/{publicationId}/retry']
                    ?.post?.operationId
            ).toBe('retryFailedPublication')
            expect(
                specification.paths['/api/projects/{projectId}/publications/{publicationId}']
                    ?.delete?.operationId
            ).toBe('deleteDraftPublication')
            expect(
                specification.paths[
                    '/api/projects/{projectId}/publications/{publicationId}/duplicate'
                ]?.post?.operationId
            ).toBe('duplicateDraftPublication')
            expect(
                specification.paths['/api/projects/{projectId}/publications/approval-requests']?.get
                    ?.security
            ).toEqual([{ sessionCookie: [] }])
            expect(
                specification.paths[
                    '/api/projects/{projectId}/publications/{publicationId}/approval-request'
                ]?.post?.operationId
            ).toBe('submitPublicationForApproval')
            expect(
                specification.paths[
                    '/api/projects/{projectId}/publications/{publicationId}/approval-request/approve'
                ]?.post?.security
            ).toEqual([{ sessionCookie: [] }])
            expect(
                specification.paths[
                    '/api/projects/{projectId}/publications/{publicationId}/approval-request/reject'
                ]?.post?.security
            ).toEqual([{ sessionCookie: [] }])
            expect(specification.components?.securitySchemes).toEqual({
                bearerAuth: {
                    bearerFormat: 'Postdot API key',
                    description:
                        'A user-owned Postdot API key sent as `Authorization: Bearer <token>`. Its project scope is limited by the creator’s current access.',
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
            expect(specification.paths['/api/account/avatar']?.post?.security).toEqual([
                { sessionCookie: [] },
            ])
            expect(specification.paths['/api/account/avatar']?.delete?.security).toEqual([
                { sessionCookie: [] },
            ])
            expect(specification.paths['/api/account/avatars/{id}']?.get?.security).toEqual([
                { sessionCookie: [] },
            ])
            expect(specification.paths['/health']?.get?.security).toEqual([])
            expect(specification.paths['/metrics']).toBeUndefined()
            expect(specification.paths['/api/projects']?.get?.security).toBeUndefined()
            expect(specification.paths['/api/projects/{projectId}/events']?.get?.security).toEqual([
                { sessionCookie: [] },
            ])
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

    it('keeps taxonomy definitions instance-scoped and tags project-scoped', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'taxonomy-operator@postdot.local')
            const categoryResponse = await jsonRequest(app, '/api/categories', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: '  Product   Updates ' }),
            })
            expect(categoryResponse.status).toBe(201)
            const category = (await categoryResponse.json()) as {
                category: { id: string; name: string; normalizedName: string; state: string }
            }
            expect(category.category).toMatchObject({
                name: 'Product Updates',
                normalizedName: 'product updates',
                state: 'active',
            })

            const duplicateCategoryResponse = await jsonRequest(app, '/api/categories', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'product updates' }),
            })
            expect(duplicateCategoryResponse.status).toBe(409)
            expect(await duplicateCategoryResponse.json()).toMatchObject({
                error: { code: 'write_conflict' },
            })

            const firstProjectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Taxonomy project one' }),
            })
            expect(firstProjectResponse.status).toBe(201)
            const firstProject = (await firstProjectResponse.json()) as { project: { id: string } }

            const assignmentResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/category`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ categoryId: category.category.id }),
                }
            )
            expect(assignmentResponse.status).toBe(200)
            expect(await assignmentResponse.json()).toMatchObject({
                id: firstProject.project.id,
                primaryCategoryId: category.category.id,
            })

            const tagResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/tags`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Launch' }),
                }
            )
            expect(tagResponse.status).toBe(201)
            const tag = (await tagResponse.json()) as {
                tag: { id: string; projectId: string; name: string; state: string }
            }
            expect(tag.tag).toMatchObject({
                projectId: firstProject.project.id,
                name: 'Launch',
                state: 'active',
            })

            const duplicateTagResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/tags`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: ' launch ' }),
                }
            )
            expect(duplicateTagResponse.status).toBe(409)

            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Taxonomy destination' }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channel = (await channelResponse.json()) as { channel: { id: string } }
            const postResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/posts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        title: 'Taxonomy post',
                        sourceContent: {
                            body: {
                                text: 'A post to exercise publication tags.',
                                format: 'plain_text',
                            },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channel.channel.id,
                                targetContent: { body: 'A tagged publication.', media: [] },
                                deliveryMode: 'manual',
                            },
                        ],
                    }),
                }
            )
            expect(postResponse.status).toBe(201)
            const post = (await postResponse.json()) as {
                publications: Array<{ id: string }>
            }
            const publicationId = post.publications[0]?.id
            expect(publicationId).toBeString()

            const assignPublicationTagsResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/publications/${publicationId}/tags`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({ tagIds: [tag.tag.id] }),
                }
            )
            expect(assignPublicationTagsResponse.status).toBe(200)
            expect(await assignPublicationTagsResponse.json()).toMatchObject({
                tags: [expect.objectContaining({ id: tag.tag.id })],
            })

            const reviewTagResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/tags`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Needs review' }),
                }
            )
            expect(reviewTagResponse.status).toBe(201)
            const reviewTag = (await reviewTagResponse.json()) as { tag: { id: string } }

            const secondPostResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/posts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        title: 'Second taxonomy post',
                        sourceContent: {
                            body: { text: 'A second tagged post.', format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channel.channel.id,
                                targetContent: { body: 'A second tagged publication.', media: [] },
                                deliveryMode: 'manual',
                            },
                        ],
                    }),
                }
            )
            expect(secondPostResponse.status).toBe(201)
            const secondPost = (await secondPostResponse.json()) as {
                publications: Array<{ id: string }>
            }
            const secondPublicationId = secondPost.publications[0]?.id
            expect(secondPublicationId).toBeString()

            const replaceFirstTagsResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/publications/${publicationId}/tags`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({ tagIds: [tag.tag.id, reviewTag.tag.id] }),
                }
            )
            expect(replaceFirstTagsResponse.status).toBe(200)
            const replaceSecondTagsResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/publications/${secondPublicationId}/tags`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({ tagIds: [tag.tag.id] }),
                }
            )
            expect(replaceSecondTagsResponse.status).toBe(200)

            const csvFilterResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/publications?tagIds=${encodeURIComponent(`${tag.tag.id},${reviewTag.tag.id}`)}`,
                cookie
            )
            expect(csvFilterResponse.status).toBe(200)
            expect(await csvFilterResponse.json()).toEqual({
                publications: [
                    expect.objectContaining({
                        id: publicationId,
                        tagIds: [tag.tag.id, reviewTag.tag.id],
                    }),
                ],
                nextCursor: null,
                summary: { total: 1, manual: 1, automatic: 0, scheduled: 0, draft: 1 },
            })

            const repeatedFilterResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/publications?tagIds=${tag.tag.id}&tagIds=${reviewTag.tag.id}`,
                cookie
            )
            expect(repeatedFilterResponse.status).toBe(200)
            expect(await repeatedFilterResponse.json()).toMatchObject({
                publications: [expect.objectContaining({ id: publicationId })],
            })

            const boundedFilterResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/publications?tagIds=${encodeURIComponent(Array.from({ length: 21 }, (_, index) => `tag-${index}`).join(','))}`,
                cookie
            )
            expect(boundedFilterResponse.status).toBe(400)
            expect(await boundedFilterResponse.json()).toMatchObject({
                error: { code: 'invalid_input' },
            })

            const secondProjectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Taxonomy project two' }),
            })
            expect(secondProjectResponse.status).toBe(201)
            const secondProject = (await secondProjectResponse.json()) as {
                project: { id: string }
            }
            const secondTagResponse = await jsonRequest(
                app,
                `/api/projects/${secondProject.project.id}/tags`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Launch' }),
                }
            )
            expect(secondTagResponse.status).toBe(201)
            const secondTag = (await secondTagResponse.json()) as { tag: { id: string } }
            expect(secondTag.tag.id).not.toBe(tag.tag.id)

            const foreignFilterResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/publications?tagIds=${secondTag.tag.id}`,
                cookie
            )
            expect(foreignFilterResponse.status).toBe(200)
            expect(await foreignFilterResponse.json()).toEqual({
                publications: [],
                nextCursor: null,
                summary: { total: 0, manual: 0, automatic: 0, scheduled: 0, draft: 0 },
            })

            const firstTagsResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/tags`,
                cookie
            )
            expect(firstTagsResponse.status).toBe(200)
            expect(await firstTagsResponse.json()).toMatchObject({
                tags: expect.arrayContaining([
                    expect.objectContaining({ id: tag.tag.id, projectId: firstProject.project.id }),
                    expect.objectContaining({
                        id: reviewTag.tag.id,
                        projectId: firstProject.project.id,
                    }),
                ]),
            })

            const archiveTagResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/tags/${tag.tag.id}/archive`,
                cookie,
                { method: 'POST' }
            )
            expect(archiveTagResponse.status).toBe(200)
            expect(await archiveTagResponse.json()).toMatchObject({
                tag: { id: tag.tag.id, state: 'archived' },
            })

            const archiveReviewTagResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/tags/${reviewTag.tag.id}/archive`,
                cookie,
                { method: 'POST' }
            )
            expect(archiveReviewTagResponse.status).toBe(200)

            const activeTagsResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/tags`,
                cookie
            )
            expect(activeTagsResponse.status).toBe(200)
            expect(await activeTagsResponse.json()).toEqual({ tags: [] })

            const archivedTagsResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/tags?includeArchived=true`,
                cookie
            )
            expect(archivedTagsResponse.status).toBe(200)
            expect(await archivedTagsResponse.json()).toMatchObject({
                tags: expect.arrayContaining([
                    expect.objectContaining({ id: tag.tag.id, state: 'archived' }),
                    expect.objectContaining({ id: reviewTag.tag.id, state: 'archived' }),
                ]),
            })

            const publicationTagsResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/publications/${publicationId}/tags`,
                cookie
            )
            expect(publicationTagsResponse.status).toBe(200)
            expect(await publicationTagsResponse.json()).toMatchObject({
                tags: expect.arrayContaining([
                    expect.objectContaining({ id: tag.tag.id, state: 'archived' }),
                    expect.objectContaining({ id: reviewTag.tag.id, state: 'archived' }),
                ]),
            })

            const archiveCategoryResponse = await jsonRequest(
                app,
                `/api/categories/${category.category.id}/archive`,
                cookie,
                { method: 'POST' }
            )
            expect(archiveCategoryResponse.status).toBe(200)
            expect(await archiveCategoryResponse.json()).toMatchObject({
                category: { id: category.category.id, state: 'archived' },
            })

            const visibleCategoriesResponse = await jsonRequest(app, '/api/categories', cookie)
            expect(visibleCategoriesResponse.status).toBe(200)
            expect(await visibleCategoriesResponse.json()).toEqual({ categories: [] })

            const archivedCategoriesResponse = await jsonRequest(
                app,
                '/api/categories?includeArchived=true',
                cookie
            )
            expect(archivedCategoriesResponse.status).toBe(200)
            expect(await archivedCategoriesResponse.json()).toMatchObject({
                categories: [
                    expect.objectContaining({ id: category.category.id, state: 'archived' }),
                ],
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('exposes provider-neutral project analytics from the durable event journal', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'analytics@postdot.local')
            const createProjectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Analytics project', timeZone: 'Europe/Paris' }),
            })
            expect(createProjectResponse.status).toBe(201)
            const created = (await createProjectResponse.json()) as {
                project: { id: string }
            }
            const actor = database.$client
                .query<{ id: string }, [string]>(
                    `select id from actors where project_id = ?1 and kind = 'human'`
                )
                .get(created.project.id)
            expect(actor).toBeDefined()

            const eventAt = Date.now() - 1_000
            createEventJournalStore(database).append({
                id: 'analytics-api-event',
                projectId: created.project.id,
                actorId: actor?.id ?? '',
                name: 'publication.execution.effect_started',
                version: 1,
                subject: { type: 'publication', id: 'publication-1' },
                payload: {
                    jobId: 'analytics-api-job',
                    attempt: 1,
                    runAt: eventAt,
                },
                occurredAt: eventAt,
            })

            const response = await jsonRequest(
                app,
                `/api/projects/${created.project.id}/analytics?from=${eventAt}&to=${eventAt + 1}`,
                cookie
            )
            expect(response.status).toBe(200)
            expect(await response.json()).toMatchObject({
                projectId: created.project.id,
                projectTimeZone: 'Europe/Paris',
                range: { from: eventAt, to: eventAt + 1 },
                historical: {
                    executions: {
                        attempts: 1,
                    },
                    buckets: [
                        expect.objectContaining({
                            metrics: expect.objectContaining({
                                executionAttempts: 1,
                            }),
                        }),
                    ],
                },
                coverage: {
                    dataQuality: {
                        missingHistoricalDimensions: 1,
                    },
                },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('keeps project email enrollment human-owned, verified and optional', async () => {
        const { app, database } = createFixture({ emailAlerts: true })
        try {
            const cookie = await signUp(app)
            const created = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Email alerts' }),
            })
            const projectId = ((await created.json()) as { project: { id: string } }).project.id
            const path = `/api/projects/${projectId}/email-alerts`
            expect(await (await jsonRequest(app, path, cookie)).json()).toMatchObject({
                enabled: false,
                available: true,
                verified: false,
            })
            const enable = () =>
                jsonRequest(app, path, cookie, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: true }),
                })
            expect((await enable()).status).toBe(400)
            database.$client.exec('update user set email_verified = 1')
            expect((await enable()).status).toBe(200)
            expect(await (await jsonRequest(app, path, cookie)).json()).toMatchObject({
                enabled: true,
                verified: true,
            })
            const key = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({ projectIds: [projectId] }),
            })
            const token = ((await key.json()) as { token: string }).token
            expect(
                (
                    await app.handle(
                        new Request(`${baseURL}${path}`, {
                            headers: { authorization: `Bearer ${token}` },
                        })
                    )
                ).status
            ).toBe(403)
            expect(
                (await jsonRequest(app, '/api/projects/missing/email-alerts', cookie)).status
            ).toBe(404)
            expect(
                (
                    await jsonRequest(app, path, cookie, {
                        method: 'PATCH',
                        body: JSON.stringify({ enabled: false }),
                    })
                ).status
            ).toBe(200)
        } finally {
            closeDatabase(database)
        }
    })

    it('exposes a human-only persistent notification inbox and preferences', async () => {
        const { app, database, notifications } = createFixture()

        try {
            const cookie = await signUp(app)
            const createProjectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Notification project' }),
            })
            expect(createProjectResponse.status).toBe(201)
            const created = (await createProjectResponse.json()) as {
                project: { id: string }
            }
            const actor = database.$client
                .query<{ id: string }, [string]>(
                    `select id from actors where project_id = ?1 and kind = 'human'`
                )
                .get(created.project.id)
            expect(actor).toBeDefined()

            createEventJournalStore(database).append({
                id: 'notification-api-event',
                projectId: created.project.id,
                actorId: actor?.id ?? '',
                name: 'publication.execution.failed',
                version: 1,
                subject: { type: 'publication', id: 'publication-1' },
                occurredAt: now,
            })
            createEventJournalStore(database).append({
                id: 'notification-api-event-2',
                projectId: created.project.id,
                actorId: actor?.id ?? '',
                name: 'publication.execution.ambiguous',
                version: 1,
                subject: { type: 'publication', id: 'publication-2' },
                occurredAt: now,
            })
            notifications.project(created.project.id)

            const inboxResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}/notifications?limit=1`,
                cookie
            )
            expect(inboxResponse.status).toBe(200)
            const inbox = (await inboxResponse.json()) as {
                unreadCount: number
                notifications: Array<{ id: string; kind: string; readAt: number | null }>
                nextCursor: string | null
            }
            expect(inbox.unreadCount).toBe(2)
            expect(inbox.notifications).toHaveLength(1)
            expect(inbox.nextCursor).not.toBeNull()

            const userInboxResponse = await jsonRequest(
                app,
                '/api/notifications?projectId=' + encodeURIComponent(created.project.id),
                cookie
            )
            expect(userInboxResponse.status).toBe(200)
            const userInbox = (await userInboxResponse.json()) as {
                unreadCount: number
                totalUnreadCount: number
                notifications: Array<{ projectId: string | null }>
            }
            expect(userInbox.unreadCount).toBe(2)
            expect(userInbox.totalUnreadCount).toBe(2)
            expect(
                userInbox.notifications.every(item => item.projectId === created.project.id)
            ).toBe(true)

            const userPreferencesResponse = await jsonRequest(
                app,
                '/api/notification-preferences',
                cookie
            )
            expect(userPreferencesResponse.status).toBe(200)
            expect(
                ((await userPreferencesResponse.json()) as { preferences: unknown[] }).preferences
            ).toHaveLength(3)

            const userPreferenceUpdate = await jsonRequest(
                app,
                '/api/notification-preferences/publication_failed',
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ inAppEnabled: false }),
                }
            )
            expect(userPreferenceUpdate.status).toBe(200)
            expect(await userPreferenceUpdate.json()).toEqual({
                kind: 'publication_failed',
                inAppEnabled: false,
            })

            const nextInboxResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}/notifications?limit=1&before=${encodeURIComponent(inbox.nextCursor ?? '')}`,
                cookie
            )
            expect(nextInboxResponse.status).toBe(200)
            const nextInbox = (await nextInboxResponse.json()) as typeof inbox
            expect(nextInbox.notifications).toHaveLength(1)
            expect(nextInbox.notifications[0]?.id).not.toBe(inbox.notifications[0]?.id)
            expect(nextInbox.nextCursor).toBeNull()

            const notificationId = inbox.notifications[0]?.id ?? ''
            const readResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}/notifications/${notificationId}/read`,
                cookie,
                { method: 'POST' }
            )
            expect(readResponse.status).toBe(200)
            expect((await readResponse.json()) as { readAt: number | null }).toMatchObject({
                readAt: now + 1_000,
            })

            const archiveResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}/notifications/${notificationId}/archive`,
                cookie,
                { method: 'POST' }
            )
            expect(archiveResponse.status).toBe(200)
            const activeInboxResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}/notifications`,
                cookie
            )
            expect(
                ((await activeInboxResponse.json()) as typeof inbox).notifications.map(
                    item => item.id
                )
            ).not.toContain(notificationId)
            const completeInboxResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}/notifications?view=all`,
                cookie
            )
            expect(
                ((await completeInboxResponse.json()) as typeof inbox).notifications.map(
                    item => item.id
                )
            ).toContain(notificationId)

            const preferenceResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}/notification-preferences/publication_failed`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ inAppEnabled: false }),
                }
            )
            expect(preferenceResponse.status).toBe(200)
            expect(await preferenceResponse.json()).toEqual({
                kind: 'publication_failed',
                inAppEnabled: false,
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('streams authenticated project updates with durable cursor replay and safe payloads', async () => {
        const { app, database } = createFixture({ allowAdditionalSignups: true })

        try {
            const cookie = await signUp(app, 'realtime-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Realtime project' }),
            })
            expect(projectResponse.status).toBe(201)
            const project = (await projectResponse.json()) as { project: { id: string } }
            const projectId = project.project.id
            const actor = database.$client
                .query<{ id: string }, [string]>(
                    `select id from actors where project_id = ?1 and kind = 'human'`
                )
                .get(projectId)
            expect(actor).toBeDefined()
            if (actor === null) throw new Error('The test human actor is missing')

            const journal = createEventJournalStore(database)
            const first = journal.append({
                id: 'realtime-api-event-1',
                projectId,
                actorId: actor.id,
                name: 'publication.execution.failed',
                version: 1,
                subject: { type: 'publication', id: 'publication-1' },
                payload: {
                    accessToken: 'provider-access-token-must-not-leak',
                    refreshToken: 'provider-refresh-token-must-not-leak',
                    providerResponse: 'provider-response-must-not-leak',
                },
                occurredAt: now,
            })

            const unauthenticatedResponse = await app.handle(
                new Request(`${baseURL}/api/projects/${projectId}/events`)
            )
            expect(unauthenticatedResponse.status).toBe(401)

            const firstResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/events`,
                cookie
            )
            expect(firstResponse.status).toBe(200)
            expect(firstResponse.headers.get('content-type')).toContain('text/event-stream')
            const firstChunk = await readStreamChunk(firstResponse)
            expect(firstChunk.text).toContain(`id: ${first.cursor}`)
            expect(firstChunk.text).toContain(`"projectId":"${projectId}"`)
            expect(firstChunk.text).toContain('"type":"publication.execution.failed"')
            expect(firstChunk.text).toContain('"payload":{}')
            expect(firstChunk.text).not.toContain('provider-access-token-must-not-leak')
            expect(firstChunk.text).not.toContain('provider-refresh-token-must-not-leak')
            expect(firstChunk.text).not.toContain('provider-response-must-not-leak')
            expect(firstChunk.text).not.toContain(actor.id)

            const globalResponse = await jsonRequest(app, '/api/notifications/events', cookie)
            expect(globalResponse.status).toBe(200)
            expect(globalResponse.headers.get('content-type')).toContain('text/event-stream')
            const globalChunk = await readStreamChunk(globalResponse)
            expect(globalChunk.text).toContain(`event: user.update`)
            expect(globalChunk.text).toContain(`id: ${first.cursor}`)
            expect(globalChunk.text).toContain(`"projectId":"${projectId}"`)
            expect(globalChunk.text).not.toContain('provider-access-token-must-not-leak')
            expect(globalChunk.text).not.toContain(actor.id)

            const second = journal.append({
                id: 'realtime-api-event-2',
                projectId,
                actorId: actor.id,
                name: 'publication.execution.succeeded',
                version: 1,
                subject: { type: 'publication', id: 'publication-2' },
                payload: { providerResponse: 'another-sensitive-response' },
                occurredAt: now + 1,
            })
            const replayResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/events`,
                cookie,
                { headers: { 'last-event-id': first.cursor } }
            )
            expect(replayResponse.status).toBe(200)
            const replayChunk = await readStreamChunk(replayResponse)
            expect(replayChunk.text).toContain(`id: ${second.cursor}`)
            expect(replayChunk.text).not.toContain(`id: ${first.cursor}`)
            expect(replayChunk.text).not.toContain('another-sensitive-response')

            const invalidCursorResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/events`,
                cookie,
                { headers: { 'last-event-id': 'not-a-cursor' } }
            )
            expect(invalidCursorResponse.status).toBe(400)
            expect(await invalidCursorResponse.json()).toEqual({
                error: { code: 'invalid_cursor', message: 'The event stream cursor is invalid' },
            })

            const aheadCursorResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/events`,
                cookie,
                { headers: { 'last-event-id': 'event-sequence:999999' } }
            )
            expect(aheadCursorResponse.status).toBe(409)
            expect(await aheadCursorResponse.json()).toEqual({
                error: {
                    code: 'cursor_ahead',
                    message:
                        'The event stream cursor is newer than the durable journal; refetch before retrying',
                },
            })

            const otherCookie = await signUpFixtureAdditionalUser(
                app,
                'other-realtime-operator@postdot.local'
            )
            const otherProjectResponse = await jsonRequest(app, '/api/projects', otherCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Other realtime project' }),
            })
            const otherProject = (await otherProjectResponse.json()) as {
                project: { id: string }
            }
            const crossProjectResponse = await jsonRequest(
                app,
                `/api/projects/${otherProject.project.id}/events`,
                cookie
            )
            expect(crossProjectResponse.status).toBe(404)

            const apiKeyResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Realtime machine key',
                    projectIds: [projectId],
                }),
            })
            expect(apiKeyResponse.status).toBe(201)
            const tokenBody = (await apiKeyResponse.json()) as { token: string }
            const bearerResponse = await bearerRequest(
                app,
                `/api/projects/${projectId}/events`,
                tokenBody.token
            )
            expect(bearerResponse.status).toBe(403)
        } finally {
            closeDatabase(database)
        }
    })

    it('persists and updates the project scheduling timezone through the API', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'timezone-operator@postdot.local')
            const createResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Timezone API Project',
                    timeZone: 'America/New_York',
                }),
            })
            expect(createResponse.status).toBe(201)
            const created = (await createResponse.json()) as {
                project: { id: string; timeZone: string }
            }
            expect(created.project.timeZone).toBe('America/New_York')

            const updateResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ timeZone: 'Europe/Paris' }),
                }
            )
            expect(updateResponse.status).toBe(200)
            expect(await updateResponse.json()).toMatchObject({
                id: created.project.id,
                timeZone: 'Europe/Paris',
            })

            const invalidResponse = await jsonRequest(
                app,
                `/api/projects/${created.project.id}`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ timeZone: '+02:00' }),
                }
            )
            expect(invalidResponse.status).toBe(400)
            expect(await invalidResponse.json()).toEqual({
                error: {
                    code: 'invalid_input',
                    message: 'timeZone must be a valid IANA time zone identifier',
                },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('authorizes project lifecycle operations with instance and project memberships', async () => {
        const { app, auth, database } = createFixture({
            allowAdditionalSignups: true,
        })

        try {
            const ownerCookie = await signUp(app, 'lifecycle-owner@postdot.local')
            const owner = database.$client
                .query<{ readonly userId: string }, []>(
                    `select claimed_by_user_id as userId from instance_state where id = 'default'`
                )
                .get()
            expect(owner).not.toBeNull()

            const ownerProjectResponse = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Lifecycle owner project' }),
            })
            expect(ownerProjectResponse.status).toBe(201)
            const ownerProject = (await ownerProjectResponse.json()) as {
                project: { id: string }
            }
            expect(
                database.$client
                    .query<{ readonly role: string; readonly state: string }, [string, string]>(
                        `select role, 'active' as state
                         from project_user_grants
                         where project_id = ?1 and user_id = ?2`
                    )
                    .get(ownerProject.project.id, owner?.userId ?? '')
            ).toEqual({ role: 'owner', state: 'active' })

            const ownerChannelResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/channels`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Lifecycle destination' }),
                }
            )
            expect(ownerChannelResponse.status).toBe(201)
            const ownerChannel = (await ownerChannelResponse.json()) as {
                channel: { id: string }
            }

            const memberEmail = 'lifecycle-member@postdot.local'
            const memberCookie = await signUpFixtureAdditionalUser(app, memberEmail)
            const member = database.$client
                .query<{ readonly userId: string }, [string]>(
                    `select id as userId from user where email = ?1`
                )
                .get(memberEmail)
            expect(member).not.toBeNull()
            if (member === null) throw new Error('The lifecycle member was not created')

            const memberProjectResponse = await jsonRequest(app, '/api/projects', memberCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Lifecycle member project' }),
            })
            expect(memberProjectResponse.status).toBe(201)
            const memberProject = (await memberProjectResponse.json()) as {
                project: { id: string }
            }
            expect(
                database.$client
                    .query<{ readonly role: string; readonly state: string }, [string, string]>(
                        `select role, 'active' as state
                         from project_user_grants
                         where project_id = ?1 and user_id = ?2`
                    )
                    .get(memberProject.project.id, member?.userId ?? '')
            ).toEqual({ role: 'owner', state: 'active' })

            const viewerGrantResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/user-grants`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ userId: member.userId, role: 'viewer' }),
                }
            )
            expect(viewerGrantResponse.status).toBe(201)

            const viewerListResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/channels`,
                memberCookie
            )
            expect(viewerListResponse.status).toBe(200)

            const viewerMembershipResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/membership`,
                memberCookie
            )
            expect(viewerMembershipResponse.status).toBe(200)
            expect(await viewerMembershipResponse.json()).toEqual({
                membership: expect.objectContaining({
                    userId: member.userId,
                    role: 'viewer',
                    state: 'active',
                }),
            })

            const viewerCreateChannelResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/channels`,
                memberCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Viewer must not create' }),
                }
            )
            expect(viewerCreateChannelResponse.status).toBe(403)

            const viewerCreatePostResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/posts`,
                memberCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent: {
                            body: { text: 'Viewer must not publish', format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: ownerChannel.channel.id,
                                targetContent: { body: 'Viewer must not publish', media: [] },
                                deliveryMode: 'manual',
                            },
                        ],
                    }),
                }
            )
            expect(viewerCreatePostResponse.status).toBe(403)

            const viewerUpdateResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}`,
                memberCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ timeZone: 'Europe/Paris' }),
                }
            )
            expect(viewerUpdateResponse.status).toBe(403)

            const editorGrantResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/user-grants/${member.userId}`,
                ownerCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'editor' }),
                }
            )
            expect(editorGrantResponse.status).toBe(200)
            const editorUpdateResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}`,
                memberCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ timeZone: 'Europe/Paris' }),
                }
            )
            expect(editorUpdateResponse.status).toBe(200)

            const editorMembershipResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/membership`,
                memberCookie
            )
            expect(editorMembershipResponse.status).toBe(200)
            expect(await editorMembershipResponse.json()).toEqual({
                membership: expect.objectContaining({
                    userId: member.userId,
                    role: 'editor',
                    state: 'active',
                }),
            })

            const editorCreatePostResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/posts`,
                memberCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent: {
                            body: { text: 'Editor can publish', format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: ownerChannel.channel.id,
                                targetContent: { body: 'Editor can publish', media: [] },
                                deliveryMode: 'manual',
                            },
                        ],
                    }),
                }
            )
            expect(editorCreatePostResponse.status).toBe(201)

            const removeGrantResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/user-grants/${member.userId}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(removeGrantResponse.status).toBe(200)
            const removedMemberResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}/channels`,
                memberCookie
            )
            expect(removedMemberResponse.status).toBe(404)

            const outsiderEmail = 'lifecycle-outsider@postdot.local'
            const outsiderCookie = await signUpFixtureAdditionalUser(app, outsiderEmail)
            const outsiderUpdateResponse = await jsonRequest(
                app,
                `/api/projects/${ownerProject.project.id}`,
                outsiderCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ timeZone: 'America/New_York' }),
                }
            )
            expect(outsiderUpdateResponse.status).toBe(404)

            const outsider = database.$client
                .query<{ readonly userId: string }, [string]>(
                    `select id as userId from user where email = ?1`
                )
                .get(outsiderEmail)
            expect(outsider).not.toBeNull()
            database.$client
                .query(`update instance_memberships set state = 'disabled' where user_id = ?1`)
                .run(outsider?.userId ?? '')
            const disabledCreateResponse = await jsonRequest(app, '/api/projects', outsiderCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Should not be created' }),
            })
            expect(disabledCreateResponse.status).toBe(403)

            const apiKeyResponse = await jsonRequest(app, '/api/api-keys', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Lifecycle API key',
                    projectIds: [ownerProject.project.id],
                }),
            })
            expect(apiKeyResponse.status).toBe(201)
            const tokenBody = (await apiKeyResponse.json()) as { token: string }
            const bearerUpdateResponse = await bearerRequest(
                app,
                `/api/projects/${ownerProject.project.id}`,
                tokenBody.token,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ timeZone: 'America/New_York' }),
                }
            )
            expect(bearerUpdateResponse.status).toBe(403)
            const verifiedToken = await auth.api.verifyApiKey({ body: { key: tokenBody.token } })
            expect(verifiedToken.valid).toBe(true)
        } finally {
            closeDatabase(database)
        }
    })

    it('reports unavailable media storage through the typed media surface', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'media-unavailable-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Media unavailable project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const response = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media`,
                cookie
            )

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
            const cookie = await signUp(app, 'profile-operator@postdot.local')
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
            profile.profileHash = 'sha256:postdot-manual-message-v2'
            profile.schemaHash = 'sha256:postdot-manual-message-schema-v2'

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
                profile: {
                    id: string
                    version: number
                    state: string
                    revision: number
                    profile: { profileHash: string; schemaHash: string }
                }
            }
            expect(draftBody.profile).toMatchObject({ version: 2, state: 'draft', revision: 1 })
            expect(draftBody.profile.profile.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)
            expect(draftBody.profile.profile.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
            expect(draftBody.profile.profile.profileHash).not.toBe(profile.profileHash)
            expect(draftBody.profile.profile.schemaHash).not.toBe(profile.schemaHash)

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

    it('exposes guarded channel lifecycle operations through the API', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'channel-lifecycle-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Channel lifecycle API project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }

            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Initial channel' }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as {
                channel: { id: string; revision: number; state: string }
            }
            expect(channelBody.channel).toMatchObject({ revision: 1, state: 'active' })

            const renameResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ name: 'Renamed channel', expectedRevision: 1 }),
                }
            )
            expect(renameResponse.status).toBe(200)
            const renamedBody = (await renameResponse.json()) as {
                channel: { name: string; revision: number }
            }
            expect(renamedBody.channel).toMatchObject({ name: 'Renamed channel', revision: 2 })

            const staleRenameResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ name: 'Stale channel', expectedRevision: 1 }),
                }
            )
            expect(staleRenameResponse.status).toBe(409)
            expect(await staleRenameResponse.json()).toMatchObject({
                error: { code: 'write_conflict' },
            })

            const activeDeleteResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}`,
                cookie,
                {
                    method: 'DELETE',
                    body: JSON.stringify({ expectedRevision: 2 }),
                }
            )
            expect(activeDeleteResponse.status).toBe(409)
            expect(await activeDeleteResponse.json()).toEqual({
                error: {
                    code: 'channel_lifecycle_conflict',
                    message: 'The channel cannot be deleted while these blockers exist',
                    blockers: ['must_be_archived'],
                },
            })

            const archiveResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/archive`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ expectedRevision: 2 }),
                }
            )
            expect(archiveResponse.status).toBe(200)
            const archivedBody = (await archiveResponse.json()) as {
                channel: { state: string; archivedAt: number | null; revision: number }
            }
            expect(archivedBody.channel).toMatchObject({
                state: 'archived',
                archivedAt: now,
                revision: 3,
            })

            const restoreResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/restore`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ expectedRevision: 3 }),
                }
            )
            expect(restoreResponse.status).toBe(200)
            expect(await restoreResponse.json()).toMatchObject({
                channel: { state: 'active', archivedAt: null, revision: 4 },
            })

            const archiveAgainResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/archive`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ expectedRevision: 4 }),
                }
            )
            expect(archiveAgainResponse.status).toBe(200)

            const deleteResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}`,
                cookie,
                {
                    method: 'DELETE',
                    body: JSON.stringify({ expectedRevision: 5 }),
                }
            )
            expect(deleteResponse.status).toBe(200)
            expect(await deleteResponse.json()).toEqual({ deleted: true })
        } finally {
            closeDatabase(database)
        }
    })

    it('creates a project-owned custom HTTP connection without exposing its secret', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'custom-http-operator@postdot.local')
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

    it('accepts path authentication when the active profile owns one secret path segment', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'custom-path-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Custom path project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        name: 'Path Receiver',
                        profile: customPathProfile,
                    }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as { channel: { id: string } }
            const pathSecret = 'path-auth-secret-with-at-least-32-characters'

            const connectionResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/custom-http/connect`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        endpointUrl: 'https://receiver.example.test',
                        authentication: { kind: 'path' },
                        externalAccountName: 'Path receiver',
                        secret: pathSecret,
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
                authentication: { kind: 'path' },
            })
            expect(JSON.stringify(connectionBody)).not.toContain(pathSecret)

            const listResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publishers`,
                cookie
            )
            expect(listResponse.status).toBe(200)
            const listBody = (await listResponse.json()) as {
                connections: Array<{ authentication: { kind: string } | null }>
            }
            expect(listBody.connections[0]?.authentication).toEqual({ kind: 'path' })
        } finally {
            closeDatabase(database)
        }
    })

    it('creates and authenticates user-owned API keys within their project scope', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'api-key-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Machine access project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const projectId = projectBody.project.id
            const createKeyResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Release agent',
                    projectIds: [projectId],
                }),
            })
            expect(createKeyResponse.status).toBe(201)
            const createdBody = (await createKeyResponse.json()) as {
                key: {
                    id: string
                    name: string
                    tokenPrefix: string
                    projectAccess: readonly string[] | 'all'
                    expiresAt: number | null
                }
                token: string
            }
            expect(createdBody.key).toMatchObject({
                name: 'Release agent',
                tokenPrefix: 'postdot_pat_',
                projectAccess: [projectId],
            })
            expect(createdBody.token.length).toBeGreaterThan(40)

            const listedResponse = await jsonRequest(app, '/api/api-keys', cookie)
            expect(listedResponse.status).toBe(200)
            const listedBody = await listedResponse.json()
            expect(listedBody).toEqual({
                keys: [
                    expect.objectContaining({
                        id: createdBody.key.id,
                        name: 'Release agent',
                        tokenPrefix: createdBody.key.tokenPrefix,
                        projectAccess: [projectId],
                    }),
                ],
            })
            expect(JSON.stringify(listedBody)).not.toContain(createdBody.token)

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

            const deniedAuditResponse = await bearerRequest(
                app,
                `/api/projects/${projectId}/audit-events`,
                createdBody.token
            )
            expect(deniedAuditResponse.status).toBe(403)

            const auditResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/audit-events`,
                cookie
            )
            expect(auditResponse.status).toBe(200)
            const auditBody = (await auditResponse.json()) as {
                events: Array<{ action: string; actorId: string }>
            }
            const humanActor = database.$client
                .query<{ readonly id: string }, [string]>(
                    `select id from actors where project_id = ?1 and kind = 'human'`
                )
                .get(projectId)
            expect(humanActor).not.toBeNull()
            expect(
                auditBody.events.find(event => event.action === 'channel.created')?.actorId
            ).toBe(humanActor?.id)

            const keyListResponse = await bearerRequest(app, '/api/api-keys', createdBody.token)
            expect(keyListResponse.status).toBe(403)

            const notificationResponse = await bearerRequest(
                app,
                `/api/projects/${projectId}/notifications`,
                createdBody.token
            )
            expect(notificationResponse.status).toBe(403)

            const projectCreationResponse = await bearerRequest(
                app,
                '/api/projects',
                createdBody.token,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Should not be created by an API key' }),
                }
            )
            expect(projectCreationResponse.status).toBe(403)

            const invalidBearerHeaders = new Headers({
                authorization: 'Bearer invalid-token',
                cookie,
                'x-api-key': createdBody.token,
            })
            const invalidBearerResponse = await app.handle(
                new Request(`${baseURL}/api/projects`, { headers: invalidBearerHeaders })
            )
            expect(invalidBearerResponse.status).toBe(401)

            const revokeResponse = await jsonRequest(
                app,
                `/api/api-keys/${createdBody.key.id}`,
                cookie,
                { method: 'DELETE' }
            )
            expect(revokeResponse.status).toBe(200)
            expect(await revokeResponse.json()).toEqual({ deleted: true })

            const revokedResponse = await bearerRequest(app, '/api/projects', createdBody.token)
            expect(revokedResponse.status).toBe(401)
        } finally {
            closeDatabase(database)
        }
    })

    it('manages project members and invitations through the Postdot access surface', async () => {
        const { access, app, auth, database } = createFixture({
            allowAdditionalSignups: true,
        })

        try {
            const ownerCookie = await signUp(app, 'project-access-owner@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Project access surface' }),
            })
            expect(projectResponse.status).toBe(201)
            const project = (await projectResponse.json()) as { project: { id: string } }
            const projectId = project.project.id

            const membersResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members`,
                ownerCookie
            )
            expect(membersResponse.status).toBe(200)
            const initialMembers = (await membersResponse.json()) as {
                members: Array<{ id: string; userId: string; role: string }>
                total: number
            }
            expect(initialMembers.total).toBe(1)
            expect(initialMembers.members[0]?.role).toBe('owner')

            const initialInvitationsResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/invitations`,
                ownerCookie
            )
            expect(initialInvitationsResponse.status).toBe(200)
            expect(await initialInvitationsResponse.json()).toEqual({ invitations: [] })

            const memberEmail = 'project-access-member@postdot.local'
            const outsiderCookie = await signUpFixtureAdditionalUser(
                app,
                'project-access-outsider@postdot.local'
            )
            const outsider = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
                .get('project-access-outsider@postdot.local')
            const outsiderWorkspace = access.getDefaultWorkspace()
            expect(outsider).not.toBeNull()
            expect(outsiderWorkspace).not.toBeNull()
            if (outsider === null || outsiderWorkspace === null) {
                throw new Error('The project access outsider fixture is incomplete')
            }
            // Additional-signup fixtures are workspace owners by default. This
            // account represents an ordinary workspace member with no project
            // grant, so it must remain hidden from the project access surface.
            database.$client
                .query(
                    `update member
                     set role = 'member'
                     where organization_id = ?1 and user_id = ?2`
                )
                .run(outsiderWorkspace.organizationId, outsider.id)
            const beforeInviteResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members`,
                outsiderCookie
            )
            // Project routes deliberately hide projects from users who are not
            // members, so the auth macro returns the same 404 as any unknown
            // project before the route-level policy can run.
            expect(beforeInviteResponse.status).toBe(404)

            const invitationResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/invitations`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ email: memberEmail, role: 'editor' }),
                }
            )
            expect(invitationResponse.status).toBe(201)
            const invitationBody = (await invitationResponse.json()) as {
                invitation: { id: string; email: string; role: string; status: string }
            }
            expect(invitationBody.invitation).toEqual(
                expect.objectContaining({
                    email: memberEmail,
                    role: 'editor',
                    status: 'pending',
                })
            )

            const memberCookie = await signUpFixtureAdditionalUser(app, memberEmail)
            const member = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
                .get(memberEmail)
            const workspace = access.getDefaultWorkspace()
            expect(member).not.toBeNull()
            expect(workspace).not.toBeNull()
            if (member === null || workspace === null) {
                throw new Error('The project invitation user fixture is incomplete')
            }
            // The additional-signup fixture normally provisions a default
            // workspace for independent browser tests. Remove that fixture
            // membership so this test exercises the real invitation path.
            database.$client
                .query('delete from member where organization_id = ?1 and user_id = ?2')
                .run(workspace.organizationId, member.id)

            const pendingInvitationsResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/invitations`,
                ownerCookie
            )
            expect(pendingInvitationsResponse.status).toBe(200)
            expect(await pendingInvitationsResponse.json()).toEqual({
                invitations: [expect.objectContaining({ id: invitationBody.invitation.id })],
            })

            const memberInvitationBypassResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/invitations`,
                memberCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: 'another-project-member@postdot.local',
                        role: 'viewer',
                    }),
                }
            )
            expect(memberInvitationBypassResponse.status).toBe(404)

            await auth.api.acceptInvitation({
                body: { invitationId: invitationBody.invitation.id },
                headers: new Headers({ cookie: memberCookie }),
            })

            const acceptedMembersResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members`,
                ownerCookie
            )
            expect(acceptedMembersResponse.status).toBe(200)
            const acceptedMembers = (await acceptedMembersResponse.json()) as {
                members: Array<{ id: string; userId: string; role: string; image: string | null }>
            }
            const projectMember = acceptedMembers.members.find(member => member.role === 'editor')
            expect(projectMember).toEqual(expect.objectContaining({ role: 'editor', image: null }))
            if (projectMember === undefined)
                throw new Error('The invited project member is missing')

            const memberListResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members`,
                memberCookie
            )
            expect(memberListResponse.status).toBe(200)

            const memberUpdateResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members/${projectMember.id}`,
                memberCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'viewer' }),
                }
            )
            expect(memberUpdateResponse.status).toBe(403)

            const ownerUpdateResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members/${projectMember.id}`,
                ownerCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'viewer' }),
                }
            )
            expect(ownerUpdateResponse.status).toBe(200)
            expect(await ownerUpdateResponse.json()).toEqual({
                membership: expect.objectContaining({ id: projectMember.id, role: 'viewer' }),
            })

            const ownerMember = acceptedMembers.members.find(member => member.role === 'owner')
            expect(ownerMember).toBeDefined()
            if (ownerMember === undefined) throw new Error('The project owner is missing')

            const ownerSelfUpdateResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members/${ownerMember.id}`,
                ownerCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'viewer' }),
                }
            )
            expect(ownerSelfUpdateResponse.status).toBe(409)
            expect(await ownerSelfUpdateResponse.json()).toEqual({
                error: {
                    code: 'self_membership_update',
                    message: 'A project owner cannot change or remove their own membership',
                },
            })

            const removeResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members/${projectMember.id}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(removeResponse.status).toBe(200)
            expect(await removeResponse.json()).toEqual({ removed: true })
            expect(access.canAccessProject(projectId, projectMember.userId)).toBe(false)

            const afterRemoveResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members`,
                memberCookie
            )
            expect(afterRemoveResponse.status).toBe(404)

            const secondInviteResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/invitations`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: 'project-access-pending@postdot.local',
                        role: 'viewer',
                    }),
                }
            )
            expect(secondInviteResponse.status).toBe(201)
            const secondInvitation = (await secondInviteResponse.json()) as {
                invitation: { id: string; email: string; role: string }
            }
            const resendResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/invitations/${secondInvitation.invitation.id}/resend`,
                ownerCookie,
                { method: 'POST' }
            )
            expect(resendResponse.status).toBe(200)
            const resentInvitation = (await resendResponse.json()) as {
                invitation: { id: string; email: string; role: string; status: string }
            }
            expect(resentInvitation.invitation).toEqual(
                expect.objectContaining({
                    email: secondInvitation.invitation.email,
                    role: secondInvitation.invitation.role,
                    status: 'pending',
                })
            )
            expect(resentInvitation.invitation.id).not.toBe(secondInvitation.invitation.id)

            const afterResendInvitationsResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/invitations`,
                ownerCookie
            )
            expect(afterResendInvitationsResponse.status).toBe(200)
            const afterResendInvitations = (await afterResendInvitationsResponse.json()) as {
                invitations: Array<{ id: string; email: string; status: string }>
            }
            const pendingInvitationsForEmail = afterResendInvitations.invitations.filter(
                invitation =>
                    invitation.email === secondInvitation.invitation.email &&
                    invitation.status === 'pending'
            )
            expect(pendingInvitationsForEmail).toEqual([
                expect.objectContaining({ id: resentInvitation.invitation.id }),
            ])
            expect(afterResendInvitations.invitations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: secondInvitation.invitation.id,
                        status: 'canceled',
                    }),
                ])
            )
            const cancelResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/invitations/${resentInvitation.invitation.id}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(cancelResponse.status).toBe(200)
            expect(await cancelResponse.json()).toEqual({
                invitation: expect.objectContaining({
                    id: resentInvitation.invitation.id,
                    status: 'canceled',
                }),
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('manages workspace group grants without making workspace membership project access', async () => {
        const { access, app, auth, database } = createFixture({ allowAdditionalSignups: true })

        try {
            const ownerCookie = await signUp(app, 'group-grant-owner@postdot.local')
            const memberCookie = await signUp(app, 'group-grant-member@postdot.local')
            const workspaceAdminCookie = await signUp(
                app,
                'group-grant-workspace-admin@postdot.local'
            )
            const member = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
                .get('group-grant-member@postdot.local')
            expect(member).not.toBeNull()
            if (member === null) throw new Error('The group grant member was not created')

            const workspace = access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')
            const editorsTeamId = `postdot-workspace-team:${workspace.id}:editors`
            await auth.api.addTeamMember({
                body: {
                    organizationId: workspace.organizationId,
                    teamId: editorsTeamId,
                    userId: member.id,
                },
                headers: new Headers({ cookie: ownerCookie }),
            })

            const projectResponse = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Group grant project' }),
            })
            expect(projectResponse.status).toBe(201)
            const project = (await projectResponse.json()) as { project: { id: string } }
            const projectId = project.project.id

            const workspaceAdminProjects = await jsonRequest(
                app,
                '/api/projects',
                workspaceAdminCookie
            )
            expect(workspaceAdminProjects.status).toBe(200)
            expect(await workspaceAdminProjects.json()).toEqual({
                projects: [expect.objectContaining({ id: projectId })],
            })

            const workspaceAdminMembers = await jsonRequest(
                app,
                `/api/projects/${projectId}/members`,
                workspaceAdminCookie
            )
            expect(workspaceAdminMembers.status).toBe(200)
            const workspaceAdminTeamGrants = await jsonRequest(
                app,
                `/api/projects/${projectId}/team-grants`,
                workspaceAdminCookie
            )
            expect(workspaceAdminTeamGrants.status).toBe(200)

            // The test signup helper creates an independent workspace owner so
            // browser fixtures can coexist. Model the invited project member
            // explicitly before checking that workspace membership alone does
            // not grant project access or workspace administration rights.
            database.$client
                .query(
                    `update member
                     set role = 'member'
                     where organization_id = ?1
                       and user_id = ?2`
                )
                .run(workspace.organizationId, member.id)

            const beforeGrantProjects = await jsonRequest(app, '/api/projects', memberCookie)
            expect(beforeGrantProjects.status).toBe(200)
            expect(await beforeGrantProjects.json()).toEqual({ projects: [] })

            const grantResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/team-grants`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ teamId: editorsTeamId, role: 'editor' }),
                }
            )
            expect(grantResponse.status).toBe(201)
            expect(await grantResponse.json()).toEqual({
                grant: expect.objectContaining({
                    projectId,
                    teamId: editorsTeamId,
                    teamName: 'Editors',
                    role: 'editor',
                }),
            })

            const memberProjects = await jsonRequest(app, '/api/projects', memberCookie)
            expect(memberProjects.status).toBe(200)
            expect(await memberProjects.json()).toEqual({
                projects: [expect.objectContaining({ id: projectId })],
            })

            const directGrantResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/user-grants`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ userId: member.id, role: 'viewer' }),
                }
            )
            expect(directGrantResponse.status).toBe(201)
            expect(await directGrantResponse.json()).toEqual({
                grant: expect.objectContaining({
                    projectId,
                    userId: member.id,
                    role: 'viewer',
                }),
            })

            const directGrantRemoved = await jsonRequest(
                app,
                `/api/projects/${projectId}/user-grants/${member.id}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(directGrantRemoved.status).toBe(200)
            expect(await directGrantRemoved.json()).toEqual({ removed: true })
            expect(access.canAccessProject(projectId, member.id, 'editor')).toBe(true)

            const forbiddenGrant = await jsonRequest(
                app,
                `/api/projects/${projectId}/team-grants`,
                memberCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ teamId: editorsTeamId, role: 'viewer' }),
                }
            )
            expect(forbiddenGrant.status).toBe(403)

            const removed = await jsonRequest(
                app,
                `/api/projects/${projectId}/team-grants/${editorsTeamId}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(removed.status).toBe(200)
            expect(await removed.json()).toEqual({ removed: true })
            expect(access.canAccessProject(projectId, member.id)).toBe(false)
        } finally {
            closeDatabase(database)
        }
    })

    it('completes a workspace invitation through group-based project access', async () => {
        const { access, app, database } = createFixture()

        try {
            const ownerCookie = await signUp(app, 'workspace-flow-owner@postdot.local')
            const workspace = access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')

            const projectResponse = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Invitation flow project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const projectId = projectBody.project.id

            const teamResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Content team' }),
                }
            )
            expect(teamResponse.status).toBe(201)
            const teamBody = (await teamResponse.json()) as { team: { id: string; name: string } }
            expect(teamBody.team.name).toBe('Content team')

            const targetEmail = 'workspace-flow-member@postdot.local'
            const invitationResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/invitations`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ email: targetEmail, teamId: teamBody.team.id }),
                }
            )
            expect(invitationResponse.status).toBe(201)
            const invitationBody = (await invitationResponse.json()) as {
                invitation: { id: string; teamId?: string; status: string }
            }
            expect(invitationBody.invitation).toMatchObject({
                teamId: teamBody.team.id,
                status: 'pending',
            })

            const memberCookie = await signUpFixtureAdditionalUser(app, targetEmail)
            const member = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
                .get(targetEmail)
            expect(member).not.toBeNull()
            if (member === null) throw new Error('The invited workspace member was not created')

            const acceptResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/invitations/${invitationBody.invitation.id}/accept`,
                memberCookie,
                { method: 'POST' }
            )
            expect(acceptResponse.status).toBe(200)
            expect(await acceptResponse.json()).toMatchObject({
                membership: { role: 'member' },
                invitation: { id: invitationBody.invitation.id, status: 'accepted' },
            })

            const teamMembersResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${teamBody.team.id}/members`,
                memberCookie
            )
            expect(teamMembersResponse.status).toBe(200)
            expect(await teamMembersResponse.json()).toEqual({
                members: [expect.objectContaining({ userId: member.id })],
            })

            const beforeGrantResponse = await jsonRequest(app, '/api/projects', memberCookie)
            expect(beforeGrantResponse.status).toBe(200)
            expect(await beforeGrantResponse.json()).toEqual({ projects: [] })

            const grantResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/team-grants`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ teamId: teamBody.team.id, role: 'editor' }),
                }
            )
            expect(grantResponse.status).toBe(201)
            expect(await grantResponse.json()).toEqual({
                grant: expect.objectContaining({
                    projectId,
                    teamId: teamBody.team.id,
                    teamName: 'Content team',
                    role: 'editor',
                }),
            })

            const afterGrantResponse = await jsonRequest(app, '/api/projects', memberCookie)
            expect(afterGrantResponse.status).toBe(200)
            expect(await afterGrantResponse.json()).toEqual({
                projects: [expect.objectContaining({ id: projectId })],
            })

            const projectMembersResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/members`,
                memberCookie
            )
            expect(projectMembersResponse.status).toBe(200)
            expect(await projectMembersResponse.json()).toMatchObject({
                members: expect.arrayContaining([
                    expect.objectContaining({ userId: member.id, role: 'editor' }),
                ]),
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('limits project visibility to a member group and revokes it when membership is removed', async () => {
        const { access, app, database } = createFixture({ allowAdditionalSignups: true })

        try {
            const ownerCookie = await signUp(app, 'group-visibility-owner@postdot.local')
            const memberCookie = await signUp(app, 'group-visibility-member@postdot.local')
            const member = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
                .get('group-visibility-member@postdot.local')
            const workspace = access.getDefaultWorkspace()
            expect(member).not.toBeNull()
            expect(workspace).not.toBeNull()
            if (member === null || workspace === null) {
                throw new Error('The group visibility fixture is incomplete')
            }

            database.$client
                .query(
                    `update member
                     set role = 'member'
                     where organization_id = ?1
                       and user_id = ?2`
                )
                .run(workspace.organizationId, member.id)

            const firstProjectResponse = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Editors project' }),
            })
            const secondProjectResponse = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Reviewers project' }),
            })
            expect(firstProjectResponse.status).toBe(201)
            expect(secondProjectResponse.status).toBe(201)
            const firstProject = (await firstProjectResponse.json()) as {
                project: { id: string }
            }
            const secondProject = (await secondProjectResponse.json()) as {
                project: { id: string }
            }

            const editorsTeamId = `postdot-workspace-team:${workspace.id}:editors`
            const reviewersTeamId = `postdot-workspace-team:${workspace.id}:reviewers`
            const addMemberResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${editorsTeamId}/members`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ userId: member.id }),
                }
            )
            expect(addMemberResponse.status).toBe(200)

            const firstGrantResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/team-grants`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ teamId: editorsTeamId, role: 'editor' }),
                }
            )
            const secondGrantResponse = await jsonRequest(
                app,
                `/api/projects/${secondProject.project.id}/team-grants`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ teamId: reviewersTeamId, role: 'viewer' }),
                }
            )
            expect(firstGrantResponse.status).toBe(201)
            expect(secondGrantResponse.status).toBe(201)

            const visibleProjectsResponse = await jsonRequest(app, '/api/projects', memberCookie)
            expect(visibleProjectsResponse.status).toBe(200)
            expect(await visibleProjectsResponse.json()).toEqual({
                projects: [expect.objectContaining({ id: firstProject.project.id })],
            })

            const visibleProjectMembersResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/members`,
                memberCookie
            )
            expect(visibleProjectMembersResponse.status).toBe(200)

            const hiddenProjectMembersResponse = await jsonRequest(
                app,
                `/api/projects/${secondProject.project.id}/members`,
                memberCookie
            )
            expect(hiddenProjectMembersResponse.status).toBe(404)

            const addReviewerResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${reviewersTeamId}/members`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ userId: member.id }),
                }
            )
            expect(addReviewerResponse.status).toBe(200)

            const visibleProjectsForBothGroupsResponse = await jsonRequest(
                app,
                '/api/projects',
                memberCookie
            )
            expect(visibleProjectsForBothGroupsResponse.status).toBe(200)
            expect(await visibleProjectsForBothGroupsResponse.json()).toEqual({
                projects: expect.arrayContaining([
                    expect.objectContaining({ id: firstProject.project.id }),
                    expect.objectContaining({ id: secondProject.project.id }),
                ]),
            })

            const removeEditorsResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${editorsTeamId}/members/${member.id}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(removeEditorsResponse.status).toBe(200)
            expect(await removeEditorsResponse.json()).toEqual({ removed: true })

            const projectsAfterEditorsRemovalResponse = await jsonRequest(
                app,
                '/api/projects',
                memberCookie
            )
            expect(projectsAfterEditorsRemovalResponse.status).toBe(200)
            expect(await projectsAfterEditorsRemovalResponse.json()).toEqual({
                projects: [expect.objectContaining({ id: secondProject.project.id })],
            })
            expect(access.canAccessProject(firstProject.project.id, member.id)).toBe(false)
            expect(access.canAccessProject(secondProject.project.id, member.id)).toBe(true)

            const removedProjectMembersResponse = await jsonRequest(
                app,
                `/api/projects/${firstProject.project.id}/members`,
                memberCookie
            )
            expect(removedProjectMembersResponse.status).toBe(404)

            const removeReviewersResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${reviewersTeamId}/members/${member.id}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(removeReviewersResponse.status).toBe(200)

            const projectsAfterAllRemovalsResponse = await jsonRequest(
                app,
                '/api/projects',
                memberCookie
            )
            expect(projectsAfterAllRemovalsResponse.status).toBe(200)
            expect(await projectsAfterAllRemovalsResponse.json()).toEqual({ projects: [] })
            expect(access.canAccessProject(secondProject.project.id, member.id)).toBe(false)
        } finally {
            closeDatabase(database)
        }
    })

    it('does not project legacy Better Auth organization invitations into Postdot access', async () => {
        const { access, app, auth, database } = createFixture()

        try {
            const ownerCookie = await signUp(app, 'organization-owner@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Invitation bridge project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const projectId = projectBody.project.id

            const legacyOrganization = await auth.api.createOrganization({
                body: {
                    name: 'Legacy organization',
                    slug: 'legacy-organization-test',
                    userId: (
                        database.$client
                            .query<{ readonly id: string }, [string]>(
                                'select id from user where email = ?1'
                            )
                            .get('organization-owner@postdot.local') ?? { id: '' }
                    ).id,
                },
            })

            const invitation = await auth.api.createInvitation({
                body: {
                    email: 'organization-member@postdot.local',
                    role: 'editor',
                    organizationId: legacyOrganization.id,
                },
                headers: new Headers({ cookie: ownerCookie }),
            })
            const memberCookie = await signUp(app, 'organization-member@postdot.local')
            const accepted = await auth.api.acceptInvitation({
                body: { invitationId: invitation.id },
                headers: new Headers({ cookie: memberCookie }),
            })

            expect(accepted.member.role).toBe('editor')
            const member = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
                .get('organization-member@postdot.local')
            expect(member).not.toBeNull()
            expect(access.canAccessProject(projectId, member?.id ?? '')).toBe(false)

            const projectsResponse = await jsonRequest(app, '/api/projects', memberCookie)
            expect(projectsResponse.status).toBe(200)
            expect(await projectsResponse.json()).toEqual({ projects: [] })

            await auth.api.leaveOrganization({
                body: { organizationId: legacyOrganization.id },
                headers: new Headers({ cookie: memberCookie }),
            })
            const projectsAfterLeave = await jsonRequest(app, '/api/projects', memberCookie)
            expect(projectsAfterLeave.status).toBe(200)
            expect(await projectsAfterLeave.json()).toEqual({ projects: [] })

            const projectAfterLeave = await jsonRequest(
                app,
                `/api/projects/${projectId}/channels`,
                memberCookie
            )
            expect(projectAfterLeave.status).toBe(404)
        } finally {
            closeDatabase(database)
        }
    })

    it('protects project resources and completes the manual publication flow', async () => {
        const { app, database, notifications } = createFixture()
        const notificationProjection = createNotificationProjectionRuntime(notifications)

        try {
            const unauthorizedResponse = await app.handle(new Request(`${baseURL}/api/projects`))
            expect(unauthorizedResponse.status).toBe(401)

            const cookie = await signUp(app)

            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Postdot Launch' }),
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
                        title: 'Postdot is ready',
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

            const invalidRetryResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${publicationId}/retry`,
                cookie,
                { method: 'POST', body: JSON.stringify({}) }
            )
            expect(invalidRetryResponse.status).toBe(409)

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

            const duplicateDraftResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${secondPublicationId}/duplicate`,
                cookie,
                { method: 'POST', body: JSON.stringify({}) }
            )
            expect(duplicateDraftResponse.status).toBe(201)
            const duplicateDraftBody = (await duplicateDraftResponse.json()) as {
                post: { id: string; title: string | null }
                publication: { id: string; postId: string; state: string }
            }
            expect(duplicateDraftBody).toMatchObject({
                post: { title: 'Postdot is ready' },
                publication: { state: 'draft' },
            })
            expect(duplicateDraftBody.publication.id).not.toBe(secondPublicationId)
            expect(duplicateDraftBody.publication.postId).toBe(duplicateDraftBody.post.id)

            const deleteDraftResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${secondPublicationId}`,
                cookie,
                { method: 'DELETE' }
            )
            expect(deleteDraftResponse.status).toBe(200)
            expect(await deleteDraftResponse.json()).toEqual({
                deleted: true,
                postDeleted: false,
            })

            const deleteDuplicatedDraftResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${duplicateDraftBody.publication.id}`,
                cookie,
                { method: 'DELETE' }
            )
            expect(deleteDuplicatedDraftResponse.status).toBe(200)
            expect(await deleteDuplicatedDraftResponse.json()).toEqual({
                deleted: true,
                postDeleted: true,
            })

            const deletePublishedResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${publicationId}`,
                cookie,
                { method: 'DELETE' }
            )
            expect(deletePublishedResponse.status).toBe(409)

            const duplicatePublishedResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publications/${publicationId}/duplicate`,
                cookie,
                { method: 'POST', body: JSON.stringify({}) }
            )
            expect(duplicatePublishedResponse.status).toBe(409)

            notificationProjection.runNow()
            const notificationResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/notifications`,
                cookie
            )
            expect(notificationResponse.status).toBe(200)
            expect(await notificationResponse.json()).toMatchObject({
                unreadCount: 1,
                notifications: [
                    {
                        kind: 'publication_published',
                        title: 'Publication delivered',
                        subject: { type: 'publication' },
                    },
                ],
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('persists and clears the new-publication composer recovery point', async () => {
        const { app, database } = createFixture()

        try {
            const unauthenticatedResponse = await app.handle(
                new Request(`${baseURL}/api/projects/missing/publication-composer-draft`)
            )
            expect(unauthenticatedResponse.status).toBe(401)

            const cookie = await signUp(app, 'composer-recovery@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Composer recovery project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const path = `/api/projects/${projectBody.project.id}/publication-composer-draft`
            const content = {
                activePublicationTabId: 'shared',
                customizedContentTargetIds: [],
                customizedTargetIds: [],
                defaultDeliveryMode: 'manual',
                defaultScheduledAt: '',
                activeContentScopeId: 'target-1',
                postContent: 'A durable recovery copy.',
                postTitle: '',
                publicationTagIds: [],
                publicationTargets: [
                    {
                        channelId: 'channel-1',
                        content: '',
                        deliveryMode: 'manual',
                        id: 'target-1',
                        scheduledAt: '',
                    },
                ],
                sourceMedia: [],
            }

            const emptyResponse = await jsonRequest(app, path, cookie)
            expect(emptyResponse.status).toBe(200)
            expect(await emptyResponse.json()).toEqual({ draft: null })

            const saveResponse = await jsonRequest(app, path, cookie, {
                method: 'PUT',
                body: JSON.stringify({ expectedRevision: 0, content }),
            })
            expect(saveResponse.status).toBe(200)
            const savedBody = (await saveResponse.json()) as {
                draft: { revision: number; content: Record<string, unknown> }
            }
            expect(savedBody.draft).toMatchObject({ revision: 1, content })

            const unchangedResponse = await jsonRequest(app, path, cookie, {
                method: 'PUT',
                body: JSON.stringify({ expectedRevision: 1, content }),
            })
            expect(unchangedResponse.status).toBe(200)
            expect(
                ((await unchangedResponse.json()) as { draft: { revision: number } }).draft.revision
            ).toBe(1)

            const updatedContent = { ...content, postContent: 'The updated recovery copy.' }
            const updateResponse = await jsonRequest(app, path, cookie, {
                method: 'PUT',
                body: JSON.stringify({ expectedRevision: 1, content: updatedContent }),
            })
            expect(updateResponse.status).toBe(200)
            expect(
                ((await updateResponse.json()) as { draft: { revision: number } }).draft.revision
            ).toBe(2)

            const staleResponse = await jsonRequest(app, path, cookie, {
                method: 'PUT',
                body: JSON.stringify({ expectedRevision: 1, content }),
            })
            expect(staleResponse.status).toBe(409)

            const invalidResponse = await jsonRequest(app, path, cookie, {
                method: 'PUT',
                body: JSON.stringify({
                    expectedRevision: 2,
                    content: { ...updatedContent, postContent: '' },
                }),
            })
            expect(invalidResponse.status).toBe(400)

            const deleteResponse = await jsonRequest(app, path, cookie, { method: 'DELETE' })
            expect(deleteResponse.status).toBe(200)
            expect(await deleteResponse.json()).toEqual({ deleted: true })

            const afterDeleteResponse = await jsonRequest(app, path, cookie)
            expect(afterDeleteResponse.status).toBe(200)
            expect(await afterDeleteResponse.json()).toEqual({ draft: null })

            const idempotentDeleteResponse = await jsonRequest(app, path, cookie, {
                method: 'DELETE',
            })
            expect(idempotentDeleteResponse.status).toBe(200)
            expect(await idempotentDeleteResponse.json()).toEqual({ deleted: false })
        } finally {
            closeDatabase(database)
        }
    })

    it('reschedules and cancels groups of queued publications through the project API', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'bulk-scheduling-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Bulk scheduling project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const projectId = projectBody.project.id

            const firstChannelResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'First destination' }),
                }
            )
            const secondChannelResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Second destination' }),
                }
            )
            expect(firstChannelResponse.status).toBe(201)
            expect(secondChannelResponse.status).toBe(201)
            const firstChannel = (await firstChannelResponse.json()) as {
                channel: { id: string }
            }
            const secondChannel = (await secondChannelResponse.json()) as {
                channel: { id: string }
            }

            const postResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/posts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent: {
                            body: { text: 'Bulk scheduling source', format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: firstChannel.channel.id,
                                targetContent: { body: 'First destination', media: [] },
                                deliveryMode: 'manual',
                                scheduledAt: now + 60_000,
                            },
                            {
                                channelId: secondChannel.channel.id,
                                targetContent: { body: 'Second destination', media: [] },
                                deliveryMode: 'manual',
                                scheduledAt: now + 60_000,
                            },
                        ],
                    }),
                }
            )
            expect(postResponse.status).toBe(201)
            const postBody = (await postResponse.json()) as {
                publications: Array<{ id: string; scheduledAt: number | null; state: string }>
            }
            const publicationIds = postBody.publications.map(publication => publication.id)
            expect(postBody.publications).toMatchObject([
                { scheduledAt: now + 60_000, state: 'scheduled' },
                { scheduledAt: now + 60_000, state: 'scheduled' },
            ])

            const rescheduleResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/publications/schedule`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        publicationIds,
                        scheduledAt: now + 120_000,
                    }),
                }
            )
            expect(rescheduleResponse.status).toBe(200)
            expect(await rescheduleResponse.json()).toMatchObject({
                publications: [
                    { id: publicationIds[0], scheduledAt: now + 120_000, state: 'scheduled' },
                    { id: publicationIds[1], scheduledAt: now + 120_000, state: 'scheduled' },
                ],
            })

            const listResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/publications`,
                cookie
            )
            expect(listResponse.status).toBe(200)
            expect(await listResponse.json()).toEqual(
                expect.objectContaining({
                    publications: expect.arrayContaining([
                        expect.objectContaining({
                            id: publicationIds[0],
                            scheduledAt: now + 120_000,
                        }),
                        expect.objectContaining({
                            id: publicationIds[1],
                            scheduledAt: now + 120_000,
                        }),
                    ]),
                })
            )

            const duplicateResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/publications/schedule`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        publicationIds: [publicationIds[0], publicationIds[0]],
                        scheduledAt: now + 180_000,
                    }),
                }
            )
            expect(duplicateResponse.status).toBe(422)

            const cancelResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/publications/cancel`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ publicationIds }),
                }
            )
            expect(cancelResponse.status).toBe(200)
            expect(await cancelResponse.json()).toMatchObject({
                publications: [
                    { id: publicationIds[0], state: 'cancelled' },
                    { id: publicationIds[1], state: 'cancelled' },
                ],
            })

            const duplicateCancelResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/publications/cancel`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        publicationIds: [publicationIds[0], publicationIds[0]],
                    }),
                }
            )
            expect(duplicateCancelResponse.status).toBe(422)
        } finally {
            closeDatabase(database)
        }
    })

    it('creates an X channel through the API', async () => {
        const { app, database } = createFixture()
        try {
            const cookie = await signUp(app, 'x-channel-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'X channel project' }),
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
                    body: JSON.stringify({ name: 'X presence', profile: 'x' }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as {
                channel: {
                    id: string
                    profileId: string
                    profileVersionId: string
                    revision: number
                    state: string
                }
            }
            expect(channelBody.channel).toMatchObject({
                profileId: 'x',
                revision: 1,
                state: 'active',
            })
            expect(channelBody.channel.profileVersionId).toBeString()

            const stateResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/profile`,
                cookie
            )
            expect(stateResponse.status).toBe(200)
            const stateBody = (await stateResponse.json()) as {
                active: {
                    version: number
                    profile: {
                        id: string
                        execution: { contractId: string; revision: string }
                    }
                }
                draft: unknown
            }
            expect(stateBody.active.version).toBe(2)
            expect(stateBody.draft).toBeNull()
            expect(stateBody.active.profile).toMatchObject({
                id: 'x',
                execution: { contractId: 'x', revision: 'post-v1' },
            })
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
                    return Response.json({ sub: 'member-42', name: 'Postdot Operator' })
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
        const { app, auth, database } = createFixture({
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
            const channelLocation = `http://localhost:5173/dashboard/projects/${projectBody.project.id}/channels?publisher_channel=${channelBody.channel.id}`

            const apiKeyResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'LinkedIn automation agent',
                    projectIds: [projectBody.project.id],
                }),
            })
            expect(apiKeyResponse.status).toBe(201)
            const accessTokenBody = (await apiKeyResponse.json()) as { token: string }
            const verifiedToken = await auth.api.verifyApiKey({
                body: { key: accessTokenBody.token },
            })
            expect(verifiedToken.valid).toBe(true)

            const tokenConnectionStartResponse = await bearerRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/linkedin/connect`,
                accessTokenBody.token,
                { method: 'POST' }
            )
            expect(tokenConnectionStartResponse.status).toBe(403)

            const rejectedCallbackResponse = await bearerRequest(
                app,
                '/api/oauth/linkedin/callback',
                accessTokenBody.token
            )
            expect(rejectedCallbackResponse.status).toBe(403)

            const sessionInvalidCallbackResponse = await jsonRequest(
                app,
                '/api/oauth/linkedin/callback',
                cookie
            )
            expect(sessionInvalidCallbackResponse.status).toBe(303)
            expect(sessionInvalidCallbackResponse.headers.get('location')).toBe(
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
                `${channelLocation}&publisher=connected`
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
                externalAccountName: 'Postdot Operator',
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

            database.$client.exec(`
                update instance_state
                set state = 'claimable',
                    bootstrap_blocked = 0,
                    claimed_by_user_id = null,
                    claimed_at = null
                where id = 'default';
                delete from instance_memberships;
            `)
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
                    return Response.json({ sub: 'member-42', name: 'Postdot Operator' })
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
            const cookie = await signUp(app, 'organization-operator@postdot.local')
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
            const channelLocation = `http://localhost:5173/dashboard/projects/${projectBody.project.id}/channels?publisher_channel=${channelBody.channel.id}`

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
                `${channelLocation}&publisher=connected`
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

    it('completes X OAuth and reconnects a revoked project-owned connection', async () => {
        const tokenRequests: Array<Record<string, string | null>> = []
        const provider = Bun.serve({
            port: 0,
            async fetch(request) {
                const url = new URL(request.url)
                if (url.pathname === '/token') {
                    const authorization = request.headers.get('authorization') ?? ''
                    expect(authorization.startsWith('Basic ')).toBe(true)
                    const body = new URLSearchParams(await request.text())
                    tokenRequests.push({
                        grantType: body.get('grant_type'),
                        code: body.get('code'),
                        codeVerifier: body.get('code_verifier'),
                        redirectUri: body.get('redirect_uri'),
                    })
                    return Response.json({
                        access_token: 'x-access-token-1',
                        refresh_token: 'x-refresh-token-1',
                        expires_in: 7200,
                        scope: 'tweet.read tweet.write users.read offline.access media.write',
                        token_type: 'Bearer',
                    })
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
        const seenProfileTokens: string[] = []
        const { app, database, publisher } = createFixture({
            x: {
                clientId: 'x-client-id',
                clientSecret: 'x-client-secret',
                authorizationServer,
                publisher: {
                    async getMe(accessToken) {
                        seenProfileTokens.push(accessToken)
                        expect(accessToken).toBe('x-access-token-1')
                        return {
                            kind: 'success',
                            value: {
                                id: '2244994945',
                                name: 'X Operator',
                                username: 'xoperator',
                            },
                        }
                    },
                    async uploadMedia() {
                        throw new Error('media upload must not run during connection')
                    },
                    async publishTweet() {
                        throw new Error('publication must not run during connection')
                    },
                },
            },
        })

        try {
            const cookie = await signUp(app, 'x-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'X Project' }),
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
                    body: JSON.stringify({ name: 'X presence', profile: 'x' }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as {
                channel: { id: string }
            }
            const channelLocation = `http://localhost:5173/dashboard/projects/${projectBody.project.id}/channels?publisher_channel=${channelBody.channel.id}`

            const apiKeyResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'X automation agent',
                    projectIds: [projectBody.project.id],
                }),
            })
            expect(apiKeyResponse.status).toBe(201)
            const accessTokenBody = (await apiKeyResponse.json()) as { token: string }

            const tokenConnectionStartResponse = await bearerRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/x/connect`,
                accessTokenBody.token,
                { method: 'POST' }
            )
            expect(tokenConnectionStartResponse.status).toBe(403)

            const rejectedCallbackResponse = await bearerRequest(
                app,
                '/api/oauth/x/callback',
                accessTokenBody.token
            )
            expect(rejectedCallbackResponse.status).toBe(403)

            const sessionInvalidCallbackResponse = await jsonRequest(
                app,
                '/api/oauth/x/callback',
                cookie
            )
            expect(sessionInvalidCallbackResponse.status).toBe(303)
            expect(sessionInvalidCallbackResponse.headers.get('location')).toBe(
                'http://localhost:5173/dashboard?publisher=invalid_callback'
            )

            const missingChannelResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/missing-channel/publisher/x/connect`,
                cookie,
                { method: 'POST' }
            )
            expect(missingChannelResponse.status).toBe(404)

            const connectionStartResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/x/connect`,
                cookie,
                { method: 'POST' }
            )
            expect(connectionStartResponse.status).toBe(200)
            const connectionStartBody = (await connectionStartResponse.json()) as {
                provider: string
                scopes: string[]
                authorizationUrl: string
            }
            expect(connectionStartBody.provider).toBe('x')
            // Scopes are normalized (sorted) by the OAuth boundary.
            expect(connectionStartBody.scopes).toEqual([
                'media.write',
                'offline.access',
                'tweet.read',
                'tweet.write',
                'users.read',
            ])
            const authorizationUrl = new URL(connectionStartBody.authorizationUrl)
            expect(authorizationUrl.searchParams.get('client_id')).toBe('x-client-id')
            expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
                'http://localhost:3000/api/oauth/x/callback'
            )
            expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
            expect(authorizationUrl.searchParams.get('code_challenge')).toBeString()
            const state = authorizationUrl.searchParams.get('state')
            expect(state).toBeString()

            // The PKCE verifier is persisted encrypted while the attempt is pending.
            const pendingAttempt = database.$client
                .query<{ status: string; verifier: Uint8Array | null }, []>(`
                    select status,
                           pkce_verifier_ciphertext as verifier
                    from oauth_authorization_attempts
                `)
                .get()
            expect(pendingAttempt?.status).toBe('pending')
            expect(pendingAttempt?.verifier).toBeInstanceOf(Uint8Array)

            const callbackResponse = await app.handle(
                new Request(
                    `${baseURL}/api/oauth/x/callback?code=authorization-code&state=${encodeURIComponent(state ?? '')}`,
                    { headers: { cookie } }
                )
            )
            expect(callbackResponse.status).toBe(303)
            expect(callbackResponse.headers.get('location')).toBe(
                `${channelLocation}&publisher=connected`
            )

            // The token endpoint received the PKCE verifier and callback URI.
            expect(tokenRequests).toHaveLength(1)
            expect(tokenRequests[0]).toMatchObject({
                grantType: 'authorization_code',
                code: 'authorization-code',
                redirectUri: 'http://localhost:3000/api/oauth/x/callback',
            })
            expect(tokenRequests[0]?.codeVerifier).toBeString()
            const codeVerifier = tokenRequests[0]?.codeVerifier
            if (typeof codeVerifier !== 'string') throw new Error('PKCE verifier was not captured')
            expect(authorizationUrl.searchParams.get('code_challenge')).toBe(
                createHash('sha256').update(codeVerifier).digest('base64url')
            )
            expect(seenProfileTokens).toEqual(['x-access-token-1'])

            // Consuming the attempt clears the single-use verifier ciphertext.
            const storedAttempt = database.$client
                .query<{ status: string; verifier: Uint8Array | null }, []>(`
                    select status,
                           pkce_verifier_ciphertext as verifier
                    from oauth_authorization_attempts
                `)
                .get()
            expect(storedAttempt?.status).toBe('consumed')
            expect(storedAttempt?.verifier).toBeNull()

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
                externalAccountId: '2244994945',
                externalAccountName: '@xoperator',
                kind: 'x',
                providerId: 'x',
                destination: { type: 'account', id: '2244994945', name: '@xoperator' },
                scopes: [
                    'media.write',
                    'offline.access',
                    'tweet.read',
                    'tweet.write',
                    'users.read',
                ],
                state: 'active',
            })
            expect(listBody.connections[0]).not.toHaveProperty('accessToken')
            expect(listBody.connections[0]).not.toHaveProperty('refreshToken')

            const initialConnection = listBody.connections[0]
            const initialCredentialId = initialConnection?.credentialId
            expect(initialCredentialId).toBeString()
            if (typeof initialCredentialId !== 'string') {
                throw new Error('The initial X connection credential was not persisted')
            }

            // A revoked credential keeps the connection discoverable so the UI can offer recovery,
            // while removing secret usability until the user completes OAuth again.
            const revokedCredential = publisher.credentialStore.revokePublisherCredential(
                projectBody.project.id,
                initialCredentialId
            )
            expect(revokedCredential?.state).toBe('revoked')

            const revokedListResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publishers`,
                cookie
            )
            expect(revokedListResponse.status).toBe(200)
            const revokedListBody = (await revokedListResponse.json()) as {
                connections: Array<Record<string, unknown>>
            }
            expect(revokedListBody.connections).toHaveLength(1)
            expect(revokedListBody.connections[0]).toMatchObject({
                credentialId: initialCredentialId,
                state: 'revoked',
            })

            const reconnectStartResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/x/connect`,
                cookie,
                { method: 'POST' }
            )
            expect(reconnectStartResponse.status).toBe(200)
            const reconnectStartBody = (await reconnectStartResponse.json()) as {
                authorizationUrl: string
            }
            const reconnectState = new URL(reconnectStartBody.authorizationUrl).searchParams.get(
                'state'
            )
            expect(reconnectState).toBeString()
            const reconnectResponse = await app.handle(
                new Request(
                    `${baseURL}/api/oauth/x/callback?code=authorization-code-reconnect&state=${encodeURIComponent(reconnectState ?? '')}`,
                    { headers: { cookie } }
                )
            )
            expect(reconnectResponse.status).toBe(303)
            expect(reconnectResponse.headers.get('location')).toBe(
                `${channelLocation}&publisher=connected`
            )

            const reconnectedListResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publishers`,
                cookie
            )
            expect(reconnectedListResponse.status).toBe(200)
            const reconnectedListBody = (await reconnectedListResponse.json()) as {
                connections: Array<Record<string, unknown>>
            }
            expect(reconnectedListBody.connections).toHaveLength(1)
            expect(reconnectedListBody.connections[0]).toMatchObject({
                credentialId: initialCredentialId,
                externalAccountId: '2244994945',
                state: 'active',
            })

            // Tokens never leak into API responses or stored ciphertext.
            expect(JSON.stringify(connectionStartBody)).not.toContain('x-access-token-1')
            expect(JSON.stringify(connectionStartBody)).not.toContain('x-refresh-token-1')
            expect(JSON.stringify(listBody)).not.toContain('x-access-token-1')
            expect(JSON.stringify(listBody)).not.toContain('x-refresh-token-1')
            const storedSecrets = database.$client
                .query<{ accessToken: Uint8Array; refreshToken: Uint8Array }, []>(`
                    select access_token_ciphertext as accessToken,
                           refresh_token_ciphertext as refreshToken
                    from publisher_credentials
                `)
                .all()
            expect(storedSecrets).toHaveLength(1)
            for (const row of storedSecrets) {
                const stored = `${Buffer.from(row.accessToken).toString('binary')}${Buffer.from(row.refreshToken).toString('binary')}`
                expect(stored).not.toContain('x-access-token-1')
                expect(stored).not.toContain('x-refresh-token-1')
            }

            expect(
                database.$client
                    .query<{ providerId: string }, []>(
                        `select provider_id as providerId from account`
                    )
                    .all()
            ).toEqual([{ providerId: 'credential' }])

            const duplicateResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher/x/connect`,
                cookie,
                { method: 'POST' }
            )
            expect(duplicateResponse.status).toBe(409)

            database.$client.exec(`
                update instance_state
                set state = 'claimable',
                    bootstrap_blocked = 0,
                    claimed_by_user_id = null,
                    claimed_at = null
                where id = 'default';
                delete from instance_memberships;
            `)
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

    it('rejects X OAuth state misuse, authorization denial, and provider errors', async () => {
        let tokenBehavior: 'ok' | 'error' = 'ok'
        const provider = Bun.serve({
            port: 0,
            async fetch(request) {
                const url = new URL(request.url)
                if (url.pathname === '/token') {
                    if (tokenBehavior === 'error') {
                        return Response.json(
                            { error: 'invalid_grant', error_description: 'Code expired' },
                            { status: 400 }
                        )
                    }
                    return Response.json({
                        access_token: 'x-access-token-2',
                        refresh_token: 'x-refresh-token-2',
                        expires_in: 7200,
                        scope: 'tweet.read tweet.write users.read offline.access media.write',
                        token_type: 'Bearer',
                    })
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
            allowAdditionalSignups: true,
            x: {
                clientId: 'x-client-id',
                clientSecret: 'x-client-secret',
                authorizationServer,
                publisher: {
                    async getMe() {
                        return {
                            kind: 'success',
                            value: {
                                id: '2244994946',
                                name: 'Second Operator',
                                username: 'xsecond',
                            },
                        }
                    },
                    async uploadMedia() {
                        throw new Error('media upload must not run during connection')
                    },
                    async publishTweet() {
                        throw new Error('publication must not run during connection')
                    },
                },
            },
        })

        try {
            const cookie = await signUp(app, 'x-first-operator@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'X state project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            async function createChannel(name: string) {
                const channelResponse = await jsonRequest(
                    app,
                    `/api/projects/${projectBody.project.id}/channels`,
                    cookie,
                    { method: 'POST', body: JSON.stringify({ name, profile: 'x' }) }
                )
                expect(channelResponse.status).toBe(201)
                return (await channelResponse.json()) as { channel: { id: string } }
            }
            async function startConnection(channelId: string) {
                const startResponse = await jsonRequest(
                    app,
                    `/api/projects/${projectBody.project.id}/channels/${channelId}/publisher/x/connect`,
                    cookie,
                    { method: 'POST' }
                )
                expect(startResponse.status).toBe(200)
                const startBody = (await startResponse.json()) as { authorizationUrl: string }
                const state = new URL(startBody.authorizationUrl).searchParams.get('state')
                expect(state).toBeString()
                return state ?? ''
            }
            async function callback(code: string, state: string, sessionCookie: string) {
                return app.handle(
                    new Request(
                        `${baseURL}/api/oauth/x/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
                        { headers: { cookie: sessionCookie } }
                    )
                )
            }

            const firstChannel = await createChannel('X first channel')
            const firstState = await startConnection(firstChannel.channel.id)
            const firstChannelLocation = `http://localhost:5173/dashboard/projects/${projectBody.project.id}/channels?publisher_channel=${firstChannel.channel.id}`

            const unknownStateResponse = await callback(
                'authorization-code',
                'unknown-state',
                cookie
            )
            expect(unknownStateResponse.status).toBe(303)
            expect(unknownStateResponse.headers.get('location')).toBe(
                'http://localhost:5173/dashboard?publisher=invalid_callback'
            )

            const secondCookie = await signUpFixtureAdditionalUser(
                app,
                'x-second-operator@postdot.local'
            )
            const mismatchedResponse = await callback(
                'authorization-code',
                firstState,
                secondCookie
            )
            expect(mismatchedResponse.status).toBe(303)
            expect(mismatchedResponse.headers.get('location')).toBe(
                `${firstChannelLocation}&publisher=invalid_callback`
            )

            const successResponse = await callback('authorization-code', firstState, cookie)
            expect(successResponse.status).toBe(303)
            expect(successResponse.headers.get('location')).toBe(
                `${firstChannelLocation}&publisher=connected`
            )

            const replayedResponse = await callback('authorization-code', firstState, cookie)
            expect(replayedResponse.status).toBe(303)
            expect(replayedResponse.headers.get('location')).toBe(
                `${firstChannelLocation}&publisher=already_used`
            )

            const deniedChannel = await createChannel('X denied channel')
            const deniedState = await startConnection(deniedChannel.channel.id)
            const deniedResponse = await app.handle(
                new Request(
                    `${baseURL}/api/oauth/x/callback?error=access_denied&error_description=${encodeURIComponent('The user declined access')}&state=${encodeURIComponent(deniedState)}`,
                    { headers: { cookie } }
                )
            )
            expect(deniedResponse.status).toBe(303)
            expect(deniedResponse.headers.get('location')).toBe(
                `http://localhost:5173/dashboard/projects/${projectBody.project.id}/channels?publisher_channel=${deniedChannel.channel.id}&publisher=authorization_denied`
            )

            const secondChannel = await createChannel('X second channel')
            const secondState = await startConnection(secondChannel.channel.id)
            tokenBehavior = 'error'
            const providerErrorResponse = await callback('expired-code', secondState, cookie)
            expect(providerErrorResponse.status).toBe(303)
            expect(providerErrorResponse.headers.get('location')).toBe(
                `http://localhost:5173/dashboard/projects/${projectBody.project.id}/channels?publisher_channel=${secondChannel.channel.id}&publisher=provider_unavailable`
            )

            const listResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publishers`,
                cookie
            )
            const listBody = (await listResponse.json()) as {
                connections: Array<Record<string, unknown>>
            }
            // Only the successful first connection persisted.
            expect(listBody.connections).toHaveLength(1)
            expect(listBody.connections[0]).toMatchObject({
                externalAccountId: '2244994946',
                kind: 'x',
            })
            expect(JSON.stringify(listBody)).not.toContain('x-access-token-2')
            expect(JSON.stringify(listBody)).not.toContain('x-refresh-token-2')
        } finally {
            provider.stop()
            closeDatabase(database)
        }
    })

    it('exposes an explicit reconciliation path for an ambiguous publication', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app, 'reconciler@postdot.local')
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

    it('applies twitter-text validation before X publication scheduling', async () => {
        const { app, database } = createFixture()

        try {
            const cookie = await signUp(app)
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'X validation' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            const projectId = projectBody.project.id
            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'X destination', profile: 'x' }),
                }
            )
            expect(channelResponse.status).toBe(201)
            const channelBody = (await channelResponse.json()) as { channel: { id: string } }

            const longUrl = `https://example.com/${'a'.repeat(300)}`
            const validPostResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/posts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent: {
                            body: { text: longUrl, format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channelBody.channel.id,
                                targetContent: { text: longUrl, media: [] },
                                deliveryMode: 'manual',
                                scheduledAt: now,
                            },
                        ],
                    }),
                }
            )
            expect(validPostResponse.status).toBe(201)

            const invalidScheduledResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/posts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent: {
                            body: { text: '日'.repeat(200), format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channelBody.channel.id,
                                targetContent: { text: '日'.repeat(200), media: [] },
                                deliveryMode: 'manual',
                                scheduledAt: now,
                            },
                        ],
                    }),
                }
            )
            expect(invalidScheduledResponse.status).toBe(400)

            const invalidDraftResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/posts`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent: {
                            body: { text: '日'.repeat(200), format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channelBody.channel.id,
                                targetContent: { text: '日'.repeat(200), media: [] },
                                deliveryMode: 'manual',
                            },
                        ],
                    }),
                }
            )
            expect(invalidDraftResponse.status).toBe(201)
            const draftBody = (await invalidDraftResponse.json()) as {
                publications: Array<{ id: string; reviewState: string }>
            }
            const draft = draftBody.publications[0]
            expect(draft?.reviewState).toBe('review_required')
            if (draft === undefined) throw new Error('The invalid X draft was not created')

            const promoteResponse = await jsonRequest(
                app,
                `/api/projects/${projectId}/publications/${draft.id}/draft/promote`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ expectedRevision: 1, scheduledAt: now }),
                }
            )
            expect(promoteResponse.status).toBe(400)
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

it('restricts SMTP settings to human instance administrators and never returns credentials', async () => {
    const settingsDatabase = createDatabase(':memory:')
    runMigrations(settingsDatabase)
    const sent: string[] = []
    const service = await createEmailSettingsService({
        store: createInstallationEmailSettingsStore(
            settingsDatabase,
            createSecretCipher({
                domain: 'postdot.installation-email',
                keyId: 'test',
                key: publisherEncryptionKey,
            })
        ),
        createTransport: () => ({
            async sendMail(message) {
                sent.push(String(message.to))
            },
        }),
    })
    const { app, access, database } = createFixture({
        emailSettings: service,
        allowAdditionalSignups: true,
    })
    try {
        const cookie = await signUp(app, 'smtp-admin@postdot.local')
        const read = await jsonRequest(app, '/api/settings/email', cookie)
        expect(read.status).toBe(200)
        expect(await read.json()).toMatchObject({
            source: 'none',
            enabled: false,
            hasPassword: false,
        })
        const input = {
            enabled: true,
            host: 'smtp.example.test',
            port: 587,
            secure: false,
            from: 'postdot@example.test',
            username: 'mailer',
            password: 'FAKE_SECRET_355',
        }
        const save = await jsonRequest(app, '/api/settings/email', cookie, {
            method: 'PUT',
            body: JSON.stringify(input),
        })
        expect(save.status).toBe(200)
        expect(await save.text()).not.toContain('FAKE_SECRET_355')
        expect(
            (await jsonRequest(app, '/api/settings/email/test', cookie, { method: 'POST' })).status
        ).toBe(200)
        expect(sent).toEqual(['smtp-admin@postdot.local'])
        const invalid = await jsonRequest(app, '/api/settings/email', cookie, {
            method: 'PUT',
            body: JSON.stringify({ ...input, host: 'smtp server' }),
        })
        expect(invalid.status).toBe(422)
        const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
            method: 'POST',
            body: JSON.stringify({ name: 'SMTP key scope' }),
        })
        const projectId = ((await projectResponse.json()) as { project: { id: string } }).project.id
        const keyResponse = await jsonRequest(app, '/api/api-keys', cookie, {
            method: 'POST',
            body: JSON.stringify({ projectIds: [projectId] }),
        })
        expect(keyResponse.status).toBe(201)
        const key = ((await keyResponse.json()) as { token: string }).token
        for (const [path, method] of [
            ['/api/settings/email', 'GET'],
            ['/api/settings/email', 'PUT'],
            ['/api/settings/email/test', 'POST'],
        ] as const) {
            const response = await app.handle(
                new Request(`${baseURL}${path}`, {
                    method,
                    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
                    ...(method === 'PUT' ? { body: JSON.stringify(input) } : {}),
                })
            )
            expect(response.status).toBe(403)
        }
        const memberCookie = await signUpFixtureAdditionalUser(app, 'smtp-member@postdot.local')
        const members = access.listInstanceMemberships()
        const memberId = members.find(
            member => member.email === 'smtp-member@postdot.local'
        )!.userId
        const demotion = await jsonRequest(app, `/api/access/members/${memberId}`, cookie, {
            method: 'PATCH',
            body: JSON.stringify({ role: 'member' }),
        })
        expect(demotion.status).toBe(200)
        expect(await demotion.json()).toMatchObject({ membership: { role: 'member' } })
        expect(
            access.isInstanceAdmin(
                members.find(member => member.email === 'smtp-member@postdot.local')!.userId
            )
        ).toBe(false)
        expect((await jsonRequest(app, '/api/settings/email', memberCookie)).status).toBe(403)
        expect(
            (await jsonRequest(app, '/api/settings/email/test', memberCookie, { method: 'POST' }))
                .status
        ).toBe(403)
        expect(sent).toHaveLength(1)
    } finally {
        closeDatabase(database)
        closeDatabase(settingsDatabase)
    }
})

it('keeps recovery inspection accessible, blocks writes and requires administrator acknowledgement', async () => {
    let held = false
    let resumes = 0
    const hold = {
        version: 1 as const,
        token: 'current-hold',
        createdAt: new Date().toISOString(),
        reason: 'restore' as const,
    }
    const recovery: RecoveryService = {
        held: () => held,
        view: () => ({ held, hold: held ? hold : null }),
        resume(token) {
            if (!held || token !== hold.token) throw new Error('Stale recovery')
            held = false
            resumes++
        },
    }
    const { app, database, access, auth } = createFixture({
        recovery,
        allowAdditionalSignups: true,
    })
    try {
        const admin = await signUp(app, 'recovery-admin@postdot.local')
        const member = await signUp(app, 'recovery-member@postdot.local')
        const memberUser = database.$client
            .query<{ id: string }, []>(
                "select id from user where email = 'recovery-member@postdot.local'"
            )
            .get()!
        const adminUser = database.$client
            .query<{ id: string }, []>(
                "select id from user where email = 'recovery-admin@postdot.local'"
            )
            .get()!
        await auth.api.setRole({
            body: { userId: memberUser.id, role: 'user' },
            headers: new Headers({ cookie: admin }),
        })
        expect(access.isInstanceAdmin(adminUser.id)).toBe(true)
        expect(access.isInstanceAdmin(memberUser.id)).toBe(false)
        held = true
        expect((await app.handle(new Request(`${baseURL}/api/recovery/status`))).status).toBe(200)
        expect((await jsonRequest(app, '/api/projects', admin)).status).toBe(200)
        for (const path of [
            '/api/projects',
            '/api/settings/email/test',
            '/api/projects/missing/publications/missing/publish',
        ]) {
            const response = await jsonRequest(app, path, admin, { method: 'POST', body: '{}' })
            expect(response.status).toBe(503)
            expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
                'recovery_hold'
            )
        }
        expect((await jsonRequest(app, '/api/settings/recovery', member)).status).toBe(403)
        const resume = (cookie: string, token: string) =>
            jsonRequest(app, '/api/settings/recovery/resume', cookie, {
                method: 'POST',
                body: JSON.stringify({ token, confirm: true }),
            })
        expect((await resume(member, hold.token)).status).toBe(403)
        expect((await resume(admin, 'old-token')).status).toBe(409)
        expect(held).toBe(true)
        expect((await resume(admin, hold.token)).status).toBe(200)
        expect(resumes).toBe(1)
        expect((await resume(admin, hold.token)).status).toBe(409)
        const created = await jsonRequest(app, '/api/projects', admin, {
            method: 'POST',
            body: JSON.stringify({ name: 'Recovered project' }),
        })
        expect(created.status).toBe(201)
    } finally {
        closeDatabase(database)
    }
})

it('serves recovery inspection as ready without masking failed runtimes', async () => {
    for (const state of ['idle', 'failed'] as const) {
        const { app, database } = createFixture({
            runtime: {
                recovery: { held: () => true },
                scheduler: { state },
                mediaMaintenance: { state: 'idle' },
                notifications: { state: 'started' },
            },
        })
        try {
            const response = await app.handle(new Request(`${baseURL}/ready`))
            expect(response.status).toBe(state === 'idle' ? 200 : 503)
            expect(await response.json()).toMatchObject({
                checks: { recovery: 'held', scheduler: state },
            })
        } finally {
            closeDatabase(database)
        }
    }
})

it('saves the standalone post source with revision guards and no destination changes', async () => {
    const { app, database, access } = createFixture({ allowAdditionalSignups: true })
    try {
        const cookie = await signUp(app)
        const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
            method: 'POST',
            body: JSON.stringify({ name: 'Shared source' }),
        })
        const { project } = (await projectResponse.json()) as { project: { id: string } }
        const channelResponse = await jsonRequest(
            app,
            `/api/projects/${project.id}/channels`,
            cookie,
            { method: 'POST', body: JSON.stringify({ name: 'Manual' }) }
        )
        const { channel } = (await channelResponse.json()) as { channel: { id: string } }
        const created = await jsonRequest(app, `/api/projects/${project.id}/posts`, cookie, {
            method: 'POST',
            body: JSON.stringify({
                sourceContent: { body: { text: 'Original', format: 'plain_text' }, media: [] },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            }),
        })
        const { post } = (await created.json()) as { post: { id: string } }
        const url = `/api/projects/${project.id}/posts/${post.id}`
        const body = JSON.stringify({
            expectedSourceRevision: 1,
            sourceContent: { body: { text: 'Updated', format: 'plain_text' }, media: [] },
        })
        const before = database.$client.query('select * from publication_working_drafts').all()
        const updated = await jsonRequest(app, url, cookie, { method: 'PATCH', body })
        expect(updated.status).toBe(200)
        const viewerCookie = await signUpFixtureAdditionalUser(app, 'source-viewer@postdot.local')
        const viewer = database.$client
            .query<{ id: string }, [string]>('select id from user where email = ?1')
            .get('source-viewer@postdot.local')!
        expect(
            access.grantProjectUserAccess({
                projectId: project.id,
                userId: viewer.id,
                role: 'viewer',
            })
        ).not.toBeNull()
        expect((await jsonRequest(app, url, viewerCookie)).status).toBe(200)
        expect((await jsonRequest(app, url, viewerCookie, { method: 'PATCH', body })).status).toBe(
            403
        )
        const outsiderCookie = await signUpFixtureAdditionalUser(
            app,
            'source-outsider@postdot.local'
        )
        expect(
            (await jsonRequest(app, url, outsiderCookie, { method: 'PATCH', body })).status
        ).toBe(404)

        expect(((await updated.json()) as { post: { sourceRevision: number } }).post).toMatchObject(
            {
                sourceRevision: 2,
                sourceContent: { body: { text: 'Updated' } },
            }
        )
        expect(database.$client.query('select * from publication_working_drafts').all()).toEqual(
            before
        )
        expect((await jsonRequest(app, url, cookie, { method: 'PATCH', body })).status).toBe(409)
        expect((await jsonRequest(app, url, '', { method: 'PATCH', body })).status).toBe(401)
        expect(
            (
                await jsonRequest(app, url, cookie, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        expectedSourceRevision: 2,
                        sourceContent: { media: [] },
                    }),
                })
            ).status
        ).toBe(400)
    } finally {
        closeDatabase(database)
    }
})
