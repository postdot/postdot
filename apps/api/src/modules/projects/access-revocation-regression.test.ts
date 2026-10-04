import { describe, expect, it } from 'bun:test'

import { createAuth } from '@herald/auth'
import { closeDatabase, createAccessStore, createDatabase, runMigrations } from '@herald/db'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
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
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, { baseURL, secret, access, allowAdditionalSignups: true })
    const app = createApp({
        auth,
        access,
        database,
        publisher,
        manualStore: { now: () => now },
    })
    return { access, app, database }
}

async function signUp(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({
                email,
                name: 'Revocation Probe',
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

/**
 * AUDIT-309 reproduction: read authorization on project routes resolves
 * against the durable `actors` attribution row, which project removal keeps
 * for history. A removed member therefore loses session access but a
 * user-owned API key keeps full project reads, and the project list keeps
 * showing the project to the removed member.
 *
 * These expectations pin the demonstrated current behavior so the regression is
 * reproducible. The bounded follow-up (register the task when approved) must
 * flip every `expect(...).toBe(200)` below to the hidden `404` outcome that the
 * session path already returns.
 */
describe('project access revocation (AUDIT-309 reproduction)', () => {
    it('keeps read access for a removed member API key while the session is denied', async () => {
        const { access, app, database } = createFixture()

        try {
            const ownerCookie = await signUp(app, 'revocation-owner@herald.local')
            const memberCookie = await signUp(app, 'revocation-member@herald.local')
            const memberUserId = database.$client
                .query<{ readonly id: string }, [string]>('select id from user where email = ?1')
                .get('revocation-member@herald.local')?.id
            expect(memberUserId).toBeDefined()
            if (memberUserId === undefined) throw new Error('The member fixture is incomplete')

            const projectResponse = await sessionRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Revocation project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectId = ((await projectResponse.json()) as { project: { id: string } })
                .project.id

            const grantResponse = await sessionRequest(
                app,
                `/api/projects/${projectId}/user-grants`,
                ownerCookie,
                { method: 'POST', body: JSON.stringify({ userId: memberUserId, role: 'editor' }) }
            )
            expect(grantResponse.status).toBe(201)

            const scopedKey = await createApiKey(app, memberCookie, null)
            const allProjectsKey = await createApiKey(app, memberCookie, [projectId])

            const membersResponse = await sessionRequest(
                app,
                `/api/projects/${projectId}/members`,
                ownerCookie
            )
            const members = (
                (await membersResponse.json()) as {
                    members: Array<{ id: string; userId: string; role: string }>
                }
            ).members
            const membership = members.find(entry => entry.userId === memberUserId)
            expect(membership).toBeDefined()

            // Baseline while the editor grant is active.
            expect(
                (await sessionRequest(app, `/api/projects/${projectId}/channels`, memberCookie))
                    .status
            ).toBe(200)
            expect(
                (await keyRequest(app, `/api/projects/${projectId}/channels`, scopedKey)).status
            ).toBe(200)

            const removalResponse = await sessionRequest(
                app,
                `/api/projects/${projectId}/members/${membership?.id}`,
                ownerCookie,
                { method: 'DELETE' }
            )
            expect(removalResponse.status).toBe(200)

            // Membership authority is genuinely gone.
            expect(access.canAccessProject(projectId, memberUserId)).toBe(false)
            expect(access.getProjectMembership(projectId, memberUserId)).toBeNull()
            const grants = database.$client
                .query<{ readonly count: number }, [string, string]>(
                    'select count(*) as count from project_user_grants where project_id = ?1 and user_id = ?2'
                )
                .get(projectId, memberUserId)
            expect(grants?.count ?? 0).toBe(0)
            // ...but the historical attribution actor row survives.
            const actors = database.$client
                .query<{ readonly count: number }, [string, string]>(
                    'select count(*) as count from actors where project_id = ?1 and subject_id = ?2'
                )
                .get(projectId, memberUserId)
            expect(actors?.count ?? 0).toBe(1)

            // The session is correctly hidden.
            expect(
                (await sessionRequest(app, `/api/projects/${projectId}/channels`, memberCookie))
                    .status
            ).toBe(404)
            expect(
                (await sessionRequest(app, `/api/projects/${projectId}/analytics`, memberCookie))
                    .status
            ).toBe(404)
            expect(
                (await sessionRequest(app, `/api/projects/${projectId}/media`, memberCookie)).status
            ).toBe(404)

            // The API key is not: read routes resolve against the actor row.
            for (const token of [scopedKey, allProjectsKey]) {
                expect(
                    (await keyRequest(app, `/api/projects/${projectId}/channels`, token)).status
                ).toBe(200)
                expect(
                    (await keyRequest(app, `/api/projects/${projectId}/publications`, token)).status
                ).toBe(200)
                expect(
                    (await keyRequest(app, `/api/projects/${projectId}/publications/due`, token))
                        .status
                ).toBe(200)
                expect(
                    (await keyRequest(app, `/api/projects/${projectId}/analytics`, token)).status
                ).toBe(200)
                expect(
                    (
                        await keyRequest(
                            app,
                            `/api/projects/${projectId}/analytics/provider/bluesky`,
                            token
                        )
                    ).status
                ).toBe(200)
                expect(
                    (await keyRequest(app, `/api/projects/${projectId}/tags`, token)).status
                ).toBe(200)
                expect(
                    (await keyRequest(app, `/api/projects/${projectId}/publishers`, token)).status
                ).toBe(200)

                // Mutations stay denied by the editor role check.
                expect(
                    (
                        await keyRequest(app, `/api/projects/${projectId}/channels`, token, {
                            method: 'POST',
                            body: JSON.stringify({ name: 'Revoked key channel' }),
                        })
                    ).status
                ).toBe(403)
            }

            // A key whose owner was never a member is hidden, proving the
            // actor row (not the action ceiling) is the read gate.
            const outsiderCookie = await signUp(app, 'revocation-outsider@herald.local')
            const outsiderKey = await createApiKey(app, outsiderCookie, null)
            expect(
                (await keyRequest(app, `/api/projects/${projectId}/channels`, outsiderKey)).status
            ).toBe(404)

            // The project list still shows the project to the removed member.
            const sessionList = await sessionRequest(app, '/api/projects', memberCookie)
            expect(sessionList.status).toBe(200)
            expect(
                ((await sessionList.json()) as { projects: Array<{ id: string }> }).projects.map(
                    project => project.id
                )
            ).toContain(projectId)
        } finally {
            closeDatabase(database)
        }
    })
})
