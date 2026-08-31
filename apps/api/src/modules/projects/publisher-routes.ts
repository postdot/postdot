import { isCustomHttpAuthentication } from '@herald/core'
import { CUSTOM_HTTP_PUBLISHER_KIND, normalizeCustomHttpEndpoint } from '@herald/custom-http'
import {
    LINKEDIN_PROVIDER,
    LINKEDIN_REQUIRED_SCOPES,
    type LinkedInMemberProfile,
} from '@herald/linkedin'
import {
    createAuthorizationRequest,
    digestAuthorizationState,
    exchangeAuthorizationCode,
    validateAuthorizationResponse,
} from '@herald/oauth'
import type { Logger } from 'pino'
import { Type } from 'typebox'

import type { PublisherRuntime } from '../publishers/runtime'
import {
    errorResponse,
    customHttpConnectionBody,
    customHttpConnectionResponse,
    linkedInConnectionSchema,
    projectParams,
    publisherConnectionsSchema,
    publisherDisconnectedSchema,
} from './models'
import type { AuthenticatedElysia } from './types'

export function registerPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly logger?: Logger
        readonly onWorkScheduled?: () => void
    } = {}
) {
    const { authorizationAttemptStore, credentialStore, linkedin, publisherStore } = publisher

    return app
        .get(
            '/api/projects/:projectId/publishers',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: publisherConnectionsSchema,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectPublishers',
                    summary: 'List connected publishers in a project',
                    tags: ['Channels'],
                },
            },
            ({ params, status, user }) => {
                const connections = publisherStore.listPublisherConnections(
                    params.projectId,
                    user.id
                )
                if (connections === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                return { connections }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/custom-http/connect',
            {
                auth: true,
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    channelId: Type.String({ minLength: 1 }),
                }),
                body: customHttpConnectionBody,
                response: {
                    200: customHttpConnectionResponse,
                    400: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'createCustomHttpPublisherConnection',
                    summary: 'Create a custom HTTP publisher connection',
                    tags: ['Channels'],
                },
            },
            async ({ body, params, status, user }) => {
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

                let endpoint: ReturnType<typeof normalizeCustomHttpEndpoint>
                try {
                    endpoint = normalizeCustomHttpEndpoint(body.endpointUrl)
                } catch {
                    return status(400, {
                        error: {
                            code: 'invalid_connection',
                            message:
                                'The custom HTTP endpoint must be a valid origin-only HTTP URL',
                        },
                    })
                }
                if (!isCustomHttpAuthentication(body.authentication)) {
                    return status(400, {
                        error: {
                            code: 'invalid_connection',
                            message: 'The custom HTTP authentication configuration is invalid',
                        },
                    })
                }

                const actorId = publisherStore.getHumanActorId(params.projectId, user.id)
                if (actorId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                const credential = await publisher.credentialStore.createPublisherCredential({
                    projectId: params.projectId,
                    connectedByActorId: actorId,
                    providerId: CUSTOM_HTTP_PUBLISHER_KIND,
                    externalAccountId: crypto.randomUUID(),
                    externalAccountName: body.externalAccountName ?? endpoint.hostname,
                    scopes: [],
                    accessToken: body.secret,
                    expiresAt: null,
                })
                if (credential.kind !== 'created') {
                    return status(409, {
                        error: {
                            code: 'credential_exists',
                            message: 'The custom HTTP credential could not be created',
                        },
                    })
                }

                const connection = publisherStore.createPublisherConnection({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                    kind: CUSTOM_HTTP_PUBLISHER_KIND,
                    credentialId: credential.credential.id,
                    endpointUrl: endpoint.url.origin,
                    authentication: body.authentication,
                })
                if (connection.kind !== 'created') {
                    publisher.credentialStore.revokePublisherCredential(
                        params.projectId,
                        credential.credential.id
                    )
                    return connection.kind === 'publisher_exists'
                        ? status(409, {
                              error: {
                                  code: 'publisher_exists',
                                  message: 'This channel already has a publisher',
                              },
                          })
                        : status(400, {
                              error: {
                                  code: 'invalid_connection',
                                  message: 'The custom HTTP connection could not be created',
                              },
                          })
                }

                options.onWorkScheduled?.()
                return { connection: connection.connection }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/linkedin/connect',
            {
                auth: true,
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    channelId: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: linkedInConnectionSchema,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'startLinkedInPublisherConnection',
                    summary: 'Start the LinkedIn publisher connection flow',
                    tags: ['Channels'],
                },
            },
            async ({ params, status, user }) => {
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

                if (linkedin === undefined) {
                    return status(503, {
                        error: {
                            code: 'provider_unavailable',
                            message: 'LinkedIn publisher connection is not configured',
                        },
                    })
                }

                const actorId = publisherStore.getHumanActorId(params.projectId, user.id)
                if (actorId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                try {
                    const authorization = await createAuthorizationRequest({
                        authorizationServer: linkedin.authorizationServer,
                        clientId: linkedin.clientId,
                        callbackUri: publisher.callbackUri,
                        scopes: LINKEDIN_REQUIRED_SCOPES,
                    })
                    const attempt = await authorizationAttemptStore.createAuthorizationAttempt({
                        projectId: params.projectId,
                        channelId: params.channelId,
                        connectedByActorId: actorId,
                        providerId: LINKEDIN_PROVIDER,
                        callbackUri: publisher.callbackUri,
                        scopes: authorization.scopes,
                        returnPath: '/dashboard',
                        stateDigest: await digestAuthorizationState(authorization.state),
                        codeVerifier: authorization.codeVerifier,
                    })

                    if (attempt.kind !== 'created') {
                        return status(503, {
                            error: {
                                code: 'provider_unavailable',
                                message: 'LinkedIn publisher connection is not available',
                            },
                        })
                    }

                    return {
                        provider: LINKEDIN_PROVIDER,
                        scopes: [...authorization.scopes],
                        authorizationUrl: authorization.url.toString(),
                    }
                } catch (error) {
                    logPublisherFlowError(
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
                            message: 'LinkedIn publisher connection is not available',
                        },
                    })
                }
            }
        )
        .get(
            '/api/oauth/linkedin/callback',
            {
                auth: true,
                detail: {
                    operationId: 'completeLinkedInPublisherConnection',
                    summary: 'Complete a LinkedIn publisher connection flow',
                    tags: ['Channels'],
                },
            },
            async ({ request, user }) => {
                if (linkedin === undefined) {
                    return redirectPublisher(
                        publisher.webOrigin,
                        '/dashboard',
                        'provider_unavailable'
                    )
                }

                const parameters = new URL(request.url).searchParams
                const state = parameters.get('state')
                if (state === null || state.length === 0) {
                    return redirectPublisher(publisher.webOrigin, '/dashboard', 'invalid_callback')
                }

                let stateDigest: Uint8Array
                try {
                    stateDigest = await digestAuthorizationState(state)
                } catch {
                    return redirectPublisher(publisher.webOrigin, '/dashboard', 'invalid_callback')
                }

                const pendingAttempt =
                    authorizationAttemptStore.getAuthorizationAttempt(stateDigest)
                if (pendingAttempt === null || pendingAttempt.providerId !== LINKEDIN_PROVIDER) {
                    return redirectPublisher(publisher.webOrigin, '/dashboard', 'invalid_callback')
                }

                const actorId = publisherStore.getHumanActorId(pendingAttempt.projectId, user.id)
                if (actorId !== pendingAttempt.connectedByActorId) {
                    return redirectPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'invalid_callback'
                    )
                }

                const consumed = await authorizationAttemptStore.consumeAuthorizationAttempt({
                    stateDigest,
                    connectedByActorId: actorId,
                    providerId: LINKEDIN_PROVIDER,
                    callbackUri: publisher.callbackUri,
                })
                if (consumed.kind !== 'consumed') {
                    return redirectPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        consumed.kind === 'already_used' ? 'already_used' : 'invalid_callback'
                    )
                }

                let callbackStage:
                    | 'validate_response'
                    | 'exchange_authorization_code'
                    | 'fetch_profile'
                    | 'save_credential'
                    | 'create_connection' = 'validate_response'
                try {
                    const callbackParameters = validateAuthorizationResponse({
                        authorizationServer: linkedin.authorizationServer,
                        clientId: linkedin.clientId,
                        parameters,
                        expectedState: state,
                    })
                    callbackStage = 'exchange_authorization_code'
                    const tokenSet = await exchangeAuthorizationCode({
                        authorizationServer: linkedin.authorizationServer,
                        clientId: linkedin.clientId,
                        clientAuthentication: linkedin.clientAuthentication,
                        callbackParameters,
                        callbackUri: publisher.callbackUri,
                        codeVerifier: consumed.codeVerifier,
                    })
                    callbackStage = 'fetch_profile'
                    const profile = await linkedin.profileClient.getProfile(tokenSet.accessToken)
                    const expiresAt = tokenExpiry(publisher.now(), tokenSet.expiresInSeconds)
                    callbackStage = 'save_credential'
                    const credential = await savePublisherCredential({
                        credentialStore,
                        projectId: consumed.attempt.projectId,
                        connectedByActorId: consumed.attempt.connectedByActorId,
                        profile,
                        providerId: LINKEDIN_PROVIDER,
                        scopes: tokenSet.scopes ?? consumed.attempt.scopes,
                        accessToken: tokenSet.accessToken,
                        refreshToken: tokenSet.refreshToken ?? undefined,
                        expiresAt,
                    })
                    if (credential === null) {
                        return redirectPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            'provider_unavailable'
                        )
                    }

                    callbackStage = 'create_connection'
                    const connection = publisherStore.createPublisherConnection({
                        projectId: consumed.attempt.projectId,
                        channelId: consumed.attempt.channelId,
                        subjectId: user.id,
                        kind: LINKEDIN_PROVIDER,
                        credentialId: credential.id,
                    })
                    if (connection.kind !== 'created') {
                        return redirectPublisher(
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
                    return redirectPublisher(
                        publisher.webOrigin,
                        consumed.attempt.returnPath,
                        'connected'
                    )
                } catch (error) {
                    logPublisherFlowError(
                        options.logger,
                        {
                            channelId: consumed.attempt.channelId,
                            projectId: consumed.attempt.projectId,
                            stage: callbackStage,
                        },
                        error
                    )
                    return redirectPublisher(
                        publisher.webOrigin,
                        consumed.attempt.returnPath,
                        'provider_unavailable'
                    )
                }
            }
        )
        .delete(
            '/api/projects/:projectId/channels/:channelId/publisher',
            {
                auth: true,
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    channelId: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: publisherDisconnectedSchema,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'disconnectProjectPublisher',
                    summary: 'Disconnect the publisher from a project channel',
                    tags: ['Channels'],
                },
            },
            ({ params, status, user }) => {
                const result = publisherStore.disconnectPublisherConnection({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                })

                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publisher not found' },
                    })
                }

                if (result.kind === 'active_work') {
                    return status(409, {
                        error: {
                            code: 'publisher_has_active_work',
                            message: 'The publisher cannot be disconnected while work is active',
                        },
                    })
                }

                return { disconnected: true as const }
            }
        )
}

