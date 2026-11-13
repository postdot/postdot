import { expect, test } from 'bun:test'

import { createAuth, postdotClientIpHeader } from '@postdot/auth'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'
import { Elysia } from 'elysia'

import { registerServingHandle } from '../serving'
import { createAuthRoutes } from './auth'
import { createClientIpPolicy } from './client-ip'
import { createHttpPolicy } from './http-policy'

test('overwrites a forged internal IP before mounted auth sees the request and fails closed on malformed chains', async () => {
    let peer: string | null = '203.0.113.10'
    let calls = 0
    registerServingHandle({
        timeout() {},
        requestIP: () => (peer === null ? null : { address: peer }),
    })
    const app = new Elysia().use(createClientIpPolicy(['127.0.0.1/32'])).use(
        createAuthRoutes({
            handler: async request => {
                calls++
                return Response.json({
                    ip: request.headers.get(postdotClientIpHeader),
                    body: request.method === 'POST' ? await request.json() : null,
                })
            },
        })
    )
    const request = (forwarded: string) =>
        app.handle(
            new Request('http://localhost/api/auth/sign-in/email', {
                method: 'POST',
                body: JSON.stringify({ email: 'fixture@example.test' }),
                headers: {
                    'content-type': 'application/json',
                    [postdotClientIpHeader]: '198.51.100.99',
                    'x-forwarded-for': forwarded,
                    'cf-connecting-ip': '198.51.100.100',
                },
            })
        )
    try {
        expect(await (await request('198.51.100.1')).json()).toEqual({
            ip: peer,
            body: { email: 'fixture@example.test' },
        })
        peer = '127.0.0.1'
        expect(await (await request('198.51.100.99,203.0.113.11')).json()).toEqual({
            ip: '203.0.113.11',
            body: { email: 'fixture@example.test' },
        })
        expect((await request('not-an-ip')).status).toBe(400)
        expect(calls).toBe(2)
        peer = null
        expect(await (await request('198.51.100.1')).json()).toEqual({
            ip: null,
            body: { email: 'fixture@example.test' },
        })
    } finally {
        registerServingHandle(undefined)
    }
})

test('preserves socket provenance across the internal HEAD-to-GET dispatch without trusting header claims', async () => {
    const request = new Request('http://localhost/api/auth/get-session', {
        method: 'HEAD',
        headers: { [postdotClientIpHeader]: '198.51.100.99' },
    })
    registerServingHandle({
        timeout() {},
        requestIP: candidate => (candidate === request ? { address: '203.0.113.12' } : null),
    })
    const seen: (string | null)[] = []
    const app = new Elysia()
        .use(createClientIpPolicy())
        .use(createHttpPolicy(async (next): Promise<Response> => app.handle(next)))
        .use(
            createAuthRoutes({
                handler: async next => {
                    seen.push(next.headers.get(postdotClientIpHeader))
                    return Response.json({ ok: true })
                },
            })
        )
    try {
        const response = await app.handle(request)
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('')
        expect(seen).toEqual(['203.0.113.12'])
    } finally {
        registerServingHandle(undefined)
    }
})

test('persists only the verified address and keeps Better Auth mapped-IPv4 and IPv6-subnet normalization', async () => {
    const { database } = await openTestDatabase()
    const origin = 'https://postdot.test'
    const auth = createAuth(database, {
        baseURL: origin,
        secret: 'postdot-verified-ip-test-secret-with-32-characters',
        logger: { disabled: true },
    })
    let peer = '::ffff:203.0.113.10'
    registerServingHandle({ timeout() {}, requestIP: () => ({ address: peer }) })
    const app = new Elysia().use(createClientIpPolicy()).use(createAuthRoutes(auth))
    const credentials = { email: 'verified-ip@example.test', password: 'verified-ip-test-password' }
    const login = async (signup: boolean) => {
        const response = await app.handle(
            new Request(`${origin}/api/auth/${signup ? 'sign-up' : 'sign-in'}/email`, {
                method: 'POST',
                headers: {
                    origin,
                    'content-type': 'application/json',
                    [postdotClientIpHeader]: '198.51.100.99',
                    'x-forwarded-for': '192.0.2.99',
                },
                body: JSON.stringify(
                    signup ? { ...credentials, name: 'IP operator' } : credentials
                ),
            })
        )
        expect(response.status).toBe(200)
        const cookie = response.headers
            .getSetCookie()
            .find(value => value.includes('.session_token='))!
            .split(';', 1)[0]!
        return (await auth.api.getSession({ headers: new Headers({ cookie }) }))!.session.ipAddress
    }
    try {
        expect(await login(true)).toBe('203.0.113.10')
        peer = '2001:db8:abcd:1234::1'
        const subnet = await login(false)
        peer = '2001:db8:abcd:1234::ffff'
        expect(await login(false)).toBe(subnet)
        peer = '2001:db8:abcd:1235::1'
        expect(await login(false)).not.toBe(subnet)
    } finally {
        registerServingHandle(undefined)
        await closeTestDatabase(database)
    }
})
