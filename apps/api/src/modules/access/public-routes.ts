import {
    postdotPasswordPolicy,
    postdotUserApiKeyConfigId,
    runWithAuthorizedBootstrap,
    type PostdotAuth,
} from '@postdot/auth'
import type { AccessStore, DatabaseHandle } from '@postdot/db'
import { Elysia } from 'elysia'
import { Type } from 'typebox'

import {
    permissionsForCapabilities,
    type PostdotApiKeyCapability,
} from '../projects/api-key-permissions'
import {
    createdUserApiKeySchema,
    createUserApiKeyBody,
    expiresInFrom,
    generatedUserApiKeyName,
    metadataForProjectAccess,
    toUserApiKey,
} from './api-key-routes'

export interface PostdotBootstrapController {
    readonly mode: 'open' | 'token_required'
    readonly verifyToken?: (token: string) => boolean | Promise<boolean>
    readonly onClaimed?: () => void | Promise<void>
}

const instanceBootstrapModeSchema = Type.Union([
    Type.Literal('open'),
    Type.Literal('token_required'),
    Type.Literal('claimed'),
])
const instanceSetupStatusSchema = Type.Object({
    setupAvailable: Type.Boolean(),
    bootstrapMode: instanceBootstrapModeSchema,
})
const instanceBootstrapBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 200 }),
    email: Type.String({ minLength: 1, maxLength: 320 }),
    password: Type.String({
        minLength: postdotPasswordPolicy.minimumLength,
        maxLength: postdotPasswordPolicy.maximumLength,
    }),
    apiKey: Type.Optional(createUserApiKeyBody),
})
const instanceBootstrapResponseSchema = Type.Object({
    user: Type.Object({
        id: Type.String({ minLength: 1 }),
        name: Type.String({ minLength: 1 }),
        email: Type.String({ minLength: 1 }),
        role: Type.Literal('admin'),
    }),
    instance: Type.Object({
        state: Type.Literal('claimed'),
        claimedByUserId: Type.String({ minLength: 1 }),
        claimedAt: Type.Integer({ minimum: 0 }),
    }),
    apiKey: Type.Optional(createdUserApiKeySchema),
})
const invitationTokenParams = Type.Object({ token: Type.String({ minLength: 1 }) })
const invitationPreviewSchema = Type.Object({
    targetEmail: Type.String({ minLength: 1 }),
    expiresAt: Type.Integer({ minimum: 0 }),
})
const errorResponse = Type.Object({
    error: Type.Object({
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
    }),
})

class BootstrapConflictError extends Error {}
class BootstrapSignUpError extends Error {
    readonly code: string
    constructor(code: string, message: string) {
        super(message)
        this.code = code
    }
}

function readBootstrapTokenFromHeaders(headers: Headers): string | null {
    const headerToken = headers.get('x-postdot-bootstrap-token')?.trim()
    if (headerToken !== undefined && headerToken.length > 0) return headerToken
    const authorization = headers.get('authorization')
    if (authorization === null) return null
    const match = /^Bearer\s+(.+)$/i.exec(authorization)
    if (match === null) return null
    const bearer = match[1]?.trim() ?? ''
    return bearer.length > 0 ? bearer : null
}

/**
 * Public instance discovery is intentionally smaller than the authenticated
 * access summary. The browser only needs to know whether first-run setup is
 * available; instance ids, timestamps and ownership never leave the server.
 */
