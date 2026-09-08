import { JoseKey } from '@atproto/jwk-jose'
import { WebcryptoKey } from '@atproto/jwk-webcrypto'
import {
    OAuthClient,
    type Jwk,
    type InternalStateData,
    type OAuthClientMetadataInput,
    type OAuthClientOptions,
    type OAuthSession,
    type RuntimeImplementation,
    type Session,
    type SessionStore,
    type StateStore,
} from '@atproto/oauth-client'
import { buildAtprotoLoopbackClientMetadata } from '@atproto/oauth-types'

export interface SerializedBlueskyStore {
    get(key: string): Promise<string | undefined>
    set(key: string, value: string): Promise<void>
    del(key: string): Promise<void>
    clear?(): Promise<void>
}

export type BlueskyOAuthClientSetupOptions = Omit<
    BlueskyOAuthClientOptions,
    'stateStore' | 'sessionStore' | 'onSessionUpdated'
>

export type BlueskyOAuthClientMetadata = OAuthClientMetadataInput

export function createBlueskyClientMetadata(options: {
    readonly clientId: string
    readonly clientName: string
    readonly clientUri: string
    readonly redirectUri: string
}): BlueskyOAuthClientMetadata {
    return {
        client_id: options.clientId as BlueskyOAuthClientMetadata['client_id'],
        client_name: options.clientName,
        client_uri: options.clientUri as BlueskyOAuthClientMetadata['client_uri'],
        redirect_uris: [options.redirectUri as BlueskyOAuthClientMetadata['redirect_uris'][number]],
        scope: 'atproto',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
        dpop_bound_access_tokens: true,
    }
}

/**
 * Build the native loopback client metadata defined by the AT Protocol OAuth
 * specification. The resulting client id is the special `http://localhost`
 * identifier; the redirect itself must use a loopback IP literal.
 */
export function createBlueskyLoopbackClientMetadata(options: {
    readonly redirectUri: string
}): BlueskyOAuthClientMetadata {
    return buildAtprotoLoopbackClientMetadata({ redirect_uris: [options.redirectUri] })
}

export interface RestoredBlueskySession {
    readonly client: OAuthClient
    readonly session: OAuthSession
    getSession(): Session
    getSerializedSession(): string
}

export type SerializedBlueskyState = Omit<InternalStateData, 'dpopKey'> & {
    readonly dpopJwk: Jwk
}

export type SerializedBlueskySession = Omit<Session, 'dpopKey'> & {
    readonly dpopJwk: Jwk
}

export interface BlueskySessionTokenSet {
    readonly sub: string
    readonly accessToken: string
    readonly refreshToken: string | null
    readonly expiresAt: string | null
}

export function createBlueskyRuntimeImplementation(): RuntimeImplementation {
    return {
        createKey: async algorithms => {
            const algorithm = algorithms.find(candidate =>
                ['ES256', 'ES384', 'ES512'].includes(candidate)
            )
            if (algorithm === undefined) {
                throw new Error(
                    'The AT Protocol authorization server exposes no Web Crypto DPoP algorithm'
                )
            }
            return WebcryptoKey.generate([algorithm], undefined, { extractable: true })
        },
        getRandomValues: length => crypto.getRandomValues(new Uint8Array(length)),
        digest: (data, algorithm) => {
            const webCryptoAlgorithm =
                algorithm.name === 'sha256'
                    ? 'SHA-256'
                    : algorithm.name === 'sha384'
                      ? 'SHA-384'
                      : 'SHA-512'
            return crypto.subtle
                .digest(webCryptoAlgorithm, data)
                .then(value => new Uint8Array(value))
        },
    }
}

function requirePrivateDpopJwk(key: Session['dpopKey'] | InternalStateData['dpopKey']): Jwk {
    const jwk = key.privateJwk
    if (jwk === undefined) throw new Error('The AT Protocol DPoP key is not exportable')
    return structuredClone(jwk)
}

function serialize(value: unknown): string {
    const result = JSON.stringify(value)
    if (result === undefined) throw new Error('The AT Protocol state is not JSON serializable')
    return result
}

export function serializeBlueskyState(state: InternalStateData): string {
    const { dpopKey, ...rest } = state
    return serialize({ ...rest, dpopJwk: requirePrivateDpopJwk(dpopKey) })
}

export async function deserializeBlueskyState(value: string): Promise<InternalStateData> {
    const parsed = parseSerialized(value) as SerializedBlueskyState
    return {
        ...parsed,
        dpopKey: await JoseKey.fromJWK(parsed.dpopJwk),
    }
}

export function serializeBlueskySession(session: Session): string {
    const { dpopKey, ...rest } = session
    return serialize({ ...rest, dpopJwk: requirePrivateDpopJwk(dpopKey) })
}

