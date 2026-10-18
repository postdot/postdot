import { requireNonBlank, requireTimestamp } from '@postbot/core'

import type { PostbotDatabase } from './client'
import type {
    EncryptedPublisherSecret,
    PublisherCredentialCipher,
} from './publisher-credential-crypto'

export const defaultAuthorizationAttemptTtlMs = 10 * 60 * 1000
export const maximumAuthorizationAttemptTtlMs = 15 * 60 * 1000

export interface CreateAuthorizationAttemptInput {
    readonly projectId: string
    readonly channelId: string
    readonly connectedByActorId: string
    readonly providerId: string
    readonly providerApplicationId?: string | null
    readonly callbackUri: string
    readonly scopes: readonly string[]
    readonly returnPath: string
    readonly context?: Readonly<Record<string, unknown>>
    readonly stateDigest: Uint8Array
    readonly codeVerifier: string | null
    /** Serialized provider-owned state, encrypted at rest when present. */
    readonly providerState?: string | null
}

export interface AuthorizationAttempt {
    readonly id: string
    readonly projectId: string
    readonly channelId: string
    readonly connectedByActorId: string
    readonly providerId: string
    readonly providerApplicationId?: string | null
    readonly callbackUri: string
    readonly scopes: readonly string[]
    readonly returnPath: string
    readonly context: Readonly<Record<string, unknown>>
    readonly expiresAt: number
    readonly createdAt: number
}

export type CreateAuthorizationAttemptResult =
    | { readonly kind: 'created'; readonly attempt: AuthorizationAttempt }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'state_collision' }

export interface ConsumeAuthorizationAttemptInput {
    readonly stateDigest: Uint8Array
    readonly connectedByActorId: string
    readonly providerId: string
    readonly callbackUri: string
}

export type ConsumeAuthorizationAttemptResult =
    | {
          readonly kind: 'consumed'
          readonly attempt: AuthorizationAttempt
          readonly codeVerifier: string | null
          readonly providerState: string | null
      }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'mismatch' }
    | { readonly kind: 'expired' }
    | { readonly kind: 'already_used' }
    | { readonly kind: 'conflict' }

export type ReadAuthorizationProviderStateResult =
    | {
          readonly kind: 'ready'
          readonly attempt: AuthorizationAttempt
          readonly providerState: string | null
      }
    | { readonly kind: 'not_found' | 'already_used' | 'mismatch' | 'expired' }

export interface AuthorizationAttemptStoreOptions {
    readonly cipher: PublisherCredentialCipher
    readonly validateReturnPath: (returnPath: string) => string
    readonly now?: () => number
    readonly createId?: () => string
    readonly ttlMs?: number
}

type AuthorizationAttemptStatus = 'pending' | 'consumed' | 'expired'

interface AuthorizationAttemptRow {
    readonly id: string
    readonly projectId: string
    readonly channelId: string
    readonly connectedByActorId: string
    readonly providerId: string
    readonly providerApplicationId: string | null
    readonly callbackUri: string
    readonly scopesJson: string
    readonly returnPath: string
    readonly contextJson: string
    readonly status: AuthorizationAttemptStatus
    readonly pkceEncryptionVersion: number | null
    readonly pkceEncryptionKeyId: string | null
    readonly pkceVerifierCiphertext: Uint8Array | null
    readonly pkceVerifierNonce: Uint8Array | null
    readonly providerStateEncryptionVersion: number | null
    readonly providerStateEncryptionKeyId: string | null
    readonly providerStateCiphertext: Uint8Array | null
    readonly providerStateNonce: Uint8Array | null
    readonly expiresAt: number
    readonly createdAt: number
}

