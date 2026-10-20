import {
    clientSecretPost,
    createAuthorizationRequest,
    exchangeAuthorizationCode,
    validateAuthorizationResponse,
    type OAuthAuthorizationServer,
    type OAuthTokenSet,
} from '@postbot/oauth'

import {
    INSTAGRAM_GRAPH_ORIGIN,
    INSTAGRAM_GRAPH_VERSION,
    INSTAGRAM_PUBLISH_PERMISSIONS,
    type InstagramFetcher,
} from './publisher'

/** The documented Instagram Login hosts are fixed and are never provider supplied. */
const authorizationEndpoint = 'https://www.instagram.com/oauth/authorize'
const tokenEndpoint = 'https://api.instagram.com/oauth/access_token'
const longLivedTokenEndpoint = `${INSTAGRAM_GRAPH_ORIGIN}/access_token`
const refreshTokenEndpoint = `${INSTAGRAM_GRAPH_ORIGIN}/refresh_access_token`
const meEndpoint = `${INSTAGRAM_GRAPH_ORIGIN}/${INSTAGRAM_GRAPH_VERSION}/me`

const server: OAuthAuthorizationServer = {
    issuer: 'https://www.instagram.com',
    authorizationEndpoint,
    tokenEndpoint,
    // The documented confidential Instagram Login flow does not document PKCE
    // parameters. This deviation is local to that flow and does not claim that
    // every Instagram flow rejects PKCE.
    pkce: 'disabled',
}

const requestTimeoutMs = 30_000
/** A provider lifetime beyond one year is not credible and is refused. */
const maximumExpiresInSeconds = 31_536_000
/** The provider refreshes a long-lived token only once it is at least a day old. */
const minimumRefreshAgeMs = 24 * 60 * 60 * 1000

export type InstagramOAuthErrorCode =
    | 'invalid_callback'
    | 'access_denied'
    | 'exchange_failed'
    | 'insufficient_permissions'
    | 'identity_mismatch'
    | 'account_ineligible'
    | 'token_invalid'
    | 'token_expired'
    | 'token_too_new'
    | 'refresh_failed'

export class InstagramOAuthError extends Error {
    constructor(readonly code: InstagramOAuthErrorCode) {
        super(
            code === 'access_denied'
                ? 'Instagram authorization was declined'
                : code === 'token_expired' ||
                    code === 'token_too_new' ||
                    code === 'token_invalid' ||
                    code === 'refresh_failed'
                  ? 'Instagram token refresh could not be completed'
                  : 'Instagram authorization could not be completed'
        )
        this.name = 'InstagramOAuthError'
    }
}

export type InstagramAccountType = 'BUSINESS' | 'MEDIA_CREATOR'

export interface InstagramAccount {
    /**
     * The professional account publishing identifier. Graph media endpoints
     * address this identifier, not the app-scoped one.
     */
    readonly id: string
    /**
     * The app-scoped identifier of the same user. It identifies the app's view
     * of the user and is never a publishing identifier.
     */
    readonly appScopedId: string
    readonly username: string
    readonly accountType: InstagramAccountType
}

export interface InstagramOAuthResult {
    readonly tokens: OAuthTokenSet
    readonly account: InstagramAccount
}

export interface InstagramRefreshedToken {
    readonly accessToken: string
    readonly tokenType: 'bearer'
    /** The provider's actual lifetime. A durable credential always has one. */
    readonly expiresInSeconds: number
    readonly expiresAt: number
    readonly issuedAt: number
}

interface CodeExchange {
    readonly accessToken: string
    readonly userId: string
    readonly permissions: readonly string[]
}

interface LongLivedToken {
    readonly accessToken: string
    readonly expiresInSeconds: number
}

type AccountRead =
    | { readonly kind: 'ok'; readonly account: InstagramAccount }
    | { readonly kind: 'mismatch' }
    | { readonly kind: 'ineligible' }
    | { readonly kind: 'invalid' }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validToken(value: unknown): value is string {
    return typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value)
}

function numericId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9]\d{0,63}$/.test(value)
}

/**
 * A durable Instagram credential needs a known lifetime, so an absent, null,
 * zero, negative or malformed `expires_in` is a failure. It is never a default
 * and never an accepted absence.
 */
function readRequiredExpiration(result: Record<string, unknown>): number | null {
    if (!Object.hasOwn(result, 'expires_in')) return null
    const value = result.expires_in
    const seconds =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && /^\d+$/.test(value)
              ? Number(value)
              : Number.NaN
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > maximumExpiresInSeconds)
        return null
    return seconds
}

/**
 * A provider error marker makes an envelope ambiguous even when the body also
 * carries a success shape. Such a body is refused instead of half accepted.
 */
