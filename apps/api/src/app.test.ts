import { describe, expect, it } from 'bun:test'

import { createAuth } from '@herald/auth'
import { closeDatabase, createDatabase, runMigrations } from '@herald/db'
import { account, publications, user as authUser } from '@herald/db/schema'
import { eq } from 'drizzle-orm'

import { createApp } from './app'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000

function createFixture(options: { readonly linkedin?: boolean } = {}) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const auth = createAuth(database, {
        baseURL,
        secret,
        ...(options.linkedin
            ? {
                  linkedin: {
                      clientId: 'linkedin-client-id',
                      clientSecret: 'linkedin-client-secret',
                  },
              }
            : {}),
    })
    const app = createApp({ auth, database, manualStore: { now: () => now } })

    return { app, database }
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

function seedLinkedInAccount(
    database: ReturnType<typeof createDatabase>,
    userId: string,
    accountId: string,
    scope = 'openid,profile,w_member_social'
) {
    database
        .insert(account)
        .values({
            id: accountId,
            issuer: 'local:oauth:linkedin',
            accountId: `${accountId}-external`,
            providerId: 'linkedin',
            userId,
            scope,
            updatedAt: new Date(now),
        })
        .run()
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
                '/api/projects/{projectId}/publishers',
                '/api/projects/{projectId}/channels/{channelId}/publisher/linkedin/connect',
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
                        content: 'A source post for multiple destinations.',
                        publications: [
                            {
                                channelId: channelBody.channel.id,
                                content: 'Manual copy',
                                scheduledAt: now,
                            },
                            {
                                channelId: secondChannelBody.channel.id,
                                content: 'Second copy',
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

    it('starts LinkedIn OAuth and binds only a linked account to a project channel', async () => {
        const { app, database } = createFixture({ linkedin: true })

        try {
            const cookie = await signUp(app)
            const currentUser = database.select({ id: authUser.id }).from(authUser).get()
            expect(currentUser).toBeDefined()
            if (currentUser === undefined) throw new Error('The test user was not created')

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
                    body: JSON.stringify({ name: 'LinkedIn Member' }),
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
            expect(connectionStartResponse.headers.get('set-cookie')).toContain('state=')
            const connectionStartBody = (await connectionStartResponse.json()) as {
                provider: string
                scopes: string[]
                authorizationUrl: string
            }
            expect(connectionStartBody.provider).toBe('linkedin')
            expect(connectionStartBody.scopes).toEqual(['w_member_social'])
            expect(
                new URL(connectionStartBody.authorizationUrl).searchParams.get('scope')
            ).toContain('w_member_social')

            seedLinkedInAccount(database, currentUser.id, 'linkedin-account')
            const bindingResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        provider: 'linkedin',
                        accountId: 'linkedin-account',
                    }),
                }
            )
            expect(bindingResponse.status).toBe(201)
            const bindingBody = (await bindingResponse.json()) as {
                connection: {
                    accountId: string
                    providerId: string
                    kind: string
                }
            }
            expect(bindingBody.connection).toMatchObject({
                accountId: 'linkedin-account',
                providerId: 'linkedin',
                kind: 'linkedin',
            })

            const duplicateResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        provider: 'linkedin',
                        accountId: 'linkedin-account',
                    }),
                }
            )
            expect(duplicateResponse.status).toBe(409)

            database
                .insert(authUser)
                .values({
                    id: 'other-user',
                    name: 'Other User',
                    email: 'other-user@herald.local',
                })
                .run()
            seedLinkedInAccount(database, 'other-user', 'other-linkedin-account')

            const foreignAccountResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        provider: 'linkedin',
                        accountId: 'other-linkedin-account',
                    }),
                }
            )
            expect(foreignAccountResponse.status).toBe(422)

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
                accountId: 'linkedin-account',
                providerId: 'linkedin',
            })
            expect(listBody.connections[0]).not.toHaveProperty('accessToken')
            expect(listBody.connections[0]).not.toHaveProperty('refreshToken')

            const disconnectResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels/${channelBody.channel.id}/publisher`,
                cookie,
                { method: 'DELETE' }
            )
            expect(disconnectResponse.status).toBe(200)
            expect(await disconnectResponse.json()).toEqual({ disconnected: true })

            const emptyListResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/publishers`,
                cookie
            )
            expect(emptyListResponse.status).toBe(200)
            expect(await emptyListResponse.json()).toEqual({ connections: [] })
            expect(() =>
                database.delete(account).where(eq(account.id, 'linkedin-account')).run()
            ).not.toThrow()
        } finally {
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
                        content: 'A publication requiring reconciliation',
                        publications: [{ channelId: channelBody.channel.id, scheduledAt: now }],
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
