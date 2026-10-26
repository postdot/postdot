import { expect, it } from 'bun:test'

import { createAuth } from '@postdot/auth'
import { closeDatabase, createAccessStore, createDatabase, runMigrations } from '@postdot/db'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

async function fixture(
    run: (
        request: (
            method: string,
            path: string,
            body?: unknown,
            token?: string
        ) => Promise<Response>,
        cookie: string,
        context: {
            database: ReturnType<typeof createDatabase>
            access: ReturnType<typeof createAccessStore>
            app: ReturnType<typeof createApp>
        }
    ) => Promise<void>,
    allowAdditionalSignups = false
) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const baseURL = 'http://localhost:3000'
    const access = createAccessStore(database)
    const auth = createAuth(database, {
        baseURL,
        secret: 'lifecycle-test-secret-over-thirty-two-characters',
        access,
        allowAdditionalSignups,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: baseURL,
        publisherEncryptionKey: new Uint8Array(32).fill(9),
        publisherEncryptionKeyId: 'test',
        bluesky: {
            clientMetadataUrl: 'https://example.test/metadata.json',
            handleResolver: 'https://bsky.social',
        },
    })
    const app = createApp({ database, access, auth, publisher, allowAdditionalSignups })
    let cookie = ''
    const request = (method: string, path: string, body?: unknown, token?: string) =>
        app.handle(
            new Request(baseURL + path, {
                method,
                headers: {
                    origin: baseURL,
                    'content-type': 'application/json',
                    ...(token ? { authorization: `Bearer ${token}` } : { cookie }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        )
    try {
        const signup = await request('POST', '/api/auth/sign-up/email', {
            name: 'Owner',
            email: 'owner@example.test',
            password: 'lifecycle-password-123',
        })
        expect(signup.status).toBe(200)
        cookie = signup.headers
            .getSetCookie()
            .map(value => value.split(';')[0])
            .join('; ')
        await run(request, cookie, { database, access, app })
    } finally {
        closeDatabase(database)
    }
}
it('archives through a scoped machine key, rejects writes, restores and permanently deletes with live impact', async () => {
    await fixture(async request => {
        const created = await request('POST', '/api/projects', { name: 'Temporary project' })
        expect(created.status).toBe(201)
        const { project } = (await created.json()) as { project: { id: string; name: string } }
        const path = `/api/projects/${project.id}`
        const keyResponse = await request('POST', '/api/api-keys', {
            name: 'Retirement',
            projectIds: [project.id],
            actionAccess: ['project:read', 'project:manage'],
        })
        // API keys use the existing session-owned management endpoint.
        expect(keyResponse.status).toBe(201)
        const keyBody = (await keyResponse.json()) as {
            token?: string
            key?: { token?: string }
            apiKey?: string
        }
        const token = keyBody.token ?? keyBody.key?.token ?? keyBody.apiKey
        expect(token).toBeString()
        const preview = (await (
            await request('GET', `${path}/lifecycle`, undefined, token)
        ).json()) as { fingerprint: string }
        const archived = await request('POST', `${path}/lifecycle/archive`, preview, token)
        expect(archived.status).toBe(200)
        expect(((await archived.json()) as { state: string }).state).toBe('archived')
        expect(
            ((await (await request('GET', '/api/projects')).json()) as { projects: unknown[] })
                .projects
        ).toHaveLength(0)
        expect(
            (
                (await (await request('GET', '/api/projects?includeArchived=true')).json()) as {
                    projects: unknown[]
                }
            ).projects
        ).toHaveLength(1)
        const rejected = await request('POST', `${path}/channels`, {
            name: 'Cannot create',
        })
        expect(rejected.status).toBe(409)
        const current = (await (await request('GET', `${path}/lifecycle`)).json()) as {
            fingerprint: string
        }
        expect(
            (
                await request(
                    'DELETE',
                    `${path}/lifecycle`,
                    { ...current, confirmName: project.name },
                    token
                )
            ).status
        ).toBe(403)
        const restore = await request('POST', `${path}/lifecycle/restore`, current, token)
        expect(restore.status).toBe(200)
        expect(((await restore.json()) as { state: string }).state).toBe('active')
        const deletion = (await (await request('GET', `${path}/lifecycle`)).json()) as {
            fingerprint: string
        }
        expect(
            (await request('DELETE', `${path}/lifecycle`, { ...deletion, confirmName: 'wrong' }))
                .status
        ).toBe(409)
        const deleteKeyResponse = await request('POST', '/api/api-keys', {
            name: 'Explicit removal',
            projectIds: [project.id],
            actionAccess: ['project:read', 'project:permanently_delete'],
        })
        expect(deleteKeyResponse.status).toBe(201)
        const deleteKey = (await deleteKeyResponse.json()) as { token: string }
        const removed = await request(
            'DELETE',
            `${path}/lifecycle`,
            {
                ...deletion,
                confirmName: project.name,
            },
            deleteKey.token
        )
        expect(removed.status).toBe(200)
        expect(((await removed.json()) as { state: string }).state).toBe('deleted')
        expect((await request('GET', `${path}/lifecycle`, undefined, token)).status).toBe(404)
    })
})
it('replaces the default workspace explicitly and leaves restored projects archived', async () => {
    await fixture(async request => {
        const workspaces = (await (await request('GET', '/api/workspaces')).json()) as {
            workspaces: { id: string }[]
        }
        const first = workspaces.workspaces[0]!
        const created = await request('POST', '/api/projects', {
            name: 'Workspace child',
            workspaceId: first.id,
        })
        expect(created.status).toBe(201)
        const { project } = (await created.json()) as { project: { id: string } }
        const secondResponse = await request('POST', '/api/workspaces', { name: 'Replacement' })
        expect(secondResponse.status).toBe(201)
        const second = (await secondResponse.json()) as { workspace: { id: string } }
        const path = `/api/workspaces/${first.id}/lifecycle`
        const preview = (await (await request('GET', path)).json()) as { fingerprint: string }
        expect((await request('POST', `${path}/archive`, preview)).status).toBe(409)
        const archived = await request('POST', `${path}/archive`, {
            ...preview,
            replacementWorkspaceId: second.workspace.id,
        })
        expect(archived.status).toBe(200)
        const visible = (await (await request('GET', '/api/workspaces')).json()) as {
            workspaces: { id: string; isDefault: boolean }[]
        }
        expect(visible.workspaces).toHaveLength(1)
        expect(visible.workspaces[0]).toMatchObject({ id: second.workspace.id, isDefault: true })
        const childPath = `/api/projects/${project.id}/lifecycle`
        expect(((await (await request('GET', childPath)).json()) as { state: string }).state).toBe(
            'archived'
        )
        const current = await (await request('GET', path)).json()
        expect((await request('POST', `${path}/restore`, current)).status).toBe(200)
        expect(((await (await request('GET', childPath)).json()) as { state: string }).state).toBe(
            'archived'
        )
        const deletion = (await (await request('GET', path)).json()) as {
            fingerprint: string
            name: string
        }
        const removed = await request('DELETE', path, { ...deletion, confirmName: deletion.name })
        expect(removed.status).toBe(200)
        expect(((await removed.json()) as { state: string }).state).toBe('deleted')
        // The initiating owner may read the minimal receipt after cascading deletion.
        expect(((await (await request('GET', childPath)).json()) as { state: string }).state).toBe(
            'deleted'
        )
        expect(
            (
                (await (await request('GET', '/api/projects?includeArchived=true')).json()) as {
                    projects: unknown[]
                }
            ).projects
        ).toHaveLength(0)
    })
})

it('requires live ownership even for former initiators and hides unknown projects from outsiders', async () => {
    await fixture(async (request, _cookie, { database, access, app }) => {
        const created = (await (
            await request('POST', '/api/projects', { name: 'Protected' })
        ).json()) as { project: { id: string } }
        const path = `/api/projects/${created.project.id}/lifecycle`
        const signup = await request('POST', '/api/auth/sign-up/email', {
            name: 'Collaborator',
            email: 'collaborator@example.test',
            password: 'collaborator-password-123',
        })
        expect(signup.status).toBe(200)
        const { user } = (await signup.json()) as { user: { id: string } }
        const cookie = signup.headers
            .getSetCookie()
            .map(value => value.split(';')[0])
            .join('; ')
        const other = (method: string, body?: unknown) =>
            app.handle(
                new Request('http://localhost:3000' + path, {
                    method,
                    headers: {
                        cookie,
                        origin: 'http://localhost:3000',
                        'content-type': 'application/json',
                    },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                })
            )
        // Remove the test-only additional-signup grants before checking real role boundaries.
        database.$client.query('delete from team_member where user_id = ?').run(user.id)
        database.$client.query('delete from member where user_id = ?').run(user.id)
        expect((await other('GET')).status).toBe(404)
        const workspace = access.getDefaultWorkspace()!
        database.$client
            .query(
                "insert or ignore into member(id,organization_id,user_id,role,created_at) values (?,?,?,'member',?)"
            )
            .run(crypto.randomUUID(), workspace.organizationId, user.id, Date.now())
        database.$client.query("update member set role = 'member' where user_id = ?").run(user.id)
        database.$client
            .query("update instance_memberships set role = 'member' where user_id = ?")
            .run(user.id)
        access.grantProjectUserAccess({
            projectId: created.project.id,
            userId: user.id,
            role: 'viewer',
        })
        expect((await other('GET')).status).toBe(403)
        access.grantProjectUserAccess({
            projectId: created.project.id,
            userId: user.id,
            role: 'owner',
        })
        const preview = (await (await other('GET')).json()) as { fingerprint: string }
        const archived = await app.handle(
            new Request('http://localhost:3000' + path + '/archive', {
                method: 'POST',
                headers: {
                    cookie,
                    origin: 'http://localhost:3000',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ fingerprint: preview.fingerprint }),
            })
        )
        expect(archived.status).toBe(200)
        database.$client
            .query(
                "update project_user_grants set role = 'viewer' where project_id = ? and user_id = ?"
            )
            .run(created.project.id, user.id)
        expect(access.canAccessProject(created.project.id, user.id, 'owner')).toBe(false)
        // The original initiator cannot use a receipt exception to regain live resource access.
        expect((await other('GET')).status).toBe(403)
    }, true)
})
