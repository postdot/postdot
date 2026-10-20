import { expect, test } from 'bun:test'

import { createInstagramOAuth, InstagramOAuthError } from './oauth'

const clientId = '123456789'
const clientSecret = 'synthetic-application-secret'
const callbackUri = 'https://postbot.example/api/oauth/instagram/callback'
const appScopedId = '17841400000000001'
const professionalId = '17841400000000002'

interface RecordedRequest {
    readonly url: URL
    readonly init: RequestInit | undefined
}

function defaultCodeExchange(): Response {
    return Response.json({
        data: [
            {
                access_token: 'synthetic-short-token',
                user_id: appScopedId,
                permissions: 'instagram_business_basic,instagram_business_content_publish',
            },
        ],
    })
}

function defaultLongLived(): Response {
    return Response.json({
        access_token: 'synthetic-long-token',
        token_type: 'bearer',
        expires_in: 5183944,
    })
}

function defaultProfile(): Response {
    return Response.json({
        data: [
            {
                id: appScopedId,
                user_id: professionalId,
                username: 'synthetic_account',
                account_type: 'BUSINESS',
            },
        ],
    })
}

function setup(options?: {
    readonly codeExchange?: () => Response
    readonly longLived?: () => Response
    readonly profile?: () => Response
    readonly now?: () => number
}) {
    const requests: RecordedRequest[] = []
    const oauth = createInstagramOAuth({
        clientId,
        clientSecret,
        callbackUri,
        now: options?.now,
        fetcher: async (input, init) => {
            const url = new URL(String(input))
            requests.push({ url, init })
            if (url.origin === 'https://api.instagram.com')
                return (options?.codeExchange ?? defaultCodeExchange)()
            if (url.pathname === '/access_token' || url.pathname === '/refresh_access_token')
                return (options?.longLived ?? defaultLongLived)()
            return (options?.profile ?? defaultProfile)()
        },
    })
    return { oauth, requests }
}

function callback(parameters: string): URL {
    return new URL(parameters)
}

test('the authorization request uses the fixed Instagram host, both publish scopes and a random state', async () => {
    const { oauth } = setup()
    const first = await oauth.createAuthorizationRequest()
    const second = await oauth.createAuthorizationRequest()
    expect(first.url.origin).toBe('https://www.instagram.com')
    expect(first.url.pathname).toBe('/oauth/authorize')
    expect(first.url.searchParams.get('response_type')).toBe('code')
    expect(first.url.searchParams.get('client_id')).toBe(clientId)
    expect(first.url.searchParams.get('redirect_uri')).toBe(callbackUri)
    expect(first.url.searchParams.get('scope')?.split(' ').sort()).toEqual([
        'instagram_business_basic',
        'instagram_business_content_publish',
    ])
    expect(first.state.length).toBeGreaterThanOrEqual(32)
    expect(first.state).not.toBe(second.state)
    expect(first.codeVerifier).toBeNull()
    expect(first.url.searchParams.has('code_challenge')).toBe(false)
    expect(first.url.searchParams.has('code_challenge_method')).toBe(false)
    expect(first.url.toString()).not.toContain(clientSecret)
    expect(first.url.toString()).not.toContain(clientId + clientSecret)
})

test('the confidential code exchange posts the documented form to the fixed token endpoint', async () => {
    const { oauth, requests } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    const result = await oauth.complete({
        parameters: callback(
            `${callbackUri}?code=synthetic-one-use-code&state=${authorization.state}`
        ),
        expectedState: authorization.state,
    })
    expect(requests).toHaveLength(3)
    const exchange = requests[0]!
    expect(exchange.url.origin).toBe('https://api.instagram.com')
    expect(exchange.url.pathname).toBe('/oauth/access_token')
    expect(exchange.init?.method).toBe('POST')
    expect(exchange.init?.redirect).toBe('error')
    expect(exchange.init?.cache).toBe('no-store')
    expect(exchange.init?.credentials).toBe('omit')
    expect(exchange.init?.signal).toBeInstanceOf(AbortSignal)
    expect(Object.fromEntries(new URLSearchParams(exchange.init?.body as string))).toEqual({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: callbackUri,
        code: 'synthetic-one-use-code',
    })
    expect(result.tokens.accessToken).toBe('synthetic-long-token')
    expect(result.tokens.tokenType).toBe('bearer')
    expect(result.tokens.refreshToken).toBeNull()
    expect(result.tokens.expiresInSeconds).toBe(5183944)
    expect([...(result.tokens.scopes ?? [])].sort()).toEqual([
        'instagram_business_basic',
        'instagram_business_content_publish',
    ])
})

