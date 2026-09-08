import type { PublisherConnectionDestination } from '@herald/db'
import {
    LINKEDIN_PROVIDER,
    LINKEDIN_MEMBER_REQUIRED_SCOPES,
    LINKEDIN_ORGANIZATION_REQUIRED_SCOPES,
    LinkedInOrganizationError,
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

import { sessionSecurity, type AuthenticatedElysia } from '../../../plugins/auth'
import type { PublisherRuntime } from '../../publishers/runtime'
import { errorResponse, linkedInConnectionBody, linkedInConnectionSchema } from '../models'

export function registerLinkedInPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly logger?: Logger
        readonly onWorkScheduled?: () => void
    } = {}
) {
    const { authorizationAttemptStore, credentialStore, publisherStore } = publisher

    return app
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/linkedin/connect',
            {
                auth: true,
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    channelId: Type.String({ minLength: 1 }),
                }),
                body: Type.Optional(linkedInConnectionBody),
                response: {
                    200: linkedInConnectionSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'startLinkedInPublisherConnection',
                    summary: 'Start the LinkedIn publisher connection flow',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human authentication is required to connect LinkedIn',
                        },
                    })
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

                let linkedin: Awaited<ReturnType<PublisherRuntime['resolveLinkedInApplication']>>
                try {
                    linkedin = await publisher.resolveLinkedInApplication()
                } catch {
                    return status(503, {
                        error: {
                            code: 'provider_unavailable',
                            message: 'LinkedIn publisher connection is not configured',
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

                const actorId = publisherStore.getProjectActorId(params.projectId, user.id)
                if (actorId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                const destination = normalizeLinkedInConnectionDestination(body?.destination)
                if (destination === null) {
                    return status(400, {
                        error: {
                            code: 'invalid_destination',
                            message: 'The LinkedIn destination is invalid',
                        },
                    })
                }

                try {
                    const authorization = await createAuthorizationRequest({
                        authorizationServer: linkedin.authorizationServer,
                        clientId: linkedin.clientId,
                        callbackUri: publisher.callbackUri,
                        scopes:
                            destination.type === 'organization'
                                ? LINKEDIN_ORGANIZATION_REQUIRED_SCOPES
                                : LINKEDIN_MEMBER_REQUIRED_SCOPES,
                    })
                    const attempt = await authorizationAttemptStore.createAuthorizationAttempt({
                        projectId: params.projectId,
                        channelId: params.channelId,
                        connectedByActorId: actorId,
                        providerId: LINKEDIN_PROVIDER,
                        providerApplicationId: linkedin.applicationId,
                        callbackUri: publisher.callbackUri,
                        scopes: authorization.scopes,
                        returnPath: '/dashboard',
                        context: { destination },
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
                    return redirectPublisher(publisher.webOrigin, '/dashboard', 'invalid_callback')
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

                let linkedin: Awaited<ReturnType<PublisherRuntime['resolveLinkedInApplication']>>
                try {
                    linkedin = await publisher.resolveLinkedInApplication(
                        pendingAttempt.providerApplicationId ?? null
                    )
                } catch {
                    return redirectPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'provider_unavailable'
                    )
                }
                if (linkedin === undefined) {
                    return redirectPublisher(
                        publisher.webOrigin,
                        pendingAttempt.returnPath,
                        'provider_unavailable'
                    )
                }

                const actorId = publisherStore.getProjectActorId(pendingAttempt.projectId, user.id)
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
                    | 'fetch_destination'
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
                    callbackStage = 'fetch_destination'
                    const requestedDestination = readLinkedInAuthorizationDestination(
                        consumed.attempt.context
                    )
                    if (requestedDestination === null) {
                        return redirectPublisher(
                            publisher.webOrigin,
                            consumed.attempt.returnPath,
                            'invalid_callback'
                        )
                    }
                    const destination =
                        requestedDestination.type === 'organization'
                            ? await linkedin.organizationClient.getOrganization(
                                  tokenSet.accessToken,
                                  requestedDestination.id
                              )
                            : {
                                  type: 'member',
                                  id: profile.id,
                                  name: profile.name,
                              }
                    const normalizedDestination: PublisherConnectionDestination = {
                        type: requestedDestination.type,
                        id: destination.id,
                        name: destination.name,
                    }
                    const expiresAt = tokenExpiry(publisher.now(), tokenSet.expiresInSeconds)
                    callbackStage = 'save_credential'
                    const credential = await savePublisherCredential({
                        credentialStore,
                        projectId: consumed.attempt.projectId,
                        connectedByActorId: consumed.attempt.connectedByActorId,
                        profile,
                        providerId: LINKEDIN_PROVIDER,
                        providerApplicationId: consumed.attempt.providerApplicationId,
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
                        destination: normalizedDestination,
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
                        isInvalidLinkedInDestinationError(error)
                            ? 'invalid_destination'
                            : 'provider_unavailable'
                    )
                }
            }
        )
}

async function savePublisherCredential(input: {
    readonly credentialStore: PublisherRuntime['credentialStore']
    readonly projectId: string
    readonly connectedByActorId: string
    readonly providerId: string
    readonly providerApplicationId?: string | null
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
        providerApplicationId: input.providerApplicationId,
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

type LinkedInAuthorizationDestination =
    | { readonly type: 'member' }
    | { readonly type: 'organization'; readonly id: string }

function normalizeLinkedInConnectionDestination(
    value:
        | { readonly type: 'member' }
        | { readonly type: 'organization'; readonly id: string }
        | undefined
): LinkedInAuthorizationDestination | null {
    if (value === undefined || value.type === 'member') return { type: 'member' }
    const id = value.id.trim()
    return isPositiveNumericIdentifier(id) ? { type: 'organization', id } : null
}

function readLinkedInAuthorizationDestination(
    context: Readonly<Record<string, unknown>>
): LinkedInAuthorizationDestination | null {
    const value = context.destination
    if (value === undefined) return null
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

    const destination = value as Record<string, unknown>
    if (destination.type === 'member') return { type: 'member' }
    if (destination.type !== 'organization' || typeof destination.id !== 'string') return null

    const id = destination.id.trim()
    return isPositiveNumericIdentifier(id) ? { type: 'organization', id } : null
}

function isPositiveNumericIdentifier(value: string): boolean {
    return /^[1-9]\d*$/.test(value)
}

function isInvalidLinkedInDestinationError(error: unknown): boolean {
    return (
        error instanceof LinkedInOrganizationError && (error.status === 403 || error.status === 404)
    )
}

function redirectPublisher(
    webOrigin: string,
    returnPath: string,
    result:
        | 'connected'
        | 'already_used'
        | 'invalid_callback'
        | 'invalid_destination'
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
