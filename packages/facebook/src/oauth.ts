import {
    clientSecretPost,
    createAuthorizationRequest,
    exchangeAuthorizationCode,
    validateAuthorizationResponse,
    type OAuthAuthorizationServer,
    type OAuthTokenSet,
} from '@postdot/oauth'

import {
    FACEBOOK_GRAPH_VERSION,
    FACEBOOK_PUBLISH_PERMISSIONS,
    type FacebookFetcher,
} from './publisher'

const tokenEndpoint = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`
const server: OAuthAuthorizationServer = {
    issuer: 'https://www.facebook.com',
    authorizationEndpoint: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
    tokenEndpoint,
    // Meta's documented confidential web flow uses a server secret and state.
    // This does not claim that Meta rejects every possible PKCE integration.
    pkce: 'disabled',
}

const maximumExpiresInSeconds = 31_536_000

type Expiration =
    | { readonly kind: 'known'; readonly seconds: number }
    | { readonly kind: 'unknown' }
    | { readonly kind: 'invalid' }

/**
 * Only the absence of `expires_in` on the final exchange is an unknown
 * lifetime. A present value, JSON null included, must satisfy the bounds.
 */
function readExpiration(result: Record<string, unknown>): Expiration {
    if (!Object.hasOwn(result, 'expires_in')) return { kind: 'unknown' }
    const value = result.expires_in
    if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        value > maximumExpiresInSeconds
    )
        return { kind: 'invalid' }
    return { kind: 'known', seconds: value }
}

export class FacebookOAuthError extends Error {
    constructor(readonly code: 'invalid_callback' | 'access_denied' | 'exchange_failed') {
        super(
            code === 'access_denied'
                ? 'Facebook authorization was declined'
                : 'Facebook authorization could not be completed'
        )
        this.name = 'FacebookOAuthError'
    }
}

export function createFacebookOAuth(options: {
    readonly clientId: string
    readonly clientSecret: string
    readonly callbackUri: string
    readonly fetcher?: FacebookFetcher
}) {
    if (!/^[1-9]\d*$/.test(options.clientId) || !/^[\x21-\x7e]{1,4096}$/.test(options.clientSecret))
        throw new Error('Facebook application configuration is invalid')
    const callback = new URL(options.callbackUri)
    if (
        callback.protocol !== 'https:' ||
        callback.username ||
        callback.password ||
        callback.hash ||
        callback.search
    )
        throw new Error('Facebook callback must be an exact HTTPS URL without query or fragment')
    const fetcher = options.fetcher ?? fetch
    return {
        clientId: options.clientId,
        callbackUri: options.callbackUri,
        createAuthorizationRequest() {
            return createAuthorizationRequest({
                authorizationServer: server,
                clientId: options.clientId,
                callbackUri: options.callbackUri,
                scopes: FACEBOOK_PUBLISH_PERMISSIONS,
            })
        },
        async complete(input: {
            readonly parameters: URL
            readonly expectedState: string
        }): Promise<OAuthTokenSet> {
            if (
                input.parameters.origin !== callback.origin ||
                input.parameters.pathname !== callback.pathname ||
                input.parameters.hash ||
                input.parameters.username ||
                input.parameters.password
            )
                throw new FacebookOAuthError('invalid_callback')
            let parameters: URLSearchParams
            try {
                parameters = validateAuthorizationResponse({
                    authorizationServer: server,
                    clientId: options.clientId,
                    parameters: input.parameters,
                    expectedState: input.expectedState,
                })
            } catch {
                // A refusal is classified only after checking the exact returned state.
                if (
                    input.parameters.searchParams.getAll('state').length === 1 &&
                    input.parameters.searchParams.get('state') === input.expectedState &&
                    input.parameters.searchParams.get('error') === 'access_denied'
                )
                    throw new FacebookOAuthError('access_denied')
                throw new FacebookOAuthError('invalid_callback')
            }
            if (parameters.getAll('code').length !== 1 || !parameters.get('code')?.trim())
                throw new FacebookOAuthError('invalid_callback')
            try {
                const tokenSet = await exchangeAuthorizationCode({
                    authorizationServer: server,
                    clientId: options.clientId,
                    clientAuthentication: clientSecretPost(options.clientSecret),
                    callbackParameters: parameters,
                    callbackUri: options.callbackUri,
                    codeVerifier: null,
                    signal: AbortSignal.timeout(30_000),
                    fetcher: async (url, init) => {
                        // Keep standards-library callback/token validation; adapt only Meta's transport.
                        if (
                            String(url) !== tokenEndpoint ||
                            init?.method !== 'POST' ||
                            !(typeof init.body === 'string' || init.body instanceof URLSearchParams)
                        )
                            throw new FacebookOAuthError('exchange_failed')
                        const body = new URLSearchParams(init.body)
                        const target = new URL(tokenEndpoint)
                        for (const field of [
                            'client_id',
                            'client_secret',
                            'code',
                            'redirect_uri',
                        ]) {
                            const value = body.get(field)
                            if (!value) throw new FacebookOAuthError('exchange_failed')
                            target.searchParams.set(field, value)
                        }
                        // The fixed Meta endpoint requires these query parameters. Never log this URL.
                        return fetcher(target, {
                            method: 'GET',
                            redirect: 'error',
                            cache: 'no-store',
                            signal: init.signal,
                            headers: { accept: 'application/json' },
                        })
                    },
                })
                if (tokenSet.tokenType.toLowerCase() !== 'bearer')
                    throw new FacebookOAuthError('exchange_failed')
                const target = new URL(tokenEndpoint)
                target.search = new URLSearchParams({
                    grant_type: 'fb_exchange_token',
                    client_id: options.clientId,
                    client_secret: options.clientSecret,
                    fb_exchange_token: tokenSet.accessToken,
                }).toString()
                const response = await fetcher(target, {
                    method: 'GET',
                    redirect: 'error',
                    cache: 'no-store',
                    signal: AbortSignal.timeout(30_000),
                    headers: { accept: 'application/json' },
                })
                const value: unknown = await response.json()
                if (!response.ok || !value || typeof value !== 'object' || Array.isArray(value))
                    throw new FacebookOAuthError('exchange_failed')
                const result = value as Record<string, unknown>
                const expiration = readExpiration(result)
                if (
                    typeof result.access_token !== 'string' ||
                    !/^[\x21-\x7e]{1,4096}$/.test(result.access_token) ||
                    typeof result.token_type !== 'string' ||
                    result.token_type.toLowerCase() !== 'bearer' ||
                    expiration.kind === 'invalid' ||
                    Object.hasOwn(result, 'error')
                )
                    throw new FacebookOAuthError('exchange_failed')
                return {
                    ...tokenSet,
                    // The final exchange alone supplies the token and its lifetime.
                    accessToken: result.access_token,
                    expiresInSeconds: expiration.kind === 'known' ? expiration.seconds : null,
                }
            } catch {
                throw new FacebookOAuthError('exchange_failed')
            }
        },
    }
}
