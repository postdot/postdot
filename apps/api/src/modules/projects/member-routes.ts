import type { PostbotAuth, PostbotOrganizationInvitation } from '@postdot/auth'
import type { AccessProjectMembership, AccessStore } from '@postdot/db'

import {
    sessionSecurity,
    type AuthenticatedElysia,
    type PostbotAuthenticationMethod,
} from '../../plugins/auth'
import {
    createProjectInvitationBody,
    errorResponse,
    projectInvitationParams,
    projectInvitationResponseSchema,
    projectInvitationsSchema,
    projectMembershipResponseSchema,
    projectMemberParams,
    projectMemberRemovedSchema,
    projectMemberResponseSchema,
    projectMembersSchema,
    projectParams,
    updateProjectMemberBody,
} from './models'

type ProjectRole = 'owner' | 'editor' | 'viewer'

const projectOwnerForbiddenResponse = () =>
    ({
        error: {
            code: 'forbidden',
            message: 'A project owner session is required to manage project access',
        },
    }) as const

const projectMemberForbiddenResponse = () =>
    ({
        error: {
            code: 'forbidden',
            message: 'An active project membership is required to view project members',
        },
    }) as const

const workspaceAdminForbiddenResponse = () =>
    ({
        error: {
            code: 'forbidden',
            message: 'A workspace owner or administrator session is required to send invitations',
        },
    }) as const

const selfMembershipResponse = () =>
    ({
        error: {
            code: 'self_membership_update',
            message: 'A project owner cannot change or remove their own membership',
        },
    }) as const

const ownerMembershipResponse = () =>
    ({
        error: {
            code: 'owner_membership_protected',
            message: 'Project owner memberships cannot be changed from this surface',
        },
    }) as const

const inheritedMembershipResponse = () =>
    ({
        error: {
            code: 'inherited_membership',
            message: 'This project access is inherited from a workspace group',
        },
    }) as const

const organizationOperationFailedResponse = () =>
    ({
        error: {
            code: 'organization_operation_failed',
            message: 'The project access change could not be completed',
        },
    }) as const

const organizationReadFailedResponse = () =>
    ({
        error: {
            code: 'organization_read_failed',
            message: 'Project access is temporarily unavailable',
        },
    }) as const

function projectExists(projectId: string, access: AccessStore): boolean {
    return access.getProjectWorkspaceId(projectId) !== null
}

function getProjectWorkspace(projectId: string, access: AccessStore) {
    const workspaceId = access.getProjectWorkspaceId(projectId)
    return workspaceId === null ? null : access.getWorkspace(workspaceId)
}

function canManageProject(
    projectId: string,
    access: AccessStore,
    authMethod: PostbotAuthenticationMethod,
    userId: string
): boolean {
    return authMethod === 'session' && access.canAccessProject(projectId, userId, 'owner')
}

function canManageProjectInvitations(
    projectId: string,
    access: AccessStore,
    authMethod: PostbotAuthenticationMethod,
    userId: string
): boolean {
    const workspace = getProjectWorkspace(projectId, access)
    return (
        authMethod === 'session' &&
        workspace !== null &&
        access.canManageWorkspace(workspace.id, userId)
    )
}

function canViewProjectAccess(
    projectId: string,
    access: AccessStore,
    authMethod: PostbotAuthenticationMethod,
    userId: string
): boolean {
    if (authMethod !== 'session') return false
    if (access.canAccessProject(projectId, userId, 'viewer')) return true

    const workspaceId = access.getProjectWorkspaceId(projectId)
    return workspaceId !== null && access.canManageWorkspace(workspaceId, userId)
}

function normalizeProjectInvitationRole(value: string | null | undefined): ProjectRole {
    if (value === 'owner' || value === 'editor' || value === 'viewer') return value
    throw new Error(`Unsupported project invitation role: ${value ?? 'missing'}`)
}

function normalizeInvitationStatus(
    status: string
): 'pending' | 'accepted' | 'rejected' | 'canceled' {
    if (
        status === 'pending' ||
        status === 'accepted' ||
        status === 'rejected' ||
        status === 'canceled'
    ) {
        return status
    }
    throw new Error(`Unsupported invitation status: ${status}`)
}

function toProjectMember(member: AccessProjectMembership) {
    return {
        id: member.id,
        projectId: member.projectId,
        userId: member.userId,
        email: member.email,
        name: member.name.trim() || member.email,
        image: null,
        role: member.role,
        state: member.state,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
    }
}