test('the long-lived token exchange and the profile read use the documented fixed endpoints', async () => {
    const { oauth, requests } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    await oauth.complete({
        parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
        expectedState: authorization.state,
    })
    const longLived = requests[1]!
    expect(longLived.url.origin).toBe('https://graph.instagram.com')
    expect(longLived.url.pathname).toBe('/access_token')
    expect(Object.fromEntries(longLived.url.searchParams)).toEqual({
        grant_type: 'ig_exchange_token',
        client_secret: clientSecret,
        access_token: 'synthetic-short-token',
    })
    expect(longLived.init?.method).toBe('GET')
    expect(longLived.init?.redirect).toBe('error')
    expect(longLived.init?.cache).toBe('no-store')

    const profile = requests[2]!
    expect(profile.url.origin).toBe('https://graph.instagram.com')
    expect(profile.url.pathname).toBe('/v26.0/me')
    expect(profile.url.searchParams.get('fields')).toBe('id,user_id,username,account_type')
    expect(profile.init?.method).toBe('GET')
    expect(profile.init?.credentials).toBe('omit')
    const headers = profile.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer synthetic-long-token')
    // A Graph resource request carries its token in the header, never in the URL.
    expect(profile.url.toString()).not.toContain('synthetic-long-token')
    expect(profile.url.toString()).not.toContain(clientSecret)
})

test('the account keeps the app-scoped identifier separate from the professional publishing identifier', async () => {
    const { oauth } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    const result = await oauth.complete({
        parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
        expectedState: authorization.state,
    })
    expect(result.account).toEqual({
        id: professionalId,
        appScopedId,
        username: 'synthetic_account',
        accountType: 'BUSINESS',
    })
    expect(result.account.id).not.toBe(result.account.appScopedId)
})

test('a media creator account is eligible and its documented spelling is normalized', async () => {
    for (const accountType of ['Media_Creator', 'MEDIA_CREATOR', 'media creator']) {
        const { oauth } = setup({
            profile: () =>
                Response.json({
                    data: [
                        {
                            id: appScopedId,
                            user_id: professionalId,
                            username: 'synthetic_creator',
                            account_type: accountType,
                        },
                    ],
                }),
        })
        const authorization = await oauth.createAuthorizationRequest()
        const result = await oauth.complete({
            parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
            expectedState: authorization.state,
        })
        expect(result.account.accountType).toBe('MEDIA_CREATOR')
    }
})

test('a business account spelling is normalized', async () => {
    for (const accountType of ['BUSINESS', 'Business', 'business']) {
        const { oauth } = setup({
            profile: () =>
                Response.json({
                    data: [
                        {
                            id: appScopedId,
                            user_id: professionalId,
                            username: 'synthetic_business',
                            account_type: accountType,
                        },
                    ],
                }),
        })
        const authorization = await oauth.createAuthorizationRequest()
        const result = await oauth.complete({
            parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
            expectedState: authorization.state,
        })
        expect(result.account.accountType).toBe('BUSINESS')
    }
})

test('a wrong callback, state, duplicate code or missing code never reaches the provider', async () => {
    const { oauth, requests } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    for (const parameters of [
        callback(`${callbackUri}?code=code&state=wrong`),
        callback(
            `https://attacker.example/api/oauth/instagram/callback?code=code&state=${authorization.state}`
        ),
        callback(`${callbackUri}/other?code=code&state=${authorization.state}`),
        callback(`${callbackUri}?code=one&code=two&state=${authorization.state}`),
        callback(
            `${callbackUri}?code=code&state=${authorization.state}&state=${authorization.state}`
        ),
        callback(`${callbackUri}?state=${authorization.state}`),
        callback(`${callbackUri}?code=&state=${authorization.state}`),
        callback(`${callbackUri}?code=%20&state=${authorization.state}`),
    ])
        await expect(
            oauth.complete({ parameters, expectedState: authorization.state })
        ).rejects.toMatchObject({ code: 'invalid_callback' })
    expect(requests).toHaveLength(0)
})