function carriesProviderError(value: Record<string, unknown>): boolean {
    return Object.hasOwn(value, 'error') || Object.hasOwn(value, 'errors')
}

/** The documented professional account types, spelled as the provider spells them. */
const accountTypes = new Map<string, InstagramAccountType>([
    ['business', 'BUSINESS'],
    ['media_creator', 'MEDIA_CREATOR'],
])

function readAccountType(value: unknown): InstagramAccountType | null {
    if (typeof value !== 'string') return null
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    return accountTypes.get(normalized) ?? null
}

function readUsername(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed.length > 255) return null
    if ([...trimmed].some(character => character.charCodeAt(0) < 32)) return null
    return trimmed
}

/**
 * The documented response carries the granted permissions and the user
 * identifier inside a one-item `data` envelope. Some provider examples show
 * the same fields at the top level. A body that mixes both shapes, or that
 * describes more than one account, is ambiguous and is refused.
 */
function readCodeExchange(payload: unknown): CodeExchange | null {
    if (!isRecord(payload)) return null
    // An error beside a success shape makes the body ambiguous.
    if (carriesProviderError(payload)) return null
    const hasData = Object.hasOwn(payload, 'data')
    const hasFlat =
        Object.hasOwn(payload, 'access_token') ||
        Object.hasOwn(payload, 'user_id') ||
        Object.hasOwn(payload, 'permissions')
    if (hasData === hasFlat) return null
    if (!hasData) return readCodeExchangeFields(payload)
    const data = payload.data
    if (!Array.isArray(data) || data.length !== 1) return null
    const entry = data[0]
    if (!isRecord(entry)) return null
    // An error inside the envelope entry is an error-bearing body too.
    if (carriesProviderError(entry)) return null
    return readCodeExchangeFields(entry)
}

function readCodeExchangeFields(source: Record<string, unknown>): CodeExchange | null {
    const accessToken = source.access_token
    const userId = source.user_id
    const permissions = source.permissions
    if (!validToken(accessToken)) return null
    if (!numericId(userId)) return null
    if (permissions !== undefined && typeof permissions !== 'string') return null
    // Absent permission metadata grants nothing. It never proves support.
    const granted =
        typeof permissions === 'string'
            ? [...new Set(permissions.split(/[\s,]+/).filter(Boolean))]
            : []
    return { accessToken, userId, permissions: granted }
}

function readLongLivedToken(payload: unknown): LongLivedToken | null {
    if (!isRecord(payload)) return null
    if (carriesProviderError(payload)) return null
    const accessToken = payload.access_token
    const tokenType = payload.token_type
    if (!validToken(accessToken)) return null
    if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') return null
    const expiresInSeconds = readRequiredExpiration(payload)
    if (expiresInSeconds === null) return null
    return { accessToken, expiresInSeconds }
}

function readAccount(payload: unknown, expectedAppScopedId: string): AccountRead {
    if (!isRecord(payload)) return { kind: 'invalid' }
    // An error beside a success shape makes the body ambiguous.
    if (carriesProviderError(payload)) return { kind: 'invalid' }
    const data = payload.data
    if (!Array.isArray(data) || data.length !== 1) return { kind: 'invalid' }
    const entry = data[0]
    if (!isRecord(entry)) return { kind: 'invalid' }
    // An error inside the envelope entry is an error-bearing body too.
    if (carriesProviderError(entry)) return { kind: 'invalid' }
    const appScopedId = entry.id
    const accountId = entry.user_id
    if (!numericId(appScopedId) || !numericId(accountId)) return { kind: 'invalid' }
    const username = readUsername(entry.username)
    if (username === null) return { kind: 'invalid' }
    // The app-scoped identifier of the profile must be the one that the code
    // exchange reported, so both responses describe the same account.
    if (appScopedId !== expectedAppScopedId) return { kind: 'mismatch' }
    const accountType = readAccountType(entry.account_type)
    if (accountType === null) return { kind: 'ineligible' }
    return {
        kind: 'ok',
        account: { id: accountId, appScopedId, username, accountType },
    }
}

function hasRequiredPermissions(granted: readonly string[]): boolean {
    return INSTAGRAM_PUBLISH_PERMISSIONS.every(scope => granted.includes(scope))
}

