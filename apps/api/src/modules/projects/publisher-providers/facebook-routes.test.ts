import { expect, test } from 'bun:test'

import { createAuth } from '@postdot/auth'
import { closeDatabase, createDatabase, createNotificationStore, runMigrations } from '@postdot/db'
import { FACEBOOK_PUBLISH_PERMISSIONS } from '@postdot/facebook'

import { createApp } from '../../../app'
import { createPublisherRuntime } from '../../publishers/runtime'

const origin = 'https://postbot.test'
async function fixture(configured = true) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let calls = 0
    const publisher = createPublisherRuntime(database, {
        apiOrigin: origin,
        webOrigin: origin,
        publisherEncryptionKey: new Uint8Array(32).fill(9),
        publisherEncryptionKeyId: 'test',
        ...(configured
            ? {
                  facebook: {
                      clientId: '123',
                      clientSecret: 'synthetic-secret',
                      fetcher: async (input: string | URL | Request) => {
                          calls++
                          const url = new URL(String(input))
                          if (url.pathname.endsWith('/oauth/access_token'))
                              return Response.json({
                                  access_token: 'synthetic-user-token',
                                  token_type: 'bearer',
                                  expires_in: 3600,
                              })
                          if (url.pathname.endsWith('/me/permissions'))
                              return Response.json({
                                  data: FACEBOOK_PUBLISH_PERMISSIONS.map(permission => ({
                                      permission,
                                      status: 'granted',
                                  })),
                              })
                          return Response.json({
                              data: [
                                  {
                                      id: '456',
                                      name: 'Page',
                                      access_token: 'synthetic-page-token',
                                      tasks: ['CREATE_CONTENT'],
                                  },
                              ],
                          })
                      },
                  },
              }
            : {}),
    })
    const auth = createAuth(database, {
        baseURL: origin,
        allowAdditionalSignups: true,
        secret: 'postbot-test-secret-with-at-least-32-characters',
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
    const owner = await signup('owner@postbot.test')
    const projectResponse = await request('/api/projects', owner.cookie, {
        method: 'POST',
        body: JSON.stringify({ name: 'Facebook project' }),
    })
    expect(projectResponse.status).toBe(201)
    const project = (await projectResponse.json()) as { project: { id: string } }
    const channelResponse = await request(
        `/api/projects/${project.project.id}/channels`,
        owner.cookie,
        {
            method: 'POST',
            body: JSON.stringify({ name: 'Facebook', profile: 'facebook' }),
        }
    )
    expect(channelResponse.status).toBe(201)
    const { channel } = (await channelResponse.json()) as { channel: { id: string } }
    const path = `/api/projects/${project.project.id}/channels/${channel.id}/publisher/facebook`
    return {
        database,
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

test('Facebook HTTP flow redirects to sanitized choices and persists the explicitly chosen Page', async () => {
    const f = await fixture()
    try {
        const start = await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })
        expect(start.status).toBe(200)
        expect(start.headers.get('cache-control')).toBe('no-store')
        const authorization = new URL(((await start.json()) as { url: string }).url)
        const callback = `/api/oauth/facebook/callback?state=${authorization.searchParams.get('state')}&code=synthetic-code`
        const completed = await f.request(callback, f.owner.cookie)
        expect(completed.status).toBe(303)
        expect(completed.headers.get('referrer-policy')).toBe('no-referrer')
        const location = new URL(completed.headers.get('location')!)
        expect(location.origin).toBe(origin)
        const selection = location.searchParams.get('facebook_selection')!
        expect(selection.length).toBeGreaterThan(32)
        expect(location.toString()).not.toContain('synthetic-user-token')
        const pages = await f.request(`${f.path}/pages?selection=${selection}`, f.owner.cookie)
        expect(pages.status).toBe(200)
        expect(pages.headers.get('cache-control')).toBe('no-store')
        expect(await pages.json()).toEqual({
            pages: [{ id: '456', name: 'Page', hasPublishTask: true }],
            nextCursor: null,
        })
        const selected = await f.request(`${f.path}/select`, f.owner.cookie, {
            method: 'POST',
            body: JSON.stringify({ selection, pageId: '456' }),
        })
        expect(selected.status).toBe(200)
        expect(await selected.text()).not.toContain('synthetic-page-token')
        const calls = f.calls
        const replay = await f.request(callback, f.owner.cookie)
        expect(new URL(replay.headers.get('location')!).searchParams.get('publisher')).toBe(
            'invalid_callback'
        )
        expect(f.calls).toBe(calls)
    } finally {
        closeDatabase(f.database)
    }
})

test('Facebook HTTP routes require authentication and mask channels belonging to other users', async () => {
    const f = await fixture()
    try {
        expect((await f.request(`${f.path}/connect`, '', { method: 'POST' })).status).toBe(401)
        const stranger = await f.signup('stranger@postbot.test')
        expect(
            (await f.request(`${f.path}/connect`, stranger.cookie, { method: 'POST' })).status
        ).toBe(404)
        expect(f.calls).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

test('unconfigured Facebook routes make no provider calls', async () => {
    const f = await fixture(false)
    try {
        const response = await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })
        expect(response.status).toBe(503)
        expect(f.calls).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

test('Facebook callback and pending selection retain their stored application when the default changes', async () => {
    const f = await fixture()
    try {
        async function application(clientId: string) {
            const response = await f.request(
                '/api/settings/provider-applications',
                f.owner.cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        providerId: 'facebook',
                        name: `Application ${clientId}`,
                        clientId,
                        clientSecret: `synthetic-${clientId}-secret`,
                        isDefault: true,
                    }),
                }
            )
            expect(response.status).toBe(201)
            const text = await response.text()
            expect(text).not.toContain(`synthetic-${clientId}-secret`)
            return (JSON.parse(text) as { application: { id: string } }).application.id
        }
        const first = await application('111')
        const start = await f.request(`${f.path}/connect`, f.owner.cookie, {
            method: 'POST',
            body: JSON.stringify({ providerApplicationId: first }),
        })
        expect(start.status).toBe(200)
        const auth = new URL(((await start.json()) as { url: string }).url)
        expect(auth.searchParams.get('client_id')).toBe('111')
        await application('222')
        const callback = await f.request(
            `/api/oauth/facebook/callback?state=${auth.searchParams.get('state')}&code=code`,
            f.owner.cookie
        )
        const selection = new URL(callback.headers.get('location')!).searchParams.get(
            'facebook_selection'
        )!
        expect(selection).toBeTruthy()
        const selected = await f.request(`${f.path}/select`, f.owner.cookie, {
            method: 'POST',
            body: JSON.stringify({ selection, pageId: '456' }),
        })
        expect(selected.status).toBe(200)
        const attempts = f.database.$client
            .query(
                'select provider_application_id as application from oauth_authorization_attempts'
            )
            .all()
        expect(attempts).toEqual([{ application: first }, { application: first }])
    } finally {
        closeDatabase(f.database)
    }
})

test('disabling a stored Facebook application invalidates its callback before any provider request', async () => {
    const f = await fixture()
    try {
        const saved = await f.publisher.providerApplicationStore.createProviderApplication({
            providerId: 'facebook',
            name: 'Facebook',
            clientId: '111',
            clientSecret: 'synthetic-secret',
            createdByUserId: f.owner.id,
        })
        if (saved.kind !== 'created') throw new Error('Expected application')
        const start = await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })
        const url = new URL(((await start.json()) as { url: string }).url)
        await f.publisher.providerApplicationStore.updateProviderApplication({
            id: saved.configuration.id,
            state: 'disabled',
        })
        const response = await f.request(
            `/api/oauth/facebook/callback?state=${url.searchParams.get('state')}&code=code`,
            f.owner.cookie
        )
        expect(new URL(response.headers.get('location')!).searchParams.get('publisher')).toBe(
            'invalid_callback'
        )
        expect(f.calls).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

test('declining Facebook authorization returns contextual feedback without contacting Meta', async () => {
    const f = await fixture()
    try {
        const start = await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })
        const url = new URL(((await start.json()) as { url: string }).url)
        const response = await f.request(
            `/api/oauth/facebook/callback?state=${url.searchParams.get('state')}&error=access_denied`,
            f.owner.cookie
        )
        const target = new URL(response.headers.get('location')!)
        expect(target.pathname).toMatch(/\/dashboard\/projects\/[^/]+\/channels$/)
        expect(target.searchParams.get('publisher')).toBe('authorization_denied')
        expect(f.calls).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

test('a foreign callback session learns no project return path and does not consume the owner attempt', async () => {
    const f = await fixture()
    try {
        const start = await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })
        const url = new URL(((await start.json()) as { url: string }).url)
        const path = `/api/oauth/facebook/callback?state=${url.searchParams.get('state')}&code=code`
        const stranger = await f.signup('callback-stranger@postbot.test')
        const rejected = await f.request(path, stranger.cookie)
        expect(new URL(rejected.headers.get('location')!).pathname).toBe('/dashboard')
        expect(f.calls).toBe(0)
        const accepted = await f.request(path, f.owner.cookie)
        expect(
            new URL(accepted.headers.get('location')!).searchParams.get('facebook_selection')
        ).toBeTruthy()
    } finally {
        closeDatabase(f.database)
    }
})

test('Facebook callback uses the configured public origin behind a TLS proxy', async () => {
    const f = await fixture()
    try {
        const start = await f.request(`${f.path}/connect`, f.owner.cookie, { method: 'POST' })
        const authorization = new URL(((await start.json()) as { url: string }).url)
        const callback = `/api/oauth/facebook/callback?state=${authorization.searchParams.get('state')}&code=synthetic-code`
        const completed = await f.request(
            callback,
            f.owner.cookie,
            {
                headers: { 'x-forwarded-host': 'attacker.test', 'x-forwarded-proto': 'http' },
            },
            'http://internal:3003'
        )
        expect(completed.status).toBe(303)
        const location = new URL(completed.headers.get('location')!)
        expect(location.origin).toBe(origin)
        expect(location.searchParams.get('facebook_selection')?.length).toBeGreaterThan(32)
        expect(f.calls).toBeGreaterThan(0)
    } finally {
        closeDatabase(f.database)
    }
})