test('only the documented callback fragment artifact is accepted', async () => {
    const { oauth, requests } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    const result = await oauth.complete({
        parameters: callback(`${callbackUri}?code=code&state=${authorization.state}#_`),
        expectedState: authorization.state,
    })
    expect(result.account.appScopedId).toBe(appScopedId)
    expect(requests).toHaveLength(3)
    for (const fragment of ['#other', '#_x', '#_#']) {
        const { oauth: other, requests: otherRequests } = setup()
        await expect(
            other.complete({
                parameters: callback(
                    `${callbackUri}?code=code&state=${authorization.state}${fragment}`
                ),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({ code: 'invalid_callback' })
        expect(otherRequests).toHaveLength(0)
    }
})

test('a refusal is classified only for the expected state and never echoes callback details', async () => {
    const { oauth, requests } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    for (const state of [authorization.state, 'wrong']) {
        const parameters = callback(
            `${callbackUri}?error=access_denied&error_description=${clientSecret}&state=${state}`
        )
        try {
            await oauth.complete({ parameters, expectedState: authorization.state })
            throw new Error('Expected refusal')
        } catch (error) {
            expect(error).toBeInstanceOf(InstagramOAuthError)
            expect((error as InstagramOAuthError).code).toBe(
                state === authorization.state ? 'access_denied' : 'invalid_callback'
            )
            expect(String(error)).not.toContain(clientSecret)
        }
    }
    expect(requests).toHaveLength(0)
})

test('missing or incomplete granted permissions never become a connection', async () => {
    for (const permissions of [
        undefined,
        '',
        'instagram_business_basic',
        'instagram_business_content_publish',
        'instagram_basic',
        'instagram_business_basic,instagram_business_read',
    ]) {
        const { oauth } = setup({
            codeExchange: () =>
                Response.json({
                    data: [
                        {
                            access_token: 'synthetic-short-token',
                            user_id: appScopedId,
                            ...(permissions === undefined ? {} : { permissions }),
                        },
                    ],
                }),
        })
        const authorization = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({ code: 'insufficient_permissions' })
    }
})

test('a personal or unknown account type is refused', async () => {
    for (const accountType of ['PERSONAL', 'Creator', '', 'unknown']) {
        const { oauth } = setup({
            profile: () =>
                Response.json({
                    data: [
                        {
                            id: appScopedId,
                            user_id: professionalId,
                            username: 'synthetic_account',
                            account_type: accountType,
                        },
                    ],
                }),
        })
        const authorization = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({ code: 'account_ineligible' })
    }
})

test('an unusable username or identifier never becomes a connection', async () => {
    for (const entry of [
        { id: appScopedId, user_id: professionalId, username: '   ', account_type: 'BUSINESS' },
        { id: appScopedId, user_id: professionalId, username: '', account_type: 'BUSINESS' },
        { id: 'not-numeric', user_id: professionalId, username: 'name', account_type: 'BUSINESS' },
        { id: appScopedId, user_id: 'not-numeric', username: 'name', account_type: 'BUSINESS' },
        { user_id: professionalId, username: 'name', account_type: 'BUSINESS' },
    ]) {
        const { oauth } = setup({
            profile: () => Response.json({ data: [entry] }),
        })
        const authorization = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({ code: 'exchange_failed' })
    }
})

test('an account that does not match the authorized identity is refused', async () => {
    const { oauth } = setup({
        profile: () =>
            Response.json({
                data: [
                    {
                        id: '17841400000009999',
                        user_id: professionalId,
                        username: 'synthetic_account',
                        account_type: 'BUSINESS',
                    },
                ],
            }),
    })
    const authorization = await oauth.createAuthorizationRequest()
    await expect(
        oauth.complete({
            parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
            expectedState: authorization.state,
        })
    ).rejects.toMatchObject({ code: 'identity_mismatch' })
})

test('a profile response describing more than one account is refused', async () => {
    const { oauth } = setup({
        profile: () =>
            Response.json({
                data: [
                    {
                        id: appScopedId,
                        user_id: professionalId,
                        username: 'first_account',
                        account_type: 'BUSINESS',
                    },
                    {
                        id: appScopedId,
                        user_id: professionalId,
                        username: 'second_account',
                        account_type: 'BUSINESS',
                    },
                ],
            }),
    })
    const authorization = await oauth.createAuthorizationRequest()
    await expect(
        oauth.complete({
            parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
            expectedState: authorization.state,
        })
    ).rejects.toMatchObject({ code: 'exchange_failed' })
})

test('malformed and ambiguous code exchange envelopes fail', async () => {
    for (const payload of [
        { data: [] },
        { data: [{ access_token: 'token' }] },
        { data: [{ user_id: appScopedId, permissions: 'scope' }] },
        { data: [{ access_token: 'token', user_id: 'not-numeric', permissions: 'scope' }] },
        {
            data: [{ access_token: 'token', user_id: appScopedId, permissions: 'scope' }],
            access_token: 'token',
        },
        {
            data: [{ access_token: 'token', user_id: appScopedId, permissions: 'scope' }],
            user_id: appScopedId,
        },
        { access_token: 'token', permissions: 'scope' },
        { user_id: appScopedId, permissions: 'scope' },
        { access_token: 'token', user_id: appScopedId, permissions: 42 },
        { data: 'not-an-array' },
    ]) {
        const { oauth } = setup({
            codeExchange: () => Response.json(payload),
        })
        const authorization = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({ code: 'exchange_failed' })
    }
})

test('the documented flat code exchange envelope is accepted', async () => {
    const { oauth } = setup({
        codeExchange: () =>
            Response.json({
                access_token: 'synthetic-short-token',
                user_id: appScopedId,
                permissions: 'instagram_business_basic,instagram_business_content_publish',
            }),
    })
    const authorization = await oauth.createAuthorizationRequest()
    const result = await oauth.complete({
        parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
        expectedState: authorization.state,
    })
    expect(result.tokens.accessToken).toBe('synthetic-long-token')
})

test('a failed token exchange exposes only a static sanitized error', async () => {
    for (const reply of [
        () => Response.json({ error: { message: clientSecret, code: 100 } }, { status: 400 }),
        () => Response.json({ data: [] }),
        () => new Response('not-json'),
        () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } }),
        () => {
            throw new Error(`Private ${clientSecret}`)
        },
    ]) {
        const { oauth, requests } = setup({ codeExchange: reply })
        const authorization = await oauth.createAuthorizationRequest()
        try {
            await oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
            throw new Error('Expected failure')
        } catch (error) {
            expect(error).toBeInstanceOf(InstagramOAuthError)
            expect((error as InstagramOAuthError).code).toBe('exchange_failed')
            expect(String(error)).not.toContain(clientSecret)
            expect((error as Error).cause).toBeUndefined()
        }
        expect(requests).toHaveLength(1)
    }
})

