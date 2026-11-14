import { describe, expect, it } from 'bun:test'

import { createAuth } from '@postdot/auth'
import type { DatabaseHandle } from '@postdot/db'
import { createTaxonomyStore } from '@postdot/db'
import { createAccessStore } from '@postdot/db'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'
import type { DevtoFetcher } from '@postdot/devto'

import { createApp } from '../../app'
import type { RecoveryService } from '../../recovery'
import type { EmailSettingsService } from '../email/settings'
import { requiredApiKeyCapability } from '../projects/api-key-permissions'
import { createPublisherRuntime } from '../publishers/runtime'
import type { PostdotBootstrapController } from './public-routes'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

async function createFixture(
    options: {
        readonly allowAdditionalSignups?: boolean
        readonly bootstrap?: PostdotBootstrapController
        readonly devtoFetcher?: DevtoFetcher
        readonly emailSettings?: EmailSettingsService
        readonly recovery?: RecoveryService
    } = {}
) {
    const database = (await openTestDatabase()).database
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, {
        baseURL,
        secret,
        access,
        isOpenSignupAllowed: () => (options.bootstrap?.mode ?? 'open') === 'open',
        allowAdditionalSignups: options.allowAdditionalSignups,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey,
        publisherEncryptionKeyId: 'test-v1',
        bluesky: {
            clientMetadataUrl: 'https://postdot.example.test/oauth/bluesky/client-metadata.json',
            handleResolver: 'https://bsky.social',
        },
    })
    const app = createApp({
        auth,
        access,
        database,
        publisher,
        manualStore: { now: () => now },
        taxonomy: createTaxonomyStore(database, { now: () => now }),
        bootstrap: options.bootstrap,
        allowAdditionalSignups: options.allowAdditionalSignups,
        devtoFetcher: options.devtoFetcher,
        emailSettings: options.emailSettings,
        recovery: options.recovery,
    })
    return { access, app, auth, database }
}

async function signUp(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({
                email,
                name: email.split('@')[0],
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    expect(response.status).toBe(200)
    return response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
}

async function signIn(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
        })
    )
    expect(response.status).toBe(200)
    return response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
}

