import * as oauth from 'oauth4webapi'

export interface OAuthAuthorizationServer {
    readonly issuer: string
    readonly authorizationEndpoint: string
    readonly tokenEndpoint: string
    /**
     * Provider-specific PKCE policy. PKCE is enabled by default; disable it only
     * when the provider's selected authorization flow does not support it.
     */
    readonly pkce?: 'required' | 'disabled'
}

export interface CreateAuthorizationRequestInput {
    readonly authorizationServer: OAuthAuthorizationServer
    readonly clientId: string
    readonly callbackUri: string
    readonly scopes: readonly string[]
    readonly additionalParameters?: Readonly<Record<string, string>>
}

export interface AuthorizationRequest {
    readonly url: URL
    readonly state: string
    readonly codeVerifier: string | null
    readonly callbackUri: string
    readonly scopes: readonly string[]
}

export interface ValidateAuthorizationResponseInput {
    readonly authorizationServer: OAuthAuthorizationServer
    readonly clientId: string
    readonly parameters: URL | URLSearchParams
    readonly expectedState: string
}

export interface ExchangeAuthorizationCodeInput {
    readonly authorizationServer: OAuthAuthorizationServer
    readonly clientId: string
    readonly clientAuthentication: OAuthClientAuthentication
    readonly callbackParameters: URLSearchParams
    readonly callbackUri: string
    readonly codeVerifier: string | null
    readonly signal?: AbortSignal
    readonly fetcher?: OAuthFetcher
}

export interface RefreshAccessTokenInput {
    readonly authorizationServer: OAuthAuthorizationServer
    readonly clientId: string
    readonly clientAuthentication: OAuthClientAuthentication
    readonly refreshToken: string
    readonly signal?: AbortSignal
    readonly fetcher?: OAuthFetcher
}

export type OAuthFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface OAuthTokenSet {
    readonly accessToken: string
    readonly refreshToken: string | null
    readonly expiresInSeconds: number | null
    readonly scopes: readonly string[] | null
    readonly tokenType: string
}

export type OAuthClientAuthentication = oauth.ClientAuth

const protectedAuthorizationParameters = new Set([
    'client_id',
    'code_challenge',
    'code_challenge_method',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
])

function requireNonBlank(value: string, field: string): string {
    const normalized = value.trim()
    if (normalized.length === 0) throw new Error(`${field} must not be blank`)
    return normalized
}

function requireOpaque(value: string, field: string): string {
    if (value.length === 0) throw new Error(`${field} must not be empty`)
    return value
}

