import type {
    createAccessStore,
    createAuthorizationAttemptStore,
    createManualStore,
    createPublisherCredentialStore,
    createPublisherStore,
    AuthorizationAttempt,
} from '@postbot/db'
import {
    FACEBOOK_PUBLISH_PERMISSIONS,
    type createFacebookOAuth,
    type createFacebookPublisher,
} from '@postbot/facebook'

type Binding = {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly authMethod: 'session' | 'user_api_key'
}

const maximumExpiresInSeconds = 31_536_000

type PendingProviderState = {
    readonly token: string
    readonly expiresAt: number | null
}

/**
 * `expiresAt` is required. Only an explicit null is an unknown provider
 * deadline; a known one must be a safe integer still in the future.
 */
function parsePendingProviderState(
    providerState: string,
    now: number
): PendingProviderState | null {
    let value: unknown
    try {
        value = JSON.parse(providerState)
    } catch {
        return null
    }
    if (
        value === null ||
        typeof value !== 'object' ||
        !('token' in value) ||
        typeof value.token !== 'string' ||
        !('expiresAt' in value)
    )
        return null
    const expiresAt = value.expiresAt
    if (expiresAt === null) return { token: value.token, expiresAt: null }
    if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= now)
        return null
    return { token: value.token, expiresAt }
}

export class FacebookConnectionError extends Error {
    constructor(
        readonly code:
            | 'not_found'
            | 'forbidden'
            | 'invalid_attempt'
            | 'conflict'
            | 'provider_unavailable'
    ) {
        super('Facebook connection could not be completed')
        this.name = 'FacebookConnectionError'
    }
}

