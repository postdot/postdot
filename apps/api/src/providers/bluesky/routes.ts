import {
    BLUESKY_PROVIDER,
    BLUESKY_REQUIRED_SCOPES,
    createBlueskyOAuthClient,
    createBlueskyMemoryStore,
    createBlueskySessionStore,
    createBlueskyStateStore,
    createBlueskyStateStoreWithKeyCapture,
    readBlueskySessionTokenSet,
} from '@postdot/bluesky'
import type { AccessStore } from '@postdot/db'
import { digestAuthorizationState, isAuthorizationDeniedError } from '@postdot/oauth'
import type { Logger } from 'pino'
import { Type } from 'typebox'

import {
    canAccessProjectRole,
    forbiddenProjectMutation,
} from '../../modules/projects/authorization'
import { errorResponse } from '../../modules/projects/models'
import { publisherChannelsReturnPath } from '../../modules/projects/publisher-providers/publisher-redirect'
import type { PublisherRuntime } from '../../modules/publishers/runtime'
import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'
import { blueskyConnectionSchema, blueskyConnectionBody } from './models'

export function registerBlueskyPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly access: AccessStore
        readonly logger?: Logger
        readonly onWorkScheduled?: () => void
    }
) {
    const { authorizationAttemptStore, credentialStore, publisherStore } = publisher

    return app
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/bluesky/connect',
            {
                auth: true,
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    channelId: Type.String({ minLength: 1 }),
                }),
                body: blueskyConnectionBody,
                response: {
                    200: blueskyConnectionSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'startBlueskyPublisherConnection',
                    summary: 'Start the Bluesky publisher connection flow',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human authentication is required to connect Bluesky',
                        },
                    })
                }
                if (
                    !canAccessProjectRole({
                        access: options.access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }

                if (!publisherStore.hasChannelAccess(params.projectId, params.channelId, user.id)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                const existingConnection = publisherStore.getPublisherConnection(
                    params.projectId,
                    params.channelId,
                    user.id
                )
                if (existingConnection?.state === 'active') {
                    return status(409, {
                        error: {
                            code: 'publisher_exists',
                            message: 'This channel already has a publisher',
                        },
                    })
                }

                let bluesky: Awaited<ReturnType<PublisherRuntime['resolveBlueskyApplication']>>
                try {
                    bluesky = await publisher.resolveBlueskyApplication(body.providerApplicationId)
                } catch {
                    return status(503, {
                        error: {
                            code: 'provider_unavailable',
                            message: 'Bluesky publisher connection is not configured',
                        },
                    })
                }
                if (bluesky === undefined) {
                    return status(503, {
                        error: {
                            code: 'provider_unavailable',
                            message: 'Bluesky publisher connection is not configured',
                        },
                    })
                }

                const actorId = publisherStore.getProjectActorId(params.projectId, user.id)
                if (actorId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                try {
                    const serializedStateStore = createBlueskyMemoryStore()
                    const { getCapturedKey, stateStore } =
                        createBlueskyStateStoreWithKeyCapture(serializedStateStore)
                    const sessionStore = createBlueskyMemoryStore()
                    const client = createBlueskyOAuthClient({
                        clientMetadata: bluesky.clientMetadata,
                        handleResolver: bluesky.handleResolver,
                        stateStore,
                        sessionStore: createBlueskySessionStore(
                            sessionStore,
                            bluesky.clientMetadata.client_id
                        ),
                    })
                    const authorizationUrl = await client.authorize(body.handle.trim())
                    const state = getCapturedKey() ?? authorizationUrl.searchParams.get('state')
                    if (state === null || state.length === 0) {
                        return status(503, {
                            error: {
                                code: 'provider_unavailable',
                                message: 'Bluesky did not return an authorization state',
                            },
                        })
                    }

                    const providerState = await serializedStateStore.get(state)
                    if (providerState === undefined) {
                        return status(503, {
                            error: {
                                code: 'provider_unavailable',
                                message: 'Bluesky authorization state could not be stored',
                            },
                        })
                    }

                    const attempt = await authorizationAttemptStore.createAuthorizationAttempt({
                        projectId: params.projectId,
                        channelId: params.channelId,
                        connectedByActorId: actorId,
                        providerId: BLUESKY_PROVIDER,
                        providerApplicationId: bluesky.applicationId,
                        callbackUri: bluesky.callbackUri,
                        scopes: BLUESKY_REQUIRED_SCOPES,
                        returnPath: publisherChannelsReturnPath(params.projectId, params.channelId),
                        context: { handle: body.handle.trim() },
                        stateDigest: await digestAuthorizationState(state),
                        codeVerifier: null,
                        providerState,
                    })
                    if (attempt.kind !== 'created') {
                        return status(503, {
                            error: {
                                code: 'provider_unavailable',
                                message: 'Bluesky publisher connection is not available',
                            },
                        })
                    }

                    return {
                        provider: BLUESKY_PROVIDER,
                        scopes: [...BLUESKY_REQUIRED_SCOPES],
                        authorizationUrl: authorizationUrl.toString(),
                    }
                } catch (error) {
                    logBlueskyFlowError(
                        options.logger,
                        {
                            channelId: params.channelId,
                            projectId: params.projectId,
                            stage: 'authorization_request',
                        },
                        error
                    )
                    return status(503, {
                        error: {
                            code: 'provider_unavailable',
                            message: 'Bluesky publisher connection is not available',
                        },
                    })
                }
            }
        )
        .get(
            '/api/oauth/bluesky/callback',
            {
                auth: true,
                detail: {
                    operationId: 'completeBlueskyPublisherConnection',
                    summary: 'Complete a Bluesky publisher connection flow',
                    tags: ['Channels'],
                    security: sessionSecurity,
                    responses: {
                        401: {
                            description: 'Human authentication is required',
                            content: {
                                'application/json': { schema: errorResponse },
                            },
                        },
                    },
                },
            },
            async ({ authMethod, request, user }) => {
                if (authMethod !== 'session') {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        '/dashboard',
                        'invalid_callback'
                    )
                }

                const parameters = new URL(request.url).searchParams
                const state = parameters.get('state')
                if (state === null || state.length === 0) {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        '/dashboard',
                        'invalid_callback'
                    )
                }

                let stateDigest: Uint8Array
                try {
                    stateDigest = await digestAuthorizationState(state)
                } catch {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        '/dashboard',
                        'invalid_callback'
                    )
                }

                const pendingAttempt =
                    authorizationAttemptStore.getAuthorizationAttempt(stateDigest)
                if (pendingAttempt === null || pendingAttempt.providerId !== BLUESKY_PROVIDER) {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        '/dashboard',
                        'invalid_callback'
                    )
                }

                if (
                    !canAccessProjectRole({
                        access: options.access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: pendingAttempt.projectId,
                        userId: user.id,
                    })
                ) {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'invalid_callback'
                    )
                }

                let bluesky: Awaited<ReturnType<PublisherRuntime['resolveBlueskyApplication']>>
                try {
                    bluesky = await publisher.resolveBlueskyApplication(
                        pendingAttempt.providerApplicationId ?? null
                    )
                } catch {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'provider_unavailable'
                    )
                }
                if (bluesky === undefined) {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'provider_unavailable'
                    )
                }

                const actorId = publisherStore.getProjectActorId(pendingAttempt.projectId, user.id)
                if (actorId !== pendingAttempt.connectedByActorId) {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'invalid_callback'
                    )
                }

                const consumed = await authorizationAttemptStore.consumeAuthorizationAttempt({
                    stateDigest,
                    connectedByActorId: actorId,
                    providerId: BLUESKY_PROVIDER,
                    callbackUri: bluesky.callbackUri,
                })
                if (consumed.kind !== 'consumed') {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        consumed.kind === 'already_used' ? 'already_used' : 'invalid_callback'
                    )
                }
                if (consumed.providerState === null) {
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        consumed.attempt.returnPath,
                        'invalid_callback'
                    )
                }

                let callbackStage:
                    | 'restore_state'
                    | 'complete_callback'
                    | 'save_credential'
                    | 'create_connection' = 'restore_state'
                try {
                    const stateStore = createBlueskyMemoryStore([[state, consumed.providerState]])
                    const sessionStore = createBlueskyMemoryStore()
                    const client = createBlueskyOAuthClient({
                        clientMetadata: bluesky.clientMetadata,
                        handleResolver: bluesky.handleResolver,
                        stateStore: createBlueskyStateStore(stateStore),
                        sessionStore: createBlueskySessionStore(
                            sessionStore,
                            bluesky.clientMetadata.client_id
                        ),
                    })
                    callbackStage = 'complete_callback'
                    const callback = await client.callback(parameters)
                    const serializedSession = await sessionStore.get(callback.session.did)
                    if (serializedSession === undefined) {
                        return redirectBlueskyPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            'provider_unavailable'
                        )
                    }

                    callbackStage = 'save_credential'
                    const tokenSet = readBlueskySessionTokenSet(serializedSession)
                    if (tokenSet === null || tokenSet.sub !== callback.session.did) {
                        return redirectBlueskyPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            'provider_unavailable'
                        )
                    }

                    const existingConnection = publisherStore.getPublisherConnection(
                        consumed.attempt.projectId,
                        consumed.attempt.channelId,
                        user.id
                    )
                    const replaceNonActiveConnection =
                        existingConnection === null || existingConnection.state === 'active'
                            ? undefined
                            : { id: existingConnection.id, state: existingConnection.state }

                    const savedCredential = await credentialStore.createPublisherCredential({
                        projectId: consumed.attempt.projectId,
                        connectedByActorId: consumed.attempt.connectedByActorId,
                        providerId: BLUESKY_PROVIDER,
                        providerApplicationId: consumed.attempt.providerApplicationId,
                        externalAccountId: callback.session.did,
                        externalAccountName: readHandle(consumed.attempt.context),
                        scopes: [...tokenSet.scopes],
                        accessToken: tokenSet.accessToken,
                        refreshToken: tokenSet.refreshToken,
                        providerSession: serializedSession,
                        expiresAt: tokenExpiry(tokenSet.expiresAt, publisher.now()),
                    })
                    let credentialId: string
                    if (savedCredential.kind === 'created') {
                        credentialId = savedCredential.credential.id
                    } else if (savedCredential.kind === 'not_found') {
                        return redirectBlueskyPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            'provider_unavailable'
                        )
                    } else {
                        // Revocation intentionally keeps the credential row for audit/history.
                        // Reusing that row lets a later OAuth grant restore the connection without
                        // violating the project/provider/account uniqueness constraint.
                        const replaced = await credentialStore.replacePublisherCredentialTokens({
                            projectId: consumed.attempt.projectId,
                            credentialId: savedCredential.credential.id,
                            providerApplicationId: consumed.attempt.providerApplicationId,
                            scopes: [...tokenSet.scopes],
                            accessToken: tokenSet.accessToken,
                            refreshToken: tokenSet.refreshToken,
                            providerSession: serializedSession,
                            expiresAt: tokenExpiry(tokenSet.expiresAt, publisher.now()),
                        })
                        if (replaced.kind !== 'updated') {
                            return redirectBlueskyPublisher(
                                publisher.webOrigin,
                                consumed.attempt.returnPath,
                                'provider_unavailable'
                            )
                        }
                        credentialId = replaced.credential.id
                    }

                    callbackStage = 'create_connection'
                    const connection = publisherStore.createPublisherConnection({
                        projectId: consumed.attempt.projectId,
                        channelId: consumed.attempt.channelId,
                        subjectId: user.id,
                        kind: BLUESKY_PROVIDER,
                        credentialId,
                        destination: {
                            type: 'account',
                            id: callback.session.did,
                            name: readHandle(consumed.attempt.context),
                        },
                        replaceNonActiveConnection,
                    })
                    if (connection.kind !== 'created') {
                        return redirectBlueskyPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            connection.kind === 'publisher_exists'
                                ? 'publisher_exists'
                                : connection.kind === 'incompatible_profile'
                                  ? 'incompatible_profile'
                                  : 'provider_unavailable'
                        )
                    }

                    options.onWorkScheduled?.()
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        consumed.attempt.returnPath,
                        'connected'
                    )
                } catch (error) {
                    if (isAuthorizationDeniedError(error)) {
                        return redirectBlueskyPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            'authorization_denied'
                        )
                    }
                    logBlueskyFlowError(
                        options.logger,
                        {
                            channelId: consumed.attempt.channelId,
                            projectId: consumed.attempt.projectId,
                            stage: callbackStage,
                        },
                        error
                    )
                    return redirectBlueskyPublisher(
                        publisher.webOrigin,
                        consumed.attempt.returnPath,
                        'provider_unavailable'
                    )
                }
            }
        )
}

