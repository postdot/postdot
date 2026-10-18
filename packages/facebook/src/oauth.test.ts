import { expect, test } from 'bun:test'

import { createFacebookOAuth, FacebookOAuthError } from './oauth'
import { FACEBOOK_PUBLISH_PERMISSIONS } from './publisher'

const clientId = '123456789'
const clientSecret = 'synthetic-application-secret'
const callbackUri = 'https://postbot.example/api/oauth/facebook/callback'
function setup(
    reply: (call: number) => Response = call =>
        Response.json({
            access_token: call === 1 ? 'synthetic-user-token' : 'synthetic-long-user-token',
            token_type: 'bearer',
            expires_in: call === 1 ? 3600 : 5184000,
        })
) {
    const requests: { url: URL; init: RequestInit | undefined }[] = []
    return {
        requests,
        oauth: createFacebookOAuth({
            clientId,
            clientSecret,
            callbackUri,
            fetcher: async (input, init) => {
                requests.push({ url: new URL(String(input)), init })
                return reply(requests.length)
            },
        }),
    }
}

test('Facebook uses its documented confidential web flow with random state and an exact callback', async () => {
    const { oauth } = setup()
    const first = await oauth.createAuthorizationRequest()
    const second = await oauth.createAuthorizationRequest()
    expect(first.url.origin).toBe('https://www.facebook.com')
    expect(first.url.pathname).toBe('/v26.0/dialog/oauth')
    expect(first.url.searchParams.get('redirect_uri')).toBe(callbackUri)
    expect(first.url.searchParams.get('response_type')).toBe('code')
    expect(first.url.searchParams.get('scope')?.split(' ').sort()).toEqual(
        [...FACEBOOK_PUBLISH_PERMISSIONS].sort()
    )
    expect(first.state.length).toBeGreaterThanOrEqual(32)
    expect(first.state).not.toBe(second.state)
    expect(first.codeVerifier).toBeNull()
    expect(first.url.searchParams.has('code_challenge')).toBe(false)
    expect(first.url.toString()).not.toContain(clientSecret)
})

test('the standards-validated callback exchanges only through the fixed Meta endpoint', async () => {
    const { oauth, requests } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    const parameters = new URL(callbackUri)
    parameters.searchParams.set('state', authorization.state)
    parameters.searchParams.set('code', 'synthetic-one-use-code')
    expect(await oauth.complete({ parameters, expectedState: authorization.state })).toMatchObject({
        accessToken: 'synthetic-long-user-token',
        expiresInSeconds: 5184000,
    })
    expect(requests).toHaveLength(2)
    expect(Object.fromEntries(requests[1]!.url.searchParams)).toEqual({
        grant_type: 'fb_exchange_token',
        client_id: clientId,
        client_secret: clientSecret,
        fb_exchange_token: 'synthetic-user-token',
    })
    const request = requests[0]!
    expect(request.url.origin).toBe('https://graph.facebook.com')
    expect(request.url.pathname).toBe('/v26.0/oauth/access_token')
    expect(Object.fromEntries(request.url.searchParams)).toEqual({
        client_id: clientId,
        client_secret: clientSecret,
        code: 'synthetic-one-use-code',
        redirect_uri: callbackUri,
    })
    expect(request.init?.method).toBe('GET')
    expect(request.init?.redirect).toBe('error')
    expect(request.init?.cache).toBe('no-store')
    expect(request.init?.signal).toBeInstanceOf(AbortSignal)
})