async function savePublisherCredential(input: {
    readonly credentialStore: PublisherRuntime['credentialStore']
    readonly projectId: string
    readonly connectedByActorId: string
    readonly providerId: string
    readonly profile: LinkedInMemberProfile
    readonly scopes: readonly string[]
    readonly accessToken: string
    readonly refreshToken?: string | null
    readonly expiresAt: number | null
}) {
    const result = await input.credentialStore.createPublisherCredential({
        projectId: input.projectId,
        connectedByActorId: input.connectedByActorId,
        providerId: input.providerId,
        externalAccountId: input.profile.id,
        externalAccountName: input.profile.name,
        scopes: input.scopes,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
    })
    if (result.kind === 'created') return result.credential
    if (result.kind === 'not_found') return null

    const replaced = await input.credentialStore.replacePublisherCredentialTokens({
        projectId: input.projectId,
        credentialId: result.credential.id,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
    })
    return replaced.kind === 'updated' ? replaced.credential : null
}

function tokenExpiry(now: number, expiresInSeconds: number | null): number | null {
    if (expiresInSeconds === null) return null
    if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new Error('OAuth token expiry is invalid')
    }

    const expiresAt = now + expiresInSeconds * 1000
    if (!Number.isSafeInteger(expiresAt)) throw new Error('OAuth token expiry is out of range')
    return expiresAt
}

