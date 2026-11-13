import { expect, test } from 'bun:test'

import { createApp, createPublisherRuntime } from '@postdot/api'
import { createAuth } from '@postdot/auth'
import { createAccessStore } from '@postdot/db'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'

import { createPostdotClient } from './index'

const password = 'native-protocol-test-password'
const day = 86400000

async function fixture(baseURL = 'https://native.postdot.test') {
    const { database } = await openTestDatabase()
    const access = createAccessStore(database)
    const auth = createAuth(database, {
        baseURL,
        secret: `native-protocol-${crypto.randomUUID()}`,
        trustedOrigins: [baseURL],
        allowAdditionalSignups: true,
        access,
        logger: { disabled: true },
    })
    const app = createApp({
        database,
        auth,
        access,
        publisher: createPublisherRuntime(database, {
            apiOrigin: baseURL,
            webOrigin: baseURL,
            publisherEncryptionKey: new Uint8Array(32).fill(6),
            publisherEncryptionKeyId: 'test',
        }),
    })
    const request = (
        path: string,
        cookie = '',
        body?: unknown,
        extra: ConstructorParameters<typeof Headers>[0] = {}
    ) =>
        app.handle(
            new Request(baseURL + path, {
                method: body === undefined ? 'GET' : 'POST',
                credentials: 'omit',
                headers: {
                    cookie,
                    origin: baseURL,
                    'content-type': 'application/json',
                    ...Object.fromEntries(new Headers(extra)),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        )
    const signup = async (email: string) => {
        const response = await request('/api/auth/sign-up/email', '', {
            email,
            name: email,
            password,
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            user: { id: string; email: string }
            token: string
        }
        const cookie = response.headers
            .getSetCookie()
            .find(value => value.split('=', 1)[0]!.endsWith('.session_token'))!
            .split(';', 1)[0]!
        return { cookie, ...body }
    }
    return {
        app,
        auth,
        access,
        database,
        request,
        signup,
        baseURL,
        close: () => closeTestDatabase(database),
    }
}

test('an explicit signed session cookie authenticates typed native calls and human-only operations without bearer fallback', async () => {
    const f = await fixture()
    try {
        const native = await f.signup('native-owner@example.test')
        const transports: {
            credentials: RequestInit['credentials']
            redirect: RequestInit['redirect']
            cookie: string | null
        }[] = []
        const client = createPostdotClient(f.baseURL, {
            cookie: native.cookie,
            credentials: 'omit',
            redirect: 'error',
            fetcher: async (input, init) => {
                const request =
                    input instanceof Request
                        ? new Request(input, init)
                        : new Request(String(input), init)
                transports.push({
                    credentials: init?.credentials,
                    redirect: init?.redirect,
                    cookie: request.headers.get('cookie'),
                })
                return f.app.handle(request)
            },
        })
        const project = await client.api.projects.post({ name: 'Native desk' })
        expect(transports).toEqual([
            { credentials: 'omit', redirect: 'error', cookie: native.cookie },
        ])
        expect(project.status, JSON.stringify(project.error?.value)).toBe(201)
        const projectId = project.data!.project.id
        expect((await client.api.projects({ projectId }).channels.get()).status).toBe(200)
        const key = await client.api['api-keys'].post({
            name: 'Native-created automation',
            projectIds: [projectId],
            actionAccess: ['project:read'],
        })
        expect(key.status).toBe(201)
        const headers = { authorization: `Bearer ${key.data!.token}` }
        expect((await f.request('/api/api-keys', '', undefined, headers)).status).toBe(403)
        expect(
            (await f.request(`/api/projects/${projectId}/channels`, '', undefined, headers)).status
        ).toBe(200)
        expect(
            (
                await f.request(
                    `/api/projects/${projectId}/channels`,
                    native.cookie,
                    { name: 'Denied' },
                    headers
                )
            ).status
        ).toBe(403)
        // The JSON login token is not a Postdot API key; the header never falls
        // back to the accompanying human cookie on project routes.
        expect(
            (
                await f.request(`/api/projects/${projectId}/channels`, native.cookie, undefined, {
                    authorization: `Bearer ${native.token}`,
                })
            ).status
        ).toBe(401)
        const before = native.cookie.slice(0, -1)
        const tampered = before + (native.cookie.endsWith('a') ? 'b' : 'a')
        expect((await f.request(`/api/projects/${projectId}/channels`, tampered)).status).toBe(401)
        expect(
            (
                await f.request(
                    `/api/projects/${projectId}/channels`,
                    `${native.cookie.split('=', 1)[0]}=${native.token}`
                )
            ).status
        ).toBe(401)
    } finally {
        await f.close()
    }
})

test('renewal refreshes the existing database session and an expired native cookie cannot renew itself', async () => {
    const f = await fixture()
    try {
        const native = await f.signup('native-renewal@example.test')
        const session = (
            (await (await f.request('/api/auth/get-session', native.cookie)).json()) as {
                session: { id: string }
            }
        ).session
        const now = Date.now()
        // Age the persisted fixture through the same persistence port. Keep its
        // lifetime valid but past Better Auth 1.7's one-day renewal threshold.
        await f.database.sql
            .statement('update session set expires_at = ?1, updated_at = ?2 where id = ?3')
            .run(now + 5 * day, now - 2 * day, session.id)
        const renewed = await f.request('/api/auth/get-session', native.cookie)
        expect(renewed.status).toBe(200)
        expect(
            renewed.headers.getSetCookie().some(value => value.includes('.session_token='))
        ).toBe(true)
        const next = ((await renewed.json()) as { session: { id: string; expiresAt: string } })
            .session
        expect(next.id).toBe(session.id)
        expect(new Date(next.expiresAt).getTime()).toBeGreaterThan(now + 6 * day)
        await f.database.sql
            .statement('update session set expires_at = ?1 where id = ?2')
            .run(now - 1000, session.id)
        const expired = await f.request('/api/auth/get-session', native.cookie)
        expect(await expired.json()).toBeNull()
        expect(expired.headers.getSetCookie().some(value => value.includes('Max-Age=0'))).toBe(true)
        expect((await f.request('/api/projects', native.cookie)).status).toBe(401)
    } finally {
        await f.close()
    }
})

test('native sessions preserve current project roles and lose access after a grant is removed', async () => {
    const f = await fixture()
    try {
        const owner = await f.signup('native-role-owner@example.test')
        const member = await f.signup('native-role-member@example.test')
        const { project } = (await (
            await f.request('/api/projects', owner.cookie, { name: 'Private native desk' })
        ).json()) as { project: { id: string } }
        const base = `/api/projects/${project.id}`
        const { channel } = (await (
            await f.request(`${base}/channels`, owner.cookie, { name: 'Manual' })
        ).json()) as { channel: { id: string } }
        const post = {
            sourceContent: { body: { text: 'Native draft', format: 'plain_text' }, media: [] },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        }
        expect((await f.request(`${base}/channels`, member.cookie)).status).toBe(404)
        expect(
            await f.access.grantProjectUserAccess({
                projectId: project.id,
                userId: member.user.id,
                role: 'viewer',
            })
        ).not.toBeNull()
        expect((await f.request(`${base}/channels`, member.cookie)).status).toBe(200)
        expect((await f.request(`${base}/posts`, member.cookie, post)).status).toBe(403)
        await f.access.grantProjectUserAccess({
            projectId: project.id,
            userId: member.user.id,
            role: 'editor',
        })
        expect((await f.request(`${base}/posts`, member.cookie, post)).status).toBe(201)
        expect(await f.access.removeProjectUserAccess(project.id, member.user.id)).toBe(true)
        expect((await f.request(`${base}/channels`, member.cookie)).status).toBe(404)
    } finally {
        await f.close()
    }
})

test('logout and a password change revoke native sessions while leaving a separate human login independent', async () => {
    const f = await fixture()
    try {
        const native = await f.signup('native-revocation@example.test')
        const login = () =>
            f.request('/api/auth/sign-in/email', '', { email: native.user.email, password })
        const other = await login()
        expect(other.status).toBe(200)
        const otherCookie = other.headers
            .getSetCookie()
            .find(value => value.split('=', 1)[0]!.endsWith('.session_token'))!
            .split(';', 1)[0]!
        expect((await f.request('/api/auth/sign-out', native.cookie, {})).status).toBe(200)
        expect((await f.request('/api/projects', native.cookie)).status).toBe(401)
        expect((await f.request('/api/projects', otherCookie)).status).toBe(200)
        const again = await login()
        const againCookie = again.headers
            .getSetCookie()
            .find(value => value.includes('.session_token='))!
            .split(';', 1)[0]!
        const changed = await f.request('/api/auth/change-password', otherCookie, {
            currentPassword: password,
            newPassword: 'changed-native-protocol-password',
            revokeOtherSessions: true,
        })
        expect(changed.status).toBe(200)
        const keptCookie = changed.headers
            .getSetCookie()
            .find(value => value.includes('.session_token='))!
            .split(';', 1)[0]!
        expect((await f.request('/api/projects', keptCookie)).status).toBe(200)
        expect((await f.request('/api/projects', againCookie)).status).toBe(401)
    } finally {
        await f.close()
    }
})

test('an isolated server rejects another installation session', async () => {
    const a = await fixture('https://a.postdot.test')
    const b = await fixture('https://b.postdot.test')
    try {
        const native = await a.signup('same-person@example.test')
        await b.signup('same-person@example.test')
        expect((await b.request('/api/projects', native.cookie)).status).toBe(401)
        expect((await a.request('/api/auth/get-session', native.cookie)).status).toBe(200)
    } finally {
        await a.close()
        await b.close()
    }
})
