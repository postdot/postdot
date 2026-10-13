import { describe, expect, it } from 'bun:test'

import {
    clientSecretPost,
    createAuthorizationRequest,
    digestAuthorizationState,
    exchangeAuthorizationCode,
    refreshAccessToken,
    validateAuthorizationResponse,
    validateReturnPath,
    isAuthorizationDeniedError,
    type OAuthAuthorizationServer,
} from './index'

const authorizationServer: OAuthAuthorizationServer = {
    issuer: 'https://provider.example.com',
    authorizationEndpoint: 'https://provider.example.com/oauth/authorize',
    tokenEndpoint: 'https://provider.example.com/oauth/token',
}

describe('OAuth authorization code mechanics', () => {
    it('builds a PKCE S256 request without exposing the verifier', async () => {
        const request = await createAuthorizationRequest({
            authorizationServer,
            clientId: 'client-1',
            callbackUri: 'https://postbot.example.com/api/oauth/linkedin/callback',
            scopes: ['w_member_social', 'openid', 'w_member_social'],
            additionalParameters: { prompt: 'consent' },
        })

        expect(request.url.origin).toBe('https://provider.example.com')
        expect(request.url.pathname).toBe('/oauth/authorize')
        expect(request.url.searchParams.get('response_type')).toBe('code')
        expect(request.url.searchParams.get('client_id')).toBe('client-1')
        expect(request.url.searchParams.get('redirect_uri')).toBe(request.callbackUri)
        expect(request.url.searchParams.get('scope')).toBe('openid w_member_social')
        expect(request.url.searchParams.get('state')).toBe(request.state)
        expect(request.url.searchParams.get('code_challenge_method')).toBe('S256')
        expect(request.url.searchParams.get('code_challenge')).not.toBe(request.codeVerifier)
        expect(request.url.href).not.toContain(request.codeVerifier)
        expect(request.url.searchParams.get('prompt')).toBe('consent')
        expect(request.state.length).toBeGreaterThanOrEqual(32)
        expect(request.codeVerifier).not.toBeNull()
        expect(request.codeVerifier?.length).toBeGreaterThanOrEqual(43)
    })

    it('allows a provider to explicitly use its non-PKCE authorization flow', async () => {
        const request = await createAuthorizationRequest({
            authorizationServer: { ...authorizationServer, pkce: 'disabled' },
            clientId: 'client-1',
            callbackUri: 'https://postbot.example.com/api/oauth/linkedin/callback',
            scopes: ['openid'],
        })

        expect(request.codeVerifier).toBeNull()
        expect(request.url.searchParams.get('code_challenge')).toBeNull()
        expect(request.url.searchParams.get('code_challenge_method')).toBeNull()
    })

    it('rejects insecure endpoints and protected parameter overrides', async () => {
        await expect(
            createAuthorizationRequest({
                authorizationServer: {
                    ...authorizationServer,
                    authorizationEndpoint: 'http://provider.example.com/oauth/authorize',
                },
                clientId: 'client-1',
                callbackUri: 'https://postbot.example.com/callback',
                scopes: [],
            })
        ).rejects.toThrow('authorizationEndpoint must use HTTPS')
        await expect(
            createAuthorizationRequest({
                authorizationServer,
                clientId: 'client-1',
                callbackUri: 'https://postbot.example.com/callback',
                scopes: [],
                additionalParameters: { state: 'attacker-controlled' },
            })
        ).rejects.toThrow('must not override state')
    })

    it('validates state and authorization-server issuer responses', async () => {
        const request = await createAuthorizationRequest({
            authorizationServer,
            clientId: 'client-1',
            callbackUri: 'https://postbot.example.com/callback',
            scopes: ['openid'],
        })
        const valid = new URLSearchParams({
            code: 'authorization-code',
            state: request.state,
            iss: authorizationServer.issuer,
        })

        expect(
            validateAuthorizationResponse({
                authorizationServer,
                clientId: 'client-1',
                parameters: valid,
                expectedState: request.state,
            }).get('code')
        ).toBe('authorization-code')
        expect(() =>
            validateAuthorizationResponse({
                authorizationServer,
                clientId: 'client-1',
                parameters: valid,
                expectedState: 'wrong-state',
            })
        ).toThrow()
        expect(() =>
            validateAuthorizationResponse({
                authorizationServer,
                clientId: 'client-1',
                parameters: new URLSearchParams({
                    code: 'authorization-code',
                    state: request.state,
                    iss: 'https://attacker.example.com',
                }),
                expectedState: request.state,
            })
        ).toThrow()
    })

    it('distinguishes an explicit authorization refusal from other callback failures', async () => {
        const request = await createAuthorizationRequest({
            authorizationServer,
            clientId: 'client-1',
            callbackUri: 'https://postbot.example.com/callback',
            scopes: ['openid'],
        })

        let deniedError: unknown
        try {
            validateAuthorizationResponse({
                authorizationServer,
                clientId: 'client-1',
                parameters: new URLSearchParams({
                    error: 'access_denied',
                    error_description: 'The user declined access',
                    state: request.state,
                }),
                expectedState: request.state,
            })
        } catch (error) {
            deniedError = error
        }

        expect(isAuthorizationDeniedError(deniedError)).toBe(true)
        expect(
            isAuthorizationDeniedError(
                Object.assign(new Error('OAuth callback error'), {
                    params: new URLSearchParams({ error: 'access_denied' }),
                })
            )
        ).toBe(true)

        let providerError: unknown
        try {
            validateAuthorizationResponse({
                authorizationServer,
                clientId: 'client-1',
                parameters: new URLSearchParams({
                    error: 'temporarily_unavailable',
                    state: request.state,
                }),
                expectedState: request.state,
            })
        } catch (error) {
            providerError = error
        }

        expect(isAuthorizationDeniedError(providerError)).toBe(false)
        expect(isAuthorizationDeniedError(new Error('network failure'))).toBe(false)
    })

    it('exchanges a validated code with client-secret-post against a fake provider', async () => {
        let requestBody: URLSearchParams | undefined
        const server = Bun.serve({
            port: 0,
            async fetch(request) {
                requestBody = new URLSearchParams(await request.text())
                return Response.json(
                    {
                        access_token: 'provider-access-token',
                        refresh_token: 'provider-refresh-token',
                        expires_in: 3600,
                        scope: 'w_member_social openid',
                        token_type: 'Bearer',
                    },
                    {
                        headers: {
                            'cache-control': 'no-store',
                            pragma: 'no-cache',
                        },
                    }
                )
            },
        })

        try {
            const origin = server.url.origin
            const localServer = {
                issuer: origin,
                authorizationEndpoint: `${origin}/authorize`,
                tokenEndpoint: `${origin}/token`,
            }
            const authorization = await createAuthorizationRequest({
                authorizationServer: localServer,
                clientId: 'client-1',
                callbackUri: 'http://127.0.0.1:3000/api/oauth/linkedin/callback',
                scopes: ['openid', 'w_member_social'],
            })
            const callbackParameters = validateAuthorizationResponse({
                authorizationServer: localServer,
                clientId: 'client-1',
                parameters: new URLSearchParams({
                    code: 'authorization-code',
                    state: authorization.state,
                }),
                expectedState: authorization.state,
            })
            const tokenSet = await exchangeAuthorizationCode({
                authorizationServer: localServer,
                clientId: 'client-1',
                clientAuthentication: clientSecretPost('client-secret'),
                callbackParameters,
                callbackUri: authorization.callbackUri,
                codeVerifier: authorization.codeVerifier,
            })

            expect(tokenSet).toEqual({
                accessToken: 'provider-access-token',
                refreshToken: 'provider-refresh-token',
                expiresInSeconds: 3600,
                scopes: ['openid', 'w_member_social'],
                tokenType: 'bearer',
            })
            expect(requestBody?.get('grant_type')).toBe('authorization_code')
            expect(requestBody?.get('code')).toBe('authorization-code')
            expect(requestBody?.get('redirect_uri')).toBe(authorization.callbackUri)
            expect(requestBody?.get('code_verifier')).toBe(authorization.codeVerifier)
            expect(requestBody?.get('client_id')).toBe('client-1')
            expect(requestBody?.get('client_secret')).toBe('client-secret')
        } finally {
            server.stop(true)
        }
    })

    it('uses the injected fetcher for authorization-code token requests', async () => {
        let calls = 0
        const authorization = await createAuthorizationRequest({
            authorizationServer,
            clientId: 'client-1',
            callbackUri: 'http://127.0.0.1:3000/api/oauth/callback',
            scopes: ['openid'],
        })
        const callbackParameters = validateAuthorizationResponse({
            authorizationServer,
            clientId: 'client-1',
            parameters: new URLSearchParams({
                code: 'authorization-code',
                state: authorization.state,
            }),
            expectedState: authorization.state,
        })

        const tokenSet = await exchangeAuthorizationCode({
            authorizationServer,
            clientId: 'client-1',
            clientAuthentication: clientSecretPost('client-secret'),
            callbackParameters,
            callbackUri: authorization.callbackUri,
            codeVerifier: authorization.codeVerifier,
            fetcher: async (input, init) => {
                calls += 1
                expect(input).toBe('https://provider.example.com/oauth/token')
                expect(init?.method).toBe('POST')
                expect(init?.redirect).toBe('manual')
                expect(init?.body).toBeInstanceOf(URLSearchParams)
                return Response.json({
                    access_token: 'controlled-access-token',
                    token_type: 'Bearer',
                })
            },
        })

        expect(calls).toBe(1)
        expect(tokenSet.accessToken).toBe('controlled-access-token')
    })

    it('digests state and only accepts allowlisted local return paths', async () => {
        const first = await digestAuthorizationState('state-1')
        const repeated = await digestAuthorizationState('state-1')
        const second = await digestAuthorizationState('state-2')
        const spaced = await digestAuthorizationState(' state-1')

        expect(first).toHaveLength(32)
        expect(first).toEqual(repeated)
        expect(first).not.toEqual(second)
        expect(first).not.toEqual(spaced)
        expect(validateReturnPath('/projects/one/publications?status=draft', ['/projects'])).toBe(
            '/projects/one/publications?status=draft'
        )
        expect(validateReturnPath('/about', ['/'])).toBe('/about')
        expect(() => validateReturnPath('//attacker.example.com', ['/projects'])).toThrow()
        expect(() => validateReturnPath('/projects-evil', ['/projects'])).toThrow()
        expect(() => validateReturnPath('/projects%2f..%2fadmin', ['/projects'])).toThrow()
        expect(() => validateReturnPath('/projects/one#redirect', ['/projects'])).toThrow()
    })

    it('refreshes an access token with client-secret-post and normalizes the response', async () => {
        let requestBody: URLSearchParams | undefined
        const server = Bun.serve({
            port: 0,
            async fetch(request) {
                requestBody = new URLSearchParams(await request.text())
                return Response.json({
                    access_token: 'refreshed-access-token',
                    refresh_token: 'rotated-refresh-token',
                    expires_in: 1800,
                    scope: 'openid w_member_social',
                    token_type: 'Bearer',
                })
            },
        })

        try {
            const origin = server.url.origin
            const tokenSet = await refreshAccessToken({
                authorizationServer: {
                    issuer: origin,
                    authorizationEndpoint: `${origin}/authorize`,
                    tokenEndpoint: `${origin}/token`,
                },
                clientId: 'client-1',
                clientAuthentication: clientSecretPost('client-secret'),
                refreshToken: 'current-refresh-token',
            })

            expect(tokenSet).toEqual({
                accessToken: 'refreshed-access-token',
                refreshToken: 'rotated-refresh-token',
                expiresInSeconds: 1800,
                scopes: ['openid', 'w_member_social'],
                tokenType: 'bearer',
            })
            expect(requestBody?.get('grant_type')).toBe('refresh_token')
            expect(requestBody?.get('refresh_token')).toBe('current-refresh-token')
            expect(requestBody?.get('client_id')).toBe('client-1')
            expect(requestBody?.get('client_secret')).toBe('client-secret')
        } finally {
            server.stop(true)
        }
    })

    it('uses the injected fetcher for refresh-token requests', async () => {
        let calls = 0
        const tokenSet = await refreshAccessToken({
            authorizationServer,
            clientId: 'client-1',
            clientAuthentication: clientSecretPost('client-secret'),
            refreshToken: 'current-refresh-token',
            fetcher: async (input, init) => {
                calls += 1
                expect(input).toBe('https://provider.example.com/oauth/token')
                expect(init?.method).toBe('POST')
                expect(init?.redirect).toBe('manual')
                expect(init?.body).toBeInstanceOf(URLSearchParams)
                return Response.json({
                    access_token: 'controlled-refreshed-access-token',
                    token_type: 'Bearer',
                })
            },
        })

        expect(calls).toBe(1)
        expect(tokenSet.accessToken).toBe('controlled-refreshed-access-token')
    })
})