function logPublisherFlowError(
    logger: Logger | undefined,
    fields: {
        readonly channelId: string
        readonly projectId: string
        readonly stage: string
    },
    error: unknown
) {
    if (logger === undefined) return

    logger.error(
        {
            ...fields,
            error: safeErrorDetails(error),
            provider: LINKEDIN_PROVIDER,
        },
        'LinkedIn publisher flow failed'
    )
}

function safeErrorDetails(error: unknown) {
    if (!(error instanceof Error)) {
        return { name: 'UnknownError', message: 'The failure did not provide an Error instance' }
    }

    const details: {
        readonly name: string
        readonly message: string
        readonly status?: number
        readonly providerCode?: string
        readonly providerDescription?: string
    } = {
        name: error.name,
        message: redactErrorMessage(error.message),
    }

    const status = readNumberProperty(error, 'status')
    const providerCode = readStringProperty(error, 'error')
    const providerDescription = readStringProperty(error, 'error_description')

    return {
        ...details,
        ...(status === undefined ? {} : { status }),
        ...(providerCode === undefined ? {} : { providerCode }),
        ...(providerDescription === undefined ? {} : { providerDescription }),
    }
}

function readNumberProperty(value: object, key: string): number | undefined {
    if (!(key in value)) return undefined
    const candidate = (value as Record<string, unknown>)[key]
    return typeof candidate === 'number' && Number.isSafeInteger(candidate) ? candidate : undefined
}

function readStringProperty(value: object, key: string): string | undefined {
    if (!(key in value)) return undefined
    const candidate = (value as Record<string, unknown>)[key]
    return typeof candidate === 'string' ? redactErrorMessage(candidate) : undefined
}

function redactErrorMessage(message: string): string {
    return message
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(
            /\b(access_token|refresh_token|client_secret|code_verifier|authorization_code|state)=\S+/gi,
            '$1=[redacted]'
        )
        .replace(/\s+/g, ' ')
        .slice(0, 500)
}

function redirectPublisher(
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