test('wrong state, callback location, duplicate parameters and missing code never contact Meta', async () => {
    const { oauth, requests } = setup()
    const auth = await oauth.createAuthorizationRequest()
    for (const parameters of [
        new URL(`${callbackUri}?code=code&state=wrong`),
        new URL(
            `https://attacker.example/api/oauth/facebook/callback?code=code&state=${auth.state}`
        ),
        new URL(`${callbackUri}/other?code=code&state=${auth.state}`),
        new URL(`${callbackUri}?code=one&code=two&state=${auth.state}`),
        new URL(`${callbackUri}?code=code&state=${auth.state}&state=${auth.state}`),
        new URL(`${callbackUri}?state=${auth.state}`),
    ])
        await expect(
            oauth.complete({ parameters, expectedState: auth.state })
        ).rejects.toMatchObject({ code: 'invalid_callback' })
    expect(requests).toHaveLength(0)
})

test('a refusal is distinguished only for the expected state and never echoes callback details', async () => {
    const { oauth, requests } = setup()
    const auth = await oauth.createAuthorizationRequest()
    for (const state of [auth.state, 'wrong']) {
        const parameters = new URL(
            `${callbackUri}?error=access_denied&error_description=${clientSecret}&state=${state}`
        )
        try {
            await oauth.complete({ parameters, expectedState: auth.state })
            throw new Error('Expected refusal')
        } catch (error) {
            expect(error).toBeInstanceOf(FacebookOAuthError)
            expect((error as FacebookOAuthError).code).toBe(
                state === auth.state ? 'access_denied' : 'invalid_callback'
            )
            expect(String(error)).not.toContain(clientSecret)
        }
    }
    expect(requests).toHaveLength(0)
})

test('malformed, failed and redirected token exchanges expose only a static error', async () => {
    for (const reply of [
        () => Response.json({ error: { message: clientSecret, code: 100 } }, { status: 400 }),
        () => Response.json({ access_token: '', token_type: 'bearer' }),
        () => Response.json({ access_token: 'token', token_type: 'unexpected' }),
        () => new Response('not-json'),
        () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } }),
        () => {
            throw new Error(`Private ${clientSecret}`)
        },
    ]) {
        const { oauth, requests } = setup(reply)
        const auth = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: new URL(`${callbackUri}?code=code&state=${auth.state}`),
                expectedState: auth.state,
            })
        ).rejects.toMatchObject({
            code: 'exchange_failed',
            message: 'Facebook authorization could not be completed',
        })
        expect(requests).toHaveLength(1)
    }
})

test('Facebook configuration rejects insecure or ambiguous callback addresses', () => {
    for (const address of [
        'http://localhost/callback',
        `${callbackUri}?state=embedded`,
        `${callbackUri}#fragment`,
        'https://user:password@postbot.example/callback',
    ])
        expect(() =>
            createFacebookOAuth({ clientId, clientSecret, callbackUri: address })
        ).toThrow()
})

test('a failed long-lived exchange never returns the initial short-lived token', async () => {
    for (const reply of [
        () => Response.json({ error: { message: clientSecret } }, { status: 400 }),
        () => Response.json({ access_token: 'token', token_type: 'bearer' }),
        () => Response.json({ access_token: 'token', token_type: 'bearer', expires_in: 0 }),
        () => Response.json({ access_token: 'token', token_type: 'bearer', expires_in: 1.5 }),
        () =>
            Response.json({ access_token: 'token', token_type: 'bearer', expires_in: 31_536_001 }),
        () => Response.json({ access_token: 'token', token_type: 'unexpected', expires_in: 3600 }),
        () => new Response('invalid'),
        () => {
            throw new Error(clientSecret)
        },
    ]) {
        const { oauth, requests } = setup(call =>
            call === 1
                ? Response.json({
                      access_token: 'short-token',
                      token_type: 'bearer',
                      expires_in: 3600,
                  })
                : reply()
        )
        const auth = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: new URL(`${callbackUri}?code=code&state=${auth.state}`),
                expectedState: auth.state,
            })
        ).rejects.toMatchObject({
            code: 'exchange_failed',
            message: 'Facebook authorization could not be completed',
        })
        expect(requests).toHaveLength(2)
        expect(requests[1]!.init?.redirect).toBe('error')
        expect(requests[1]!.init?.cache).toBe('no-store')
    }
})
