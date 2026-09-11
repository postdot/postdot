import type { AccessStore } from '@herald/db'
import {
    MASTODON_PROVIDER,
    MASTODON_REQUIRED_SCOPES,
    createMastodonPublisher,
    normalizeMastodonInstanceOrigin,
    type MastodonFetcher,
} from '@herald/mastodon'
import {
    clientSecretPost,
    createAuthorizationRequest,
    digestAuthorizationState,
    exchangeAuthorizationCode,
    validateAuthorizationResponse,
    type OAuthAuthorizationServer,
} from '@herald/oauth'
import type { Logger } from 'pino'
import { Type } from 'typebox'

import { sessionSecurity, type AuthenticatedElysia } from '../../../plugins/auth'
import type { PublisherRuntime } from '../../publishers/runtime'
import { canAccessProjectRole, forbiddenProjectMutation } from '../authorization'
import { errorResponse, mastodonConnectionBody, mastodonConnectionSchema } from '../models'

interface MastodonAuthorizationState {
    readonly version: 1
    readonly instanceUrl: string
    readonly clientId: string
    readonly clientSecret: string
}

export function registerMastodonPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly access: AccessStore
        readonly logger?: Logger
        readonly onWorkScheduled?: () => void
        readonly mastodonFetcher?: MastodonFetcher
    }
) {
    const { authorizationAttemptStore, credentialStore, mastodon, publisherStore } = publisher

    return app
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/mastodon/connect',
            {
                auth: true,
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    channelId: Type.String({ minLength: 1 }),
                }),
                body: mastodonConnectionBody,
                response: {
                    200: mastodonConnectionSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'startMastodonPublisherConnection',
                    summary: 'Start a Mastodon publisher connection flow',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human authentication is required to connect Mastodon',
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

                if (publisherStore.hasPublisherForChannel(params.projectId, params.channelId)) {
                    return status(409, {
                        error: {
                            code: 'publisher_exists',
                            message: 'This channel already has a publisher',
                        },
                    })
                }

                const actorId = publisherStore.getProjectActorId(params.projectId, user.id)
                if (actorId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                let instanceUrl: string
                try {
                    instanceUrl = normalizeMastodonInstanceOrigin(body.instanceUrl)
                } catch {
                    return status(400, {
                        error: {
                            code: 'invalid_instance',
                            message: 'The Mastodon instance must be a valid HTTPS origin',
                        },
                    })
                }

                const callbackUri = mastodon.callbackUri
                const mastodonClient = createMastodonPublisher({
                    baseUrl: instanceUrl,
                    ...(options.mastodonFetcher === undefined
                        ? {}
                        : { fetcher: options.mastodonFetcher }),
                })
                const application = await mastodonClient.registerApplication({
                    clientName: mastodon.clientName,
                    redirectUri: callbackUri,
                    scopes: MASTODON_REQUIRED_SCOPES,
                    website: publisher.webOrigin,
                })
                if (application.kind === 'failure') {
                    logMastodonFlowError(options.logger, {
                        channelId: params.channelId,
                        projectId: params.projectId,
                        stage: 'application_registration',
                    })
                    if (application.outcome.code === 'network_policy_denied') {
                        return status(503, {
                            error: {
                                code: 'network_policy_denied',
                                message:
                                    'The Mastodon instance is blocked by the server network policy',
                            },
                        })
                    }
                    return status(503, {
                        error: {
                            code: 'provider_unavailable',
                            message: 'The Mastodon instance could not register Herald',
                        },
                    })
                }

                try {
                    const authorization = await createAuthorizationRequest({
                        authorizationServer: mastodonAuthorizationServer(instanceUrl),
                        clientId: application.value.clientId,
                        callbackUri,
                        scopes: MASTODON_REQUIRED_SCOPES,
                    })
                    const attempt = await authorizationAttemptStore.createAuthorizationAttempt({
                        projectId: params.projectId,
                        channelId: params.channelId,
                        connectedByActorId: actorId,
                        providerId: MASTODON_PROVIDER,
                        callbackUri,
                        scopes: authorization.scopes,
                        returnPath: '/dashboard',
                        stateDigest: await digestAuthorizationState(authorization.state),
                        codeVerifier: authorization.codeVerifier,
                        providerState: serializeAuthorizationState({
                            version: 1,
                            instanceUrl,
                            clientId: application.value.clientId,
                            clientSecret: application.value.clientSecret,
                        }),
                    })
                    if (attempt.kind !== 'created') {
                        return status(503, {
                            error: {
                                code: 'provider_unavailable',
                                message: 'The Mastodon publisher connection is not available',
                            },
                        })
                    }

                    return {
                        provider: MASTODON_PROVIDER,
                        scopes: [...authorization.scopes],
                        authorizationUrl: authorization.url.toString(),
                    }
                } catch (error) {
                    logMastodonFlowError(
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
                            message: 'The Mastodon publisher connection is not available',
                        },
                    })
                }
            }
        )
        .get(
            '/api/oauth/mastodon/callback',
            {
                auth: true,
                detail: {
                    operationId: 'completeMastodonPublisherConnection',
                    summary: 'Complete a Mastodon publisher connection flow',
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
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        '/dashboard',
                        'invalid_callback'
                    )
                }

                const parameters = new URL(request.url).searchParams
                const state = parameters.get('state')
                if (state === null || state.length === 0) {
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        '/dashboard',
                        'invalid_callback'
                    )
                }

                let stateDigest: Uint8Array
                try {
                    stateDigest = await digestAuthorizationState(state)
                } catch {
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        '/dashboard',
                        'invalid_callback'
                    )
                }

                const pendingAttempt =
                    authorizationAttemptStore.getAuthorizationAttempt(stateDigest)
                if (pendingAttempt === null || pendingAttempt.providerId !== MASTODON_PROVIDER) {
                    return redirectMastodonPublisher(
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
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'invalid_callback'
                    )
                }

                const actorId = publisherStore.getProjectActorId(pendingAttempt.projectId, user.id)
                if (actorId !== pendingAttempt.connectedByActorId) {
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'invalid_callback'
                    )
                }

                const consumed = await authorizationAttemptStore.consumeAuthorizationAttempt({
                    stateDigest,
                    connectedByActorId: actorId,
                    providerId: MASTODON_PROVIDER,
                    callbackUri: mastodon.callbackUri,
                })
                if (consumed.kind !== 'consumed') {
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        consumed.kind === 'already_used' ? 'already_used' : 'invalid_callback'
                    )
                }

                const authorizationState = parseAuthorizationState(consumed.providerState)
                if (authorizationState === null) {
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        consumed.attempt.returnPath,
                        'invalid_callback'
                    )
                }

                try {
                    const authorizationServer = mastodonAuthorizationServer(
                        authorizationState.instanceUrl
                    )
                    const callbackParameters = validateAuthorizationResponse({
                        authorizationServer,
                        clientId: authorizationState.clientId,
                        parameters,
                        expectedState: state,
                    })
                    const tokenSet = await exchangeAuthorizationCode({
                        authorizationServer,
                        clientId: authorizationState.clientId,
                        clientAuthentication: clientSecretPost(authorizationState.clientSecret),
                        callbackParameters,
                        callbackUri: mastodon.callbackUri,
                        codeVerifier: consumed.codeVerifier,
                        ...(options.mastodonFetcher === undefined
                            ? {}
                            : { fetcher: options.mastodonFetcher }),
                    })
                    const mastodonClient = createMastodonPublisher({
                        baseUrl: authorizationState.instanceUrl,
                        ...(options.mastodonFetcher === undefined
                            ? {}
                            : { fetcher: options.mastodonFetcher }),
                    })
                    const account = await mastodonClient.verifyCredentials(tokenSet.accessToken)
                    if (account.kind === 'failure') {
                        return redirectMastodonPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            'provider_unavailable'
                        )
                    }

                    const credential = await credentialStore.createPublisherCredential({
                        projectId: consumed.attempt.projectId,
                        connectedByActorId: consumed.attempt.connectedByActorId,
                        providerId: MASTODON_PROVIDER,
                        externalAccountId: account.value.id,
                        externalAccountName: account.value.acct,
                        scopes: [...(tokenSet.scopes ?? consumed.attempt.scopes)],
                        accessToken: tokenSet.accessToken,
                        refreshToken: tokenSet.refreshToken,
                        providerSession: serializeAuthorizationState(authorizationState),
                        expiresAt: tokenExpiry(tokenSet.expiresInSeconds, publisher.now()),
                    })
                    if (credential.kind !== 'created') {
                        return redirectMastodonPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            'provider_unavailable'
                        )
                    }

                    const connection = publisherStore.createPublisherConnection({
                        projectId: consumed.attempt.projectId,
                        channelId: consumed.attempt.channelId,
                        subjectId: user.id,
                        kind: MASTODON_PROVIDER,
                        credentialId: credential.credential.id,
                        endpointUrl: authorizationState.instanceUrl,
                        destination: {
                            type: 'account',
                            id: account.value.id,
                            name: account.value.acct,
                        },
                    })
                    if (connection.kind !== 'created') {
                        return redirectMastodonPublisher(
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
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        consumed.attempt.returnPath,
                        'connected'
                    )
                } catch (error) {
                    logMastodonFlowError(
                        options.logger,
                        {
                            channelId: consumed.attempt.channelId,
                            projectId: consumed.attempt.projectId,
                            stage: 'callback',
                        },
                        error
                    )
                    return redirectMastodonPublisher(
                        publisher.webOrigin,
                        consumed.attempt.returnPath,
                        'provider_unavailable'
                    )
                }
            }
        )
}