test('a failed long-lived exchange never returns the short-lived token', async () => {
    for (const reply of [
        () => Response.json({ error: { message: clientSecret } }, { status: 400 }),
        () => Response.json({ token_type: 'bearer', expires_in: 5183944 }),
        () => Response.json({ access_token: 'token', token_type: 'unexpected' }),
        () => Response.json({ access_token: 'token', token_type: 'bearer', expires_in: 0 }),
        () => Response.json({ access_token: 'token', token_type: 'bearer', expires_in: 'soon' }),
        () => new Response('invalid'),
        () => {
            throw new Error(clientSecret)
        },
    ]) {
        const { oauth, requests } = setup({ longLived: reply })
        const authorization = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({
            code: 'exchange_failed',
            message: 'Instagram authorization could not be completed',
        })
        expect(requests).toHaveLength(2)
    }
})

test('an absent or unusable final expiry fails closed and never becomes a connection', async () => {
    for (const expiresIn of [undefined, null, 0, -1, 1.5, 'soon', 31_536_001, {}]) {
        const { oauth, requests } = setup({
            longLived: () =>
                Response.json({
                    access_token: 'synthetic-long-token',
                    token_type: 'bearer',
                    ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
                }),
        })
        const authorization = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({ code: 'exchange_failed' })
        // The provider is asked for the token only. No profile is read, so no
        // identity and no connection can come out of an unusable lifetime.
        expect(requests).toHaveLength(2)
        expect(requests.some(request => request.url.pathname.endsWith('/me'))).toBe(false)
    }
})

