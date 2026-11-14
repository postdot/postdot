import {
    createPostdotAuthServerActions,
    postdotUserApiKeyConfigId,
    runWithAuthorizedMemberProvisioning,
    type PostdotAuth,
} from '@postdot/auth'
import type { AccessStore } from '@postdot/db'
import { everySequential } from '@postdot/db'
import { Type } from 'typebox'

import {
    sessionSecurity,
    type AuthenticatedElysia,
    type PostdotAuthenticationMethod,
} from '../../plugins/auth'
import {
    apiKeyHasCapability,
    permissionsForCapabilities,
    type PostdotApiKeyCapability,
} from '../projects/api-key-permissions'
import {
    apiKeyEscalationDeniedResponse,
    canApiKeyGrantScope,
    createdUserApiKeySchema,
    createUserApiKeyBody,
    expiresInFrom,
    generatedUserApiKeyName,
    metadataForProjectAccess,
    toUserApiKey,
} from './api-key-routes'

const errorResponse = Type.Object({
    error: Type.Object({
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
    }),
})

const nullableString = Type.Union([Type.String({ minLength: 1 }), Type.Null()])
const instanceStateSchema = Type.Object({
    id: Type.Literal('default'),
    state: Type.Union([Type.Literal('claimable'), Type.Literal('claimed')]),
    bootstrapBlocked: Type.Boolean(),
    claimedByUserId: nullableString,
    claimedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    defaultWorkspaceId: nullableString,
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
const instanceMembershipSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal('admin'), Type.Literal('member')]),
    state: Type.Union([Type.Literal('enabled'), Type.Literal('disabled')]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
const invitationSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    targetEmail: Type.String({ minLength: 1 }),
    instanceRole: Type.Literal('member'),
    state: Type.Union([
        Type.Literal('pending'),
        Type.Literal('accepted'),
        Type.Literal('revoked'),
        Type.Literal('expired'),
    ]),
    createdByUserId: Type.String({ minLength: 1 }),
    expiresAt: Type.Integer({ minimum: 0 }),
    acceptedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    acceptedByUserId: nullableString,
    revokedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

const accessSummarySchema = Type.Object({
    instance: instanceStateSchema,
    membership: Type.Union([instanceMembershipSchema, Type.Null()]),
    isAdmin: Type.Boolean(),
})
const instanceMembershipsSchema = Type.Object({
    members: Type.Array(instanceMembershipSchema),
})
const invitationsSchema = Type.Object({ invitations: Type.Array(invitationSchema) })
const invitationResponseSchema = Type.Object({ invitation: invitationSchema })
const createInstanceMemberBody = Type.Object({
    email: Type.String({ minLength: 3, maxLength: 320 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    password: Type.Optional(Type.String({ minLength: 12, maxLength: 128 })),
    role: Type.Optional(Type.Union([Type.Literal('admin'), Type.Literal('member')])),
    joinDefaultWorkspace: Type.Optional(Type.Boolean()),
    apiKey: Type.Optional(createUserApiKeyBody),
})
const createdInstanceMemberSchema = Type.Object({
    membership: instanceMembershipSchema,
    apiKey: Type.Optional(createdUserApiKeySchema),
})
const memberApiKeysSchema = Type.Object({
    keys: Type.Array(createdUserApiKeySchema.properties.key),
})
const updateInstanceMembershipBody = Type.Object(
    {
        role: Type.Optional(Type.Union([Type.Literal('admin'), Type.Literal('member')])),
        state: Type.Optional(Type.Union([Type.Literal('enabled'), Type.Literal('disabled')])),
    },
    { minProperties: 1 }
)
const createInvitationBody = Type.Object({
    targetEmail: Type.String({ minLength: 1, maxLength: 320 }),
    expiresAt: Type.Optional(Type.Integer({ minimum: 0 })),
})
const acceptInvitationBody = Type.Object({ token: Type.String({ minLength: 1 }) })
const invitationParams = Type.Object({ invitationId: Type.String({ minLength: 1 }) })
const instanceMemberParams = Type.Object({ userId: Type.String({ minLength: 1 }) })
const instanceMemberApiKeyParams = Type.Object({
    userId: Type.String({ minLength: 1 }),
    keyId: Type.String({ minLength: 1 }),
})
const createdInvitationSchema = Type.Object({
    invitation: invitationSchema,
    token: Type.String({ minLength: 1 }),
})
const acceptedInvitationSchema = Type.Object({
    invitation: invitationSchema,
    instanceMembership: instanceMembershipSchema,
})

const forbiddenResponse = () => ({
    error: {
        code: 'forbidden',
        message: 'An enabled instance administrator is required for access administration',
    },
})
const insufficientApiKeyPermissionsResponse = () => ({
    error: {
        code: 'insufficient_api_key_permissions',
        message: 'This API key is not allowed to perform this action',
    },
})
const adminSyncFailedResponse = () => ({
    error: {
        code: 'admin_sync_failed',
        message: 'The instance membership changed, but Better Auth could not be synchronized',
    },
})

async function isInstanceAdmin(
    _authMethod: PostdotAuthenticationMethod,
    userId: string,
    access: AccessStore
): Promise<boolean> {
    return await access.isInstanceAdmin(userId)
}

export function registerAccessRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    access: AccessStore,
    auth: PostdotAuth,
    now: () => number = Date.now
) {
    const serverActions = createPostdotAuthServerActions(auth)

    return app
        .get(
            '/api/access',
            {
                auth: true,
                response: {
                    200: accessSummarySchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'getCurrentInstanceAccess',
                    summary: 'Get the current user instance access summary',
                    tags: ['Access'],
                },
            },
            async ({ user }) => {
                const instance = await access.getInstanceState()
                return {
                    instance,
                    membership: await access.getInstanceMembership(user.id),
                    isAdmin: await access.isInstanceAdmin(user.id),
                }
            }
        )
        .get(
            '/api/access/members',
            {
                auth: true,
                response: {
                    200: instanceMembershipsSchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'listAccessMembers',
                    summary: 'List instance members',
                    tags: ['Access'],
                },
            },
            async ({ authMethod, status, user }) => {
                if (!(await isInstanceAdmin(authMethod, user.id, access))) {
                    return status(403, forbiddenResponse())
                }
                return { members: await access.listInstanceMemberships() }
            }
        )
        .post(
            '/api/access/members',
            {
                auth: true,
                body: createInstanceMemberBody,
                response: {
                    201: createdInstanceMemberSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'createAccessMember',
                    summary:
                        'Provision an enabled instance member or service account with an optional initial API key',
                    tags: ['Access'],
                },
            },
            async ({ apiKeyPermissions, apiKeyProjectIds, authMethod, body, status, user }) => {
                if (!(await isInstanceAdmin(authMethod, user.id, access))) {
                    return status(403, forbiddenResponse())
                }

                const email = body.email.trim().toLowerCase()
                const name = body.name.trim()
                if (!email.includes('@') || name.length === 0) {
                    return status(400, {
                        error: {
                            code: 'invalid_member_input',
                            message: 'A valid member email and non-empty display name are required',
                        },
                    })
                }

                const role = body.role ?? 'member'
                const joinDefaultWorkspace = body.joinDefaultWorkspace ?? true

                let requestedProjectIds: readonly string[] | null = null
                let expiresIn: number | undefined
                if (body.apiKey !== undefined) {
                    requestedProjectIds =
                        body.apiKey.projectIds === undefined || body.apiKey.projectIds === null
                            ? null
                            : [...new Set(body.apiKey.projectIds)]

                    if (
                        !canApiKeyGrantScope({
                            authMethod,
                            callerProjectIds: apiKeyProjectIds,
                            callerPermissions: apiKeyPermissions,
                            targetProjectIds: requestedProjectIds,
                            targetActionAccess: body.apiKey.actionAccess ?? null,
                        })
                    ) {
                        return status(403, apiKeyEscalationDeniedResponse())
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

                    if (requestedProjectIds !== null) {
                        if (!joinDefaultWorkspace) {
                            return status(400, {
                                error: {
                                    code: 'invalid_project_access',
                                    message:
                                        'Selected project access requires default workspace membership',
                                },
                            })
                        }
                        const defaultWorkspace = await access.getDefaultWorkspace()
                        const projectsAccessible =
                            defaultWorkspace !== null &&
                            (await everySequential(
                                requestedProjectIds,
                                async projectId =>
                                    (await access.getProjectWorkspaceId(projectId)) ===
                                    defaultWorkspace.id
                            ))
                        if (!projectsAccessible) {
                            return status(400, {
                                error: {
                                    code: 'invalid_project_access',
                                    message:
                                        'Every selected project must belong to the default workspace',
                                },
                            })
                        }
                    }
                }

                let createdUserId: string
                try {
                    const created = await runWithAuthorizedMemberProvisioning(() =>
                        auth.api.createUser({
                            body: {
                                email,
                                name,
                                role: role === 'admin' ? 'admin' : 'user',
                                ...(body.password === undefined ? {} : { password: body.password }),
                            },
                        })
                    )
                    createdUserId = created.user.id
                } catch {
                    return status(409, {
                        error: {
                            code: 'member_already_exists',
                            message: 'A user with this email already exists',
                        },
                    })
                }

                try {
                    const issuedApiKey =
                        body.apiKey === undefined
                            ? undefined
                            : await auth.api.createApiKey({
                                  body: {
                                      configId: postdotUserApiKeyConfigId,
                                      name: body.apiKey.name?.trim() || generatedUserApiKeyName(),
                                      userId: createdUserId,
                                      metadata: metadataForProjectAccess(requestedProjectIds),
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

                    const membership = await access.provisionDirectInstanceMembership({
                        userId: createdUserId,
                        role,
                        displayName: name,
                        joinDefaultWorkspace,
                    })

                    return status(201, {
                        membership,
                        ...(issuedApiKey === undefined
                            ? {}
                            : {
                                  apiKey: {
                                      key: toUserApiKey(issuedApiKey),
                                      token: issuedApiKey.key,
                                  },
                              }),
                    })
                } catch {
                    try {
                        await serverActions.deleteUser({ userId: createdUserId })
                    } catch {
                        // Surface the provisioning failure cleanly.
                    }
                    return status(503, adminSyncFailedResponse())
                }
            }
        )
        .patch(
            '/api/access/members/:userId',
            {
                auth: true,
                body: updateInstanceMembershipBody,
                params: instanceMemberParams,
                response: {
                    200: Type.Object({ membership: instanceMembershipSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'updateAccessMember',
                    summary: 'Update an instance member role or state',
                    tags: ['Access'],
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (!(await isInstanceAdmin(authMethod, user.id, access))) {
                    return status(403, forbiddenResponse())
                }

                const previousMembership = await access.getInstanceMembership(params.userId)
                const result = await access.updateInstanceMembership({
                    actorUserId: user.id,
                    userId: params.userId,
                    role: body.role,
                    state: body.state,
                })
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Instance member not found' },
                    })
                }
                if (result.kind === 'last_admin') {
                    return status(409, {
                        error: {
                            code: 'last_admin',
                            message:
                                'The last enabled instance administrator cannot be demoted or disabled',
                        },
                    })
                }
                if (result.kind === 'self_update') {
                    return status(409, {
                        error: {
                            code: 'self_membership_update',
                            message:
                                'An instance administrator cannot demote or disable their own membership',
                        },
                    })
                }
                const previousRole = previousMembership?.role ?? result.membership.role
                const previousState = previousMembership?.state ?? result.membership.state
                const nextRole = body.role ?? previousRole
                const nextState = body.state ?? previousState

                try {
                    await serverActions.setUserRole({
                        userId: params.userId,
                        role: nextRole === 'admin' ? 'admin' : 'user',
                    })
                    if (nextState === 'disabled') {
                        await serverActions.banUser({
                            userId: params.userId,
                            banReason: 'Disabled by a Postdot instance administrator',
                        })
                    } else {
                        await serverActions.unbanUser({
                            userId: params.userId,
                        })
                    }
                } catch {
                    // The custom table was updated first so it could enforce Postdot's
                    // last-admin and self-protection invariants. Compensate both
                    // projections if Better Auth rejects the subsequent sync.
                    if (
                        previousMembership !== null &&
                        (previousMembership.role !== nextRole ||
                            previousMembership.state !== nextState)
                    ) {
                        await access.updateInstanceMembership({
                            actorUserId: user.id,
                            userId: params.userId,
                            role: previousMembership.role,
                            state: previousMembership.state,
                        })
                    }
                    try {
                        await serverActions.setUserRole({
                            userId: params.userId,
                            role: previousRole === 'admin' ? 'admin' : 'user',
                        })
                        if (previousState === 'disabled') {
                            await serverActions.banUser({
                                userId: params.userId,
                                banReason: 'Disabled by a Postdot instance administrator',
                            })
                        } else {
                            await serverActions.unbanUser({
                                userId: params.userId,
                            })
                        }
                    } catch {
                        // The 503 makes a partial projection visible to operators;
                        // the next reconciliation/read still uses Better Auth fields.
                    }
                    return status(503, adminSyncFailedResponse())
                }

                return {
                    membership:
                        (await access.getInstanceMembership(params.userId)) ?? result.membership,
                }
            }
        )
        .get(
            '/api/access/members/:userId/api-keys',
            {
                auth: true,
                params: instanceMemberParams,
                response: {
                    200: memberApiKeysSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listMemberApiKeys',
                    summary:
                        'List API keys owned by an instance member for administration/offboarding',
                    tags: ['Access'],
                },
            },
            async ({ apiKeyPermissions, authMethod, params, status, user }) => {
                if (!(await isInstanceAdmin(authMethod, user.id, access))) {
                    return status(403, forbiddenResponse())
                }
                if (
                    authMethod === 'user_api_key' &&
                    !apiKeyHasCapability(apiKeyPermissions ?? null, 'api_key:manage')
                ) {
                    return status(403, insufficientApiKeyPermissionsResponse())
                }
                if ((await access.getInstanceMembership(params.userId)) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Instance member not found' },
                    })
                }
                const listed = await serverActions.listUserApiKeys({
                    userId: params.userId,
                    configId: postdotUserApiKeyConfigId,
                })
                return {
                    keys: listed
                        .map(toUserApiKey)
                        .filter(key => key.projectAccess === 'all' || key.projectAccess.length > 0),
                }
            }
        )
        .delete(
            '/api/access/members/:userId/api-keys/:keyId',
            {
                auth: true,
                params: instanceMemberApiKeyParams,
                response: {
                    200: Type.Object({ deleted: Type.Literal(true) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'revokeMemberApiKey',
                    summary: 'Revoke an API key owned by an instance member during offboarding',
                    tags: ['Access'],
                },
            },
            async ({ apiKeyPermissions, authMethod, params, status, user }) => {
                if (!(await isInstanceAdmin(authMethod, user.id, access))) {
                    return status(403, forbiddenResponse())
                }
                if (
                    authMethod === 'user_api_key' &&
                    !apiKeyHasCapability(apiKeyPermissions ?? null, 'api_key:manage')
                ) {
                    return status(403, insufficientApiKeyPermissionsResponse())
                }
                if ((await access.getInstanceMembership(params.userId)) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Instance member not found' },
                    })
                }
                try {
                    await serverActions.deleteUserApiKey({
                        userId: params.userId,
                        keyId: params.keyId,
                        configId: postdotUserApiKeyConfigId,
                    })
                } catch {
                    return status(404, {
                        error: { code: 'not_found', message: 'API key not found' },
                    })
                }
                return { deleted: true as const }
            }
        )
        .get(
            '/api/access/invitations',
            {
                auth: true,
                response: {
                    200: invitationsSchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'listAccessInvitations',
                    summary: 'List instance invitations',
                    tags: ['Access'],
                },
            },
            async ({ authMethod, status, user }) => {
                if (!(await isInstanceAdmin(authMethod, user.id, access))) {
                    return status(403, forbiddenResponse())
                }
                return { invitations: await access.listInvitations() }
            }
        )
        .post(
            '/api/access/invitations',
            {
                auth: true,
                body: createInvitationBody,
                response: {
                    201: createdInvitationSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'createAccessInvitation',
                    summary: 'Create an instance invitation',
                    tags: ['Access'],
                },
            },
            async ({ authMethod, body, status, user }) => {
                if (!(await isInstanceAdmin(authMethod, user.id, access))) {
                    return status(403, forbiddenResponse())
                }

                try {
                    const result = await access.createInvitation({
                        targetEmail: body.targetEmail,
                        createdByUserId: user.id,
                        expiresAt: body.expiresAt,
                    })
                    return status(201, result)
                } catch {
                    return status(400, {
                        error: {
                            code: 'invalid_invitation',
                            message: 'Invitation details are invalid',
                        },
                    })
                }
            }
        )
        .delete(
            '/api/access/invitations/:invitationId',
            {
                auth: true,
                params: invitationParams,
                response: {
                    200: invitationResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'revokeAccessInvitation',
                    summary: 'Revoke an instance invitation',
                    tags: ['Access'],
                },
            },
            async ({ authMethod, params, status, user }) => {
                if (!(await isInstanceAdmin(authMethod, user.id, access))) {
                    return status(403, forbiddenResponse())
                }
                const result = await access.revokeInvitation(params.invitationId)
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Invitation not found' },
                    })
                }
                if (result.kind === 'not_pending') {
                    return status(409, {
                        error: {
                            code: 'invitation_not_pending',
                            message: 'Invitation is not pending',
                        },
                    })
                }
                return { invitation: result.invitation }
            }
        )
        .post(
            '/api/access/invitations/accept',
            {
                auth: true,
                body: acceptInvitationBody,
                response: {
                    200: acceptedInvitationSchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'acceptAccessInvitation',
                    summary: 'Accept an instance invitation for the current user',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, status, user }) => {
                if (authMethod !== 'session' || user.email === null) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An authenticated matching user is required to accept an invitation',
                        },
                    })
                }

                // Better Auth handles project invitations separately. This route
                // accepts only Postdot instance invitations.
                const result = await access.acceptInvitation({
                    token: body.token,
                    userId: user.id,
                    email: user.email,
                    displayName: user.name,
                })
                if (result.kind === 'invalid') {
                    return status(403, {
                        error: {
                            code: 'invalid_invitation',
                            message: 'Invitation is invalid or addressed to another email',
                        },
                    })
                }
                return result
            }
        )
}

export type AccessSummaryResponse = {
    readonly instance: Awaited<ReturnType<AccessStore['getInstanceState']>>
    readonly membership: Awaited<ReturnType<AccessStore['getInstanceMembership']>>
    readonly isAdmin: boolean
}