export function createInstagramOAuth(options: {
    readonly clientId: string
    readonly clientSecret: string
    readonly callbackUri: string
    readonly fetcher?: InstagramFetcher
    readonly now?: () => number
}) {
    if (!/^[1-9]\d*$/.test(options.clientId))
        throw new Error('Instagram application configuration is invalid')
    if (!/^[\x21-\x7e]{1,4096}$/.test(options.clientSecret))
        throw new Error('Instagram application configuration is invalid')
    const callback = new URL(options.callbackUri)
    if (
        callback.protocol !== 'https:' ||
        callback.username ||
        callback.password ||
        callback.hash ||
        callback.search
    )
        throw new Error('Instagram callback must be an exact HTTPS URL without query or fragment')
    const fetcher = options.fetcher ?? fetch
    const now = options.now ?? Date.now

    /** The provider documents a literal `#_` artifact on the callback URL. */
    function callbackParameters(parameters: URL): URL {
        if (parameters.hash === '') return parameters
        if (parameters.hash !== '#_') throw new InstagramOAuthError('invalid_callback')
        // The artifact is removed from the whole address. Rebuilding the address
        // from its parts would drop the userinfo, so the copy keeps every other
        // component and the validation below still sees a credentialed host.
        const cleaned = new URL(parameters.href)
        cleaned.hash = ''
        return cleaned
    }

    async function exchangeCode(parameters: URLSearchParams): Promise<CodeExchange | null> {
        let exchanged: CodeExchange | null = null
        try {
            await exchangeAuthorizationCode({
                authorizationServer: server,
                clientId: options.clientId,
                clientAuthentication: clientSecretPost(options.clientSecret),
                callbackParameters: parameters,
                callbackUri: options.callbackUri,
                codeVerifier: null,
                signal: AbortSignal.timeout(requestTimeoutMs),
                fetcher: async (url, init) => {
                    // Keep the shared standards validation and adapt only the
                    // documented Instagram transport.
                    if (
                        String(url) !== tokenEndpoint ||
                        init?.method !== 'POST' ||
                        !(typeof init.body === 'string' || init.body instanceof URLSearchParams)
                    )
                        throw new Error('unexpected token request')
                    const body = new URLSearchParams(init.body)
                    for (const field of [
                        'client_id',
                        'client_secret',
                        'grant_type',
                        'redirect_uri',
                        'code',
                    ]) {
                        if (!body.get(field)) throw new Error('incomplete token request')
                    }
                    if (
                        body.get('grant_type') !== 'authorization_code' ||
                        body.get('client_id') !== options.clientId ||
                        body.get('redirect_uri') !== callback.href
                    )
                        throw new Error('unexpected token request')
                    const response = await fetcher(tokenEndpoint, {
                        method: 'POST',
                        body,
                        redirect: 'error',
                        cache: 'no-store',
                        credentials: 'omit',
                        signal: init.signal,
                        headers: {
                            accept: 'application/json',
                            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        },
                    })
                    const payload: unknown = await response.json().catch(() => null)
                    if (!response.ok) throw new Error('token request failed')
                    const result = readCodeExchange(payload)
                    if (result === null) throw new Error('unexpected token response')
                    exchanged = result
                    // The shared library understands only a standard token
                    // response; the documented envelope is translated here.
                    return Response.json({
                        access_token: result.accessToken,
                        token_type: 'bearer',
                    })
                },
            })
        } catch {
            return null
        }
        return exchanged
    }

    async function exchangeLongLivedToken(shortToken: string): Promise<LongLivedToken | null> {
        const target = new URL(longLivedTokenEndpoint)
        // The fixed endpoint carries the secret as a documented transport
        // exception. This URL is never logged, returned or used as an error cause.
        target.search = new URLSearchParams({
            grant_type: 'ig_exchange_token',
            client_secret: options.clientSecret,
            access_token: shortToken,
        }).toString()
        try {
            const response = await fetcher(target, {
                method: 'GET',
                redirect: 'error',
                cache: 'no-store',
                credentials: 'omit',
                signal: AbortSignal.timeout(requestTimeoutMs),
                headers: { accept: 'application/json' },
            })
            const payload: unknown = await response.json().catch(() => null)
            if (!response.ok) return null
            return readLongLivedToken(payload)
        } catch {
            return null
        }
    }

    async function readProfile(
        accessToken: string,
        expectedAppScopedId: string
    ): Promise<AccountRead> {
        const target = new URL(meEndpoint)
        target.search = new URLSearchParams({
            fields: 'id,user_id,username,account_type',
        }).toString()
        try {
            const response = await fetcher(target, {
                method: 'GET',
                redirect: 'error',
                cache: 'no-store',
                credentials: 'omit',
                signal: AbortSignal.timeout(requestTimeoutMs),
                headers: {
                    authorization: `Bearer ${accessToken}`,
                    accept: 'application/json',
                },
            })
            const payload: unknown = await response.json().catch(() => null)
            if (!response.ok) return { kind: 'invalid' }
            return readAccount(payload, expectedAppScopedId)
        } catch {
            return { kind: 'invalid' }
        }
    }

    return {
        clientId: options.clientId,
        callbackUri: options.callbackUri,
        createAuthorizationRequest() {
            return createAuthorizationRequest({
                authorizationServer: server,
                clientId: options.clientId,
                callbackUri: options.callbackUri,
                scopes: INSTAGRAM_PUBLISH_PERMISSIONS,
            })
        },
        async complete(input: {
            readonly parameters: URL
            readonly expectedState: string
        }): Promise<InstagramOAuthResult> {
            const parameters = callbackParameters(input.parameters)
            if (
                parameters.origin !== callback.origin ||
                parameters.pathname !== callback.pathname ||
                parameters.username ||
                parameters.password
            )
                throw new InstagramOAuthError('invalid_callback')

            let validated: URLSearchParams
            try {
                validated = validateAuthorizationResponse({
                    authorizationServer: server,
                    clientId: options.clientId,
                    parameters,
                    expectedState: input.expectedState,
                })
            } catch {
                // A refusal is classified only after the exact state matched.
                if (
                    parameters.searchParams.getAll('state').length === 1 &&
                    parameters.searchParams.get('state') === input.expectedState &&
                    parameters.searchParams.get('error') === 'access_denied'
                )
                    throw new InstagramOAuthError('access_denied')
                throw new InstagramOAuthError('invalid_callback')
            }
            const code = validated.get('code')
            if (validated.getAll('code').length !== 1 || !code?.trim())
                throw new InstagramOAuthError('invalid_callback')

            const exchanged = await exchangeCode(validated)
            if (exchanged === null) throw new InstagramOAuthError('exchange_failed')
            if (!hasRequiredPermissions(exchanged.permissions))
                throw new InstagramOAuthError('insufficient_permissions')

            const longLived = await exchangeLongLivedToken(exchanged.accessToken)
            if (longLived === null) throw new InstagramOAuthError('exchange_failed')

            const profile = await readProfile(longLived.accessToken, exchanged.userId)
            if (profile.kind === 'mismatch') throw new InstagramOAuthError('identity_mismatch')
            if (profile.kind === 'ineligible') throw new InstagramOAuthError('account_ineligible')
            if (profile.kind !== 'ok') throw new InstagramOAuthError('exchange_failed')

            return {
                tokens: {
                    accessToken: longLived.accessToken,
                    // The provider grants no refresh token; none is invented.
                    refreshToken: null,
                    expiresInSeconds: longLived.expiresInSeconds,
                    scopes: exchanged.permissions,
                    tokenType: 'bearer',
                },
                account: profile.account,
            }
        },
        async refresh(input: {
            readonly accessToken: string
            readonly issuedAt: number
            readonly expiresAt: number
        }): Promise<InstagramRefreshedToken> {
            if (!validToken(input.accessToken)) throw new InstagramOAuthError('token_invalid')
            // A negative issuance or a lifetime that ends no later than it
            // starts is corrupt metadata, refused before any request.
            if (
                !Number.isSafeInteger(input.issuedAt) ||
                input.issuedAt < 0 ||
                input.issuedAt > now()
            )
                throw new InstagramOAuthError('token_invalid')
            if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= input.issuedAt)
                throw new InstagramOAuthError('token_invalid')
            if (input.expiresAt <= now()) throw new InstagramOAuthError('token_expired')
            if (now() - input.issuedAt < minimumRefreshAgeMs)
                throw new InstagramOAuthError('token_too_new')

            const target = new URL(refreshTokenEndpoint)
            // The refresh endpoint needs no secret, only the long-lived token.
            target.search = new URLSearchParams({
                grant_type: 'ig_refresh_token',
                access_token: input.accessToken,
            }).toString()
            let refreshed: LongLivedToken | null = null
            try {
                const response = await fetcher(target, {
                    method: 'GET',
                    redirect: 'error',
                    cache: 'no-store',
                    credentials: 'omit',
                    signal: AbortSignal.timeout(requestTimeoutMs),
                    headers: { accept: 'application/json' },
                })
                const payload: unknown = await response.json().catch(() => null)
                if (!response.ok) throw new Error('refresh request failed')
                refreshed = readLongLivedToken(payload)
            } catch {
                throw new InstagramOAuthError('refresh_failed')
            }
            if (refreshed === null) throw new InstagramOAuthError('refresh_failed')
            const issuedAt = now()
            const expiresInSeconds = refreshed.expiresInSeconds
            const expiresAt = issuedAt + expiresInSeconds * 1000
            if (!Number.isSafeInteger(expiresAt)) throw new InstagramOAuthError('refresh_failed')
            return {
                accessToken: refreshed.accessToken,
                tokenType: 'bearer',
                expiresInSeconds,
                expiresAt,
                issuedAt,
            }
        },
    }
}