export function createPublicInstanceRoutes(
    access: AccessStore,
    options: {
        readonly auth: PostdotAuth
        readonly database: DatabaseHandle
        readonly allowAdditionalSignups?: boolean
        readonly bootstrap?: PostdotBootstrapController
        readonly now?: () => number
    }
) {
    const now = options.now ?? Date.now
    const bootstrapModeConfig = options.bootstrap?.mode ?? 'open'

    return new Elysia({ name: 'postdot-public-instance' })
        .get(
            '/api/instance/status',
            {
                response: { 200: instanceSetupStatusSchema },
                detail: {
                    operationId: 'getInstanceSetupStatus',
                    summary: 'Check whether first-run instance setup is available',
                    tags: ['System'],
                    security: [],
                },
            },
            async () => {
                // The E2E runtime may explicitly allow additional isolated
                // accounts after bootstrap. Production never enables this
                // escape hatch, so first-run setup remains single-use there.
                const setupAvailable =
                    options.allowAdditionalSignups === true || (await access.isSignupAllowed())
                return {
                    setupAvailable,
                    bootstrapMode: setupAvailable ? bootstrapModeConfig : ('claimed' as const),
                }
            }
        )
        .post(
            '/api/instance/bootstrap',
            {
                body: instanceBootstrapBody,
                response: {
                    201: instanceBootstrapResponseSchema,
                    400: errorResponse,
                    403: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'bootstrapInstance',
                    summary:
                        'Claim the fresh Postdot instance and optionally mint an initial API key',
                    tags: ['System'],
                    security: [],
                },
            },
            async ({ body, request, set, status }) => {
                if (bootstrapModeConfig === 'token_required') {
                    const presented = readBootstrapTokenFromHeaders(request.headers)
                    const valid =
                        presented !== null &&
                        (await options.bootstrap?.verifyToken?.(presented)) === true
                    if (!valid) {
                        return status(403, {
                            error: {
                                code: 'invalid_bootstrap_token',
                                message:
                                    'A valid bootstrap token is required to initialize this instance',
                            },
                        })
                    }
                }

                const initialState = await access.getInstanceState()
                if (initialState.state !== 'claimable' || !(await access.isSignupAllowed())) {
                    return status(409, {
                        error: {
                            code: 'already_claimed',
                            message: 'This Postdot instance has already been claimed',
                        },
                    })
                }

                const trimmedName = body.name.trim()
                const trimmedEmail = body.email.trim()
                if (trimmedName.length === 0 || trimmedEmail.length === 0) {
                    return status(400, {
                        error: {
                            code: 'validation_error',
                            message: 'Name and email are required',
                        },
                    })
                }

                let expiresIn: number | undefined
                if (body.apiKey !== undefined) {
                    if (body.apiKey.projectIds !== undefined && body.apiKey.projectIds !== null) {
                        return status(400, {
                            error: {
                                code: 'invalid_project_access',
                                message:
                                    'Every selected project must be accessible to the current user',
                            },
                        })
                    }
                    expiresIn = expiresInFrom(body.apiKey.expiresAt, now())
                    if (expiresIn === -1) {
                        return status(400, {
                            error: {
                                code: 'invalid_time',
                                message: 'expiresAt must be at least one day in the future',
                            },
                        })
                    }
                }

                const authBaseURL = options.auth.options.baseURL
                const origin =
                    typeof authBaseURL === 'string' && authBaseURL.length > 0
                        ? new URL(authBaseURL).origin
                        : new URL(request.url).origin

                try {
                    const outcome = await options.database.sql.transaction(
                        () =>
                            runWithAuthorizedBootstrap(async () => {
                                const stateBeforeSignUp = await access.getInstanceState()
                                if (
                                    stateBeforeSignUp.state !== 'claimable' ||
                                    !(await access.isSignupAllowed())
                                ) {
                                    throw new BootstrapConflictError('Instance already claimed')
                                }

                                const signUpResponse = await options.auth.handler(
                                    new Request(`${origin}/api/auth/sign-up/email`, {
                                        method: 'POST',
                                        headers: {
                                            'content-type': 'application/json',
                                            origin,
                                        },
                                        body: JSON.stringify({
                                            name: trimmedName,
                                            email: trimmedEmail,
                                            password: body.password,
                                        }),
                                    })
                                )

                                if (!signUpResponse.ok) {
                                    const payload = (await signUpResponse
                                        .json()
                                        .catch(() => null)) as {
                                        readonly code?: string
                                        readonly message?: string
                                    } | null
                                    throw new BootstrapSignUpError(
                                        typeof payload?.code === 'string' && payload.code.length > 0
                                            ? payload.code
                                            : 'bootstrap_failed',
                                        typeof payload?.message === 'string' &&
                                            payload.message.length > 0
                                            ? payload.message
                                            : 'Administrator creation failed'
                                    )
                                }

                                const signUpBody = (await signUpResponse.json()) as {
                                    readonly user?: {
                                        readonly id?: string
                                        readonly name?: string
                                        readonly email?: string
                                    }
                                }
                                const createdUser = signUpBody.user
                                if (
                                    createdUser === undefined ||
                                    typeof createdUser.id !== 'string' ||
                                    createdUser.id.length === 0
                                ) {
                                    throw new Error(
                                        'The bootstrap administrator user was not returned'
                                    )
                                }

                                const claimedState = await access.getInstanceState()
                                if (
                                    claimedState.state !== 'claimed' ||
                                    claimedState.claimedByUserId !== createdUser.id ||
                                    claimedState.claimedAt === null
                                ) {
                                    throw new BootstrapConflictError(
                                        'Instance claim was not confirmed'
                                    )
                                }

                                let apiKeyPayload:
                                    | {
                                          readonly key: ReturnType<typeof toUserApiKey>
                                          readonly token: string
                                      }
                                    | undefined
                                if (body.apiKey !== undefined) {
                                    const createdKey = await options.auth.api.createApiKey({
                                        body: {
                                            configId: postdotUserApiKeyConfigId,
                                            name:
                                                body.apiKey.name?.trim() ||
                                                generatedUserApiKeyName(),
                                            userId: createdUser.id,
                                            metadata: metadataForProjectAccess(null),
                                            ...(body.apiKey.actionAccess === undefined ||
                                            body.apiKey.actionAccess === null
                                                ? {}
                                                : {
                                                      permissions: permissionsForCapabilities(
                                                          body.apiKey
                                                              .actionAccess as readonly PostdotApiKeyCapability[]
                                                      ),
                                                  }),
                                            ...(expiresIn === undefined ? {} : { expiresIn }),
                                        },
                                    })
                                    apiKeyPayload = {
                                        key: toUserApiKey(createdKey),
                                        token: createdKey.key,
                                    }
                                }

                                return {
                                    user: {
                                        id: createdUser.id,
                                        name: createdUser.name ?? trimmedName,
                                        email: createdUser.email ?? trimmedEmail,
                                        role: 'admin' as const,
                                    },
                                    instance: {
                                        state: 'claimed' as const,
                                        claimedByUserId: claimedState.claimedByUserId,
                                        claimedAt: claimedState.claimedAt,
                                    },
                                    ...(apiKeyPayload === undefined
                                        ? {}
                                        : { apiKey: apiKeyPayload }),
                                    setCookies: signUpResponse.headers.getSetCookie(),
                                }
                            }),
                        'immediate'
                    )

                    await options.bootstrap?.onClaimed?.()
                    if (outcome.setCookies.length > 0) {
                        set.headers['set-cookie'] = outcome.setCookies
                    }

                    return status(201, {
                        user: outcome.user,
                        instance: outcome.instance,
                        ...(outcome.apiKey === undefined ? {} : { apiKey: outcome.apiKey }),
                    })
                } catch (error) {
                    if (error instanceof BootstrapConflictError) {
                        return status(409, {
                            error: {
                                code: 'already_claimed',
                                message: 'This Postdot instance has already been claimed',
                            },
                        })
                    }
                    if (error instanceof BootstrapSignUpError) {
                        return status(400, {
                            error: {
                                code: error.code,
                                message: error.message,
                            },
                        })
                    }
                    throw error
                }
            }
        )
        .get(
            '/api/access/invitations/:token',
            {
                params: invitationTokenParams,
                response: {
                    200: invitationPreviewSchema,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getAccessInvitationPreview',
                    summary: 'Preview a public instance invitation',
                    tags: ['Access'],
                    security: [],
                },
            },
            async ({ params, status }) => {
                const invitation = await access.getInvitationByToken(params.token)
                if (invitation === null || invitation.state !== 'pending') {
                    return status(404, {
                        error: {
                            code: 'invalid_invitation',
                            message: 'Invitation is invalid, expired, or no longer available',
                        },
                    })
                }
                return {
                    targetEmail: invitation.targetEmail,
                    expiresAt: invitation.expiresAt,
                }
            }
        )
}