test('a failed profile read never becomes a connection', async () => {
    for (const reply of [
        () => Response.json({ error: { message: clientSecret } }, { status: 400 }),
        () => Response.json({ data: [] }),
        () => new Response('not-json'),
        () => {
            throw new Error(clientSecret)
        },
    ]) {
        const { oauth, requests } = setup({ profile: reply })
        const authorization = await oauth.createAuthorizationRequest()
        await expect(
            oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({ code: 'exchange_failed' })
        expect(requests).toHaveLength(3)
    }
})

test('the Instagram configuration rejects insecure or ambiguous callback addresses', () => {
    for (const address of [
        'http://localhost/callback',
        'http://postbot.example/callback',
        `${callbackUri}?state=embedded`,
        `${callbackUri}#fragment`,
        'https://user:password@postbot.example/callback',
    ])
        expect(() =>
            createInstagramOAuth({ clientId, clientSecret, callbackUri: address })
        ).toThrow()
    expect(() =>
        createInstagramOAuth({ clientId: 'not-numeric', clientSecret, callbackUri })
    ).toThrow()
    expect(() => createInstagramOAuth({ clientId, clientSecret: ' ', callbackUri })).toThrow()
})

test('refresh refuses a token that is too young or expired', async () => {
    const issuedAt = 1_700_000_000_000
    const now = issuedAt + 25 * 60 * 60 * 1000
    const { oauth, requests } = setup({ now: () => now })
    await expect(
        oauth.refresh({
            accessToken: 'synthetic-long-token',
            issuedAt: now - 60 * 60 * 1000,
            expiresAt: now + 60 * 60 * 1000,
        })
    ).rejects.toMatchObject({ code: 'token_too_new' })
    await expect(
        oauth.refresh({
            accessToken: 'synthetic-long-token',
            issuedAt: issuedAt,
            expiresAt: now - 1000,
        })
    ).rejects.toMatchObject({ code: 'token_expired' })
    await expect(
        oauth.refresh({
            accessToken: '',
            issuedAt,
            expiresAt: now + 1000,
        })
    ).rejects.toMatchObject({ code: 'token_invalid' })
    expect(requests).toHaveLength(0)
})

test('refresh reads the documented endpoint without a secret and returns the actual token', async () => {
    const issuedAt = 1_700_000_000_000
    const now = issuedAt + 48 * 60 * 60 * 1000
    const { oauth, requests } = setup({ now: () => now })
    const refreshed = await oauth.refresh({
        accessToken: 'synthetic-long-token',
        issuedAt,
        expiresAt: now + 60 * 60 * 1000,
    })
    expect(refreshed.accessToken).toBe('synthetic-long-token')
    expect(refreshed.tokenType).toBe('bearer')
    expect(refreshed.expiresInSeconds).toBe(5183944)
    expect(refreshed.issuedAt).toBe(now)
    expect(refreshed.expiresAt).toBe(now + 5183944 * 1000)
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.url.origin).toBe('https://graph.instagram.com')
    expect(request.url.pathname).toBe('/refresh_access_token')
    expect(Object.fromEntries(request.url.searchParams)).toEqual({
        grant_type: 'ig_refresh_token',
        access_token: 'synthetic-long-token',
    })
    expect(request.url.toString()).not.toContain(clientSecret)
    expect(request.init?.method).toBe('GET')
    expect(request.init?.redirect).toBe('error')
    expect(request.init?.cache).toBe('no-store')
})

test('a failed refresh exposes only a static sanitized error', async () => {
    const issuedAt = 1_700_000_000_000
    const now = issuedAt + 48 * 60 * 60 * 1000
    for (const reply of [
        () => Response.json({ error: { message: clientSecret } }, { status: 400 }),
        () => Response.json({ token_type: 'bearer' }),
        () => new Response('not-json'),
        () => {
            throw new Error(clientSecret)
        },
    ]) {
        const { oauth } = setup({ now: () => now, longLived: reply })
        try {
            await oauth.refresh({
                accessToken: 'synthetic-long-token',
                issuedAt,
                expiresAt: now + 60 * 60 * 1000,
            })
            throw new Error('Expected failure')
        } catch (error) {
            expect(error).toBeInstanceOf(InstagramOAuthError)
            expect((error as InstagramOAuthError).code).toBe('refresh_failed')
            expect(String(error)).not.toContain(clientSecret)
        }
    }
})

