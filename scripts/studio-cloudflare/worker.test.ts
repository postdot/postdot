import { expect, test } from 'bun:test'

import { proxyStudioRequest } from './worker'
import type { StudioCloudflareBindings } from './worker-configuration'

const env: Omit<StudioCloudflareBindings, 'ASSETS'> = {
    POSTDOT_API_ORIGIN: 'https://origin.example.test',
    POSTDOT_PUBLIC_ORIGIN: 'https://postdot.example.test',
    POSTDOT_INGRESS_SECRET: 'a'.repeat(64),
}
const makeRequest = (path = '/api/auth/get-session', init?: RequestInit) =>
    new Request(`${env.POSTDOT_PUBLIC_ORIGIN}${path}`, {
        ...init,
        headers: { 'cf-connecting-ip': '203.0.113.12', ...init?.headers },
    })

test('forwards bodies and credentials to a fixed origin with verified edge identity, never following a redirect', async () => {
    let calls = 0
    const response = await proxyStudioRequest(
        makeRequest('/api/upload?signature=a%2Fb&part=2', {
            method: 'PUT',
            body: new Uint8Array([0, 255, 42]),
            headers: {
                origin: 'https://untrusted.example',
                cookie: 'session=private',
                authorization: 'Bearer scoped-key',
                'x-postdot-ingress': 'forged',
                'x-postdot-client-address': '192.0.2.44',
                'x-postdot-client-ip': '192.0.2.45',
                'x-forwarded-for': '192.0.2.46',
                'x-forwarded-host': 'evil.example',
                'x-real-ip': '192.0.2.47',
            },
        }),
        env,
        async (input: Request) => {
            calls++
            expect(input.url).toBe('https://origin.example.test/api/upload?signature=a%2Fb&part=2')
            expect(input.method).toBe('PUT')
            expect(input.redirect).toBe('manual')
            expect(input.cache).toBe('no-store')
            expect([...new Uint8Array(await input.arrayBuffer())]).toEqual([0, 255, 42])
            expect(input.headers.get('origin')).toBe('https://untrusted.example')
            expect(input.headers.get('cookie')).toBe('session=private')
            expect(input.headers.get('authorization')).toBe('Bearer scoped-key')
            expect(input.headers.get('x-postdot-ingress')).toBe(env.POSTDOT_INGRESS_SECRET)
            expect(input.headers.get('x-postdot-client-address')).toBe('203.0.113.12')
            for (const name of [
                'x-postdot-client-ip',
                'x-forwarded-for',
                'x-forwarded-host',
                'x-real-ip',
                'cf-connecting-ip',
            ])
                expect(input.headers.has(name)).toBe(false)
            const headers = new Headers({ location: 'https://elsewhere.example/return' })
            headers.append('set-cookie', 'one=1; Secure; HttpOnly; Path=/')
            headers.append('set-cookie', 'two=2; Secure; SameSite=Lax; Path=/')
            return new Response(null, { status: 303, headers })
        }
    )
    expect(calls).toBe(1)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://elsewhere.example/return')
    expect(response.headers.getSetCookie()).toHaveLength(2)
    expect(response.headers.get('cache-control')).toBe('no-store')
})

test('fails closed on missing edge identity, unsafe configuration and alternate origins without fetching', async () => {
    const neverFetch = () => {
        throw new Error('Must not fetch')
    }
    for (const value of [
        undefined,
        '',
        '1.2.3.999',
        '203.0.113.1, 192.0.2.2',
        'fe80::1%lo',
        '::not-ip',
    ]) {
        const request = makeRequest()
        if (value === undefined) request.headers.delete('cf-connecting-ip')
        else request.headers.set('cf-connecting-ip', value)
        expect((await proxyStudioRequest(request, env, neverFetch)).status).toBe(503)
    }
    for (const value of [
        'http://origin.example.test',
        'https://u:p@origin.example.test',
        `${env.POSTDOT_API_ORIGIN}/path`,
        env.POSTDOT_PUBLIC_ORIGIN,
    ])
        expect(
            (
                await proxyStudioRequest(
                    makeRequest(),
                    { ...env, POSTDOT_API_ORIGIN: value },
                    neverFetch
                )
            ).status
        ).toBe(503)
    expect(
        (
            await proxyStudioRequest(
                makeRequest(),
                { ...env, POSTDOT_INGRESS_SECRET: '' },
                neverFetch
            )
        ).status
    ).toBe(503)
    expect(
        (
            await proxyStudioRequest(
                new Request('https://alternate.example/api/private'),
                env,
                neverFetch
            )
        ).status
    ).toBe(421)
    expect((await proxyStudioRequest(makeRequest('/apiculture'), env, neverFetch)).status).toBe(404)
    expect(
        (
            await proxyStudioRequest(
                makeRequest('/api/private', { headers: { connection: 'origin' } }),
                env,
                neverFetch
            )
        ).status
    ).toBe(400)
    expect(
        (
            await proxyStudioRequest(makeRequest(), env, async () => {
                throw new Error('private infrastructure details')
            })
        ).status
    ).toBe(502)
})

test('returns an open SSE stream immediately and propagates cancellation and IPv6 identity', async () => {
    const abort = new AbortController()
    let forwardedSignal: AbortSignal | undefined
    let cancelled = false
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('data: ready\n\n'))
        },
        cancel() {
            cancelled = true
        },
    })
    const response = await proxyStudioRequest(
        makeRequest('/api/projects/id/events', {
            signal: abort.signal,
            headers: { 'cf-connecting-ip': '2001:db8::12' },
        }),
        env,
        async (input: Request) => {
            forwardedSignal = input.signal
            expect(input.headers.get('x-postdot-client-address')).toBe('2001:db8::12')
            return new Response(stream, {
                headers: {
                    'content-type': 'text/event-stream',
                    'cache-control': 'private, max-age=0, no-store',
                },
            })
        }
    )
    const reader = response.body!.getReader()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: ready\n\n')
    await reader.cancel()
    expect(cancelled).toBe(true)
    abort.abort()
    expect(forwardedSignal?.aborted).toBe(true)
})
