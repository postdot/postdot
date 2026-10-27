import { expect, test } from 'bun:test'

import { createAuth } from '@postdot/auth'
import { closeDatabase, createDatabase, createNotificationStore, runMigrations } from '@postdot/db'
import { INSTAGRAM_PUBLISH_PERMISSIONS } from '@postdot/instagram'

import { createApp } from '../../../app'
import { createPublisherRuntime } from '../../publishers/runtime'

const origin = 'https://postdot.test'
async function fixture(configured = true) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let calls = 0
    const publisher = createPublisherRuntime(database, {
        apiOrigin: origin,
        webOrigin: origin,
        publisherEncryptionKey: new Uint8Array(32).fill(9),
        publisherEncryptionKeyId: 'test',
        instagram: {
            fetcher: async (input: string | URL | Request) => {
                calls++
                const url = new URL(String(input))
                if (url.host === 'api.instagram.com')
                    return Response.json({
                        data: [
                            {
                                access_token: 'synthetic-short-token',
                                user_id: '1234',
                                permissions: INSTAGRAM_PUBLISH_PERMISSIONS.join(','),
                            },
                        ],
                    })
                if (url.pathname === '/access_token')
                    return Response.json({
                        access_token: 'synthetic-long-token',
                        token_type: 'bearer',
                        expires_in: 5183944,
                    })
                return Response.json({
                    data: [
                        {
                            id: '1234',
                            user_id: '5678',
                            username: 'studio_test',
                            account_type: 'BUSINESS',
                        },
                    ],
                })
            },
        },
    })
    const auth = createAuth(database, {
        baseURL: origin,
        allowAdditionalSignups: true,
        secret: 'postdot-test-secret-with-at-least-32-characters',
    })
    const app = createApp({
        database,
        auth,
        publisher,
        notifications: createNotificationStore(database),
    })
    async function request(
        path: string,
        cookie = '',
        init: RequestInit = {},
        transportOrigin = origin
    ) {
        const headers = new Headers(init.headers)
        headers.set('origin', origin)
        if (cookie) headers.set('cookie', cookie)
        if (init.body !== undefined) headers.set('content-type', 'application/json')
        return app.handle(new Request(`${transportOrigin}${path}`, { ...init, headers }))
    }
    async function signup(email: string) {
        const response = await request('/api/auth/sign-up/email', '', {
            method: 'POST',
            body: JSON.stringify({
                email,
                name: 'Operator',
                password: 'correct-horse-battery-staple',
            }),
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { user: { id: string } }
        return { cookie: response.headers.get('set-cookie')!.split(';', 1)[0]!, id: body.user.id }
    }
    const owner = await signup('owner@postdot.test')
    const projectResponse = await request('/api/projects', owner.cookie, {
        method: 'POST',
        body: JSON.stringify({ name: 'Instagram project' }),
    })
    expect(projectResponse.status).toBe(201)
    const project = (await projectResponse.json()) as { project: { id: string } }
    const projectId = project.project.id
    const channelResponse = await request(`/api/projects/${projectId}/channels`, owner.cookie, {
        method: 'POST',
        body: JSON.stringify({ name: 'Instagram', profile: 'instagram' }),
    })
    expect(channelResponse.status).toBe(201)
    const { channel } = (await channelResponse.json()) as { channel: { id: string } }
    const configuration = configured
        ? await publisher.providerApplicationStore.createProviderApplication({
              providerId: 'instagram',
              name: 'Instagram test',
              clientId: '123',
              clientSecret: 'synthetic-secret',
              createdByUserId: owner.id,
          })
        : null
    if (configuration && configuration.kind !== 'created')
        throw new Error('Application was not created')
    const applicationId = configuration?.kind === 'created' ? configuration.configuration.id : null
    const path = `/api/projects/${projectId}/channels/${channel.id}/publisher/instagram`
    return {
        database,
        projectId,
        channelId: channel.id,
        applicationId,
        publisher,
        app,
        request,
        signup,
        owner,
        path,
        get calls() {
            return calls
        },
    }
}

async function startCallback(f: Awaited<ReturnType<typeof fixture>>) {
    const start = await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })
    expect(start.status).toBe(200)
    expect(start.headers.get('cache-control')).toBe('no-store')
    const authorization = new URL(((await start.json()) as { url: string }).url)
    expect(authorization.origin).toBe('https://www.instagram.com')
    expect(authorization.searchParams.get('redirect_uri')).toBe(
        `${origin}/api/oauth/instagram/callback`
    )
    return `/api/oauth/instagram/callback?state=${authorization.searchParams.get('state')}&code=synthetic-code`
}

