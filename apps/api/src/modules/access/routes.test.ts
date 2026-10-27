import { describe, expect, it } from 'bun:test'

import { createAuth } from '@postdot/auth'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createTaxonomyStore,
    runMigrations,
} from '@postdot/db'

import { createApp } from '../../app'
import { requiredApiKeyCapability } from '../projects/api-key-permissions'
import { createPublisherRuntime } from '../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

function createFixture(options: { readonly allowAdditionalSignups?: boolean } = {}) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, {
        baseURL,
        secret,
        access,
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
        allowAdditionalSignups: options.allowAdditionalSignups,
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

async function seedExistingUser(
    database: ReturnType<typeof createDatabase>,
    email: string,
    name: string
) {
    const credential = database.$client
        .query<
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
    database.$client
        .query<
            void,
            [id: string, name: string, email: string, createdAt: number, updatedAt: number]
        >(
            `insert into user (id, name, email, email_verified, created_at, updated_at)
             values (?1, ?2, ?3, 0, ?4, ?5)`
        )
        .run(userId, name, email, timestamp, timestamp)
    database.$client
        .query<
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

async function bearerRequest(app: ReturnType<typeof createApp>, path: string, token: string) {
    return app.handle(
        new Request(`${baseURL}${path}`, {
            headers: { authorization: `Bearer ${token}` },
        })
    )
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
        const { app, database } = createFixture()

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
            closeDatabase(database)
        }
    })

    it('enforces and updates action ceilings independently from project scope', async () => {
        const { app, database } = createFixture()

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
            closeDatabase(database)
        }
    })

    it('allows a manage-only API key to request approval but not schedule or approve', async () => {
        const { app, database } = createFixture()

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
            closeDatabase(database)
        }
    })

    it('requires the separate permanent-delete capability for media purging', async () => {
        const { app, database } = createFixture()

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
            closeDatabase(database)
        }
    })

    it("rechecks the key owner's project role after key creation", async () => {
        const { access, app, database } = createFixture()

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
            const defaultWorkspace = access.getDefaultWorkspace()
            expect(defaultWorkspace).not.toBeNull()
            if (defaultWorkspace === null) throw new Error('The default workspace was not created')
            database.$client
                .query(
                    `insert into instance_memberships
                     (id, user_id, role, state, created_at, updated_at)
                     values (?1, ?2, 'member', 'enabled', ?3, ?3)`
                )
                .run(`instance-membership:${editorUserId}`, editorUserId, now)
            database.$client
                .query(
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
                access.grantProjectUserAccess({
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

            expect(access.removeProjectUserAccess(projectBody.project.id, editorUserId)).toBe(true)
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
            closeDatabase(database)
        }
    })

    it('publishes access paths with session security and typed status responses', async () => {
        const { app, database } = createFixture()

        try {
            const setupStatus = await app.handle(new Request(`${baseURL}/api/instance/status`))
            expect(setupStatus.status).toBe(200)
            expect(await setupStatus.json()).toEqual({ setupAvailable: true })

            await signUp(app, 'bootstrap@postdot.local')
            const claimedStatus = await app.handle(new Request(`${baseURL}/api/instance/status`))
            expect(claimedStatus.status).toBe(200)
            expect(await claimedStatus.json()).toEqual({ setupAvailable: false })

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
            closeDatabase(database)
        }
    })

    it('keeps setup discoverable for isolated E2E accounts without changing production defaults', async () => {
        const { app, database } = createFixture({ allowAdditionalSignups: true })

        try {
            await signUp(app, 'e2e-bootstrap@postdot.local')
            const status = await app.handle(new Request(`${baseURL}/api/instance/status`))

            expect(status.status).toBe(200)
            expect(await status.json()).toEqual({ setupAvailable: true })
        } finally {
            closeDatabase(database)
        }
    })

    it('requires an instance admin and forbids user API keys on instance routes', async () => {
        const { access, app, database } = createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const adminId = access.listInstanceMemberships()[0]?.userId
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

            expect((await bearerRequest(app, '/api/access', token.token)).status).toBe(403)
            expect(
                (await bearerRequest(app, '/api/settings/provider-applications', token.token))
                    .status
            ).toBe(403)
            expect((await bearerRequest(app, '/api/categories', token.token)).status).toBe(403)
        } finally {
            closeDatabase(database)
        }
    })

    it('lists and updates members only for admin sessions while preserving admin safety', async () => {
        const { access, app, auth, database } = createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const adminId = access.listInstanceMemberships()[0]?.userId
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
                database.$client
                    .query<{ readonly role: string | null }, [string]>(
                        'select role from user where id = ?1'
                    )
                    .get(memberId)
            ).toEqual({ role: 'admin' })

            await auth.api.setRole({
                body: { userId: memberId, role: 'user' },
                headers: new Headers({ cookie: adminCookie }),
            })
            expect(access.getInstanceMembership(memberId)).toMatchObject({
                role: 'member',
                state: 'enabled',
            })
            await auth.api.setRole({
                body: { userId: memberId, role: 'admin' },
                headers: new Headers({ cookie: adminCookie }),
            })
            expect(access.getInstanceMembership(memberId)).toMatchObject({
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
                database.$client
                    .query<{ readonly role: string | null }, [string]>(
                        'select role from user where id = ?1'
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
                database.$client
                    .query<{ readonly banned: number | null }, [string]>(
                        'select banned from user where id = ?1'
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
            expect(access.getInstanceMembership(adminId)).toMatchObject({
                role: 'admin',
                state: 'enabled',
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('returns invitation tokens only at creation and accepts a matching authenticated user', async () => {
        const { access, app, database } = createFixture()

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
            expect(access.getInstanceMembership(memberId)).toBeNull()

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
            closeDatabase(database)
        }
    })

    it('allows a pending invitation to bootstrap a new account before acceptance', async () => {
        const { access, app, database } = createFixture()

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
            const inviteeId = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
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
            expect(access.hasPendingInvitationForEmail(targetEmail)).toBe(false)

            const projectsResponse = await jsonRequest(app, '/api/projects', inviteeCookie)
            expect(projectsResponse.status).toBe(200)
            expect(await projectsResponse.json()).toMatchObject({
                projects: [expect.objectContaining({ id: project.project.id })],
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('invites and accepts a workspace group member through Better Auth', async () => {
        const { access, app, database } = createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@postdot.local')
            const workspace = access.getDefaultWorkspace()
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
            const inviteeId = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
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
            expect(access.getInstanceMembership(inviteeId?.id ?? '')).toMatchObject({
                role: 'member',
                state: 'enabled',
            })

            const teamMembership = database.$client
                .query<{ readonly count: number }, [string, string]>(
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
            closeDatabase(database)
        }
    })

    it('lets an instance administrator create a workspace with its default groups', async () => {
        const { access, app, database } = createFixture()

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

            const workspace = access.getWorkspace(created.workspace.id)
            expect(workspace).toMatchObject({
                name: 'Editorial workspace',
                slug: created.workspace.slug,
                isDefault: false,
            })
            const teams = database.$client
                .query<{ readonly name: string; readonly memberCount: number }, [string]>(
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
            closeDatabase(database)
        }
    })
})