const attemptColumns = `
    id,
    project_id as projectId,
    channel_id as channelId,
    connected_by_actor_id as connectedByActorId,
    provider_id as providerId,
    provider_application_id as providerApplicationId,
    callback_uri as callbackUri,
    scopes as scopesJson,
    return_path as returnPath,
    context_json as contextJson,
    status,
    pkce_encryption_version as pkceEncryptionVersion,
    pkce_encryption_key_id as pkceEncryptionKeyId,
    pkce_verifier_ciphertext as pkceVerifierCiphertext,
    pkce_verifier_nonce as pkceVerifierNonce,
    provider_state_encryption_version as providerStateEncryptionVersion,
    provider_state_encryption_key_id as providerStateEncryptionKeyId,
    provider_state_ciphertext as providerStateCiphertext,
    provider_state_nonce as providerStateNonce,
    expires_at as expiresAt,
    created_at as createdAt
`

function normalizeScopes(scopes: readonly string[]): readonly string[] {
    return [...new Set(scopes.map(scope => requireNonBlank(scope, 'scope')))].sort()
}

function parseScopes(scopesJson: string): readonly string[] {
    const parsed: unknown = JSON.parse(scopesJson)
    if (!Array.isArray(parsed) || !parsed.every(scope => typeof scope === 'string')) {
        throw new Error('Stored OAuth authorization attempt scopes are invalid')
    }
    return normalizeScopes(parsed)
}

function parseContext(contextJson: string): Readonly<Record<string, unknown>> {
    let parsed: unknown
    try {
        parsed = JSON.parse(contextJson)
    } catch {
        throw new Error('Stored OAuth authorization attempt context is not valid JSON')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Stored OAuth authorization attempt context must be a JSON object')
    }
    return parsed as Readonly<Record<string, unknown>>
}

function serializeContext(context: Readonly<Record<string, unknown>> | undefined): string {
    try {
        const serialized = JSON.stringify(context ?? {})
        if (serialized === undefined) throw new Error('undefined JSON')
        return serialized
    } catch {
        throw new Error('OAuth authorization attempt context must be JSON serializable')
    }
}

function toAttempt(row: AuthorizationAttemptRow): AuthorizationAttempt {
    return {
        id: row.id,
        projectId: row.projectId,
        channelId: row.channelId,
        connectedByActorId: row.connectedByActorId,
        providerId: row.providerId,
        ...(row.providerApplicationId === null
            ? {}
            : { providerApplicationId: row.providerApplicationId }),
        callbackUri: row.callbackUri,
        scopes: parseScopes(row.scopesJson),
        returnPath: row.returnPath,
        context: parseContext(row.contextJson),
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
    }
}

function requireStateDigest(stateDigest: Uint8Array): Uint8Array {
    const copy = Uint8Array.from(stateDigest)
    if (copy.byteLength !== 32) {
        throw new Error('stateDigest must contain exactly 32 bytes')
    }
    return copy
}

function requireTtl(ttlMs: number): number {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > maximumAuthorizationAttemptTtlMs) {
        throw new Error(
            `OAuth authorization attempt TTL must be between 1 and ${maximumAuthorizationAttemptTtlMs} milliseconds`
        )
    }
    return ttlMs
}

function requireCodeVerifier(codeVerifier: string | null): string | null {
    if (codeVerifier === null) return null
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
        throw new Error('codeVerifier must satisfy the RFC 7636 length and character requirements')
    }
    return codeVerifier
}

function pkceEnvelope(row: AuthorizationAttemptRow): EncryptedPublisherSecret | null {
    const {
        pkceEncryptionVersion,
        pkceEncryptionKeyId,
        pkceVerifierCiphertext,
        pkceVerifierNonce,
    } = row
    if (
        pkceEncryptionVersion === null &&
        pkceEncryptionKeyId === null &&
        pkceVerifierCiphertext === null &&
        pkceVerifierNonce === null
    ) {
        return null
    }
    if (
        pkceEncryptionVersion === null ||
        pkceEncryptionKeyId === null ||
        pkceVerifierCiphertext === null ||
        pkceVerifierNonce === null
    ) {
        throw new Error('Pending OAuth authorization attempt has no PKCE verifier')
    }

    return {
        version: pkceEncryptionVersion as EncryptedPublisherSecret['version'],
        keyId: pkceEncryptionKeyId,
        ciphertext: pkceVerifierCiphertext,
        nonce: pkceVerifierNonce,
    }
}