test('an absent or unusable refresh expiry fails closed', async () => {
    const issuedAt = 1_700_000_000_000
    const now = issuedAt + 48 * 60 * 60 * 1000
    for (const expiresIn of [undefined, null, 0, -1, 'soon']) {
        const { oauth } = setup({
            now: () => now,
            longLived: () =>
                Response.json({
                    access_token: 'synthetic-refreshed-token',
                    token_type: 'bearer',
                    ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
                }),
        })
        await expect(
            oauth.refresh({
                accessToken: 'synthetic-long-token',
                issuedAt,
                expiresAt: now + 60 * 60 * 1000,
            })
        ).rejects.toMatchObject({ code: 'refresh_failed' })
    }
})

test('the callback artifact removal never hides the rest of the address', async () => {
    const { oauth, requests } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    const credentialed = callbackUri.replace('https://', 'https://attacker:password@')
    for (const suffix of ['', '#_']) {
        await expect(
            oauth.complete({
                parameters: callback(
                    `${credentialed}?code=code&state=${authorization.state}${suffix}`
                ),
                expectedState: authorization.state,
            })
        ).rejects.toMatchObject({ code: 'invalid_callback' })
    }
    expect(requests).toHaveLength(0)
})

test('a body that mixes a provider error with a success shape fails closed', async () => {
    const error = { error: { message: clientSecret, type: 'OAuthException', code: 190 } }
    const permissions = 'instagram_business_basic,instagram_business_content_publish'
    for (const payload of [
        {
            ...error,
            data: [{ access_token: 'token', user_id: appScopedId, permissions }],
        },
        { ...error, access_token: 'token', user_id: appScopedId, permissions },
        {
            data: [{ ...error, access_token: 'token', user_id: appScopedId, permissions }],
        },
    ]) {
        const { oauth, requests } = setup({ codeExchange: () => Response.json(payload) })
        const authorization = await oauth.createAuthorizationRequest()
        try {
            await oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
            throw new Error('Expected failure')
        } catch (failure) {
            expect(failure).toBeInstanceOf(InstagramOAuthError)
            expect((failure as InstagramOAuthError).code).toBe('exchange_failed')
            expect(String(failure)).not.toContain(clientSecret)
        }
        // No token and no profile request follow an ambiguous exchange body.
        expect(requests).toHaveLength(1)
    }
    for (const payload of [
        {
            ...error,
            data: [
                {
                    id: appScopedId,
                    user_id: professionalId,
                    username: 'synthetic_account',
                    account_type: 'BUSINESS',
                },
            ],
        },
        {
            data: [
                {
                    ...error,
                    id: appScopedId,
                    user_id: professionalId,
                    username: 'synthetic_account',
                    account_type: 'BUSINESS',
                },
            ],
        },
    ]) {
        const { oauth, requests } = setup({ profile: () => Response.json(payload) })
        const authorization = await oauth.createAuthorizationRequest()
        try {
            await oauth.complete({
                parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
                expectedState: authorization.state,
            })
            throw new Error('Expected failure')
        } catch (failure) {
            expect(failure).toBeInstanceOf(InstagramOAuthError)
            expect((failure as InstagramOAuthError).code).toBe('exchange_failed')
            expect(String(failure)).not.toContain(clientSecret)
        }
        // The profile was read but no identity came out of it.
        expect(requests).toHaveLength(3)
    }
})

test('refresh refuses corrupt metadata before any request', async () => {
    const issuedAt = 1_700_000_000_000
    const now = issuedAt + 48 * 60 * 60 * 1000
    const { oauth, requests } = setup({ now: () => now })
    for (const metadata of [
        { issuedAt: -1, expiresAt: now + 60 * 60 * 1000 },
        { issuedAt, expiresAt: issuedAt },
        { issuedAt, expiresAt: issuedAt - 1 },
    ])
        await expect(
            oauth.refresh({ accessToken: 'synthetic-long-token', ...metadata })
        ).rejects.toMatchObject({ code: 'token_invalid' })
    expect(requests).toHaveLength(0)
})

test('no authorization or refresh request publishes anything', async () => {
    const { oauth, requests } = setup()
    const authorization = await oauth.createAuthorizationRequest()
    await oauth.complete({
        parameters: callback(`${callbackUri}?code=code&state=${authorization.state}`),
        expectedState: authorization.state,
    })
    for (const request of requests) {
        expect(request.url.pathname).not.toContain('/media')
        expect(request.url.pathname).not.toContain('/media_publish')
        expect(request.url.pathname).not.toContain('/comments')
    }
    expect(requests.filter(request => request.url.pathname === '/media_publish')).toHaveLength(0)
})