function tokenExpiry(expiresAt: string | null, now: number): number | null {
    if (expiresAt === null) return null
    const timestamp = Date.parse(expiresAt)
    return Number.isSafeInteger(timestamp) && timestamp > now ? timestamp : null
}

function readHandle(context: Readonly<Record<string, unknown>>): string | null {
    const handle = context.handle
    if (typeof handle !== 'string') return null
    const normalized = handle.trim()
    return normalized.length === 0 ? null : normalized
}

function logBlueskyFlowError(
    logger: Logger | undefined,
    fields: { readonly channelId: string; readonly projectId: string; readonly stage: string },
    error: unknown
) {
    logger?.error(
        {
            ...fields,
            provider: BLUESKY_PROVIDER,
            error:
                error instanceof Error ? { name: error.name, message: redact(error.message) } : {},
        },
        'Bluesky publisher flow failed'
    )
}

function redact(message: string): string {
    return message
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(
            /\b(access_token|refresh_token|client_secret|code_verifier|state)=\S+/gi,
            '$1=[redacted]'
        )
        .replace(/\s+/g, ' ')
        .slice(0, 500)
}

function redirectBlueskyPublisher(
    webOrigin: string,
    returnPath: string,
    result:
        | 'connected'
        | 'already_used'
        | 'authorization_denied'
        | 'invalid_callback'
        | 'provider_unavailable'
        | 'publisher_exists'
        | 'incompatible_profile'
) {
    const destination = new URL(returnPath, webOrigin)
    destination.searchParams.set('publisher', result)
    return new Response(null, {
        status: 303,
        headers: { location: destination.toString() },
    })
}