function providerStateEnvelope(row: AuthorizationAttemptRow): EncryptedPublisherSecret | null {
    const {
        providerStateEncryptionVersion,
        providerStateEncryptionKeyId,
        providerStateCiphertext,
        providerStateNonce,
    } = row
    if (
        providerStateEncryptionVersion === null &&
        providerStateEncryptionKeyId === null &&
        providerStateCiphertext === null &&
        providerStateNonce === null
    ) {
        return null
    }
    if (
        providerStateEncryptionVersion === null ||
        providerStateEncryptionKeyId === null ||
        providerStateCiphertext === null ||
        providerStateNonce === null
    ) {
        throw new Error('Pending OAuth authorization attempt has incomplete provider state')
    }

    return {
        version: providerStateEncryptionVersion as EncryptedPublisherSecret['version'],
        keyId: providerStateEncryptionKeyId,
        ciphertext: providerStateCiphertext,
        nonce: providerStateNonce,
    }
}

export function createAuthorizationAttemptStore(
    database: PostbotDatabase,
    options: AuthorizationAttemptStoreOptions
) {
    const client = database.$client
    const cipher = options.cipher
    const validateReturnPath = options.validateReturnPath
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const ttlMs = requireTtl(options.ttlMs ?? defaultAuthorizationAttemptTtlMs)

    const loadBindingStatement = client.query<
        { found: number },
        [projectId: string, channelId: string, connectedByActorId: string]
    >(`
        select 1 as found
        from projects
        inner join channels
            on channels.project_id = projects.id
           and channels.id = ?2
        inner join actors
            on actors.project_id = projects.id
           and actors.id = ?3
        where projects.id = ?1
          and channels.state = 'active'
    `)
    const loadAttemptByStateStatement = client.query<
        AuthorizationAttemptRow,
        [stateDigest: Uint8Array]
    >(`
        select ${attemptColumns}
        from oauth_authorization_attempts
        where state_digest = ?1
    `)
    const insertAttemptStatement = client.query<
        { changes: number },
        [
            id: string,
            projectId: string,
            channelId: string,
            connectedByActorId: string,
            providerId: string,
            providerApplicationId: string | null,
            callbackUri: string,
            scopesJson: string,
            returnPath: string,
            contextJson: string,
            stateDigest: Uint8Array,
            encryptionVersion: number | null,
            encryptionKeyId: string | null,
            verifierCiphertext: Uint8Array | null,
            verifierNonce: Uint8Array | null,
            providerStateEncryptionVersion: number | null,
            providerStateEncryptionKeyId: string | null,
            providerStateCiphertext: Uint8Array | null,
            providerStateNonce: Uint8Array | null,
            expiresAt: number,
            timestamp: number,
        ]
    >(`
        insert into oauth_authorization_attempts (
            id,
            project_id,
            channel_id,
            connected_by_actor_id,
            provider_id,
            provider_application_id,
            callback_uri,
            scopes,
            return_path,
            context_json,
            state_digest,
            status,
            pkce_encryption_version,
            pkce_encryption_key_id,
            pkce_verifier_ciphertext,
            pkce_verifier_nonce,
            provider_state_encryption_version,
            provider_state_encryption_key_id,
            provider_state_ciphertext,
            provider_state_nonce,
            expires_at,
            created_at,
            updated_at
        ) values (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21
        )
        on conflict (state_digest) do nothing
    `)
    const consumeAttemptStatement = client.query<
        { changes: number },
        [
            completedAt: number,
            id: string,
            connectedByActorId: string,
            providerId: string,
            callbackUri: string,
        ]
    >(`
        update oauth_authorization_attempts
        set status = 'consumed',
            completed_at = ?1,
            pkce_encryption_version = null,
            pkce_encryption_key_id = null,
            pkce_verifier_ciphertext = null,
            pkce_verifier_nonce = null,
            provider_state_encryption_version = null,
            provider_state_encryption_key_id = null,
            provider_state_ciphertext = null,
            provider_state_nonce = null,
            updated_at = ?1
        where id = ?2
          and connected_by_actor_id = ?3
          and provider_id = ?4
          and callback_uri = ?5
          and status = 'pending'
          and expires_at > ?1
    `)
    const expireAttemptStatement = client.query<
        { changes: number },
        [completedAt: number, id: string]
    >(`
        update oauth_authorization_attempts
        set status = 'expired',
            completed_at = ?1,
            pkce_encryption_version = null,
            pkce_encryption_key_id = null,
            pkce_verifier_ciphertext = null,
            pkce_verifier_nonce = null,
            provider_state_encryption_version = null,
            provider_state_encryption_key_id = null,
            provider_state_ciphertext = null,
            provider_state_nonce = null,
            updated_at = ?1
        where id = ?2
          and status = 'pending'
          and expires_at <= ?1
    `)
    const expireAllAttemptsStatement = client.query<{ changes: number }, [completedAt: number]>(`
        update oauth_authorization_attempts
        set status = 'expired',
            completed_at = ?1,
            pkce_encryption_version = null,
            pkce_encryption_key_id = null,
            pkce_verifier_ciphertext = null,
            pkce_verifier_nonce = null,
            provider_state_encryption_version = null,
            provider_state_encryption_key_id = null,
            provider_state_ciphertext = null,
            provider_state_nonce = null,
            updated_at = ?1
        where status = 'pending'
          and expires_at <= ?1
    `)

    return {
        /** Server-only inspection of a pending provider phase; never returns its PKCE verifier. */
        async readPendingAuthorizationProviderState(
            input: ConsumeAuthorizationAttemptInput
        ): Promise<ReadAuthorizationProviderStateResult> {
            const row = loadAttemptByStateStatement.get(requireStateDigest(input.stateDigest))
            if (row === null) return { kind: 'not_found' }
            if (row.status !== 'pending') return { kind: 'already_used' }
            if (
                row.connectedByActorId !== input.connectedByActorId ||
                row.providerId !== input.providerId ||
                row.callbackUri !== input.callbackUri
            )
                return { kind: 'mismatch' }
            const timestamp = requireTimestamp(now(), 'now')
            if (row.expiresAt <= timestamp) {
                expireAttemptStatement.run(timestamp, row.id)
                return { kind: 'expired' }
            }
            if (
                loadBindingStatement.get(row.projectId, row.channelId, row.connectedByActorId) ===
                null
            )
                return { kind: 'not_found' }
            const envelope = providerStateEnvelope(row)
            return {
                kind: 'ready',
                attempt: toAttempt(row),
                providerState:
                    envelope === null
                        ? null
                        : await cipher.decrypt(
                              {
                                  recordId: row.id,
                                  providerId: row.providerId,
                                  field: 'provider_state',
                              },
                              envelope
                          ),
            }
        },
        getAuthorizationAttempt(stateDigest: Uint8Array): AuthorizationAttempt | null {
            const row = loadAttemptByStateStatement.get(requireStateDigest(stateDigest))
            return row === null ? null : toAttempt(row)
        },

        async createAuthorizationAttempt(
            input: CreateAuthorizationAttemptInput
        ): Promise<CreateAuthorizationAttemptResult> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const connectedByActorId = requireNonBlank(
                input.connectedByActorId,
                'connectedByActorId'
            )
            const providerId = requireNonBlank(input.providerId, 'providerId')
            const callbackUri = requireNonBlank(input.callbackUri, 'callbackUri')
            const returnPath = validateReturnPath(input.returnPath)
            const scopes = normalizeScopes(input.scopes)
            const contextJson = serializeContext(input.context)
            const stateDigest = requireStateDigest(input.stateDigest)
            const codeVerifier = requireCodeVerifier(input.codeVerifier)
            const providerState =
                input.providerState === null || input.providerState === undefined
                    ? null
                    : input.providerState
            if (loadBindingStatement.get(projectId, channelId, connectedByActorId) === null) {
                return { kind: 'not_found' }
            }
            if (loadAttemptByStateStatement.get(stateDigest) !== null) {
                return { kind: 'state_collision' }
            }

            const timestamp = requireTimestamp(now(), 'now')
            const attempt: AuthorizationAttempt = {
                id: createId(),
                projectId,
                channelId,
                connectedByActorId,
                providerId,
                ...(input.providerApplicationId === undefined
                    ? {}
                    : { providerApplicationId: input.providerApplicationId }),
                callbackUri,
                scopes,
                returnPath,
                context: parseContext(contextJson),
                expiresAt: timestamp + ttlMs,
                createdAt: timestamp,
            }
            const verifier =
                codeVerifier === null
                    ? null
                    : await cipher.encrypt(
                          { recordId: attempt.id, providerId, field: 'pkce_verifier' },
                          codeVerifier
                      )
            const providerStateEnvelope =
                providerState === null
                    ? null
                    : await cipher.encrypt(
                          { recordId: attempt.id, providerId, field: 'provider_state' },
                          providerState
                      )
            const inserted = insertAttemptStatement.run(
                attempt.id,
                attempt.projectId,
                attempt.channelId,
                attempt.connectedByActorId,
                attempt.providerId,
                attempt.providerApplicationId ?? null,
                attempt.callbackUri,
                JSON.stringify(attempt.scopes),
                attempt.returnPath,
                contextJson,
                stateDigest,
                verifier?.version ?? null,
                verifier?.keyId ?? null,
                verifier?.ciphertext ?? null,
                verifier?.nonce ?? null,
                providerStateEnvelope?.version ?? null,
                providerStateEnvelope?.keyId ?? null,
                providerStateEnvelope?.ciphertext ?? null,
                providerStateEnvelope?.nonce ?? null,
                attempt.expiresAt,
                timestamp
            )

            return inserted.changes === 1
                ? { kind: 'created', attempt }
                : { kind: 'state_collision' }
        },

        async consumeAuthorizationAttempt(
            input: ConsumeAuthorizationAttemptInput
        ): Promise<ConsumeAuthorizationAttemptResult> {
            const stateDigest = requireStateDigest(input.stateDigest)
            const connectedByActorId = requireNonBlank(
                input.connectedByActorId,
                'connectedByActorId'
            )
            const providerId = requireNonBlank(input.providerId, 'providerId')
            const callbackUri = requireNonBlank(input.callbackUri, 'callbackUri')
            const row = loadAttemptByStateStatement.get(stateDigest)
            if (row === null) return { kind: 'not_found' }
            if (row.status !== 'pending') return { kind: 'already_used' }
            if (
                row.connectedByActorId !== connectedByActorId ||
                row.providerId !== providerId ||
                row.callbackUri !== callbackUri
            ) {
                return { kind: 'mismatch' }
            }

            const timestamp = requireTimestamp(now(), 'now')
            if (row.expiresAt <= timestamp) {
                expireAttemptStatement.run(timestamp, row.id)
                return { kind: 'expired' }
            }

            const verifier = pkceEnvelope(row)
            const providerState = providerStateEnvelope(row)
            const consumed = consumeAttemptStatement.run(
                timestamp,
                row.id,
                connectedByActorId,
                providerId,
                callbackUri
            )
            if (consumed.changes !== 1) {
                const current = loadAttemptByStateStatement.get(stateDigest)
                if (current === null) return { kind: 'not_found' }
                if (current.status !== 'pending') return { kind: 'already_used' }
                if (current.expiresAt <= timestamp) return { kind: 'expired' }
                return { kind: 'conflict' }
            }

            return {
                kind: 'consumed',
                attempt: toAttempt(row),
                codeVerifier:
                    verifier === null
                        ? null
                        : await cipher.decrypt(
                              {
                                  recordId: row.id,
                                  providerId: row.providerId,
                                  field: 'pkce_verifier',
                              },
                              verifier
                          ),
                providerState:
                    providerState === null
                        ? null
                        : await cipher.decrypt(
                              {
                                  recordId: row.id,
                                  providerId: row.providerId,
                                  field: 'provider_state',
                              },
                              providerState
                          ),
            }
        },

        expireAuthorizationAttempts(): number {
            return expireAllAttemptsStatement.run(requireTimestamp(now(), 'now')).changes
        },
    }
}