function isLoopback(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function secureUrl(value: string, field: string, allowLoopbackHttp: boolean): URL {
    const exactValue = requireOpaque(value, field)
    if (exactValue !== exactValue.trim()) throw new Error(`${field} must not contain outer spaces`)
    const url = new URL(exactValue)
    const allowed =
        url.protocol === 'https:' ||
        (allowLoopbackHttp && url.protocol === 'http:' && isLoopback(url.hostname))
    if (!allowed || url.username.length > 0 || url.password.length > 0) {
        throw new Error(`${field} must use HTTPS or an HTTP loopback address`)
    }
    return url
}

function normalizeScopes(scopes: readonly string[]): readonly string[] {
    return [...new Set(scopes.map(scope => requireNonBlank(scope, 'scope')))].sort()
}

function authorizationServerMetadata(input: OAuthAuthorizationServer): oauth.AuthorizationServer {
    const issuer = requireOpaque(input.issuer, 'issuer')
    secureUrl(issuer, 'issuer', true)

    return {
        issuer,
        authorization_endpoint: secureUrl(
            input.authorizationEndpoint,
            'authorizationEndpoint',
            true
        ).href,
        token_endpoint: secureUrl(input.tokenEndpoint, 'tokenEndpoint', true).href,
    }
}

function clientMetadata(clientId: string): oauth.Client {
    return { client_id: requireOpaque(clientId, 'clientId') }
}

function allowsInsecureLocalTransport(input: OAuthAuthorizationServer): boolean {
    return new URL(input.tokenEndpoint).protocol === 'http:'
}

export async function createAuthorizationRequest(
    input: CreateAuthorizationRequestInput
): Promise<AuthorizationRequest> {
    const metadata = authorizationServerMetadata(input.authorizationServer)
    const authorizationEndpoint = new URL(metadata.authorization_endpoint as string)
    const clientId = requireOpaque(input.clientId, 'clientId')
    const callbackUri = secureUrl(input.callbackUri, 'callbackUri', true).href
    const scopes = normalizeScopes(input.scopes)
    const state = oauth.generateRandomState()
    const usesPkce = input.authorizationServer.pkce !== 'disabled'
    const codeVerifier = usesPkce ? oauth.generateRandomCodeVerifier() : null
    const codeChallenge =
        codeVerifier === null ? null : await oauth.calculatePKCECodeChallenge(codeVerifier)

    for (const [name, value] of Object.entries(input.additionalParameters ?? {})) {
        if (protectedAuthorizationParameters.has(name)) {
            throw new Error(`additionalParameters must not override ${name}`)
        }
        authorizationEndpoint.searchParams.set(
            requireNonBlank(name, 'additional parameter name'),
            requireOpaque(value, `additional parameter ${name}`)
        )
    }

    authorizationEndpoint.searchParams.set('response_type', 'code')
    authorizationEndpoint.searchParams.set('client_id', clientId)
    authorizationEndpoint.searchParams.set('redirect_uri', callbackUri)
    authorizationEndpoint.searchParams.set('scope', scopes.join(' '))
    authorizationEndpoint.searchParams.set('state', state)
    if (codeChallenge !== null) {
        authorizationEndpoint.searchParams.set('code_challenge', codeChallenge)
        authorizationEndpoint.searchParams.set('code_challenge_method', 'S256')
    }

    return { url: authorizationEndpoint, state, codeVerifier, callbackUri, scopes }
}

export function validateAuthorizationResponse(
    input: ValidateAuthorizationResponseInput
): URLSearchParams {
    return oauth.validateAuthResponse(
        authorizationServerMetadata(input.authorizationServer),
        clientMetadata(input.clientId),
        input.parameters,
        requireOpaque(input.expectedState, 'expectedState')
    )
}

/**
 * Detect an explicit authorization refusal without treating it as a provider outage.
 *
 * The standard OAuth adapter exposes the response as AuthorizationResponseError. Provider
 * adapters may wrap the same callback parameters in their own error type, so preserve the
 * classification through a small structural fallback as well.
 */
export function isAuthorizationDeniedError(error: unknown): boolean {
    if (error instanceof oauth.AuthorizationResponseError) {
        return error.error === 'access_denied'
    }

    if (!(error instanceof Error)) return false
    const parameters = (error as { readonly params?: unknown }).params
    return parameters instanceof URLSearchParams && parameters.get('error') === 'access_denied'
}

export async function exchangeAuthorizationCode(
    input: ExchangeAuthorizationCodeInput
): Promise<OAuthTokenSet> {
    const metadata = authorizationServerMetadata(input.authorizationServer)
    const client = clientMetadata(input.clientId)
    const callbackUri = secureUrl(input.callbackUri, 'callbackUri', true).href
    const options = tokenEndpointRequestOptions(input)
    const response = await oauth.authorizationCodeGrantRequest(
        metadata,
        client,
        input.clientAuthentication,
        input.callbackParameters,
        callbackUri,
        input.codeVerifier === null
            ? oauth.nopkce
            : requireOpaque(input.codeVerifier, 'codeVerifier'),
        options
    )
    return toTokenSet(await oauth.processAuthorizationCodeResponse(metadata, client, response))
}

export async function refreshAccessToken(input: RefreshAccessTokenInput): Promise<OAuthTokenSet> {
    const metadata = authorizationServerMetadata(input.authorizationServer)
    const client = clientMetadata(input.clientId)
    const refreshToken = requireOpaque(input.refreshToken, 'refreshToken')
    const response = await oauth.refreshTokenGrantRequest(
        metadata,
        client,
        input.clientAuthentication,
        refreshToken,
        tokenEndpointRequestOptions(input)
    )

    return toTokenSet(await oauth.processRefreshTokenResponse(metadata, client, response))
}

function tokenEndpointRequestOptions(input: {
    readonly authorizationServer: OAuthAuthorizationServer
    readonly signal?: AbortSignal
    readonly fetcher?: OAuthFetcher
}): oauth.TokenEndpointRequestOptions {
    const options: oauth.TokenEndpointRequestOptions = {
        signal: input.signal,
        [oauth.allowInsecureRequests]: allowsInsecureLocalTransport(input.authorizationServer),
    }
    if (input.fetcher !== undefined) {
        options[oauth.customFetch] = (url, requestOptions) =>
            input.fetcher!(url, requestOptions as RequestInit)
    }
    return options
}

export function clientSecretPost(clientSecret: string): OAuthClientAuthentication {
    return oauth.ClientSecretPost(requireOpaque(clientSecret, 'clientSecret'))
}

export function clientSecretBasic(clientSecret: string): OAuthClientAuthentication {
    return oauth.ClientSecretBasic(requireOpaque(clientSecret, 'clientSecret'))
}

function toTokenSet(tokenSet: oauth.TokenEndpointResponse): OAuthTokenSet {
    return {
        accessToken: tokenSet.access_token,
        refreshToken: tokenSet.refresh_token ?? null,
        expiresInSeconds: tokenSet.expires_in ?? null,
        scopes:
            tokenSet.scope === undefined
                ? null
                : normalizeScopes(tokenSet.scope.split(' ').filter(Boolean)),
        tokenType: tokenSet.token_type,
    }
}

export async function digestAuthorizationState(state: string): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(requireOpaque(state, 'state'))
    )
    return new Uint8Array(digest)
}

function hasControlCharacters(value: string): boolean {
    return [...value].some(character => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127
    })
}

export function validateReturnPath(returnPath: string, allowedPrefixes: readonly string[]): string {
    if (
        !returnPath.startsWith('/') ||
        returnPath.startsWith('//') ||
        returnPath.includes('\\') ||
        hasControlCharacters(returnPath) ||
        /%(?:2f|5c)/i.test(returnPath)
    ) {
        throw new Error('returnPath must be a local application path')
    }

    const base = new URL('https://herald.invalid')
    const parsed = new URL(returnPath, base)
    if (parsed.origin !== base.origin || parsed.hash.length > 0) {
        throw new Error('returnPath must be a local application path without a fragment')
    }

    const prefixes = allowedPrefixes.map(prefix => {
        const normalized = requireNonBlank(prefix, 'allowed return path prefix')
        if (!normalized.startsWith('/') || normalized.startsWith('//')) {
            throw new Error('Allowed return path prefixes must be local absolute paths')
        }
        return normalized.length > 1 && normalized.endsWith('/')
            ? normalized.slice(0, -1)
            : normalized
    })
    const allowed = prefixes.some(
        prefix =>
            prefix === '/' || parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    )
    if (!allowed) throw new Error('returnPath is not allowlisted')

    return `${parsed.pathname}${parsed.search}`
}