export async function deserializeBlueskySession(value: string): Promise<Session> {
    const parsed = parseSerialized(value) as SerializedBlueskySession
    return {
        ...parsed,
        dpopKey: await JoseKey.fromJWK(parsed.dpopJwk),
    }
}

export function readBlueskySessionTokenSet(value: string): BlueskySessionTokenSet | null {
    try {
        const parsed = JSON.parse(value) as {
            readonly tokenSet?: {
                readonly sub?: string
                readonly access_token?: string
                readonly refresh_token?: string
                readonly expires_at?: string
            }
        }
        const tokenSet = parsed.tokenSet
        if (
            tokenSet === undefined ||
            typeof tokenSet.sub !== 'string' ||
            typeof tokenSet.access_token !== 'string' ||
            tokenSet.access_token.trim().length === 0 ||
            (tokenSet.refresh_token !== undefined && typeof tokenSet.refresh_token !== 'string') ||
            (tokenSet.expires_at !== undefined && typeof tokenSet.expires_at !== 'string')
        ) {
            return null
        }
        return {
            sub: tokenSet.sub,
            accessToken: tokenSet.access_token,
            refreshToken: tokenSet.refresh_token ?? null,
            expiresAt: tokenSet.expires_at ?? null,
        }
    } catch {
        return null
    }
}

function parseSerialized(value: string): SerializedBlueskyState | SerializedBlueskySession {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new Error('Stored AT Protocol state is not valid JSON')
    }
    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        !('dpopJwk' in parsed) ||
        parsed.dpopJwk === null ||
        typeof parsed.dpopJwk !== 'object'
    ) {
        throw new Error('Stored AT Protocol state is invalid')
    }
    return parsed as SerializedBlueskyState | SerializedBlueskySession
}

export function createBlueskyStateStore(store: SerializedBlueskyStore): StateStore {
    return {
        async get(key) {
            const value = await store.get(key)
            return value === undefined ? undefined : deserializeBlueskyState(value)
        },
        async set(key, value) {
            await store.set(key, serializeBlueskyState(value))
        },
        del: store.del,
        clear: store.clear,
    }
}

export function createBlueskyStateStoreWithKeyCapture(store: SerializedBlueskyStore): {
    readonly stateStore: StateStore
    getCapturedKey(): string | undefined
} {
    let capturedKey: string | undefined
    const stateStore = createBlueskyStateStore({
        ...store,
        async set(key, value) {
            capturedKey = key
            await store.set(key, value)
        },
    })

    return {
        stateStore,
        getCapturedKey() {
            return capturedKey
        },
    }
}

export function createBlueskySessionStore(store: SerializedBlueskyStore): SessionStore {
    return {
        async get(key) {
            const value = await store.get(key)
            return value === undefined ? undefined : deserializeBlueskySession(value)
        },
        async set(key, value) {
            await store.set(key, serializeBlueskySession(value))
        },
        del: store.del,
        clear: store.clear,
    }
}

export function createBlueskyMemoryStore(
    entries: readonly (readonly [string, string])[] = []
): SerializedBlueskyStore {
    const values = new Map(entries)
    return {
        async get(key) {
            return values.get(key)
        },
        async set(key, value) {
            values.set(key, value)
        },
        async del(key) {
            values.delete(key)
        },
        async clear() {
            values.clear()
        },
    }
}

export type BlueskyOAuthClientOptions = Omit<
    OAuthClientOptions,
    'responseMode' | 'runtimeImplementation'
>

export function createBlueskyOAuthClient(options: BlueskyOAuthClientOptions): OAuthClient {
    return new OAuthClient({
        ...options,
        responseMode: 'query',
        runtimeImplementation: createBlueskyRuntimeImplementation(),
    })
}

export async function restoreBlueskySession(options: {
    readonly sub: string
    readonly serializedSession: string
    readonly client: BlueskyOAuthClientSetupOptions
    readonly onSessionUpdated?: (serializedSession: string) => void
}): Promise<RestoredBlueskySession> {
    const serializedStore = createBlueskyMemoryStore([[options.sub, options.serializedSession]])
    let currentSession = await deserializeBlueskySession(options.serializedSession)
    let currentSerializedSession = options.serializedSession
    const client = createBlueskyOAuthClient({
        ...options.client,
        stateStore: createBlueskyStateStore(createBlueskyMemoryStore()),
        sessionStore: createBlueskySessionStore(serializedStore),
        onSessionUpdated(_sub, session) {
            currentSession = session
            currentSerializedSession = serializeBlueskySession(session)
            options.onSessionUpdated?.(currentSerializedSession)
        },
    })
    const session = await client.restore(options.sub)
    return {
        client,
        session,
        getSession() {
            return currentSession
        },
        getSerializedSession() {
            return currentSerializedSession
        },
    }
}
