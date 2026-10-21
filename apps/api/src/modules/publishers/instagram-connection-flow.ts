import type {
    createAccessStore,
    createAuthorizationAttemptStore,
    createManualStore,
    createPublisherCredentialStore,
    createPublisherStore,
    AuthorizationAttempt,
} from '@postdot/db'
import { INSTAGRAM_PUBLISH_PERMISSIONS, type createInstagramOAuth } from '@postdot/instagram'

type Binding = {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly authMethod: 'session' | 'user_api_key'
}

/** A provider lifetime beyond one year is not credible and is refused. */
const maximumExpiresInSeconds = 31_536_000

/** The provider identity the connection credential is bound to. */
const providerId = 'instagram'

export type InstagramConnectionErrorCode =
    | 'not_found'
    | 'forbidden'
    | 'invalid_attempt'
    | 'conflict'
    | 'provider_unavailable'

export class InstagramConnectionError extends Error {
    constructor(readonly code: InstagramConnectionErrorCode) {
        super('Instagram connection could not be completed')
        this.name = 'InstagramConnectionError'
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

/** The provider publishing identity is numeric and never carries decoration. */
function numericId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9]\d{0,63}$/.test(value)
}

function plainText(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.trim().length <= 255 &&
        ![...value].some(character => character.charCodeAt(0) < 32)
    )
}

interface PreparedToken {
    readonly accessToken: string
    readonly expiresInSeconds: number
    readonly scopes: readonly string[]
}

/**
 * The exchanged token is read defensively. A missing, nullable, negative or
 * implausible lifetime is never replaced by a guessed default: an unknown
 * provider deadline is a failure, not a licence to invent one.
 */
function readPreparedToken(value: unknown): PreparedToken | null {
    const result = asRecord(value)
    if (result === null) return null
    const tokens = asRecord(result.tokens) ?? result
    const accessToken = tokens.accessToken
    if (typeof accessToken !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(accessToken)) return null
    const tokenType = tokens.tokenType
    if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') return null
    const expiresInSeconds = tokens.expiresInSeconds
    if (
        typeof expiresInSeconds !== 'number' ||
        !Number.isSafeInteger(expiresInSeconds) ||
        expiresInSeconds <= 0 ||
        expiresInSeconds > maximumExpiresInSeconds
    )
        return null
    const scopes = tokens.scopes
    if (!Array.isArray(scopes)) return null
    const granted: string[] = []
    for (const scope of scopes as readonly unknown[]) {
        if (!plainText(scope)) return null
        granted.push(scope)
    }
    return { accessToken, expiresInSeconds, scopes: granted }
}

interface PreparedAccount {
    /** The professional publishing identifier. */
    readonly id: string
    /** The application's view of the same user; never a publishing identifier. */
    readonly appScopedId: string
    readonly username: string
    readonly accountType: string
}

/**
 * The provider already verifies the professional account and its identity.
 * The publishing identifier must still be numeric and kept separate from the
 * app-scoped identifier, which never addresses a media endpoint.
 */
function readPreparedAccount(value: unknown): PreparedAccount | null {
    const account = asRecord(value)
    if (account === null) return null
    const id = account.id
    const appScopedId = account.appScopedId
    if (!numericId(id) || !numericId(appScopedId)) return null
    const username = account.username
    const accountType = account.accountType
    if (!plainText(username) || (accountType !== 'BUSINESS' && accountType !== 'MEDIA_CREATOR'))
        return null
    return { id, appScopedId, username, accountType }
}

/**
 * Internal orchestration. HTTP callers must supply an authenticated identity,
 * never body identity fields.
 */
