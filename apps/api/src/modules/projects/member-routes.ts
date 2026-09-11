import type { HeraldAuth } from '@herald/auth'
import type { AccessStore } from '@herald/db'

import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'
import {
    createProjectInvitationBody,
    errorResponse,
    projectInvitationParams,
    projectInvitationResponseSchema,
    projectInvitationsSchema,
    projectMemberParams,
    projectMemberRemovedSchema,
    projectMemberResponseSchema,
    projectMembersSchema,
    projectParams,
    updateProjectMemberBody,
} from './models'

const projectInvitationResponse = projectInvitationResponseSchema

const projectOwnerForbiddenResponse = () =>
    ({
        error: {
            code: 'forbidden',
            message: 'A project owner session is required to manage project members',
        },
    }) as const

const projectMemberForbiddenResponse = () =>
    ({
        error: {
            code: 'forbidden',
            message: 'An active project membership is required to view project members',
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

type ProjectRole = 'owner' | 'editor' | 'viewer'
type ProjectInvitationStatus = 'pending' | 'accepted' | 'rejected' | 'canceled'

function normalizeProjectRole(role: string): ProjectRole {
    const rank: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 }
    let selected: ProjectRole | null = null
    for (const candidate of role.split(',').map(value => value.trim())) {
        if (candidate !== 'owner' && candidate !== 'editor' && candidate !== 'viewer') continue
        if (selected === null || rank[candidate] > rank[selected]) selected = candidate
    }
    if (selected === null) throw new Error(`Unsupported Better Auth project role: ${role}`)
    return selected
}

function normalizeInvitationStatus(status: string): ProjectInvitationStatus {
    if (
        status === 'pending' ||
        status === 'accepted' ||
        status === 'rejected' ||
        status === 'canceled'
    ) {
        return status
    }
    throw new Error(`Unsupported Better Auth invitation status: ${status}`)
}

function toProjectMember(
    projectId: string,
    member: {
        readonly id: string
        readonly userId: string
        readonly role: string
        readonly createdAt: Date
        readonly user: {
            readonly id: string
            readonly email: string
            readonly name: string
            readonly image?: string | null
        }
    }
) {
    const createdAt = member.createdAt.getTime()
    return {
        id: member.id,
        projectId,
        userId: member.userId,
        email: member.user.email,
        name: member.user.name.trim() || member.user.email,
        image: member.user.image?.trim() || null,
        role: normalizeProjectRole(member.role),
        state: 'active' as const,
        createdAt,
        // Better Auth's member record has no updatedAt field. The member row is
        // replaced on role changes, so its creation timestamp is the only
        // durable membership timestamp available to this public projection.
        updatedAt: createdAt,
    }
}

function toProjectInvitation(invitation: {
    readonly id: string
    readonly email: string
    readonly role: string
    readonly organizationId: string
    readonly inviterId: string
    readonly status: string
    readonly expiresAt: Date
    readonly createdAt: Date
}) {
    return {
        id: invitation.id,
        email: invitation.email,
        role: normalizeProjectRole(invitation.role),
        organizationId: invitation.organizationId,
        inviterId: invitation.inviterId,
        status: normalizeInvitationStatus(invitation.status),
        expiresAt: invitation.expiresAt.getTime(),
        createdAt: invitation.createdAt.getTime(),
    }
}

async function listOrganizationMembers(auth: HeraldAuth, organizationId: string, headers: Headers) {
    return auth.api.listMembers({
        query: { organizationId, limit: 1_000 },
        headers,
    })
}

async function findOrganizationMember(
    auth: HeraldAuth,
    organizationId: string,
    memberId: string,
    headers: Headers
) {
    const listed = await listOrganizationMembers(auth, organizationId, headers)
    return listed.members.find(member => member.id === memberId) ?? null
}

function getProjectOrganizationId(
    projectId: string,
    access: AccessStore,
    authMethod: 'session' | 'project_token',
    userId: string,
    minimumRole: ProjectRole
) {
    if (authMethod !== 'session') return null
    const organizationId = access.getProjectOrganizationId(projectId)
    if (organizationId === null || !access.canAccessProject(projectId, userId, minimumRole)) {
        return null
    }
    return organizationId
}

export function registerProjectMemberRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    auth: HeraldAuth,
    access: AccessStore
) {
    return app
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
                    503: errorResponse,
                },
                detail: {
                    operationId: 'listProjectMembers',
                    summary: 'List members of a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                const organizationId = getProjectOrganizationId(
                    params.projectId,
                    access,
                    authMethod,
                    user.id,
                    'viewer'
                )
                if (authMethod !== 'session') {
                    return status(403, projectMemberForbiddenResponse())
                }
                if (access.getProjectOrganizationId(params.projectId) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (organizationId === null) return status(403, projectMemberForbiddenResponse())

                try {
                    const listed = await listOrganizationMembers(
                        auth,
                        organizationId,
                        request.headers
                    )
                    return {
                        members: listed.members.map(member =>
                            toProjectMember(params.projectId, member)
                        ),
                        total: listed.total,
                    }
                } catch {
                    return status(503, organizationReadFailedResponse())
                }
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
                    summary: 'List project invitations',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                const organizationId = getProjectOrganizationId(
                    params.projectId,
                    access,
                    authMethod,
                    user.id,
                    'owner'
                )
                if (authMethod !== 'session') return status(403, projectOwnerForbiddenResponse())
                if (access.getProjectOrganizationId(params.projectId) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (organizationId === null) return status(403, projectOwnerForbiddenResponse())

                try {
                    const invitations = await auth.api.listInvitations({
                        query: { organizationId },
                        headers: request.headers,
                    })
                    return {
                        invitations: invitations.map(toProjectInvitation),
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
                    201: projectInvitationResponse,
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
                    summary: 'Invite a member to a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                const organizationId = getProjectOrganizationId(
                    params.projectId,
                    access,
                    authMethod,
                    user.id,
                    'owner'
                )
                if (authMethod !== 'session') return status(403, projectOwnerForbiddenResponse())
                if (access.getProjectOrganizationId(params.projectId) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (organizationId === null) return status(403, projectOwnerForbiddenResponse())

                try {
                    const invitation = await auth.api.createInvitation({
                        body: {
                            email: body.email.trim().toLowerCase(),
                            role: body.role,
                            organizationId,
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
                    200: projectInvitationResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'cancelProjectInvitation',
                    summary: 'Cancel a project invitation',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                const organizationId = getProjectOrganizationId(
                    params.projectId,
                    access,
                    authMethod,
                    user.id,
                    'owner'
                )
                if (authMethod !== 'session') return status(403, projectOwnerForbiddenResponse())
                if (access.getProjectOrganizationId(params.projectId) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (organizationId === null) return status(403, projectOwnerForbiddenResponse())

                try {
                    const invitations = await auth.api.listInvitations({
                        query: { organizationId },
                        headers: request.headers,
                    })
                    const existing = invitations.find(
                        invitation => invitation.id === params.invitationId
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
                    200: projectInvitationResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'resendProjectInvitation',
                    summary: 'Resend a project invitation',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                const organizationId = getProjectOrganizationId(
                    params.projectId,
                    access,
                    authMethod,
                    user.id,
                    'owner'
                )
                if (authMethod !== 'session') return status(403, projectOwnerForbiddenResponse())
                if (access.getProjectOrganizationId(params.projectId) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (organizationId === null) return status(403, projectOwnerForbiddenResponse())

                try {
                    const invitations = await auth.api.listInvitations({
                        query: { organizationId },
                        headers: request.headers,
                    })
                    const existing = invitations.find(
                        invitation => invitation.id === params.invitationId
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

                    // Better Auth's `resend` option keeps the same invitation ID.
                    // Herald deliberately rotates it so an old copied link stops
                    // working as soon as the owner asks for a new one. Cancel every
                    // pending duplicate as a repair guard for development databases
                    // created before the one-active-invitation policy.
                    for (const invitation of invitations) {
                        if (
                            invitation.status === 'pending' &&
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
                            role: existing.role,
                            organizationId,
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
                    summary: 'Update a project member role',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                const organizationId = getProjectOrganizationId(
                    params.projectId,
                    access,
                    authMethod,
                    user.id,
                    'owner'
                )
                if (authMethod !== 'session') return status(403, projectOwnerForbiddenResponse())
                if (access.getProjectOrganizationId(params.projectId) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (organizationId === null) return status(403, projectOwnerForbiddenResponse())

                try {
                    const existing = await findOrganizationMember(
                        auth,
                        organizationId,
                        params.memberId,
                        request.headers
                    )
                    if (existing === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project member not found' },
                        })
                    }
                    if (existing.userId === user.id) return status(409, selfMembershipResponse())
                    if (normalizeProjectRole(existing.role) === 'owner') {
                        return status(409, ownerMembershipResponse())
                    }

                    await auth.api.updateMemberRole({
                        body: {
                            memberId: params.memberId,
                            role: body.role,
                            organizationId,
                        },
                        headers: request.headers,
                    })
                    const updated = await findOrganizationMember(
                        auth,
                        organizationId,
                        params.memberId,
                        request.headers
                    )
                    if (updated === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project member not found' },
                        })
                    }
                    return { membership: toProjectMember(params.projectId, updated) }
                } catch {
                    return status(503, organizationOperationFailedResponse())
                }
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
                    summary: 'Remove a member from a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                const organizationId = getProjectOrganizationId(
                    params.projectId,
                    access,
                    authMethod,
                    user.id,
                    'owner'
                )
                if (authMethod !== 'session') return status(403, projectOwnerForbiddenResponse())
                if (access.getProjectOrganizationId(params.projectId) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (organizationId === null) return status(403, projectOwnerForbiddenResponse())

                try {
                    const existing = await findOrganizationMember(
                        auth,
                        organizationId,
                        params.memberId,
                        request.headers
                    )
                    if (existing === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project member not found' },
                        })
                    }
                    if (existing.userId === user.id) return status(409, selfMembershipResponse())
                    if (normalizeProjectRole(existing.role) === 'owner') {
                        return status(409, ownerMembershipResponse())
                    }

                    await auth.api.removeMember({
                        body: {
                            memberIdOrEmail: params.memberId,
                            organizationId,
                        },
                        headers: request.headers,
                    })
                    return { removed: true as const }
                } catch {
                    return status(503, organizationOperationFailedResponse())
                }
            }
        )
}