/** Internal orchestration. HTTP callers must supply an authenticated identity, never body identity fields. */
export function createFacebookConnectionFlow(options: {
    readonly attempts: ReturnType<typeof createAuthorizationAttemptStore>
    readonly credentials: ReturnType<typeof createPublisherCredentialStore>
    readonly publishers: ReturnType<typeof createPublisherStore>
    readonly channels: Pick<ReturnType<typeof createManualStore>, 'listChannels'>
    readonly access: Pick<ReturnType<typeof createAccessStore>, 'canAccessProject'>
    readonly oauth: ReturnType<typeof createFacebookOAuth>
    readonly graph: ReturnType<typeof createFacebookPublisher>
    readonly applicationId?: string | null
    readonly now?: () => number
}) {
    const now = options.now ?? Date.now
    const selectionProvider = 'facebook'
    const fail = (code: FacebookConnectionError['code']): never => {
        throw new FacebookConnectionError(code)
    }
    async function digest(state: string) {
        if (!/^[\x21-\x7e]{32,512}$/.test(state)) return fail('invalid_attempt')
        return new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))
        )
    }
    function authorize(binding: Binding) {
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
        if (channel.execution.kind !== 'built_in' || channel.execution.contractId !== 'facebook')
            return fail('conflict')
        const actorId = options.publishers.getProjectActorId(binding.projectId, binding.subjectId)
        if (!actorId) return fail('not_found')
        const connection = options.publishers.getPublisherConnection(
            binding.projectId,
            binding.channelId,
            binding.subjectId
        )
        if (connection?.state === 'active') return fail('conflict')
        return {
            actorId,
            replacement: connection ? { id: connection.id, state: connection.state } : undefined,
        }
    }
    function verifyAttempt(
        attempt: AuthorizationAttempt | null,
        binding: Binding,
        actorId: string,
        providerId: string,
        phase: 'authorization' | 'page-selection'
    ) {
        if (
            !attempt ||
            attempt.projectId !== binding.projectId ||
            attempt.channelId !== binding.channelId ||
            attempt.connectedByActorId !== actorId ||
            attempt.providerId !== providerId ||
            attempt.callbackUri !== options.oauth.callbackUri ||
            attempt.context.clientId !== options.oauth.clientId ||
            attempt.context.phase !== phase ||
            (attempt.providerApplicationId ?? null) !== (options.applicationId ?? null)
        )
            return fail('invalid_attempt')
        return attempt
    }
    async function pending(binding: Binding, state: string) {
        const authorization = authorize(binding)
        const stateDigest = await digest(state)
        verifyAttempt(
            options.attempts.getAuthorizationAttempt(stateDigest),
            binding,
            authorization.actorId,
            selectionProvider,
            'page-selection'
        )
        const input = {
            stateDigest,
            connectedByActorId: authorization.actorId,
            providerId: selectionProvider,
            callbackUri: options.oauth.callbackUri,
        }
        const stored = await options.attempts.readPendingAuthorizationProviderState(input)
        if (stored.kind !== 'ready' || !stored.providerState) return fail('invalid_attempt')
        const providerState = parsePendingProviderState(stored.providerState, now())
        if (providerState === null) return fail('invalid_attempt')
        return { authorization, input, token: providerState.token }
    }
    return {
        async start(binding: Binding, returnPath: string) {
            const { actorId } = authorize(binding)
            const request = await options.oauth.createAuthorizationRequest()
            const result = await options.attempts.createAuthorizationAttempt({
                projectId: binding.projectId,
                channelId: binding.channelId,
                connectedByActorId: actorId,
                providerId: 'facebook',
                providerApplicationId: options.applicationId,
                callbackUri: options.oauth.callbackUri,
                scopes: FACEBOOK_PUBLISH_PERMISSIONS,
                returnPath,
                context: { clientId: options.oauth.clientId, phase: 'authorization' },
                stateDigest: await digest(request.state),
                codeVerifier: request.codeVerifier,
            })
            if (result.kind !== 'created') return fail('conflict')
            return { url: request.url.toString() }
        },
        async complete(binding: Binding, parameters: URL) {
            const { actorId } = authorize(binding)
            if (parameters.searchParams.getAll('state').length !== 1) return fail('invalid_attempt')
            const state = parameters.searchParams.get('state') ?? ''
            const stateDigest = await digest(state)
            const attempt = verifyAttempt(
                options.attempts.getAuthorizationAttempt(stateDigest),
                binding,
                actorId,
                'facebook',
                'authorization'
            )
            // Consume before exchanging a one-use provider code, including on refused authorization.
            const consumed = await options.attempts.consumeAuthorizationAttempt({
                stateDigest,
                connectedByActorId: actorId,
                providerId: 'facebook',
                callbackUri: options.oauth.callbackUri,
            })
            if (consumed.kind !== 'consumed') return fail('invalid_attempt')
            const tokenSet = await options.oauth.complete({ parameters, expectedState: state })
            const expiresInSeconds = tokenSet.expiresInSeconds
            if (
                expiresInSeconds !== null &&
                (!Number.isSafeInteger(expiresInSeconds) ||
                    expiresInSeconds <= 0 ||
                    expiresInSeconds > maximumExpiresInSeconds)
            )
                return fail('invalid_attempt')
            // The provider deadline is measured when the exchange completed, so a
            // slow permission probe cannot extend the pending token's lifetime.
            const providerExpiresAt =
                expiresInSeconds === null ? null : now() + expiresInSeconds * 1000
            if (providerExpiresAt !== null && !Number.isSafeInteger(providerExpiresAt))
                return fail('invalid_attempt')
            // Permissions are checked again at selection; no Page token is returned from this phase.
            const permission = await options.graph.getGrantedPermissions(tokenSet.accessToken)
            if (
                !permission.ok ||
                FACEBOOK_PUBLISH_PERMISSIONS.some(scope => !permission.value.includes(scope))
            )
                return fail('provider_unavailable')
            // A known deadline that the permission probe crossed is not a usable pending choice.
            if (providerExpiresAt !== null && now() >= providerExpiresAt)
                return fail('invalid_attempt')
            authorize(binding)
            const selection = crypto.randomUUID() + crypto.randomUUID()
            const created = await options.attempts.createAuthorizationAttempt({
                projectId: binding.projectId,
                channelId: binding.channelId,
                connectedByActorId: actorId,
                providerId: selectionProvider,
                providerApplicationId: options.applicationId,
                callbackUri: options.oauth.callbackUri,
                scopes: permission.value,
                returnPath: attempt.returnPath,
                context: { clientId: options.oauth.clientId, phase: 'page-selection' },
                stateDigest: await digest(selection),
                codeVerifier: null,
                providerState: JSON.stringify({
                    token: tokenSet.accessToken,
                    expiresAt: providerExpiresAt,
                }),
            })
            if (created.kind !== 'created') return fail('conflict')
            return {
                selection,
                expiresAt: created.attempt.expiresAt,
                returnPath: created.attempt.returnPath,
            }
        },
        async listPages(binding: Binding, selection: string, after?: string) {
            const { token } = await pending(binding, selection)
            const result = await options.graph.listPages({ userToken: token, after })
            if (!result.ok) return fail('provider_unavailable')
            authorize(binding)
            return {
                pages: result.value.pages.map(({ id, name, hasPublishTask }) => ({
                    id,
                    name,
                    hasPublishTask,
                })),
                nextCursor: result.value.nextCursor,
            }
        },
        async selectPage(binding: Binding, selection: string, pageId: string, after?: string) {
            const { token, input } = await pending(binding, selection)
            const selected = await options.graph.selectPage({ userToken: token, pageId, after })
            if (!selected.ok) return fail('provider_unavailable')
            const { actorId, replacement } = authorize(binding)
            const consumed = await options.attempts.consumeAuthorizationAttempt(input)
            if (consumed.kind !== 'consumed') return fail('invalid_attempt')
            const { page, grantedPermissions } = selected.value
            const saved = await options.credentials.createPublisherCredential({
                projectId: binding.projectId,
                connectedByActorId: actorId,
                providerId: 'facebook',
                externalAccountId: page.id,
                externalAccountName: page.name,
                scopes: grantedPermissions,
                accessToken: page.accessToken,
                expiresAt: null,
            })
            if (saved.kind !== 'created' && saved.kind !== 'already_exists') return fail('conflict')
            const credentialId = saved.credential.id
            if (saved.kind === 'already_exists') {
                const replaced = await options.credentials.replacePublisherCredentialTokens({
                    projectId: binding.projectId,
                    credentialId,
                    accessToken: page.accessToken,
                    refreshToken: null,
                    expiresAt: null,
                })
                if (replaced.kind !== 'updated') return fail('conflict')
            }
            try {
                const connected = options.publishers.createPublisherConnection({
                    projectId: binding.projectId,
                    channelId: binding.channelId,
                    subjectId: binding.subjectId,
                    kind: 'facebook',
                    credentialId,
                    replaceNonActiveConnection: replacement,
                    destination: { type: 'channel', id: page.id, name: page.name },
                })
                if (connected.kind !== 'created') return fail('conflict')
                return { connection: connected.connection }
            } catch {
                if (saved.kind === 'created')
                    options.credentials.revokePublisherCredential(binding.projectId, credentialId)
                return fail('conflict')
            }
        },
    }
}