export function createInstagramConnectionFlow(options: {
    readonly attempts: ReturnType<typeof createAuthorizationAttemptStore>
    readonly credentials: ReturnType<typeof createPublisherCredentialStore>
    readonly publishers: ReturnType<typeof createPublisherStore>
    readonly channels: Pick<ReturnType<typeof createManualStore>, 'listChannels'>
    readonly access: Pick<ReturnType<typeof createAccessStore>, 'canAccessProject'>
    readonly oauth: ReturnType<typeof createInstagramOAuth>
    /** The Instagram provider application configuration that issues the token. */
    readonly applicationId: string
    /** Rechecks that the issuing application configuration is still current. */
    readonly applicationAvailable: () => Promise<boolean>
    readonly now?: () => number
}) {
    const now = options.now ?? Date.now
    const fail = (code: InstagramConnectionErrorCode): never => {
        throw new InstagramConnectionError(code)
    }
    if (options.applicationId.trim().length === 0) {
        throw new Error('Instagram connection requires an issuing application configuration')
    }
    const callback = new URL(options.oauth.callbackUri)
    async function digest(state: string) {
        if (!/^[\x21-\x7e]{32,512}$/.test(state)) return fail('invalid_attempt')
        return new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))
        )
    }
    async function assertApplicationAvailable() {
        if (!(await options.applicationAvailable())) return fail('provider_unavailable')
    }
    function authorizeActor(binding: Binding) {
        if (binding.authMethod !== 'session') return fail('forbidden')
        if (
            !options.publishers.hasChannelAccess(
                binding.projectId,
                binding.channelId,
                binding.subjectId
            )
        )
            return fail('not_found')
        if (!options.access.canAccessProject(binding.projectId, binding.subjectId, 'editor'))
            return fail('forbidden')
        const channel = options.channels
            .listChannels(binding.projectId, binding.subjectId)
            ?.find(value => value.id === binding.channelId)
        if (!channel || channel.state !== 'active') return fail('not_found')
        // The built-in Instagram profile is the only channel that publishes
        // through this contract. Its image-v1 revision belongs to the Instagram
        // package, which owns the publishing behaviour.
        if (channel.execution.kind !== 'built_in' || channel.execution.contractId !== 'instagram')
            return fail('conflict')
        const actorId = options.publishers.getProjectActorId(binding.projectId, binding.subjectId)
        if (!actorId) return fail('not_found')
        return { actorId }
    }
    /**
     * The connection belongs to the project, not to the connecting actor. A
     * connection that is already active is never replaced. The pinned
     * replacement is the connection this authorization may replace.
     */
    function assertNoActiveConnection(binding: Binding, pinnedConnectionId?: string) {
        const connection = options.publishers.getPublisherConnection(
            binding.projectId,
            binding.channelId,
            binding.subjectId
        )
        if (connection?.state === 'active' && connection.id !== pinnedConnectionId)
            return fail('conflict')
        return connection
    }
    function verifyAttempt(
        attempt: AuthorizationAttempt | null,
        binding: Binding,
        actorId: string
    ) {
        if (
            !attempt ||
            attempt.projectId !== binding.projectId ||
            attempt.channelId !== binding.channelId ||
            attempt.connectedByActorId !== actorId ||
            attempt.providerId !== providerId ||
            attempt.callbackUri !== options.oauth.callbackUri ||
            attempt.context.clientId !== options.oauth.clientId ||
            attempt.context.phase !== 'authorization' ||
            (attempt.providerApplicationId ?? null) !== options.applicationId
        )
            return fail('invalid_attempt')
        return attempt
    }
    /**
     * The replacement identity observed when the authorization started. A
     * connection created afterwards keeps its own identity, so a concurrent
     * change is reported instead of being overwritten.
     */
    function readPinnedReplacement(
        context: Readonly<Record<string, unknown>>
    ): { readonly id: string; readonly state: 'reconnect_required' | 'revoked' } | undefined {
        const id = context.replacementConnectionId
        const state = context.replacementConnectionState
        if (id === null || id === undefined) return undefined
        if (typeof id !== 'string' || id.length === 0) return undefined
        if (state !== 'reconnect_required' && state !== 'revoked') return undefined
        return { id, state }
    }
    return {
        async start(binding: Binding, returnPath: string) {
            const { actorId } = authorizeActor(binding)
            const connection = assertNoActiveConnection(binding)
            await assertApplicationAvailable()
            const request = await options.oauth.createAuthorizationRequest()
            const result = await options.attempts.createAuthorizationAttempt({
                projectId: binding.projectId,
                channelId: binding.channelId,
                connectedByActorId: actorId,
                providerId,
                providerApplicationId: options.applicationId,
                callbackUri: options.oauth.callbackUri,
                scopes: INSTAGRAM_PUBLISH_PERMISSIONS,
                returnPath,
                context: {
                    clientId: options.oauth.clientId,
                    phase: 'authorization',
                    replacementConnectionId: connection?.id ?? null,
                    replacementConnectionState: connection?.state ?? null,
                },
                // Only the digest of the shared authorization state is stored.
                stateDigest: await digest(request.state),
                // The confidential Instagram flow publishes no PKCE verifier.
                codeVerifier: request.codeVerifier,
            })
            if (result.kind !== 'created') return fail('conflict')
            return { url: request.url.toString() }
        },
        async complete(binding: Binding, parameters: URL) {
            if (
                parameters.origin !== callback.origin ||
                parameters.pathname !== callback.pathname ||
                parameters.username !== '' ||
                parameters.password !== ''
            )
                return fail('invalid_attempt')
            if (parameters.searchParams.getAll('state').length !== 1) return fail('invalid_attempt')
            const state = parameters.searchParams.get('state') ?? ''
            const stateDigest = await digest(state)
            const { actorId } = authorizeActor(binding)
            const attempt = verifyAttempt(
                options.attempts.getAuthorizationAttempt(stateDigest),
                binding,
                actorId
            )
            // Consume before exchanging a one-use provider code.
            const consumed = await options.attempts.consumeAuthorizationAttempt({
                stateDigest,
                connectedByActorId: actorId,
                providerId,
                callbackUri: options.oauth.callbackUri,
            })
            if (consumed.kind !== 'consumed') return fail('invalid_attempt')
            const replacement = readPinnedReplacement(attempt.context)
            assertNoActiveConnection(binding)
            const prepared = await options.oauth.complete({ parameters, expectedState: state })
            const result = asRecord(prepared)
            if (result === null) return fail('provider_unavailable')
            const token = readPreparedToken(result)
            if (token === null) return fail('provider_unavailable')
            const account = readPreparedAccount(result.account)
            if (account === null) return fail('provider_unavailable')
            if (!INSTAGRAM_PUBLISH_PERMISSIONS.every(scope => token.scopes.includes(scope)))
                return fail('provider_unavailable')
            // The provider exchange is asynchronous: the actor, the channel and
            // the issuing application are rechecked before anything is stored.
            authorizeActor(binding)
            assertNoActiveConnection(binding)
            await assertApplicationAvailable()
            authorizeActor(binding)
            assertNoActiveConnection(binding)
            const issuedAt = now()
            const expiresAt = issuedAt + token.expiresInSeconds * 1000
            if (!Number.isSafeInteger(expiresAt)) return fail('provider_unavailable')
            // The issuance metadata is encrypted with the credential and lets a
            // later worker enforce the provider refresh age.
            const providerSession = JSON.stringify({
                version: 1,
                issuedAt,
                appScopedId: account.appScopedId,
                accountType: account.accountType,
            })
            const saved = await options.credentials.createPublisherCredential({
                projectId: binding.projectId,
                connectedByActorId: actorId,
                providerId,
                providerApplicationId: options.applicationId,
                // The professional account publishes; the app-scoped identity
                // never addresses a media endpoint.
                externalAccountId: account.id,
                externalAccountName: account.username,
                scopes: token.scopes,
                accessToken: token.accessToken,
                // The provider grants no refresh token; none is invented.
                refreshToken: null,
                providerSession,
                expiresAt,
            })
            if (saved.kind === 'not_found') return fail('not_found')
            const credentialId = saved.credential.id
            const created = saved.kind === 'created'
            if (saved.kind === 'already_exists') {
                await assertApplicationAvailable()
                authorizeActor(binding)
                assertNoActiveConnection(binding)
                // A reused credential carries the token and the application that
                // issued it, never the metadata of another application.
                const replaced = await options.credentials.replacePublisherCredentialTokens({
                    projectId: binding.projectId,
                    credentialId,
                    scopes: token.scopes,
                    providerApplicationId: options.applicationId,
                    accessToken: token.accessToken,
                    refreshToken: null,
                    providerSession,
                    expiresAt,
                })
                if (replaced.kind !== 'updated') {
                    if (created)
                        options.credentials.revokePublisherCredential(
                            binding.projectId,
                            credentialId
                        )
                    return fail('conflict')
                }
            }
            // A reconnectable credential can now make its pinned connection
            // active. Recheck the application before the final synchronous
            // actor/connection checks, so its await cannot leave stale access.
            try {
                await assertApplicationAvailable()
                authorizeActor(binding)
                assertNoActiveConnection(binding, replacement?.id)
            } catch (error) {
                if (created)
                    options.credentials.revokePublisherCredential(binding.projectId, credentialId)
                throw error
            }
            let connected
            try {
                connected = options.publishers.createPublisherConnection({
                    projectId: binding.projectId,
                    channelId: binding.channelId,
                    subjectId: binding.subjectId,
                    kind: providerId,
                    credentialId,
                    replaceNonActiveConnection: replacement,
                    destination: { type: 'account', id: account.id, name: account.username },
                })
            } catch {
                if (created)
                    options.credentials.revokePublisherCredential(binding.projectId, credentialId)
                return fail('conflict')
            }
            if (connected.kind !== 'created') {
                // A newly created credential that no channel references is
                // revoked; an existing project credential is left untouched.
                if (created)
                    options.credentials.revokePublisherCredential(binding.projectId, credentialId)
                return fail('conflict')
            }
            return { connection: connected.connection, returnPath: attempt.returnPath }
        },
    }
}