function toProjectInvitation(invitation: PostbotOrganizationInvitation) {
    return {
        id: invitation.id,
        email: invitation.email,
        role: normalizeProjectInvitationRole(invitation.projectRole),
        organizationId: invitation.organizationId,
        inviterId: invitation.inviterId,
        status: normalizeInvitationStatus(invitation.status),
        expiresAt: invitation.expiresAt.getTime(),
        createdAt: invitation.createdAt.getTime(),
    }
}

async function listWorkspaceInvitations(
    auth: PostbotAuth,
    workspaceOrganizationId: string,
    headers: Headers
) {
    return auth.api.listInvitations({
        query: { organizationId: workspaceOrganizationId },
        headers,
    })
}

function findProjectMember(access: AccessStore, projectId: string, memberId: string) {
    return access
        .listProjectMemberships(projectId)
        .find(member => member.id === memberId || member.userId === memberId)
}

export function registerProjectMemberRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    auth: PostbotAuth,
    access: AccessStore
) {
    return app
        .get(
            '/api/projects/:projectId/membership',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: projectMembershipResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'getProjectMembership',
                    summary: 'Read the current user project membership',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, projectMemberForbiddenResponse())
                }
                if (!projectExists(params.projectId, access)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                const membership = access.getProjectMembership(params.projectId, user.id)
                if (membership === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project membership not found' },
                    })
                }
                return { membership: toProjectMember(membership) }
            }
        )
        .get(
            '/api/projects/:projectId/members',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: projectMembersSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'listProjectMembers',
                    summary: 'List effective members of a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!canViewProjectAccess(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectMemberForbiddenResponse())
                }
                const members = access.listProjectMemberships(params.projectId).map(toProjectMember)
                return { members, total: members.length }
            }
        )
        .get(
            '/api/projects/:projectId/invitations',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: projectInvitationsSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'listProjectInvitations',
                    summary: 'List project access invitations',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!canManageProjectInvitations(params.projectId, access, authMethod, user.id)) {
                    return status(403, workspaceAdminForbiddenResponse())
                }
                const workspace = getProjectWorkspace(params.projectId, access)
                if (workspace === null) return status(503, organizationReadFailedResponse())

                try {
                    const invitations = await listWorkspaceInvitations(
                        auth,
                        workspace.organizationId,
                        request.headers
                    )
                    return {
                        invitations: invitations
                            .filter(invitation => invitation.projectId === params.projectId)
                            .map(toProjectInvitation),
                    }
                } catch {
                    return status(503, organizationReadFailedResponse())
                }
            }
        )
        .post(
            '/api/projects/:projectId/invitations',
            {
                auth: true,
                body: createProjectInvitationBody,
                params: projectParams,
                response: {
                    201: projectInvitationResponseSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'createProjectInvitation',
                    summary: 'Invite a member to a project workspace',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!canManageProjectInvitations(params.projectId, access, authMethod, user.id)) {
                    return status(403, workspaceAdminForbiddenResponse())
                }
                const workspace = getProjectWorkspace(params.projectId, access)
                if (workspace === null) return status(503, organizationOperationFailedResponse())

                try {
                    const email = body.email.trim().toLowerCase()
                    const members = await auth.api.listMembers({
                        query: { organizationId: workspace.organizationId, limit: 1_000 },
                        headers: request.headers,
                    })
                    if (members.members.some(member => member.user.email.toLowerCase() === email)) {
                        return status(409, {
                            error: {
                                code: 'workspace_member_requires_grant',
                                message:
                                    'This user already belongs to the workspace; grant project access directly',
                            },
                        })
                    }

                    const invitation = await auth.api.createInvitation({
                        body: {
                            email,
                            role: 'member',
                            organizationId: workspace.organizationId,
                            projectId: params.projectId,
                            projectRole: body.role,
                        },
                        headers: request.headers,
                    })
                    return status(201, { invitation: toProjectInvitation(invitation) })
                } catch {
                    return status(409, organizationOperationFailedResponse())
                }
            }
        )
        .delete(
            '/api/projects/:projectId/invitations/:invitationId',
            {
                auth: true,
                params: projectInvitationParams,
                response: {
                    200: projectInvitationResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'cancelProjectInvitation',
                    summary: 'Cancel a project access invitation',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!canManageProjectInvitations(params.projectId, access, authMethod, user.id)) {
                    return status(403, workspaceAdminForbiddenResponse())
                }
                const workspace = getProjectWorkspace(params.projectId, access)
                if (workspace === null) return status(503, organizationOperationFailedResponse())

                try {
                    const invitations = await listWorkspaceInvitations(
                        auth,
                        workspace.organizationId,
                        request.headers
                    )
                    const existing = invitations.find(
                        invitation =>
                            invitation.id === params.invitationId &&
                            invitation.projectId === params.projectId
                    )
                    if (existing === undefined) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project invitation not found' },
                        })
                    }
                    if (existing.status !== 'pending') {
                        return status(409, {
                            error: {
                                code: 'invitation_not_pending',
                                message: 'Project invitation is no longer pending',
                            },
                        })
                    }
                    const invitation = await auth.api.cancelInvitation({
                        body: { invitationId: params.invitationId },
                        headers: request.headers,
                    })
                    return { invitation: toProjectInvitation(invitation) }
                } catch {
                    return status(503, organizationOperationFailedResponse())
                }
            }
        )
        .post(
            '/api/projects/:projectId/invitations/:invitationId/resend',
            {
                auth: true,
                params: projectInvitationParams,
                response: {
                    200: projectInvitationResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'resendProjectInvitation',
                    summary: 'Resend a project access invitation',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!canManageProjectInvitations(params.projectId, access, authMethod, user.id)) {
                    return status(403, workspaceAdminForbiddenResponse())
                }
                const workspace = getProjectWorkspace(params.projectId, access)
                if (workspace === null) return status(503, organizationOperationFailedResponse())

                try {
                    const invitations = await listWorkspaceInvitations(
                        auth,
                        workspace.organizationId,
                        request.headers
                    )
                    const existing = invitations.find(
                        invitation =>
                            invitation.id === params.invitationId &&
                            invitation.projectId === params.projectId
                    )
                    if (existing === undefined) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project invitation not found' },
                        })
                    }
                    if (existing.status !== 'pending') {
                        return status(409, {
                            error: {
                                code: 'invitation_not_pending',
                                message: 'Project invitation is no longer pending',
                            },
                        })
                    }

                    for (const invitation of invitations) {
                        if (
                            invitation.status === 'pending' &&
                            invitation.projectId === params.projectId &&
                            invitation.email.toLowerCase() === existing.email.toLowerCase()
                        ) {
                            await auth.api.cancelInvitation({
                                body: { invitationId: invitation.id },
                                headers: request.headers,
                            })
                        }
                    }

                    const invitation = await auth.api.createInvitation({
                        body: {
                            email: existing.email,
                            role: 'member',
                            organizationId: workspace.organizationId,
                            projectId: params.projectId,
                            projectRole: normalizeProjectInvitationRole(existing.projectRole),
                        },
                        headers: request.headers,
                    })
                    return { invitation: toProjectInvitation(invitation) }
                } catch {
                    return status(503, organizationOperationFailedResponse())
                }
            }
        )
        .patch(
            '/api/projects/:projectId/members/:memberId',
            {
                auth: true,
                body: updateProjectMemberBody,
                params: projectMemberParams,
                response: {
                    200: projectMemberResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'updateProjectMemberRole',
                    summary: 'Update a direct project member grant',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!canManageProject(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectOwnerForbiddenResponse())
                }
                const existing = findProjectMember(access, params.projectId, params.memberId)
                if (existing === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project member not found' },
                    })
                }
                if (existing.userId === user.id) return status(409, selfMembershipResponse())
                if (existing.role === 'owner') return status(409, ownerMembershipResponse())

                const grant = access.grantProjectUserAccess({
                    projectId: params.projectId,
                    userId: existing.userId,
                    role: body.role,
                })
                if (grant === null) return status(409, organizationOperationFailedResponse())
                const updated = access.getProjectMembership(params.projectId, existing.userId)
                if (updated === null) return status(503, organizationOperationFailedResponse())
                return { membership: toProjectMember(updated) }
            }
        )
        .delete(
            '/api/projects/:projectId/members/:memberId',
            {
                auth: true,
                params: projectMemberParams,
                response: {
                    200: projectMemberRemovedSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'removeProjectMember',
                    summary: 'Remove direct project access',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!canManageProject(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectOwnerForbiddenResponse())
                }
                const existing = findProjectMember(access, params.projectId, params.memberId)
                if (existing === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project member not found' },
                    })
                }
                if (existing.userId === user.id) return status(409, selfMembershipResponse())
                if (existing.role === 'owner') return status(409, ownerMembershipResponse())

                if (existing.id.startsWith('project-team-grant:')) {
                    return status(409, inheritedMembershipResponse())
                }

                if (access.removeProjectUserAccess(params.projectId, existing.userId)) {
                    return { removed: true as const }
                }

                return status(404, {
                    error: { code: 'not_found', message: 'Project member not found' },
                })
            }
        )
}