async function seedExistingUser(database: DatabaseHandle, email: string, name: string) {
    const credential = await database.sql
        .statement<
            {
                readonly issuer: string | null
                readonly providerId: string
                readonly password: string
            },
            []
        >(
            `select issuer, provider_id as providerId, password from account
             where provider_id = 'credential' and password is not null
             order by created_at, id limit 1`
        )
        .get()
    if (credential === null) throw new Error('The bootstrap password hash was not found')

    const userId = `user-${email.split('@')[0]}`
    const timestamp = now + 1
    await database.sql
        .statement<
            void,
            [id: string, name: string, email: string, createdAt: number, updatedAt: number]
        >(
            `insert into "user" (id, name, email, email_verified, created_at, updated_at)
             values (?1, ?2, ?3, 0, ?4, ?5)`
        )
        .run(userId, name, email, timestamp, timestamp)
    await database.sql
        .statement<
            void,
            [
                id: string,
                issuer: string | null,
                accountId: string,
                providerId: string,
                userId: string,
                password: string,
                createdAt: number,
                updatedAt: number,
            ]
        >(
            `insert into account (
                 id, issuer, account_id, provider_id, user_id, password, created_at, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        )
        .run(
            `account-${userId}`,
            credential.issuer,
            userId,
            credential.providerId,
            userId,
            credential.password,
            timestamp,
            timestamp
        )
    return userId
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
    return app.handle(new Request(`${baseURL}${path}`, { ...init, headers }))
}

async function bearerRequest(
    app: ReturnType<typeof createApp>,
    path: string,
    token: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    return app.handle(new Request(`${baseURL}${path}`, { ...init, headers }))
}

async function bearerJsonRequest(
    app: ReturnType<typeof createApp>,
    path: string,
    token: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    return app.handle(new Request(`${baseURL}${path}`, { ...init, headers }))
}

describe('access HTTP routes', () => {
    it('creates user-owned API keys with an optional project subset', async () => {
        const { app, database } = await createFixture()

        try {
            const cookie = await signUp(app, 'api-key-owner@postdot.local')
            const firstProjectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'First API project' }),
            })
            const secondProjectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Second API project' }),
            })
            expect(firstProjectResponse.status).toBe(201)
            expect(secondProjectResponse.status).toBe(201)
            const firstProject = (await firstProjectResponse.json()) as {
                project: { id: string }
            }
            const secondProject = (await secondProjectResponse.json()) as {
                project: { id: string }
            }

            const createAllResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({ projectIds: null }),
            })
            expect(createAllResponse.status).toBe(201)
            const createdAll = (await createAllResponse.json()) as {
                key: { name: string; projectAccess: string }
                token: string
            }
            expect(createdAll.key.projectAccess).toBe('all')
            expect(createdAll.key.name).toMatch(
                /^Postdot (Amber|Bright|Calm|Clever|Golden|Gentle|Noble|Quiet|Silver|Sunny|Swift|Warm) (Cedar|Comet|Fox|Horizon|Maple|Meadow|Orbit|Pine|River|Sparrow|Stone|Willow) [0-9A-F]{6}$/
            )
            expect(createdAll.token).toMatch(/^postdot_pat_/)

            const allProjectsResponse = await bearerRequest(app, '/api/projects', createdAll.token)
            expect(allProjectsResponse.status).toBe(200)
            const allProjects = (await allProjectsResponse.json()) as { projects: unknown[] }
            expect(allProjects.projects).toHaveLength(2)

            const allKeyProjectResponse = await bearerRequest(
                app,
                `/api/projects/${secondProject.project.id}/channels`,
                createdAll.token
            )
            expect(allKeyProjectResponse.status).toBe(200)

            const createSelectedResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Postdot MCP',
                    projectIds: [firstProject.project.id],
                }),
            })
            expect(createSelectedResponse.status).toBe(201)
            const createdSelected = (await createSelectedResponse.json()) as {
                key: { name: string; projectAccess: string[] }
                token: string
            }
            expect(createdSelected.key.name).toBe('Postdot MCP')
            expect(createdSelected.key.projectAccess).toEqual([firstProject.project.id])

            const selectedProjectsResponse = await bearerRequest(
                app,
                '/api/projects',
                createdSelected.token
            )
            expect(selectedProjectsResponse.status).toBe(200)
            const selectedProjects = (await selectedProjectsResponse.json()) as {
                projects: unknown[]
            }
            expect(selectedProjects.projects).toEqual([
                expect.objectContaining({ id: firstProject.project.id }),
            ])

            const selectedKeyProjectResponse = await bearerRequest(
                app,
                `/api/projects/${firstProject.project.id}/channels`,
                createdSelected.token
            )
            expect(selectedKeyProjectResponse.status).toBe(200)
            const rejectedProjectResponse = await bearerRequest(
                app,
                `/api/projects/${secondProject.project.id}/channels`,
                createdSelected.token
            )
            expect(rejectedProjectResponse.status).toBe(404)

            const listed = await jsonRequest(app, '/api/api-keys', cookie)
            expect(listed.status).toBe(200)
            const listedKeys = (await listed.json()) as { keys: unknown[] }
            expect(listedKeys.keys).toHaveLength(2)

            expect(secondProject.project.id).not.toBe(firstProject.project.id)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('enforces and updates action ceilings independently from project scope', async () => {
        const { app, database } = await createFixture()

        try {
            const cookie = await signUp(app, 'api-key-actions@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'API key actions project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            expect(projectResponse.status).toBe(201)

            const createResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Read-only API key',
                    projectIds: [projectBody.project.id],
                    actionAccess: ['project:read'],
                }),
            })
            expect(createResponse.status).toBe(201)
            const created = (await createResponse.json()) as {
                key: { id: string; actionAccess: string[] }
                token: string
            }
            expect(created.key.actionAccess).toEqual(['project:read'])

            const readableChannels = await bearerRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                created.token
            )
            expect(readableChannels.status).toBe(200)

            const deniedChannelMutation = await bearerJsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                created.token,
                { method: 'POST', body: JSON.stringify({ name: 'Denied channel' }) }
            )
            expect(deniedChannelMutation.status).toBe(403)
            expect(await deniedChannelMutation.json()).toMatchObject({
                error: { code: 'insufficient_api_key_permissions' },
            })

            const updateResponse = await jsonRequest(
                app,
                `/api/api-keys/${created.key.id}`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ actionAccess: ['channel:manage'] }),
                }
            )
            expect(updateResponse.status).toBe(200)
            expect(await updateResponse.json()).toMatchObject({
                key: { actionAccess: ['channel:manage'], projectAccess: [projectBody.project.id] },
            })

            const deniedRead = await bearerRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                created.token
            )
            expect(deniedRead.status).toBe(403)

            const allowedChannelMutation = await bearerJsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                created.token,
                { method: 'POST', body: JSON.stringify({ name: 'Allowed channel' }) }
            )
            expect(allowedChannelMutation.status).toBe(201)
            const { channel } = (await allowedChannelMutation.json()) as {
                channel: { id: string }
            }

            const deniedSessionOnlyRoute = await bearerRequest(
                app,
                `/api/projects/${projectBody.project.id}/members`,
                created.token
            )
            expect(deniedSessionOnlyRoute.status).toBe(403)

            const unrestrictedUpdate = await jsonRequest(
                app,
                `/api/api-keys/${created.key.id}`,
                cookie,
                { method: 'PATCH', body: JSON.stringify({ actionAccess: null }) }
            )
            expect(unrestrictedUpdate.status).toBe(200)
            expect(await unrestrictedUpdate.json()).toMatchObject({
                key: { actionAccess: 'all' },
            })

            const allowedSchedule = await bearerJsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/posts`,
                created.token,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent: {
                            body: { text: 'Unrestricted scheduled post', format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channel.id,
                                deliveryMode: 'manual',
                                scheduledAt: now + 60_000,
                            },
                        ],
                    }),
                }
            )
            expect(allowedSchedule.status).toBe(201)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('allows a manage-only API key to request approval but not schedule or approve', async () => {
        const { app, database } = await createFixture()

        try {
            const cookie = await signUp(app, 'publication-approval@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Publication approval project' }),
            })
            const { project } = (await projectResponse.json()) as { project: { id: string } }
            expect(projectResponse.status).toBe(201)

            const channelResponse = await jsonRequest(
                app,
                `/api/projects/${project.id}/channels`,
                cookie,
                { method: 'POST', body: JSON.stringify({ name: 'Approval destination' }) }
            )
            const { channel } = (await channelResponse.json()) as { channel: { id: string } }
            expect(channelResponse.status).toBe(201)

            const keyResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    projectIds: [project.id],
                    actionAccess: ['publication:manage'],
                }),
            })
            const { token } = (await keyResponse.json()) as { token: string }
            expect(keyResponse.status).toBe(201)

            const sourceContent = {
                body: { text: 'Prepared by an external agent', format: 'plain_text' },
                media: [],
            }
            const proposedScheduledAt = now + 60_000
            const scheduledCreation = await bearerJsonRequest(
                app,
                `/api/projects/${project.id}/posts`,
                token,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent,
                        publications: [
                            {
                                channelId: channel.id,
                                deliveryMode: 'manual',
                                scheduledAt: proposedScheduledAt,
                            },
                        ],
                    }),
                }
            )
            expect(scheduledCreation.status).toBe(403)
            expect(await scheduledCreation.json()).toMatchObject({
                error: { code: 'insufficient_api_key_permissions' },
            })

            const draftResponse = await bearerJsonRequest(
                app,
                `/api/projects/${project.id}/posts`,
                token,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        sourceContent,
                        publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
                    }),
                }
            )
            expect(draftResponse.status).toBe(201)
            const { publications } = (await draftResponse.json()) as {
                publications: Array<{ id: string; state: string }>
            }
            const publication = publications[0]
            if (publication === undefined) throw new Error('The API draft was not created')
            expect(publication.state).toBe('draft')

            const directPromotion = await bearerJsonRequest(
                app,
                `/api/projects/${project.id}/publications/${publication.id}/draft/promote`,
                token,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        expectedRevision: 1,
                        scheduledAt: proposedScheduledAt,
                    }),
                }
            )
            expect(directPromotion.status).toBe(403)

            const approvalRequest = await bearerJsonRequest(
                app,
                `/api/projects/${project.id}/publications/${publication.id}/approval-request`,
                token,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        expectedDraftRevision: 1,
                        proposedScheduledAt,
                    }),
                }
            )
            expect(approvalRequest.status).toBe(201)
            expect(await approvalRequest.json()).toMatchObject({
                request: { publicationId: publication.id, state: 'pending', proposedScheduledAt },
            })

            const hiddenRequestList = await bearerRequest(
                app,
                `/api/projects/${project.id}/publications/approval-requests`,
                token
            )
            expect(hiddenRequestList.status).toBe(403)
            const deniedApproval = await bearerJsonRequest(
                app,
                `/api/projects/${project.id}/publications/${publication.id}/approval-request/approve`,
                token,
                { method: 'POST', body: JSON.stringify({}) }
            )
            expect(deniedApproval.status).toBe(403)

            const requestsResponse = await jsonRequest(
                app,
                `/api/projects/${project.id}/publications/approval-requests`,
                cookie
            )
            expect(requestsResponse.status).toBe(200)
            expect(await requestsResponse.json()).toMatchObject({
                requests: [{ publicationId: publication.id, state: 'pending' }],
            })
            const approved = await jsonRequest(
                app,
                `/api/projects/${project.id}/publications/${publication.id}/approval-request/approve`,
                cookie,
                { method: 'POST', body: JSON.stringify({}) }
            )
            expect(approved.status).toBe(200)
            expect(await approved.json()).toMatchObject({
                publication: {
                    id: publication.id,
                    state: 'scheduled',
                    scheduledAt: proposedScheduledAt,
                },
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('requires the separate permanent-delete capability for media purging', async () => {
        const { app, database } = await createFixture()

        try {
            const cookie = await signUp(app, 'api-key-media-actions@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'API key media project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            expect(projectResponse.status).toBe(201)

            const createResponse = await jsonRequest(app, '/api/api-keys', cookie, {
                method: 'POST',
                body: JSON.stringify({
                    projectIds: [projectBody.project.id],
                    actionAccess: ['project:read', 'media:manage'],
                }),
            })
            const created = (await createResponse.json()) as {
                key: { id: string }
                token: string
            }
            expect(createResponse.status).toBe(201)

            const deniedPurge = await bearerJsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/missing-asset/permanent`,
                created.token,
                { method: 'POST' }
            )
            expect(deniedPurge.status).toBe(403)

            const updateResponse = await jsonRequest(
                app,
                `/api/api-keys/${created.key.id}`,
                cookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ actionAccess: ['media:permanently_delete'] }),
                }
            )
            expect(updateResponse.status).toBe(200)

            const allowedPurgeAttempt = await bearerJsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/missing-asset/permanent`,
                created.token,
                { method: 'POST' }
            )
            expect(allowedPurgeAttempt.status).toBe(503)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it("rechecks the key owner's project role after key creation", async () => {
        const { access, app, database } = await createFixture()

        try {
            const ownerCookie = await signUp(app, 'api-key-role-owner@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'API key role project' }),
            })
            const projectBody = (await projectResponse.json()) as { project: { id: string } }
            expect(projectResponse.status).toBe(201)

            const editorUserId = await seedExistingUser(
                database,
                'api-key-role-editor@postdot.local',
                'API Key Editor'
            )
            const defaultWorkspace = await access.getDefaultWorkspace()
            expect(defaultWorkspace).not.toBeNull()
            if (defaultWorkspace === null) throw new Error('The default workspace was not created')
            await database.sql
                .statement(
                    `insert into instance_memberships
                     (id, user_id, role, state, created_at, updated_at)
                     values (?1, ?2, 'member', 'enabled', ?3, ?3)`
                )
                .run(`instance-membership:${editorUserId}`, editorUserId, now)
            await database.sql
                .statement(
                    `insert into member (id, organization_id, user_id, role, created_at)
                     values (?1, ?2, ?3, 'member', ?4)`
                )
                .run(
                    `workspace-member:${editorUserId}`,
                    defaultWorkspace.organizationId,
                    editorUserId,
                    now
                )
            const editorCookie = await signIn(app, 'api-key-role-editor@postdot.local')
            expect(
                await access.grantProjectUserAccess({
                    projectId: projectBody.project.id,
                    userId: editorUserId,
                    role: 'editor',
                })
            ).toMatchObject({ role: 'editor' })

            const createKeyResponse = await jsonRequest(app, '/api/api-keys', editorCookie, {
                method: 'POST',
                body: JSON.stringify({
                    projectIds: [projectBody.project.id],
                    actionAccess: ['channel:manage'],
                }),
            })
            expect(createKeyResponse.status).toBe(201)
            const createdKey = (await createKeyResponse.json()) as { token: string }

            const allowedBeforeRevocation = await bearerJsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                createdKey.token,
                { method: 'POST', body: JSON.stringify({ name: 'Before revocation' }) }
            )
            expect(allowedBeforeRevocation.status).toBe(201)

            expect(await access.removeProjectUserAccess(projectBody.project.id, editorUserId)).toBe(
                true
            )
            const deniedAfterRevocation = await bearerJsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/channels`,
                createdKey.token,
                { method: 'POST', body: JSON.stringify({ name: 'After revocation' }) }
            )
            // ACCESS-309: a key now answers with the same hidden 404 the session
            // path returns once the owner no longer holds project access, so
            // revocation is not distinguishable from an unknown project. An
            // action ceiling failure still answers 403 while access is held.
            expect(deniedAfterRevocation.status).toBe(404)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('publishes access paths with session security and typed status responses', async () => {
        const { app, database } = await createFixture()

        try {
            const setupStatus = await app.handle(new Request(`${baseURL}/api/instance/status`))
            expect(setupStatus.status).toBe(200)
            expect(await setupStatus.json()).toEqual({
                setupAvailable: true,
                bootstrapMode: 'open',
            })

            await signUp(app, 'bootstrap@postdot.local')
            const claimedStatus = await app.handle(new Request(`${baseURL}/api/instance/status`))
            expect(claimedStatus.status).toBe(200)
            expect(await claimedStatus.json()).toEqual({
                setupAvailable: false,
                bootstrapMode: 'claimed',
            })

            const response = await app.handle(new Request(`${baseURL}/openapi/json`))
            expect(response.status).toBe(200)
            const specification = (await response.json()) as {
                paths: Record<
                    string,
                    Record<
                        string,
                        { operationId?: string; responses?: Record<string, unknown> } | undefined
                    >
                >
            }
            expect(Object.keys(specification.paths)).toEqual(
                expect.arrayContaining([
                    '/api/instance/status',
                    '/api/instance/bootstrap',
                    '/api/access/invitations/{token}',
                    '/api/access',
                    '/api/access/members',
                    '/api/access/invitations',
                    '/api/access/invitations/{invitationId}',
                    '/api/access/invitations/accept',
                ])
            )
            expect(specification.paths['/api/instance/status']?.get?.operationId).toBe(
                'getInstanceSetupStatus'
            )
            expect(specification.paths['/api/instance/bootstrap']?.post?.operationId).toBe(
                'bootstrapInstance'
            )
            expect(specification.paths['/api/access/invitations/{token}']?.get?.operationId).toBe(
                'getAccessInvitationPreview'
            )
            expect(specification.paths['/api/access']?.get?.operationId).toBe(
                'getCurrentInstanceAccess'
            )
            expect(specification.paths['/api/access/members']?.get?.operationId).toBe(
                'listAccessMembers'
            )
            expect(specification.paths['/api/access/members/{userId}']?.patch?.operationId).toBe(
                'updateAccessMember'
            )
            expect(specification.paths['/api/access/invitations']?.get?.operationId).toBe(
                'listAccessInvitations'
            )
            expect(specification.paths['/api/access/invitations']?.post?.operationId).toBe(
                'createAccessInvitation'
            )
            expect(
                specification.paths['/api/access/invitations/{invitationId}']?.delete?.operationId
            ).toBe('revokeAccessInvitation')
            expect(specification.paths['/api/access/invitations/accept']?.post?.operationId).toBe(
                'acceptAccessInvitation'
            )
            expect(specification.paths['/api/access/invitations']?.post?.responses).toHaveProperty(
                '201'
            )
            expect(
                specification.paths['/api/access/invitations/accept']?.post?.responses
            ).toHaveProperty('403')

            for (const [path, pathItem] of Object.entries(specification.paths)) {
                for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
                    const operation = pathItem[method]
                    if (operation === undefined) continue
                    if (requiredApiKeyCapability(method, path) === null) continue

                    expect(operation.responses, `${method.toUpperCase()} ${path}`).toHaveProperty(
                        '403'
                    )
                }
            }
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('keeps setup discoverable for isolated E2E accounts without changing production defaults', async () => {
        const { app, database } = await createFixture({ allowAdditionalSignups: true })

        try {
            await signUp(app, 'e2e-bootstrap@postdot.local')
            const status = await app.handle(new Request(`${baseURL}/api/instance/status`))

            expect(status.status).toBe(200)
            expect(await status.json()).toEqual({
                setupAvailable: true,
                bootstrapMode: 'open',
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('requires an instance admin and forbids user API keys on instance routes', async () => {
        const { access, app, database } = await createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const adminId = (await access.listInstanceMemberships())[0]?.userId
            expect(adminId).toBeString()
            if (adminId === undefined) throw new Error('The bootstrap admin was not created')

            await seedExistingUser(database, 'member@postdot.local', 'Member')
            const memberCookie = await signIn(app, 'member@postdot.local')

            const memberProviderResponse = await jsonRequest(
                app,
                '/api/settings/provider-applications',
                memberCookie
            )
            expect(memberProviderResponse.status).toBe(403)

            const memberCategoryResponse = await jsonRequest(app, '/api/categories', memberCookie)
            expect(memberCategoryResponse.status).toBe(200)

            const adminProviderResponse = await jsonRequest(
                app,
                '/api/settings/provider-applications',
                adminCookie
            )
            expect(adminProviderResponse.status).toBe(200)
            const adminCategoryResponse = await jsonRequest(app, '/api/categories', adminCookie)
            expect(adminCategoryResponse.status).toBe(200)

            const project = await jsonRequest(app, '/api/projects', adminCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Access policy project' }),
            })
            expect(project.status).toBe(201)
            const projectBody = (await project.json()) as { project: { id: string } }
            const tokenResponse = await jsonRequest(app, '/api/api-keys', adminCookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'instance-route-test',
                    projectIds: [projectBody.project.id],
                }),
            })
            expect(tokenResponse.status).toBe(201)
            const token = (await tokenResponse.json()) as { token: string }

            expect((await bearerRequest(app, '/api/access', token.token)).status).toBe(200)
            expect((await bearerRequest(app, '/api/categories', token.token)).status).toBe(200)
            expect(
                (
                    await bearerJsonRequest(app, '/api/categories', token.token, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Scoped key blocked' }),
                    })
                ).status
            ).toBe(403)
            expect(
                (await bearerRequest(app, '/api/settings/provider-applications', token.token))
                    .status
            ).toBe(403)

            const unrestrictedAdminResponse = await jsonRequest(app, '/api/api-keys', adminCookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'instance-admin-unrestricted',
                    projectIds: null,
                }),
            })
            expect(unrestrictedAdminResponse.status).toBe(201)
            const unrestrictedAdmin = (await unrestrictedAdminResponse.json()) as { token: string }
            expect(
                (
                    await bearerRequest(
                        app,
                        '/api/settings/provider-applications',
                        unrestrictedAdmin.token
                    )
                ).status
            ).toBe(200)

            const unrestrictedMemberResponse = await jsonRequest(
                app,
                '/api/api-keys',
                memberCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        name: 'member-unrestricted',
                        projectIds: null,
                    }),
                }
            )
            expect(unrestrictedMemberResponse.status).toBe(201)
            const unrestrictedMember = (await unrestrictedMemberResponse.json()) as {
                token: string
            }
            expect(
                (
                    await bearerRequest(
                        app,
                        '/api/settings/provider-applications',
                        unrestrictedMember.token
                    )
                ).status
            ).toBe(403)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('lists and updates members only for admin sessions while preserving admin safety', async () => {
        const { access, app, auth, database } = await createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const adminId = (await access.listInstanceMemberships())[0]?.userId
            expect(adminId).toBeString()
            if (adminId === undefined) throw new Error('The bootstrap admin was not created')

            const memberId = await seedExistingUser(database, 'member@postdot.local', 'Member')
            const memberCookie = await signIn(app, 'member@postdot.local')
            const invitationResponse = await jsonRequest(
                app,
                '/api/access/invitations',
                adminCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ targetEmail: 'member@postdot.local' }),
                }
            )
            expect(invitationResponse.status).toBe(201)
            const invitation = (await invitationResponse.json()) as { token: string }
            const accepted = await jsonRequest(
                app,
                '/api/access/invitations/accept',
                memberCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ token: invitation.token }),
                }
            )
            expect(accepted.status).toBe(200)

            const listed = await jsonRequest(app, '/api/access/members', adminCookie)
            expect(listed.status).toBe(200)
            expect(await listed.json()).toMatchObject({
                members: expect.arrayContaining([
                    expect.objectContaining({
                        userId: adminId,
                        email: 'admin@postdot.local',
                        name: 'admin',
                        role: 'admin',
                        state: 'enabled',
                    }),
                    expect.objectContaining({
                        userId: memberId,
                        email: 'member@postdot.local',
                        name: 'Member',
                        role: 'member',
                        state: 'enabled',
                    }),
                ]),
            })

            expect((await jsonRequest(app, '/api/access/members', memberCookie)).status).toBe(403)
            expect(
                (
                    await jsonRequest(app, `/api/access/members/${adminId}`, memberCookie, {
                        method: 'PATCH',
                        body: JSON.stringify({ role: 'member' }),
                    })
                ).status
            ).toBe(403)

            const projectResponse = await jsonRequest(app, '/api/projects', adminCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Member administration project' }),
            })
            expect(projectResponse.status).toBe(201)
            const project = (await projectResponse.json()) as { project: { id: string } }
            const tokenResponse = await jsonRequest(app, '/api/api-keys', adminCookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'member-administration-test',
                    projectIds: [project.project.id],
                }),
            })
            expect(tokenResponse.status).toBe(201)
            const token = (await tokenResponse.json()) as { token: string }

            expect((await bearerRequest(app, '/api/access/members', token.token)).status).toBe(403)
            expect(
                (
                    await bearerJsonRequest(app, `/api/access/members/${memberId}`, token.token, {
                        method: 'PATCH',
                        body: JSON.stringify({ role: 'admin' }),
                    })
                ).status
            ).toBe(403)

            const promoted = await jsonRequest(
                app,
                `/api/access/members/${memberId}`,
                adminCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'admin' }),
                }
            )
            expect(promoted.status).toBe(200)
            const promotedBody = await promoted.json()
            expect(promotedBody).toMatchObject({
                membership: { userId: memberId, role: 'admin', state: 'enabled' },
            })
            expect(
                await database.sql
                    .statement<{ readonly role: string | null }, [string]>(
                        'select role from "user" where id = ?1'
                    )
                    .get(memberId)
            ).toEqual({ role: 'admin' })

            await auth.api.setRole({
                body: { userId: memberId, role: 'user' },
                headers: new Headers({ cookie: adminCookie }),
            })
            expect(await access.getInstanceMembership(memberId)).toMatchObject({
                role: 'member',
                state: 'enabled',
            })
            await auth.api.setRole({
                body: { userId: memberId, role: 'admin' },
                headers: new Headers({ cookie: adminCookie }),
            })
            expect(await access.getInstanceMembership(memberId)).toMatchObject({
                role: 'admin',
                state: 'enabled',
            })

            const repeated = await jsonRequest(
                app,
                `/api/access/members/${memberId}`,
                adminCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'admin' }),
                }
            )
            expect(repeated.status).toBe(200)
            expect(await repeated.json()).toEqual(promotedBody)

            const selfUpdate = await jsonRequest(
                app,
                `/api/access/members/${adminId}`,
                adminCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'member' }),
                }
            )
            expect(selfUpdate.status).toBe(409)
            expect(await selfUpdate.json()).toMatchObject({
                error: { code: 'self_membership_update' },
            })

            const demoted = await jsonRequest(app, `/api/access/members/${memberId}`, adminCookie, {
                method: 'PATCH',
                body: JSON.stringify({ role: 'member' }),
            })
            expect(demoted.status).toBe(200)
            expect(
                await database.sql
                    .statement<{ readonly role: string | null }, [string]>(
                        'select role from "user" where id = ?1'
                    )
                    .get(memberId)
            ).toEqual({ role: 'user' })

            const disabled = await jsonRequest(
                app,
                `/api/access/members/${memberId}`,
                adminCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ state: 'disabled' }),
                }
            )
            expect(disabled.status).toBe(200)
            expect(await disabled.json()).toMatchObject({
                membership: { userId: memberId, role: 'member', state: 'disabled' },
            })
            expect(
                await database.sql
                    .statement<{ readonly banned: number | null }, [string]>(
                        'select banned from "user" where id = ?1'
                    )
                    .get(memberId)
            ).toEqual({ banned: 1 })

            const lastAdmin = await jsonRequest(
                app,
                `/api/access/members/${adminId}`,
                adminCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ state: 'disabled' }),
                }
            )
            expect(lastAdmin.status).toBe(409)
            expect(await lastAdmin.json()).toMatchObject({ error: { code: 'last_admin' } })
            expect(await access.getInstanceMembership(adminId)).toMatchObject({
                role: 'admin',
                state: 'enabled',
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('returns invitation tokens only at creation and accepts a matching authenticated user', async () => {
        const { access, app, database } = await createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const memberId = await seedExistingUser(database, 'member@postdot.local', 'Member')
            const memberCookie = await signIn(app, 'member@postdot.local')

            const createResponse = await jsonRequest(app, '/api/access/invitations', adminCookie, {
                method: 'POST',
                body: JSON.stringify({ targetEmail: 'member@postdot.local' }),
            })
            expect(createResponse.status).toBe(201)
            const created = (await createResponse.json()) as {
                invitation: { id: string; targetEmail: string }
                token: string
            }
            expect(created.invitation.targetEmail).toBe('member@postdot.local')
            expect(created.token).toBeString()

            const previewResponse = await app.handle(
                new Request(`${baseURL}/api/access/invitations/${created.token}`)
            )
            expect(previewResponse.status).toBe(200)
            expect(await previewResponse.json()).toEqual({
                targetEmail: 'member@postdot.local',
                expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
            })

            const listResponse = await jsonRequest(app, '/api/access/invitations', adminCookie)
            expect(listResponse.status).toBe(200)
            const listed = await listResponse.json()
            expect(JSON.stringify(listed)).not.toContain(created.token)
            expect(listed).toEqual({ invitations: [created.invitation] })

            const wrongEmailResponse = await jsonRequest(
                app,
                '/api/access/invitations/accept',
                adminCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ token: created.token }),
                }
            )
            expect(wrongEmailResponse.status).toBe(403)
            expect(await access.getInstanceMembership(memberId)).toBeNull()

            const acceptedResponse = await jsonRequest(
                app,
                '/api/access/invitations/accept',
                memberCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ token: created.token }),
                }
            )
            expect(acceptedResponse.status).toBe(200)
            expect(await acceptedResponse.json()).toMatchObject({
                invitation: { id: created.invitation.id, state: 'accepted' },
                instanceMembership: { userId: memberId, role: 'member', state: 'enabled' },
            })
            const consumedPreviewResponse = await app.handle(
                new Request(`${baseURL}/api/access/invitations/${created.token}`)
            )
            expect(consumedPreviewResponse.status).toBe(404)

            const summaryResponse = await jsonRequest(app, '/api/access', memberCookie)
            expect(summaryResponse.status).toBe(200)
            expect(await summaryResponse.json()).toMatchObject({
                membership: { userId: memberId, role: 'member' },
                isAdmin: false,
                instance: { bootstrapBlocked: false },
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('allows a pending invitation to bootstrap a new account before acceptance', async () => {
        const { access, app, database } = await createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const projectResponse = await jsonRequest(app, '/api/projects', adminCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Shared workspace project' }),
            })
            expect(projectResponse.status).toBe(201)
            const project = (await projectResponse.json()) as { project: { id: string } }
            const targetEmail = 'new-invitee@postdot.local'
            const createResponse = await jsonRequest(app, '/api/access/invitations', adminCookie, {
                method: 'POST',
                body: JSON.stringify({ targetEmail }),
            })
            expect(createResponse.status).toBe(201)
            const created = (await createResponse.json()) as { token: string }

            const inviteeCookie = await signUp(app, targetEmail)
            const inviteeId = await database.sql
                .statement<{ readonly id: string }, [string]>(
                    'select id from "user" where email = ?1'
                )
                .get(targetEmail)
            expect(inviteeId).not.toBeNull()

            const acceptResponse = await jsonRequest(
                app,
                '/api/access/invitations/accept',
                inviteeCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ token: created.token }),
                }
            )
            expect(acceptResponse.status).toBe(200)
            expect(await acceptResponse.json()).toMatchObject({
                instanceMembership: {
                    userId: inviteeId?.id,
                    role: 'member',
                    state: 'enabled',
                },
            })
            expect(await access.hasPendingInvitationForEmail(targetEmail)).toBe(false)

            const projectsResponse = await jsonRequest(app, '/api/projects', inviteeCookie)
            expect(projectsResponse.status).toBe(200)
            expect(await projectsResponse.json()).toMatchObject({
                projects: [expect.objectContaining({ id: project.project.id })],
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('invites and accepts a workspace group member through Better Auth', async () => {
        const { access, app, database } = await createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const workspace = await access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')

            const workspaceResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}`,
                adminCookie
            )
            expect(workspaceResponse.status).toBe(200)
            const workspaceBody = (await workspaceResponse.json()) as {
                membership: { role: string }
                teams: Array<{ id: string; name: string }>
            }
            expect(workspaceBody.membership).toEqual({ role: 'owner' })
            const editors = workspaceBody.teams.find(team => team.name === 'Editors')
            expect(editors).toBeDefined()
            if (editors === undefined) throw new Error('The default Editors group was not created')

            const createTeamResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams`,
                adminCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Writers' }),
                }
            )
            expect(createTeamResponse.status).toBe(201)
            const createdTeamBody = (await createTeamResponse.json()) as {
                team: { id: string; name: string; isDefault: boolean; memberCount: number }
            }
            expect(createdTeamBody.team).toMatchObject({
                name: 'Writers',
                isDefault: false,
                memberCount: 0,
            })

            const renameTeamResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${createdTeamBody.team.id}`,
                adminCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ name: 'Content writers' }),
                }
            )
            expect(renameTeamResponse.status).toBe(200)
            expect(await renameTeamResponse.json()).toMatchObject({
                team: {
                    id: createdTeamBody.team.id,
                    name: 'Content writers',
                    isDefault: false,
                },
            })

            const targetEmail = 'workspace-invitee@postdot.local'
            const createResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/invitations`,
                adminCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ email: targetEmail, teamId: editors.id }),
                }
            )
            expect(createResponse.status).toBe(201)
            const created = (await createResponse.json()) as {
                invitation: { id: string; teamId?: string; status: string }
            }
            expect(created.invitation).toMatchObject({ teamId: editors.id, status: 'pending' })

            const inviteeCookie = await signUp(app, targetEmail)
            const inviteeId = await database.sql
                .statement<{ readonly id: string }, [string]>(
                    'select id from "user" where email = ?1'
                )
                .get(targetEmail)
            expect(inviteeId).not.toBeNull()

            const acceptResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/invitations/${created.invitation.id}/accept`,
                inviteeCookie,
                { method: 'POST' }
            )
            expect(acceptResponse.status).toBe(200)
            expect(await acceptResponse.json()).toMatchObject({
                membership: { role: 'member' },
                invitation: { id: created.invitation.id, status: 'accepted' },
            })
            expect(await access.getInstanceMembership(inviteeId?.id ?? '')).toMatchObject({
                role: 'member',
                state: 'enabled',
            })

            const teamMembership = await database.sql
                .statement<{ readonly count: number }, [string, string]>(
                    'select count(*) as count from team_member where team_id = ?1 and user_id = ?2'
                )
                .get(editors.id, inviteeId?.id ?? '')
            expect(teamMembership).toEqual({ count: 1 })

            const addTeamMemberResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${createdTeamBody.team.id}/members`,
                adminCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ userId: inviteeId?.id }),
                }
            )
            expect(addTeamMemberResponse.status).toBe(200)
            expect(await addTeamMemberResponse.json()).toMatchObject({
                member: {
                    teamId: createdTeamBody.team.id,
                    userId: inviteeId?.id,
                },
            })

            const teamMembersResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${createdTeamBody.team.id}/members`,
                adminCookie
            )
            expect(teamMembersResponse.status).toBe(200)
            expect(await teamMembersResponse.json()).toEqual({
                members: [expect.objectContaining({ userId: inviteeId?.id })],
            })
            const removeTeamMemberResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${createdTeamBody.team.id}/members/${inviteeId?.id}`,
                adminCookie,
                { method: 'DELETE' }
            )
            expect(removeTeamMemberResponse.status).toBe(200)
            expect(await removeTeamMemberResponse.json()).toEqual({ removed: true })

            const memberReadAfterRemovalResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${createdTeamBody.team.id}/members`,
                inviteeCookie
            )
            expect(memberReadAfterRemovalResponse.status).toBe(200)
            expect(await memberReadAfterRemovalResponse.json()).toEqual({ members: [] })

            const forbiddenTeamCreate = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/teams`,
                inviteeCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Member-created group' }),
                }
            )
            expect(forbiddenTeamCreate.status).toBe(403)

            const forbiddenWorkspaceCreate = await jsonRequest(
                app,
                '/api/workspaces',
                inviteeCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Member workspace' }),
                }
            )
            expect(forbiddenWorkspaceCreate.status).toBe(403)

            const memberWorkspaceResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}`,
                inviteeCookie
            )
            expect(memberWorkspaceResponse.status).toBe(200)
            const memberWorkspaceBody = (await memberWorkspaceResponse.json()) as {
                members: Array<{ id: string; userId: string; role: string }>
            }
            const workspaceMember = memberWorkspaceBody.members.find(
                member => member.userId === inviteeId?.id
            )
            expect(memberWorkspaceBody).toMatchObject({
                membership: { role: 'member' },
                members: expect.arrayContaining([expect.objectContaining({ email: targetEmail })]),
            })
            expect(workspaceMember).toBeDefined()
            if (workspaceMember === undefined) {
                throw new Error('The workspace member record was not returned')
            }

            const promoteMemberResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/members/${workspaceMember.id}`,
                adminCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'admin' }),
                }
            )
            expect(promoteMemberResponse.status).toBe(200)
            expect(await promoteMemberResponse.json()).toMatchObject({
                member: { id: workspaceMember.id, role: 'admin' },
            })

            const selfRoleUpdateResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/members/${workspaceMember.id}`,
                inviteeCookie,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'member' }),
                }
            )
            expect(selfRoleUpdateResponse.status).toBe(409)
            expect(await selfRoleUpdateResponse.json()).toMatchObject({
                error: { code: 'workspace_self_update' },
            })

            const removeMemberResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/members/${workspaceMember.id}`,
                adminCookie,
                { method: 'DELETE' }
            )
            expect(removeMemberResponse.status).toBe(200)
            expect(await removeMemberResponse.json()).toEqual({ removed: true })

            const removedWorkspaceResponse = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}`,
                inviteeCookie
            )
            expect(removedWorkspaceResponse.status).toBe(403)

            const forbiddenInvite = await jsonRequest(
                app,
                `/api/workspaces/${workspace.id}/invitations`,
                inviteeCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ email: 'another@postdot.local' }),
                }
            )
            expect(forbiddenInvite.status).toBe(403)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('lets an instance administrator create a workspace with its default groups', async () => {
        const { access, app, database } = await createFixture()

        try {
            const adminCookie = await signUp(app, 'workspace-owner@postdot.local')
            const listBefore = await jsonRequest(app, '/api/workspaces', adminCookie)
            expect(listBefore.status).toBe(200)
            expect(await listBefore.json()).toMatchObject({
                canCreateWorkspace: true,
                workspaces: [expect.objectContaining({ name: 'My workspace', role: 'owner' })],
            })

            const createResponse = await jsonRequest(app, '/api/workspaces', adminCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Editorial workspace' }),
            })
            expect(createResponse.status).toBe(201)
            const created = (await createResponse.json()) as {
                workspace: {
                    id: string
                    name: string
                    slug: string
                    isDefault: boolean
                    role: string
                }
            }
            expect(created.workspace).toMatchObject({
                name: 'Editorial workspace',
                isDefault: false,
                role: 'owner',
            })

            const workspace = await access.getWorkspace(created.workspace.id)
            expect(workspace).toMatchObject({
                name: 'Editorial workspace',
                slug: created.workspace.slug,
                isDefault: false,
            })
            const teams = await database.sql
                .statement<{ readonly name: string; readonly memberCount: number }, [string]>(
                    `select name, member_count as memberCount
                     from team where organization_id = ?1 order by name`
                )
                .all(workspace?.organizationId ?? '')
            expect(teams).toEqual([
                { name: 'Administrators', memberCount: 1 },
                { name: 'Editors', memberCount: 0 },
                { name: 'Reviewers', memberCount: 0 },
                { name: 'Viewers', memberCount: 0 },
            ])

            const listAfter = await jsonRequest(app, '/api/workspaces', adminCookie)
            expect(listAfter.status).toBe(200)
            expect(await listAfter.json()).toMatchObject({
                canCreateWorkspace: true,
                workspaces: expect.arrayContaining([
                    expect.objectContaining({ id: created.workspace.id, role: 'owner' }),
                ]),
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('closes public sign-up in token_required mode and bootstraps admin, workspace, session cookie, and API key atomically', async () => {
        const expectedToken = 'bootstrap-secret-token-for-agentic-setup'
        let claimedHookCount = 0
        const { access, app, database } = await createFixture({
            bootstrap: {
                mode: 'token_required',
                verifyToken: candidate => candidate === expectedToken,
                onClaimed: () => {
                    claimedHookCount += 1
                },
            },
        })

        try {
            const initialStatus = await app.handle(new Request(`${baseURL}/api/instance/status`))
            expect(initialStatus.status).toBe(200)
            expect(await initialStatus.json()).toEqual({
                setupAvailable: true,
                bootstrapMode: 'token_required',
            })

            // Unauthenticated Better Auth public sign-up must fail closed in token_required mode.
            const blockedPublicSignUp = await app.handle(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', origin: baseURL },
                    body: JSON.stringify({
                        name: 'Attacker',
                        email: 'attacker@postdot.local',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(blockedPublicSignUp.ok).toBe(false)
            expect((await access.getInstanceState()).state).toBe('claimable')

            // Missing or wrong bootstrap token is rejected with 403 and creates nothing.
            const missingToken = await app.handle(
                new Request(`${baseURL}/api/instance/bootstrap`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        name: 'Operator',
                        email: 'operator@postdot.local',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(missingToken.status).toBe(403)
            expect(await missingToken.json()).toMatchObject({
                error: { code: 'invalid_bootstrap_token' },
            })

            const wrongToken = await app.handle(
                new Request(`${baseURL}/api/instance/bootstrap`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-postdot-bootstrap-token': 'wrong-token-value-000',
                    },
                    body: JSON.stringify({
                        name: 'Operator',
                        email: 'operator@postdot.local',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(wrongToken.status).toBe(403)
            expect((await access.getInstanceState()).state).toBe('claimable')

            // Invalid apiKey expiry fails cleanly without claiming the instance.
            const invalidKeyBootstrap = await app.handle(
                new Request(`${baseURL}/api/instance/bootstrap`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        authorization: `Bearer ${expectedToken}`,
                    },
                    body: JSON.stringify({
                        name: 'Operator',
                        email: 'operator@postdot.local',
                        password: 'correct-horse-battery-staple',
                        apiKey: { expiresAt: now + 1_000 },
                    }),
                })
            )
            expect(invalidKeyBootstrap.status).toBe(400)
            expect(await invalidKeyBootstrap.json()).toMatchObject({
                error: { code: 'invalid_time' },
            })
            expect((await access.getInstanceState()).state).toBe('claimable')

            // Valid bootstrap claims the instance, creates the admin, mints a PAT, and sets a session cookie.
            const validBootstrap = await app.handle(
                new Request(`${baseURL}/api/instance/bootstrap`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-postdot-bootstrap-token': expectedToken,
                    },
                    body: JSON.stringify({
                        name: 'Agent Admin',
                        email: 'agent@postdot.local',
                        password: 'correct-horse-battery-staple',
                        apiKey: {
                            name: 'Initial Agent Key',
                            projectIds: null,
                            actionAccess: null,
                        },
                    }),
                })
            )
            expect(validBootstrap.status).toBe(201)
            expect(claimedHookCount).toBe(1)

            const bootstrapPayload = (await validBootstrap.json()) as {
                user: { id: string; name: string; email: string; role: string }
                instance: { state: string; claimedByUserId: string; claimedAt: number }
                apiKey?: {
                    key: { id: string; name: string; projectAccess: string; actionAccess: string }
                    token: string
                }
            }
            expect(bootstrapPayload.user).toMatchObject({
                name: 'Agent Admin',
                email: 'agent@postdot.local',
                role: 'admin',
            })
            expect(bootstrapPayload.instance).toMatchObject({
                state: 'claimed',
                claimedByUserId: bootstrapPayload.user.id,
            })
            expect(bootstrapPayload.apiKey?.key).toMatchObject({
                name: 'Initial Agent Key',
                projectAccess: 'all',
                actionAccess: 'all',
            })
            expect(bootstrapPayload.apiKey?.token).toStartWith('postdot_pat_')

            // Session cookie works immediately on authenticated endpoints.
            const sessionCookie = validBootstrap.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
            expect(sessionCookie.length).toBeGreaterThan(0)
            const sessionAccess = await jsonRequest(app, '/api/access', sessionCookie)
            expect(sessionAccess.status).toBe(200)
            expect(await sessionAccess.json()).toMatchObject({
                isAdmin: true,
                instance: { state: 'claimed' },
            })

            // Minted API key works immediately for Bearer-authorized project creation.
            const apiKeyProject = await app.handle(
                new Request(`${baseURL}/api/projects`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        authorization: `Bearer ${bootstrapPayload.apiKey!.token}`,
                    },
                    body: JSON.stringify({ name: 'Bootstrapped Project' }),
                })
            )
            expect(apiKeyProject.status).toBe(201)

            // Status flips to claimed and replay with the same token is permanently rejected.
            const claimedStatus = await app.handle(new Request(`${baseURL}/api/instance/status`))
            expect(await claimedStatus.json()).toEqual({
                setupAvailable: false,
                bootstrapMode: 'claimed',
            })

            const replayBootstrap = await app.handle(
                new Request(`${baseURL}/api/instance/bootstrap`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        authorization: `Bearer ${expectedToken}`,
                    },
                    body: JSON.stringify({
                        name: 'Second Admin',
                        email: 'second@postdot.local',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(replayBootstrap.status).toBe(409)
            expect(await replayBootstrap.json()).toMatchObject({
                error: { code: 'already_claimed' },
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('provisions and offboards agent accounts without passwords and initial keys while preventing escalation', async () => {
        const { app, database } = await createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const p1 = (
                (await (
                    await jsonRequest(app, '/api/projects', adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Agent Project One' }),
                    })
                ).json()) as { project: { id: string } }
            ).project.id
            const p2 = (
                (await (
                    await jsonRequest(app, '/api/projects', adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Agent Project Two' }),
                    })
                ).json()) as { project: { id: string } }
            ).project.id

            const adminAllKey = (
                (await (
                    await jsonRequest(app, '/api/api-keys', adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Admin unrestricted', projectIds: null }),
                    })
                ).json()) as { token: string }
            ).token

            const adminOnlyKey = (
                (await (
                    await jsonRequest(app, '/api/api-keys', adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({
                            name: 'Instance admin only',
                            projectIds: null,
                            actionAccess: ['instance:admin', 'project:read'],
                        }),
                    })
                ).json()) as { token: string }
            ).token

            // instance:admin key without publication:manage cannot mint an initial key with publication:manage or 'all'.
            const blockedEscalation = await bearerJsonRequest(
                app,
                '/api/access/members',
                adminOnlyKey,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: 'blocked-agent@postdot.local',
                        name: 'Blocked Agent',
                        role: 'member',
                        apiKey: {
                            name: 'Escalated key',
                            projectIds: [p1],
                            actionAccess: ['publication:manage'],
                        },
                    }),
                }
            )
            expect(blockedEscalation.status).toBe(403)
            expect(await blockedEscalation.json()).toMatchObject({
                error: { code: 'api_key_escalation_denied' },
            })

            // Unrestricted admin key provisions a service account without a password + scoped initial key atomically.
            const provisioned = await bearerJsonRequest(app, '/api/access/members', adminAllKey, {
                method: 'POST',
                body: JSON.stringify({
                    email: 'release-bot@postdot.local',
                    name: 'Release Bot',
                    role: 'member',
                    apiKey: {
                        name: 'Release Bot Key',
                        projectIds: [p1],
                        actionAccess: ['project:read', 'channel:manage'],
                    },
                }),
            })
            expect(provisioned.status).toBe(201)
            const provisionedBody = (await provisioned.json()) as {
                membership: { userId: string; email: string; role: string; state: string }
                apiKey?: { key: { id: string; projectAccess: string[] }; token: string }
            }
            expect(provisionedBody.membership).toMatchObject({
                email: 'release-bot@postdot.local',
                role: 'member',
                state: 'enabled',
            })
            expect(provisionedBody.apiKey?.token).toStartWith('postdot_pat_')
            expect(provisionedBody.apiKey?.key.projectAccess).toEqual([p1])

            const botToken = provisionedBody.apiKey!.token
            const botKeyId = provisionedBody.apiKey!.key.id
            const botUserId = provisionedBody.membership.userId

            // Granted scope does NOT automatically confer project membership until granted; default workspace member sees 0 projects.
            expect((await bearerRequest(app, '/api/access', botToken)).status).toBe(200)
            // Grant bot editor access on p1 and p2: bot key only holds [p1], so p2 remains hidden (404).
            expect(
                (
                    await jsonRequest(app, `/api/projects/${p1}/user-grants`, adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ userId: botUserId, role: 'editor' }),
                    })
                ).status
            ).toBe(201)
            expect(
                (
                    await jsonRequest(app, `/api/projects/${p2}/user-grants`, adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ userId: botUserId, role: 'editor' }),
                    })
                ).status
            ).toBe(201)

            const botChannel = await bearerJsonRequest(
                app,
                `/api/projects/${p1}/channels`,
                botToken,
                { method: 'POST', body: JSON.stringify({ name: 'Bot channel' }) }
            )
            expect(botChannel.status).toBe(201)
            expect(
                (await bearerRequest(app, `/api/projects/${p2}/channels`, botToken)).status
            ).toBe(404)

            // Key offboarding requires BOTH instance:admin AND api_key:manage.
            expect(
                (
                    await bearerRequest(
                        app,
                        `/api/access/members/${botUserId}/api-keys`,
                        adminOnlyKey
                    )
                ).status
            ).toBe(403)
            const listedKeys = await bearerRequest(
                app,
                `/api/access/members/${botUserId}/api-keys`,
                adminAllKey
            )
            expect(listedKeys.status).toBe(200)
            expect(await listedKeys.json()).toMatchObject({
                keys: [expect.objectContaining({ id: botKeyId, name: 'Release Bot Key' })],
            })

            const revokedKey = await bearerRequest(
                app,
                `/api/access/members/${botUserId}/api-keys/${botKeyId}`,
                adminAllKey,
                { method: 'DELETE' }
            )
            expect(revokedKey.status).toBe(200)
            expect(await revokedKey.json()).toEqual({ deleted: true })

            // Revoked key fails immediately with 401.
            expect((await bearerRequest(app, '/api/access', botToken)).status).toBe(401)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('enforces anti-escalation rules on api_key:manage keys', async () => {
        const { app, database } = await createFixture()

        try {
            const ownerCookie = await signUp(app, 'key-mgr@postdot.local')
            const p1 = (
                (await (
                    await jsonRequest(app, '/api/projects', ownerCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Scoped One' }),
                    })
                ).json()) as { project: { id: string } }
            ).project.id
            const p2 = (
                (await (
                    await jsonRequest(app, '/api/projects', ownerCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Scoped Two' }),
                    })
                ).json()) as { project: { id: string } }
            ).project.id

            const broaderKey = (
                (await (
                    await jsonRequest(app, '/api/api-keys', ownerCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Broader unrestricted', projectIds: null }),
                    })
                ).json()) as { key: { id: string } }
            ).key.id

            const readOnlyKey = (
                (await (
                    await jsonRequest(app, '/api/api-keys', ownerCookie, {
                        method: 'POST',
                        body: JSON.stringify({
                            name: 'Read only',
                            projectIds: [p1],
                            actionAccess: ['project:read'],
                        }),
                    })
                ).json()) as { token: string }
            ).token
            expect((await bearerRequest(app, '/api/api-keys', readOnlyKey)).status).toBe(403)

            const managerKey = (
                (await (
                    await jsonRequest(app, '/api/api-keys', ownerCookie, {
                        method: 'POST',
                        body: JSON.stringify({
                            name: 'Scoped Manager',
                            projectIds: [p1],
                            actionAccess: ['api_key:manage', 'project:read', 'publication:manage'],
                        }),
                    })
                ).json()) as { token: string }
            ).token

            // Cannot mint wider projectIds or wider capabilities or 'all'.
            for (const invalidBody of [
                { name: 'All projects', projectIds: null, actionAccess: ['project:read'] },
                { name: 'Other project', projectIds: [p2], actionAccess: ['project:read'] },
                { name: 'All actions', projectIds: [p1], actionAccess: null },
                {
                    name: 'Extra capability',
                    projectIds: [p1],
                    actionAccess: ['project:read', 'project:manage'],
                },
            ]) {
                const denied = await bearerJsonRequest(app, '/api/api-keys', managerKey, {
                    method: 'POST',
                    body: JSON.stringify(invalidBody),
                })
                expect(denied.status).toBe(403)
                expect(await denied.json()).toMatchObject({
                    error: { code: 'api_key_escalation_denied' },
                })
            }

            // Can mint a narrower child key.
            const childRes = await bearerJsonRequest(app, '/api/api-keys', managerKey, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Child reader',
                    projectIds: [p1],
                    actionAccess: ['project:read'],
                }),
            })
            expect(childRes.status).toBe(201)
            const childId = ((await childRes.json()) as { key: { id: string } }).key.id

            // Cannot update or delete the owner's broader key.
            expect(
                (
                    await bearerJsonRequest(app, `/api/api-keys/${broaderKey}`, managerKey, {
                        method: 'PATCH',
                        body: JSON.stringify({ name: 'Hijacked' }),
                    })
                ).status
            ).toBe(403)
            expect(
                (
                    await bearerRequest(app, `/api/api-keys/${broaderKey}`, managerKey, {
                        method: 'DELETE',
                    })
                ).status
            ).toBe(403)

            // Cannot escalate child key via PATCH.
            expect(
                (
                    await bearerJsonRequest(app, `/api/api-keys/${childId}`, managerKey, {
                        method: 'PATCH',
                        body: JSON.stringify({ actionAccess: ['publication:approve'] }),
                    })
                ).status
            ).toBe(403)

            // Can update and delete the narrower child key cleanly.
            const renamed = await bearerJsonRequest(app, `/api/api-keys/${childId}`, managerKey, {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Renamed Child' }),
            })
            expect(renamed.status).toBe(200)
            expect((await renamed.json()) as { key: { name: string } }).toMatchObject({
                key: { name: 'Renamed Child' },
            })

            const deleted = await bearerRequest(app, `/api/api-keys/${childId}`, managerKey, {
                method: 'DELETE',
            })
            expect(deleted.status).toBe(200)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('administers workspaces, project grants, instance settings, and Better Auth sync via API keys', async () => {
        const { access, app, database } = await createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const memberId = await seedExistingUser(database, 'member@postdot.local', 'Member')
            const memberCookie = await signIn(app, 'member@postdot.local')

            const wsKeyRes = await jsonRequest(app, '/api/api-keys', adminCookie, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Workspace Admin Key',
                    projectIds: null,
                    actionAccess: [
                        'workspace:manage',
                        'project:manage',
                        'project:access_manage',
                        'project:read',
                        'instance:admin',
                    ],
                }),
            })
            expect(wsKeyRes.status).toBe(201)
            const wsKey = ((await wsKeyRes.json()) as { token: string }).token

            // Invite & manage instance member via Bearer API key (server-side Better Auth sync).
            const inviteMember = await bearerJsonRequest(app, '/api/access/invitations', wsKey, {
                method: 'POST',
                body: JSON.stringify({ targetEmail: 'member@postdot.local' }),
            })
            expect(inviteMember.status).toBe(201)
            const inviteToken = ((await inviteMember.json()) as { token: string }).token

            // Accepting an invitation via API key stays session-only.
            expect(
                (
                    await bearerJsonRequest(app, '/api/access/invitations/accept', wsKey, {
                        method: 'POST',
                        body: JSON.stringify({ token: inviteToken }),
                    })
                ).status
            ).toBe(403)

            // Member accepts with their session cookie.
            expect(
                (
                    await jsonRequest(app, '/api/access/invitations/accept', memberCookie, {
                        method: 'POST',
                        body: JSON.stringify({ token: inviteToken }),
                    })
                ).status
            ).toBe(200)

            // Create workspace + team + manage team members + workspace invitations without cookies.
            const createdWsRes = await bearerJsonRequest(app, '/api/workspaces', wsKey, {
                method: 'POST',
                body: JSON.stringify({ name: 'Agent Managed Workspace' }),
            })
            expect(createdWsRes.status).toBe(201)
            const wsId = ((await createdWsRes.json()) as { workspace: { id: string } }).workspace.id

            const wsInvite = await bearerJsonRequest(
                app,
                `/api/workspaces/${wsId}/invitations`,
                wsKey,
                {
                    method: 'POST',
                    body: JSON.stringify({ email: 'member@postdot.local' }),
                }
            )
            expect(wsInvite.status).toBe(201)
            const wsInviteId = ((await wsInvite.json()) as { invitation: { id: string } })
                .invitation.id

            // Workspace invitation accept remains session-only.
            expect(
                (
                    await bearerRequest(
                        app,
                        `/api/workspaces/${wsId}/invitations/${wsInviteId}/accept`,
                        wsKey,
                        { method: 'POST' }
                    )
                ).status
            ).toBe(403)
            expect(
                (
                    await jsonRequest(
                        app,
                        `/api/workspaces/${wsId}/invitations/${wsInviteId}/accept`,
                        memberCookie,
                        { method: 'POST' }
                    )
                ).status
            ).toBe(200)

            const teamRes = await bearerJsonRequest(app, `/api/workspaces/${wsId}/teams`, wsKey, {
                method: 'POST',
                body: JSON.stringify({ name: 'Automation Crew' }),
            })
            expect(teamRes.status).toBe(201)
            const teamId = ((await teamRes.json()) as { team: { id: string } }).team.id

            expect(
                (
                    await bearerJsonRequest(
                        app,
                        `/api/workspaces/${wsId}/teams/${teamId}/members`,
                        wsKey,
                        { method: 'POST', body: JSON.stringify({ userId: memberId }) }
                    )
                ).status
            ).toBe(200)

            const wsDetail = await bearerRequest(app, `/api/workspaces/${wsId}`, wsKey)
            expect(wsDetail.status).toBe(200)
            const wsDetailBody = (await wsDetail.json()) as {
                members: Array<{ id: string; userId: string }>
            }
            const wsMemberRecord = wsDetailBody.members.find(m => m.userId === memberId)
            expect(wsMemberRecord).toBeDefined()

            expect(
                (
                    await bearerJsonRequest(
                        app,
                        `/api/workspaces/${wsId}/members/${wsMemberRecord!.id}`,
                        wsKey,
                        { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) }
                    )
                ).status
            ).toBe(200)

            // Create project in workspace & grant team + user access via Bearer key.
            const projectRes = await bearerJsonRequest(app, '/api/projects', wsKey, {
                method: 'POST',
                body: JSON.stringify({ name: 'Team Project', workspaceId: wsId }),
            })
            expect(projectRes.status).toBe(201)
            const projectId = ((await projectRes.json()) as { project: { id: string } }).project.id

            expect(
                (
                    await bearerJsonRequest(app, `/api/projects/${projectId}/team-grants`, wsKey, {
                        method: 'POST',
                        body: JSON.stringify({ teamId, role: 'editor' }),
                    })
                ).status
            ).toBe(201)
            expect(await access.canAccessProject(projectId, memberId, 'editor')).toBe(true)

            expect(
                (
                    await bearerJsonRequest(app, `/api/projects/${projectId}/user-grants`, wsKey, {
                        method: 'POST',
                        body: JSON.stringify({ userId: memberId, role: 'viewer' }),
                    })
                ).status
            ).toBe(201)

            // Manage categories and provider applications via instance:admin API key.
            const createdCategory = await bearerJsonRequest(app, '/api/categories', wsKey, {
                method: 'POST',
                body: JSON.stringify({ name: 'Releases' }),
            })
            expect(createdCategory.status).toBe(201)

            const createdApp = await bearerJsonRequest(
                app,
                '/api/settings/provider-applications',
                wsKey,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        providerId: 'x',
                        name: 'Agent X App',
                        clientId: 'client-id-123',
                        clientSecret: 'client-secret-456',
                    }),
                }
            )
            expect(createdApp.status).toBe(201)

            // Disable member via PATCH /api/access/members/:userId and verify Better Auth banned sync.
            const disabled = await bearerJsonRequest(
                app,
                `/api/access/members/${memberId}`,
                wsKey,
                { method: 'PATCH', body: JSON.stringify({ state: 'disabled' }) }
            )
            expect(disabled.status).toBe(200)
            expect(
                await database.sql
                    .statement<{ readonly banned: number | null }, [string]>(
                        'select banned from "user" where id = ?1'
                    )
                    .get(memberId)
            ).toEqual({ banned: 1 })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('separates publication:approve from publication:manage, filters search/removals, and unlocks non-OAuth connect', async () => {
        const devtoFetcher: DevtoFetcher = async () =>
            new Response(JSON.stringify({ id: 99, username: 'agent_dev', name: 'Agent Dev' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        const { app, database } = await createFixture({ devtoFetcher })

        try {
            const adminCookie = await signUp(app, 'workflow-admin@postdot.local')
            const p1 = (
                (await (
                    await jsonRequest(app, '/api/projects', adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Alpha Launch' }),
                    })
                ).json()) as { project: { id: string } }
            ).project.id
            const p2 = (
                (await (
                    await jsonRequest(app, '/api/projects', adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Beta Launch Hidden' }),
                    })
                ).json()) as { project: { id: string } }
            ).project.id

            const devtoChannel = (
                (await (
                    await jsonRequest(app, `/api/projects/${p1}/channels`, adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'DEV.to Articles', profile: 'devto' }),
                    })
                ).json()) as { channel: { id: string } }
            ).channel.id

            const authorKey = (
                (await (
                    await jsonRequest(app, '/api/api-keys', adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({
                            name: 'Author key',
                            projectIds: [p1],
                            actionAccess: ['project:read', 'publication:manage', 'channel:manage'],
                        }),
                    })
                ).json()) as { token: string }
            ).token

            const approverKey = (
                (await (
                    await jsonRequest(app, '/api/api-keys', adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({
                            name: 'Approver key',
                            projectIds: [p1],
                            actionAccess: ['project:read', 'publication:approve'],
                        }),
                    })
                ).json()) as { token: string }
            ).token

            // Non-interactive devto connect works with channel:manage; bluesky connect remains session-only.
            const connectDevto = await bearerJsonRequest(
                app,
                `/api/projects/${p1}/channels/${devtoChannel}/publisher/devto/connect`,
                authorKey,
                {
                    method: 'POST',
                    body: JSON.stringify({ apiKey: 'devto-test-api-key-value' }),
                }
            )
            expect(connectDevto.status).toBe(200)

            const blueskyChannel = (
                (await (
                    await jsonRequest(app, `/api/projects/${p1}/channels`, adminCookie, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Bluesky Feed', profile: 'bluesky' }),
                    })
                ).json()) as { channel: { id: string } }
            ).channel.id
            expect(
                (
                    await bearerJsonRequest(
                        app,
                        `/api/projects/${p1}/channels/${blueskyChannel}/publisher/bluesky/connect`,
                        authorKey,
                        {
                            method: 'POST',
                            body: JSON.stringify({ handle: 'postdot.bsky.social' }),
                        }
                    )
                ).status
            ).toBe(403)

            // Create post & submit for approval via authorKey (publication:manage).
            const createdPost = await bearerJsonRequest(
                app,
                `/api/projects/${p1}/posts`,
                authorKey,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        title: 'Approval Target Alpha',
                        sourceContent: {
                            body: { text: 'Hello launch', format: 'plain_text' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: devtoChannel,
                                deliveryMode: 'manual',
                                targetContent: {
                                    title: 'Hello DEV.to',
                                    body_markdown: 'Hello **DEV.to**',
                                    media: [],
                                },
                            },
                        ],
                    }),
                }
            )
            expect(createdPost.status).toBe(201)
            const publicationId = (
                (await createdPost.json()) as { publications: Array<{ id: string }> }
            ).publications[0]!.id

            const submitApproval = await bearerJsonRequest(
                app,
                `/api/projects/${p1}/publications/${publicationId}/approval-request`,
                authorKey,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        expectedDraftRevision: 1,
                        proposedScheduledAt: now + 60_000,
                    }),
                }
            )
            expect(submitApproval.status).toBe(201)

            // Author key CANNOT approve its own request.
            expect(
                (
                    await bearerJsonRequest(
                        app,
                        `/api/projects/${p1}/publications/${publicationId}/approval-request/approve`,
                        authorKey,
                        { method: 'POST', body: JSON.stringify({}) }
                    )
                ).status
            ).toBe(403)

            // Approver key lists approval requests (project:read) and approves (publication:approve).
            const approvalList = await bearerRequest(
                app,
                `/api/projects/${p1}/publications/approval-requests`,
                approverKey
            )
            expect(approvalList.status).toBe(200)
            expect((await approvalList.json()) as { requests: unknown[] }).toMatchObject({
                requests: [expect.objectContaining({ publicationId, state: 'pending' })],
            })

            const approved = await bearerJsonRequest(
                app,
                `/api/projects/${p1}/publications/${publicationId}/approval-request/approve`,
                approverKey,
                { method: 'POST', body: JSON.stringify({}) }
            )
            expect(approved.status).toBe(200)

            // Scoped search only exposes p1 (not p2).
            const searchRes = await bearerRequest(app, '/api/search?q=Launch', authorKey)
            expect(searchRes.status).toBe(200)
            const searchBody = (await searchRes.json()) as {
                results: Array<{ kind: string; id: string; projectId: string }>
            }
            expect(searchBody.results.length).toBeGreaterThan(0)
            expect(searchBody.results.every(r => r.projectId === p1)).toBe(true)

            // Archive both projects and check GET /api/resource-removals is scoped to p1 for authorKey.
            for (const pid of [p1, p2]) {
                const impact = (await (
                    await jsonRequest(app, `/api/projects/${pid}/lifecycle`, adminCookie)
                ).json()) as { fingerprint: string }
                expect(
                    (
                        await jsonRequest(
                            app,
                            `/api/projects/${pid}/lifecycle/archive`,
                            adminCookie,
                            {
                                method: 'POST',
                                body: JSON.stringify({
                                    fingerprint: impact.fingerprint,
                                    cancelPending: true,
                                }),
                            }
                        )
                    ).status
                ).toBe(200)
            }

            const removals = await bearerRequest(app, '/api/resource-removals', authorKey)
            expect(removals.status).toBe(200)
            const removalsBody = (await removals.json()) as {
                resources: Array<{ kind: string; id: string }>
            }
            expect(removalsBody.resources.map(r => r.id)).toEqual([p1])
        } finally {
            await closeTestDatabase(database)
        }
    })
})