test('Instagram HTTP callback connects the verified account behind a TLS proxy without exposing tokens', async () => {
    const f = await fixture()
    try {
        const callback = await startCallback(f)
        const completed = await f.request(
            callback,
            f.owner.cookie,
            { headers: { 'x-forwarded-host': 'attacker.test' } },
            'http://127.0.0.1:4100'
        )
        expect(completed.status).toBe(303)
        expect(completed.headers.get('referrer-policy')).toBe('no-referrer')
        expect(completed.headers.get('cache-control')).toBe('no-store')
        const location = new URL(completed.headers.get('location')!)
        expect(location.origin).toBe(origin)
        expect(location.searchParams.get('publisher')).toBe('connected')
        expect(location.toString()).not.toContain('synthetic-')
        const connections = f.publisher.publisherStore.listPublisherConnections(
            f.projectId,
            f.owner.id
        )!
        expect(connections).toHaveLength(1)
        expect(connections[0]!.destination).toEqual({
            type: 'account',
            id: '5678',
            name: 'studio_test',
        })
        const credentials = f.publisher.credentialStore.listPublisherCredentials(f.projectId)
        expect(credentials).toHaveLength(1)
        expect(credentials[0]).toMatchObject({
            providerApplicationId: f.applicationId,
            externalAccountId: '5678',
        })
        const secret = await f.publisher.credentialStore.resolvePublisherCredentialSecrets(
            f.projectId,
            credentials[0]!.id
        )
        expect(secret?.accessToken).toBe('synthetic-long-token')
        expect(JSON.stringify(connections)).not.toContain('synthetic-long-token')
        const calls = f.calls
        const replay = await f.request(callback, f.owner.cookie)
        expect(new URL(replay.headers.get('location')!).searchParams.get('publisher')).toBe(
            'invalid_callback'
        )
        expect(f.calls).toBe(calls)
        expect(
            (await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })).status
        ).toBe(409)
    } finally {
        closeDatabase(f.database)
    }
})

test('Instagram HTTP callback rejects a foreign actor and a disabled issuing application before exchange', async () => {
    const f = await fixture()
    try {
        const callback = await startCallback(f)
        const stranger = await f.signup('stranger@postdot.test')
        const foreign = await f.request(callback, stranger.cookie)
        expect(new URL(foreign.headers.get('location')!).pathname).toBe('/dashboard')
        expect(f.calls).toBe(0)
        await f.publisher.providerApplicationStore.updateProviderApplication({
            id: f.applicationId!,
            state: 'disabled',
        })
        const disabled = await f.request(callback, f.owner.cookie)
        expect(new URL(disabled.headers.get('location')!).searchParams.get('publisher')).toBe(
            'invalid_callback'
        )
        expect(f.calls).toBe(0)
        expect(f.publisher.credentialStore.listPublisherCredentials(f.projectId)).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})

test('Instagram HTTP routes require authentication and report missing distinct configuration', async () => {
    const f = await fixture(false)
    try {
        expect((await f.request(`${f.path}/connect`, '', { method: 'POST' })).status).toBe(401)
        expect(
            (await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })).status
        ).toBe(503)
        const readiness = await f.request(`/api/projects/${f.projectId}/publishers`, f.owner.cookie)
        expect(readiness.status).toBe(200)
        expect(
            ((await readiness.json()) as { oauthReadiness: { instagram: string } }).oauthReadiness
                .instagram
        ).toBe('not_configured')
        expect(f.calls).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

test('Instagram authorization cannot be started by an automation key', async () => {
    const f = await fixture()
    try {
        const response = await f.request('/api/api-keys', f.owner.cookie, {
            method: 'POST',
            body: JSON.stringify({ name: 'Automation', projectIds: [f.projectId] }),
        })
        expect(response.status).toBe(201)
        const { token } = (await response.json()) as { token: string }
        const start = await f.request(`${f.path}/connect`, '', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
        })
        expect(start.status).toBe(403)
        const callback = await f.request('/api/oauth/instagram/callback', '', {
            headers: { authorization: `Bearer ${token}` },
        })
        expect(callback.status).toBe(403)
        expect(((await callback.json()) as { error: { code: string } }).error.code).toBe(
            'insufficient_api_key_permissions'
        )
        expect(f.calls).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})
