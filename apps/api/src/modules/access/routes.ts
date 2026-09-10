import type { AccessStore } from '@herald/db'
import { Type } from 'typebox'

import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'

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
const projectMembershipSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal('owner'), Type.Literal('editor'), Type.Literal('viewer')]),
    state: Type.Union([Type.Literal('active'), Type.Literal('removed')]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
const invitationSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    targetEmail: Type.String({ minLength: 1 }),
    instanceRole: Type.Literal('member'),
    projectId: nullableString,
    projectRole: Type.Union([
        Type.Literal('owner'),
        Type.Literal('editor'),
        Type.Literal('viewer'),
        Type.Null(),
    ]),
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
const updateInstanceMembershipBody = Type.Object(
    {
        role: Type.Optional(Type.Union([Type.Literal('admin'), Type.Literal('member')])),
        state: Type.Optional(Type.Union([Type.Literal('enabled'), Type.Literal('disabled')])),
    },
    { minProperties: 1 }
)
const createInvitationBody = Type.Object({
    targetEmail: Type.String({ minLength: 1, maxLength: 320 }),
    projectId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    projectRole: Type.Optional(
        Type.Union([
            Type.Literal('owner'),
            Type.Literal('editor'),
            Type.Literal('viewer'),
            Type.Null(),
        ])
    ),
    expiresAt: Type.Optional(Type.Integer({ minimum: 0 })),
})
const acceptInvitationBody = Type.Object({ token: Type.String({ minLength: 1 }) })
const invitationParams = Type.Object({ invitationId: Type.String({ minLength: 1 }) })
const instanceMemberParams = Type.Object({ userId: Type.String({ minLength: 1 }) })
const createdInvitationSchema = Type.Object({
    invitation: invitationSchema,
    token: Type.String({ minLength: 1 }),
})
const acceptedInvitationSchema = Type.Object({
    invitation: invitationSchema,
    instanceMembership: instanceMembershipSchema,
    projectMembership: Type.Union([projectMembershipSchema, Type.Null()]),
})

const forbiddenResponse = () => ({
    error: {
        code: 'forbidden',
        message: 'An instance administrator session is required for access administration',
    },
})
const sessionOnlyForbiddenResponse = () => ({
    error: {
        code: 'forbidden',
        message: 'A human session is required to view instance access',
    },
})

function isInstanceAdmin(
    authMethod: 'session' | 'project_token',
    userId: string,
    access: AccessStore
): boolean {
    return authMethod === 'session' && access.isInstanceAdmin(userId)
}

export function registerAccessRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    access: AccessStore
) {
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
                    security: sessionSecurity,
                },
            },
            ({ authMethod, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, sessionOnlyForbiddenResponse())
                }
                const instance = access.getInstanceState()
                return {
                    instance,
                    membership: access.getInstanceMembership(user.id),
                    isAdmin: access.isInstanceAdmin(user.id),
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
                    security: sessionSecurity,
                },
            },
            ({ authMethod, status, user }) => {
                if (!isInstanceAdmin(authMethod, user.id, access)) {
                    return status(403, forbiddenResponse())
                }
                return { members: access.listInstanceMemberships() }
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
                },
                detail: {
                    operationId: 'updateAccessMember',
                    summary: 'Update an instance member role or state',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (!isInstanceAdmin(authMethod, user.id, access)) {
                    return status(403, forbiddenResponse())
                }

                const result = access.updateInstanceMembership({
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
                return { membership: result.membership }
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
                    security: sessionSecurity,
                },
            },
            ({ authMethod, status, user }) => {
                if (!isInstanceAdmin(authMethod, user.id, access)) {
                    return status(403, forbiddenResponse())
                }
                return { invitations: access.listInvitations() }
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
                    404: errorResponse,
                },
                detail: {
                    operationId: 'createAccessInvitation',
                    summary: 'Create an instance invitation',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, status, user }) => {
                if (!isInstanceAdmin(authMethod, user.id, access)) {
                    return status(403, forbiddenResponse())
                }

                try {
                    const result = access.createInvitation({
                        targetEmail: body.targetEmail,
                        createdByUserId: user.id,
                        projectId: body.projectId,
                        projectRole: body.projectRole,
                        expiresAt: body.expiresAt,
                    })
                    if ('kind' in result) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project not found' },
                        })
                    }
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
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (!isInstanceAdmin(authMethod, user.id, access)) {
                    return status(403, forbiddenResponse())
                }
                const result = access.revokeInvitation(params.invitationId)
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
            ({ authMethod, body, status, user }) => {
                if (authMethod !== 'session' || user.email === null) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An authenticated matching user is required to accept an invitation',
                        },
                    })
                }

                // TODO(ACCESS-132): account creation from an invitation needs a safe
                // Better Auth transaction seam. This route intentionally accepts only
                // an already-authenticated user until that seam exists.
                const result = access.acceptInvitation({
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
    readonly instance: ReturnType<AccessStore['getInstanceState']>
    readonly membership: ReturnType<AccessStore['getInstanceMembership']>
    readonly isAdmin: boolean
}
