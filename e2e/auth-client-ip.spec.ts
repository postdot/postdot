import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'

import { expect, test } from '@playwright/test'

test('production login quotas use verified client IPs and reject spoofed proxy identities', async ({
    baseURL,
}) => {
    test.setTimeout(60_000)
    const origin = new URL(baseURL!).origin
    const backend = `http://127.0.0.1:${process.env.POSTDOT_E2E_API_PORT}`
    expect(new URL(origin).hostname).toBe('127.0.0.1')
    type Reply = { status: number; headers: IncomingHttpHeaders; body: Buffer }
    const credentials = {
        email: 'ip-acceptance@example.test',
        password: 'ip-acceptance-test-password',
    }
    function send(
        targetOrigin: string,
        localAddress: string,
        path: string,
        data?: unknown,
        extra: Record<string, string> = {},
        method?: 'HEAD'
    ): Promise<Reply> {
        const target = new URL(path, targetOrigin)
        if (![origin, backend].includes(target.origin))
            throw new Error('Unexpected acceptance origin')
        const body = data === undefined ? undefined : Buffer.from(JSON.stringify(data))
        return new Promise((resolve, reject) => {
            const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
                target,
                {
                    localAddress,
                    agent: false,
                    rejectUnauthorized: false,
                    method: method ?? (body ? 'POST' : 'GET'),
                    headers: {
                        origin,
                        ...(body
                            ? {
                                  'content-type': 'application/json',
                                  'content-length': String(body.byteLength),
                              }
                            : {}),
                        ...extra,
                    },
                },
                response => {
                    const chunks: Buffer[] = []
                    response.on('data', chunk => chunks.push(Buffer.from(chunk)))
                    response.on('error', reject)
                    response.on('end', () =>
                        resolve({
                            status: response.statusCode!,
                            headers: response.headers,
                            body: Buffer.concat(chunks),
                        })
                    )
                }
            )
            request.on('error', reject)
            request.end(body)
        })
    }
    const signup = await send(origin, '127.0.0.10', '/api/auth/sign-up/email', {
        ...credentials,
        name: 'IP operator',
    })
    expect(signup.status).toBe(200)
    const path = '/api/auth/sign-in/email'
    const wrong = { ...credentials, password: 'incorrect-test-password' }
    const forged = (index: number) => ({
        'x-forwarded-for': `203.0.113.${index + 1}`,
        'x-postdot-client-ip': `198.51.100.${index + 1}`,
        'x-real-ip': `192.0.2.${index + 1}`,
        'cf-connecting-ip': `192.0.2.${index + 20}`,
    })
    // The proxy appends the actual socket address. A changing prefix cannot buy
    // extra attempts, and an internal-looking header cannot override the result.
    for (let index = 0; index < 3; index++)
        expect((await send(origin, '127.0.0.2', path, wrong, forged(index))).status).toBe(401)
    const throttled = await send(origin, '127.0.0.2', path, credentials, forged(4))
    expect(throttled.status).toBe(429)
    expect(Number(throttled.headers['x-retry-after'])).toBeGreaterThan(0)
    const other = await send(origin, '127.0.0.3', path, credentials, forged(5))
    expect(other.status).toBe(200)
    const cookie = other.headers['set-cookie']!.find(value =>
        value.split('=', 1)[0]!.endsWith('.session_token')
    )!.split(';', 1)[0]!
    const session = await send(origin, '127.0.0.3', '/api/auth/get-session', undefined, { cookie })
    expect(session.status).toBe(200)
    expect(JSON.parse(session.body.toString()).session.ipAddress).toBe('127.0.0.3')

    // Direct access from a peer outside the proxy allowlist ignores all IP headers.
    for (let index = 0; index < 3; index++)
        expect((await send(backend, '127.0.0.4', path, wrong, forged(index))).status).toBe(401)
    expect((await send(backend, '127.0.0.4', path, credentials, forged(6))).status).toBe(429)
    expect((await send(backend, '127.0.0.5', path, credentials, forged(7))).status).toBe(200)

    // A malformed attacker prefix is beyond the established client boundary.
    for (let index = 0; index < 3; index++)
        expect(
            (
                await send(origin, '127.0.0.6', path, wrong, {
                    'x-forwarded-for': `garbage-${index}`,
                })
            ).status
        ).toBe(401)
    expect(
        (await send(origin, '127.0.0.6', path, credentials, { 'x-forwarded-for': 'garbage-final' }))
            .status
    ).toBe(429)

    // Only a genuinely trusted socket peer can submit a chain for interpretation.
    // Malformed nearest hops are rejected before authentication, not assigned a new quota.
    for (const forwarded of ['not-an-ip', '203.0.113.1,', Array(33).fill('127.0.0.1').join(',')]) {
        const invalid = await send(backend, '127.0.0.1', path, credentials, {
            'x-forwarded-for': forwarded,
        })
        expect(invalid.status).toBe(400)
        expect(JSON.parse(invalid.body.toString()).error.code).toBe('invalid_forwarded_address')
    }

    // A trusted IPv6-aware ingress cannot create new quotas by rotating client
    // addresses inside the same /64; another client subnet stays independent.
    for (let suffix = 1; suffix <= 3; suffix++)
        expect(
            (
                await send(backend, '127.0.0.1', path, wrong, {
                    'x-forwarded-for': `2001:db8:abcd:2::${suffix}`,
                })
            ).status
        ).toBe(401)
    expect(
        (
            await send(backend, '127.0.0.1', path, credentials, {
                'x-forwarded-for': '2001:db8:abcd:2::4',
            })
        ).status
    ).toBe(429)
    expect(
        (
            await send(backend, '127.0.0.1', path, credentials, {
                'x-forwarded-for': '2001:db8:abcd:3::1',
            })
        ).status
    ).toBe(200)

    // Internal HEAD redispatch must use the same identity and quota as GET,
    // rather than accumulating attempts in an unknown-peer bucket.
    const reads = await Promise.all(
        Array.from({ length: 100 }, () =>
            send(origin, '127.0.0.7', '/api/auth/get-session', undefined, {}, 'HEAD')
        )
    )
    expect(reads.every(reply => reply.status === 200 && reply.body.byteLength === 0)).toBe(true)
    expect((await send(origin, '127.0.0.7', '/api/auth/get-session')).status).toBe(429)
    expect((await send(origin, '127.0.0.8', '/api/auth/get-session')).status).toBe(200)
})
