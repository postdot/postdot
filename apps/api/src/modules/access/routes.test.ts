import { describe, expect, it } from 'bun:test'

import { createAuth } from '@herald/auth'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createTaxonomyStore,
    runMigrations,
} from '@herald/db'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, { baseURL, secret, access })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey,
        publisherEncryptionKeyId: 'test-v1',
        bluesky: {
            clientMetadataUrl: 'https://herald.example.test/oauth/bluesky/client-metadata.json',
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
            { readonly issuer: string; readonly providerId: string; readonly password: string },
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
                issuer: string,
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
    it('publishes access paths with session security and typed status responses', async () => {
        const { app, database } = createFixture()

        try {
            const response = await app.handle(new Request(`${baseURL}/openapi/json`))
            expect(response.status).toBe(200)
            const specification = (await response.json()) as {
                paths: Record<
                    string,
                    Record<string, { operationId?: string; responses?: Record<string, unknown> }>
                >
            }
            expect(Object.keys(specification.paths)).toEqual(
                expect.arrayContaining([
                    '/api/access',
                    '/api/access/members',
                    '/api/access/invitations',
                    '/api/access/invitations/{invitationId}',
                    '/api/access/invitations/accept',
                ])
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
        } finally {
            closeDatabase(database)
        }
    })

    it('requires an instance admin and forbids project API keys on instance routes', async () => {
        const { access, app, auth, database } = createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@herald.local')
            const adminId = access.listInstanceMemberships()[0]?.userId
            expect(adminId).toBeString()
            if (adminId === undefined) throw new Error('The bootstrap admin was not created')

            await seedExistingUser(database, 'member@herald.local', 'Member')
            const memberCookie = await signIn(app, 'member@herald.local')

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
            const organization = database.$client
                .query<{ readonly id: string }, [string]>(
                    'select organization_id as id from projects where id = ?1'
                )
                .get(projectBody.project.id)
            if (organization === null) throw new Error('The project organization was not created')
            const token = await auth.api.createApiKey({
                body: {
                    name: 'instance-route-test',
                    organizationId: organization.id,
                    userId: adminId,
                    metadata: { heraldProjectId: projectBody.project.id },
                },
                headers: new Headers({ cookie: adminCookie }),
            })

            expect((await bearerRequest(app, '/api/access', token.key)).status).toBe(403)
            expect(
                (await bearerRequest(app, '/api/settings/provider-applications', token.key)).status
            ).toBe(403)
            expect((await bearerRequest(app, '/api/categories', token.key)).status).toBe(403)
        } finally {
            closeDatabase(database)
        }
    })

    it('lists and updates members only for admin sessions while preserving admin safety', async () => {
        const { access, app, auth, database } = createFixture()

        try {
            const adminCookie = await signUp(app, 'admin@herald.local')
            const adminId = access.listInstanceMemberships()[0]?.userId
            expect(adminId).toBeString()
            if (adminId === undefined) throw new Error('The bootstrap admin was not created')

            const memberId = await seedExistingUser(database, 'member@herald.local', 'Member')
            const memberCookie = await signIn(app, 'member@herald.local')
            const invitationResponse = await jsonRequest(
                app,
                '/api/access/invitations',
                adminCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ targetEmail: 'member@herald.local' }),
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
                        email: 'admin@herald.local',
                        name: 'admin',
                        role: 'admin',
                        state: 'enabled',
                    }),
                    expect.objectContaining({
                        userId: memberId,
                        email: 'member@herald.local',
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
            const organization = database.$client
                .query<{ readonly id: string }, [string]>(
                    'select organization_id as id from projects where id = ?1'
                )
                .get(project.project.id)
            if (organization === null) throw new Error('The project organization was not created')
            const token = await auth.api.createApiKey({
                body: {
                    name: 'member-administration-test',
                    organizationId: organization.id,
                    userId: adminId,
                    metadata: { heraldProjectId: project.project.id },
                },
                headers: new Headers({ cookie: adminCookie }),
            })

            expect((await bearerRequest(app, '/api/access/members', token.key)).status).toBe(403)
            expect(
                (
                    await bearerJsonRequest(app, `/api/access/members/${memberId}`, token.key, {
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
            const adminCookie = await signUp(app, 'admin@herald.local')
            const memberId = await seedExistingUser(database, 'member@herald.local', 'Member')
            const memberCookie = await signIn(app, 'member@herald.local')

            const createResponse = await jsonRequest(app, '/api/access/invitations', adminCookie, {
                method: 'POST',
                body: JSON.stringify({ targetEmail: 'member@herald.local' }),
            })
            expect(createResponse.status).toBe(201)
            const created = (await createResponse.json()) as {
                invitation: { id: string; targetEmail: string }
                token: string
            }
            expect(created.invitation.targetEmail).toBe('member@herald.local')
            expect(created.token).toBeString()

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
            const adminCookie = await signUp(app, 'admin@herald.local')
            const targetEmail = 'new-invitee@herald.local'
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
        } finally {
            closeDatabase(database)
        }
    })
})