function mastodonAuthorizationServer(instanceUrl: string): OAuthAuthorizationServer {
    return {
        issuer: instanceUrl,
        authorizationEndpoint: `${instanceUrl}/oauth/authorize`,
        tokenEndpoint: `${instanceUrl}/oauth/token`,
        pkce: 'required',
    }
}

function serializeAuthorizationState(state: MastodonAuthorizationState): string {
    return JSON.stringify(state)
}

function parseAuthorizationState(value: string | null): MastodonAuthorizationState | null {
    if (value === null) return null
    try {
        const parsed = JSON.parse(value) as Partial<MastodonAuthorizationState>
        if (
            parsed.version !== 1 ||
            typeof parsed.instanceUrl !== 'string' ||
            typeof parsed.clientId !== 'string' ||
            typeof parsed.clientSecret !== 'string'
        ) {
            return null
        }
        const instanceUrl = normalizeMastodonInstanceOrigin(parsed.instanceUrl)
        if (parsed.clientId.trim().length === 0 || parsed.clientSecret.trim().length === 0) {
            return null
        }
        return {
            version: 1,
            instanceUrl,
            clientId: parsed.clientId,
            clientSecret: parsed.clientSecret,
        }
    } catch {
        return null
    }
}

function tokenExpiry(expiresInSeconds: number | null, now: number): number | null {
    if (expiresInSeconds === null || !Number.isSafeInteger(expiresInSeconds)) return null
    const expiresAt = now + expiresInSeconds * 1_000
    return Number.isSafeInteger(expiresAt) && expiresAt > now ? expiresAt : null
}

function logMastodonFlowError(
    logger: Logger | undefined,
    fields: { readonly channelId: string; readonly projectId: string; readonly stage: string },
    error?: unknown
) {
    logger?.error(
        {
            ...fields,
            provider: MASTODON_PROVIDER,
            error:
                error instanceof Error ? { name: error.name, message: redact(error.message) } : {},
        },
        'Mastodon publisher flow failed'
    )
}

function redact(message: string): string {
    return message
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(
            /\b(access_token|refresh_token|client_secret|code_verifier|state|code)=\S+/gi,
            '$1=[redacted]'
        )
        .replace(/\s+/g, ' ')
        .slice(0, 500)
}

function redirectMastodonPublisher(
    webOrigin: string,
    returnPath: string,
    result:
        | 'connected'
        | 'already_used'
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
