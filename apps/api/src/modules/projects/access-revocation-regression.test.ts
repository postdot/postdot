import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth } from '@postbot/auth'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createMediaAssetStore,
    runMigrations,
} from '@postbot/db'
import { createLocalMediaStore } from '@postbot/media'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'postbot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const mediaRoot = mkdtempSync(join(tmpdir(), 'access-309-media-'))
    const media = createMediaAssetStore(
        database,
        createLocalMediaStore({
            storeId: 'access-309-local',
            rootDirectory: mediaRoot,
            maxObjectBytes: 10_000_000,
        })
    )
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey,
        publisherEncryptionKeyId: 'test-v1',
        bluesky: {
            clientMetadataUrl: 'https://postbot.example.test/oauth/bluesky/client-metadata.json',
            handleResolver: 'https://bsky.social',
        },
    })
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, { baseURL, secret, access, allowAdditionalSignups: true })
    const app = createApp({
        auth,
        access,
        database,
        publisher,
        media,
        manualStore: { now: () => now },
    })
    return { access, app, database, mediaRoot }
}

async function signUp(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({
                email,
                name: 'Access 309 Fixture',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    expect(response.status).toBe(200)
    return cookie ?? ''
}

async function sessionRequest(
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

async function keyRequest(
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

async function createApiKey(
    app: ReturnType<typeof createApp>,
    cookie: string,
    projectIds: string[] | null
) {
    const response = await sessionRequest(app, '/api/api-keys', cookie, {
        method: 'POST',
        body: JSON.stringify({ projectIds }),
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as { token: string }).token
}

async function createProject(app: ReturnType<typeof createApp>, cookie: string, name: string) {
    const response = await sessionRequest(app, '/api/projects', cookie, {
        method: 'POST',
        body: JSON.stringify({ name }),
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as { project: { id: string } }).project.id
}

/**
 * Additional-signup fixtures become workspace owners. Project-surface tests
 * need an ordinary workspace member, so the fixture demotes them explicitly.
 */
function demoteToWorkspaceMember(
    database: ReturnType<typeof createDatabase>,
    access: ReturnType<typeof createAccessStore>,
    email: string
) {
    const workspace = access.getDefaultWorkspace()
    expect(workspace).not.toBeNull()
    if (workspace === null) throw new Error('The default workspace fixture is missing')
    const userId = database.$client
        .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
        .get(email)?.id
    expect(userId).toBeDefined()
    if (userId === undefined) throw new Error(`The ${email} fixture is missing`)
    database.$client
        .query('update member set role = ?1 where organization_id = ?2 and user_id = ?3')
        .run('member', workspace.organizationId, userId)
    return userId
}

async function findMembershipId(
    app: ReturnType<typeof createApp>,
    ownerCookie: string,
    projectId: string,
    userId: string
) {
    const response = await sessionRequest(app, `/api/projects/${projectId}/members`, ownerCookie)
    expect(response.status).toBe(200)
    const members = (
        (await response.json()) as {
            members: Array<{ id: string; userId: string; role: string }>
        }
    ).members
    const membership = members.find(entry => entry.userId === userId)
    expect(membership).toBeDefined()
    return membership?.id ?? ''
}

const projectReadPaths = (projectId: string) => [
    `/api/projects/${projectId}/channels`,
    `/api/projects/${projectId}/publications`,
    `/api/projects/${projectId}/publications/due`,
    `/api/projects/${projectId}/analytics`,
    `/api/projects/${projectId}/analytics/provider/bluesky`,
    `/api/projects/${projectId}/tags`,
    `/api/projects/${projectId}/publishers`,
    `/api/projects/${projectId}/media?view=library`,
]

describe('API key project access follows the owner current access (ACCESS-309)', () => {
    it('keeps reads while granted, hides them after removal, and preserves other projects', async () => {
        const { access, app, database, mediaRoot } = createFixture()

        try {
            const ownerCookie = await signUp(app, 'access-309-owner@postbot.local')
            const memberCookie = await signUp(app, 'access-309-member@postbot.local')
            const retainedCookie = await signUp(app, 'access-309-retained@postbot.local')
            const memberUserId = demoteToWorkspaceMember(
                database,
                access,
                'access-309-member@postbot.local'
            )
            const retainedUserId = demoteToWorkspaceMember(
                database,
                access,
                'access-309-retained@postbot.local'
            )
            const memberWorkspaceId = access.getProjectWorkspaceId(
                await createProject(app, ownerCookie, 'Placeholder')
            )
            expect(memberWorkspaceId).not.toBeNull()

            const revokedProject = await createProject(app, ownerCookie, 'Revoked project')
            const retainedProject = await createProject(app, ownerCookie, 'Retained project')
            for (const projectId of [revokedProject, retainedProject]) {
                expect(access.getProjectWorkspaceId(projectId)).toBe(memberWorkspaceId)
            }

            // The fixture is an ordinary workspace member, so the project list
            // is driven by project membership alone.
            expect(access.canManageWorkspace(memberWorkspaceId!, memberUserId)).toBe(false)
            expect(access.canManageWorkspace(memberWorkspaceId!, retainedUserId)).toBe(false)

            for (const [userId, role] of [
                [memberUserId, 'editor'],
                [retainedUserId, 'editor'],
            ] as const) {
                const grant = await sessionRequest(
                    app,
                    `/api/projects/${revokedProject}/user-grants`,
                    ownerCookie,
                    { method: 'POST', body: JSON.stringify({ userId, role }) }
                )
                expect(grant.status).toBe(201)
                const otherGrant = await sessionRequest(
                    app,
                    `/api/projects/${retainedProject}/user-grants`,
                    ownerCookie,
                    { method: 'POST', body: JSON.stringify({ userId, role }) }
                )
                expect(otherGrant.status).toBe(201)
            }

            const allScopeKey = await createApiKey(app, memberCookie, null)
            const selectedScopeKey = await createApiKey(app, memberCookie, [revokedProject])
            const retainedScopeKey = await createApiKey(app, retainedCookie, null)

            // Before removal the keys read the granted project.
            for (const path of projectReadPaths(revokedProject)) {
                expect((await keyRequest(app, path, allScopeKey)).status).toBe(200)
                expect((await keyRequest(app, path, selectedScopeKey)).status).toBe(200)
            }
            expect(
                (await keyRequest(app, `/api/projects/${retainedProject}/channels`, allScopeKey))
                    .status
            ).toBe(200)

            const membershipId = await findMembershipId(
                app,
                ownerCookie,
                revokedProject,
                memberUserId
            )
            const removal = await sessionRequest(
                app,
                `/api/projects/${revokedProject}/members/${membershipId}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(removal.status).toBe(200)

            // Membership authority is gone while historical attribution stays.
            expect(access.canAccessProject(revokedProject, memberUserId)).toBe(false)
            expect(access.getProjectMembership(revokedProject, memberUserId)).toBeNull()
            const grants = database.$client
                .query<{ readonly count: number }, [string, string]>(
                    'select count(*) as count from project_user_grants where project_id = ?1 and user_id = ?2'
                )
                .get(revokedProject, memberUserId)
            expect(grants?.count ?? 0).toBe(0)
            const actors = database.$client
                .query<{ readonly count: number }, [string, string]>(
                    'select count(*) as count from actors where project_id = ?1 and subject_id = ?2'
                )
                .get(revokedProject, memberUserId)
            expect(actors?.count ?? 0).toBe(1)

            // Both scopes are now hidden, exactly like the session path.
            for (const path of projectReadPaths(revokedProject)) {
                expect((await keyRequest(app, path, allScopeKey)).status).toBe(404)
                expect((await keyRequest(app, path, selectedScopeKey)).status).toBe(404)
                expect((await sessionRequest(app, path.split('?')[0]!, memberCookie)).status).toBe(
                    404
                )
            }
            // Hidden access now precedes the role check, so a revoked key sees
            // the same masked 404 as the revoked session.
            expect(
                (
                    await keyRequest(app, `/api/projects/${revokedProject}/channels`, allScopeKey, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Revoked key channel' }),
                    })
                ).status
            ).toBe(404)
            expect(
                (
                    await sessionRequest(
                        app,
                        `/api/projects/${revokedProject}/channels`,
                        memberCookie,
                        {
                            method: 'POST',
                            body: JSON.stringify({ name: 'Revoked session channel' }),
                        }
                    )
                ).status
            ).toBe(404)

            // Access the key owner still holds is untouched.
            for (const path of projectReadPaths(retainedProject)) {
                expect((await keyRequest(app, path, allScopeKey)).status).toBe(200)
                expect((await keyRequest(app, path, retainedScopeKey)).status).toBe(200)
                expect(
                    (await sessionRequest(app, path.split('?')[0]!, retainedCookie)).status
                ).toBe(200)
            }

            // The removed member's project list follows membership only, because
            // the fixture is not a workspace manager.
            const listAfterRemoval = await sessionRequest(app, '/api/projects', memberCookie)
            expect(listAfterRemoval.status).toBe(200)
            const listed = (
                (await listAfterRemoval.json()) as { projects: Array<{ id: string }> }
            ).projects.map(project => project.id)
            expect(listed).not.toContain(revokedProject)
            expect(listed).toContain(retainedProject)
            const keyList = await keyRequest(app, '/api/projects', allScopeKey)
            expect(keyList.status).toBe(200)
            expect(
                ((await keyList.json()) as { projects: Array<{ id: string }> }).projects.map(
                    project => project.id
                )
            ).not.toContain(revokedProject)
        } finally {
            closeDatabase(database)
            rmSync(mediaRoot, { recursive: true, force: true })
        }
    })

    it('keeps team-grant inherited access available to the key', async () => {
        const { access, app, database, mediaRoot } = createFixture()

        try {
            const ownerCookie = await signUp(app, 'access-309-team-owner@postbot.local')
            const memberCookie = await signUp(app, 'access-309-team-member@postbot.local')
            const memberUserId = demoteToWorkspaceMember(
                database,
                access,
                'access-309-team-member@postbot.local'
            )
            const workspace = access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The workspace fixture is incomplete')

            const teamResponse = await sessionRequest(
                app,
                `/api/workspaces/${workspace.id}/teams`,
                ownerCookie,
                { method: 'POST', body: JSON.stringify({ name: 'Access 309 viewers' }) }
            )
            expect(teamResponse.status).toBe(201)
            const teamId = ((await teamResponse.json()) as { team: { id: string } }).team.id

            const addMember = await sessionRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${teamId}/members`,
                ownerCookie,
                { method: 'POST', body: JSON.stringify({ userId: memberUserId }) }
            )
            expect(addMember.status).toBe(200)

            const projectId = await createProject(app, ownerCookie, 'Team grant project')
            const teamGrant = await sessionRequest(
                app,
                `/api/projects/${projectId}/team-grants`,
                ownerCookie,
                { method: 'POST', body: JSON.stringify({ teamId, role: 'viewer' }) }
            )
            expect(teamGrant.status).toBe(201)

            expect(access.getProjectMembership(projectId, memberUserId)?.role).toBe('viewer')
            expect(access.canAccessProject(projectId, memberUserId, 'editor')).toBe(false)

            const key = await createApiKey(app, memberCookie, null)
            for (const path of projectReadPaths(projectId)) {
                expect((await keyRequest(app, path, key)).status).toBe(200)
            }
            // A viewer key still cannot mutate.
            expect(
                (
                    await keyRequest(app, `/api/projects/${projectId}/channels`, key, {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Team grant channel' }),
                    })
                ).status
            ).toBe(403)

            // Losing the team membership revokes the inherited access too.
            const removeMember = await sessionRequest(
                app,
                `/api/workspaces/${workspace.id}/teams/${teamId}/members/${memberUserId}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(removeMember.status).toBe(200)
            expect(access.getProjectMembership(projectId, memberUserId)).toBeNull()
            expect((await keyRequest(app, `/api/projects/${projectId}/channels`, key)).status).toBe(
                404
            )
            expect(
                (await keyRequest(app, `/api/projects/${projectId}/analytics`, key)).status
            ).toBe(404)
        } finally {
            closeDatabase(database)
            rmSync(mediaRoot, { recursive: true, force: true })
        }
    })

    it('still hides a project for a key whose owner was never a member', async () => {
        const { access, app, database, mediaRoot } = createFixture()

        try {
            const ownerCookie = await signUp(app, 'access-309-outsider-owner@postbot.local')
            const outsiderCookie = await signUp(app, 'access-309-outsider@postbot.local')
            demoteToWorkspaceMember(database, access, 'access-309-outsider@postbot.local')
            const projectId = await createProject(app, ownerCookie, 'Outsider project')
            const key = await createApiKey(app, outsiderCookie, null)

            expect((await keyRequest(app, `/api/projects/${projectId}/channels`, key)).status).toBe(
                404
            )
            expect(
                (await keyRequest(app, `/api/projects/${projectId}/analytics`, key)).status
            ).toBe(404)
            expect(
                (await keyRequest(app, `/api/projects/${projectId}/media?view=library`, key)).status
            ).toBe(404)
        } finally {
            closeDatabase(database)
            rmSync(mediaRoot, { recursive: true, force: true })
        }
    })
})
