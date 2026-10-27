import type { PostdotAuth } from '@postdot/auth'
import type { ResourceLifecycleStore } from '@postdot/db'
import type { AccessStore } from '@postdot/db'
import { Type } from 'typebox'

import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'

const errorResponse = Type.Object({
    error: Type.Object({
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
    }),
})

const workspaceParams = Type.Object({ workspaceId: Type.String({ minLength: 1 }) })
const workspaceMemberParams = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
    memberId: Type.String({ minLength: 1 }),
})
const workspaceTeamParams = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
    teamId: Type.String({ minLength: 1 }),
})
const workspaceTeamMemberParams = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
    teamId: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
})
const workspaceInvitationParams = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
    invitationId: Type.String({ minLength: 1 }),
})
const workspaceRoleSchema = Type.Union([
    Type.Literal('owner'),
    Type.Literal('admin'),
    Type.Literal('member'),
])
const workspaceSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    slug: Type.String({ minLength: 1 }),
    isDefault: Type.Boolean(),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
const workspaceListItemSchema = Type.Intersect([
    workspaceSchema,
    Type.Object({ role: workspaceRoleSchema }),
])
const workspaceListResponseSchema = Type.Object({
    workspaces: Type.Array(workspaceListItemSchema),
    canCreateWorkspace: Type.Boolean(),
})
const workspaceMemberSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    image: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    role: Type.String({ minLength: 1 }),
    createdAt: Type.Integer({ minimum: 0 }),
})
const workspaceTeamSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    memberCount: Type.Integer({ minimum: 0 }),
    isDefault: Type.Boolean(),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
const workspaceTeamMemberSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    teamId: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
    createdAt: Type.Integer({ minimum: 0 }),
})
const workspaceInvitationSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    role: Type.String({ minLength: 1 }),
    teamId: Type.Optional(Type.String({ minLength: 1 })),
    inviterId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    expiresAt: Type.Integer({ minimum: 0 }),
    createdAt: Type.Integer({ minimum: 0 }),
})
const workspaceSummarySchema = Type.Object({
    workspace: workspaceSchema,
    membership: Type.Object({ role: workspaceRoleSchema }),
    members: Type.Array(workspaceMemberSchema),
    teams: Type.Array(workspaceTeamSchema),
})
const workspaceInvitationResponseSchema = Type.Object({
    invitation: workspaceInvitationSchema,
})
const workspaceInvitationListSchema = Type.Object({
    invitations: Type.Array(workspaceInvitationSchema),
})
const workspaceInvitationBody = Type.Object({
    email: Type.String({ minLength: 1, maxLength: 320 }),
    role: Type.Optional(Type.Union([Type.Literal('admin'), Type.Literal('member')])),
    teamId: Type.Optional(Type.String({ minLength: 1 })),
    resend: Type.Optional(Type.Boolean()),
})
const createWorkspaceBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 80 }),
})
const workspaceMemberRoleBody = Type.Object({
    role: Type.Union([Type.Literal('admin'), Type.Literal('member')]),
})
const workspaceTeamBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 80 }),
})
const workspaceTeamMemberBody = Type.Object({
    userId: Type.String({ minLength: 1 }),
})
const workspaceInvitationAcceptanceSchema = Type.Object({
    workspace: workspaceSchema,
    membership: Type.Object({ role: workspaceRoleSchema }),
    invitation: workspaceInvitationSchema,
})

const sessionOnlyForbiddenResponse = () => ({
    error: {
        code: 'forbidden',
        message: 'A human session is required for workspace access',
    },
})

const workspaceForbiddenResponse = () => ({
    error: {
        code: 'forbidden',
        message: 'An active workspace membership is required',
    },
})

const workspaceAdminForbiddenResponse = () => ({
    error: {
        code: 'forbidden',
        message: 'A workspace owner or administrator session is required',
    },
})

const workspaceOperationFailedResponse = () => ({
    error: {
        code: 'workspace_operation_failed',
        message: 'The workspace operation could not be completed',
    },
})

const workspaceOwnerProtectedResponse = () => ({
    error: {
        code: 'workspace_owner_protected',
        message: 'The workspace owner cannot be changed or removed here',
    },
})

const workspaceSelfUpdateResponse = () => ({
    error: {
        code: 'workspace_self_update',
        message: 'You cannot change your own workspace membership here',
    },
})

const workspaceSelfRemovalResponse = () => ({
    error: {
        code: 'workspace_self_removal',
        message: 'You cannot remove your own workspace membership here',
    },
})

const workspaceLastAdminResponse = () => ({
    error: {
        code: 'workspace_last_admin',
        message: 'Keep at least one workspace administrator before demoting this member',
    },
})

function toWorkspaceResponse(workspace: NonNullable<ReturnType<AccessStore['getWorkspace']>>) {
    const { organizationId: _organizationId, ...publicWorkspace } = workspace
    return publicWorkspace
}

function toWorkspaceMember(member: {
    readonly id: string
    readonly organizationId: string
    readonly role: string
    readonly createdAt: Date
    readonly userId: string
    readonly user: {
        readonly id: string
        readonly email: string
        readonly name: string
        readonly image?: string | null
    }
}) {
    return {
        id: member.id,
        userId: member.userId,
        email: member.user.email,
        name: member.user.name.trim() || member.user.email,
        image: member.user.image?.trim() || null,
        role: member.role,
        createdAt: member.createdAt.getTime(),
    }
}

function toWorkspaceTeam(
    team: {
        readonly id: string
        readonly name: string
        readonly organizationId: string
        readonly memberCount?: number
        readonly createdAt: Date
        readonly updatedAt?: Date
    },
    workspaceId: string
) {
    return {
        id: team.id,
        name: team.name,
        memberCount: team.memberCount ?? 0,
        isDefault: isDefaultWorkspaceTeam(workspaceId, team.id),
        createdAt: team.createdAt.getTime(),
        updatedAt: team.updatedAt?.getTime() ?? team.createdAt.getTime(),
    }
}

function toWorkspaceTeamMember(member: {
    readonly id: string
    readonly teamId: string
    readonly userId: string
    readonly createdAt: Date
}) {
    return {
        id: member.id,
        teamId: member.teamId,
        userId: member.userId,
        createdAt: member.createdAt.getTime(),
    }
}

function isDefaultWorkspaceTeam(workspaceId: string, teamId: string): boolean {
    return ['administrators', 'editors', 'reviewers', 'viewers'].some(
        name => teamId === `postdot-workspace-team:${workspaceId}:${name}`
    )
}

async function findWorkspaceTeam(
    auth: PostdotAuth,
    workspace: NonNullable<ReturnType<AccessStore['getWorkspace']>>,
    teamId: string,
    headers: Headers
) {
    const teams = await auth.api.listOrganizationTeams({
        query: { organizationId: workspace.organizationId },
        headers,
    })
    return teams.find(team => team.id === teamId) ?? null
}

function toWorkspaceInvitation(invitation: {
    readonly id: string
    readonly email: string
    readonly role: string
    readonly teamId?: string
    readonly inviterId: string
    readonly status: string
    readonly expiresAt: Date
    readonly createdAt: Date
}) {
    return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        ...(invitation.teamId === undefined ? {} : { teamId: invitation.teamId }),
        inviterId: invitation.inviterId,
        status: invitation.status,
        expiresAt: invitation.expiresAt.getTime(),
        createdAt: invitation.createdAt.getTime(),
    }
}

function hasWorkspaceRole(
    access: AccessStore,
    workspaceId: string,
    userId: string,
    required: 'member' | 'admin'
): boolean {
    const membership = access.getWorkspaceMembership(workspaceId, userId)
    if (membership === null) return false
    if (required === 'member') return true
    return access.canManageWorkspace(workspaceId, userId)
}

function hasOrganizationRole(role: string, expected: 'owner' | 'admin'): boolean {
    return role.split(',').some(part => part.trim() === expected)
}

export function registerWorkspaceRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    auth: PostdotAuth,
    access: AccessStore,
    lifecycle?: ResourceLifecycleStore
) {
    return app
        .post(
            '/api/workspaces',
            {
                auth: true,
                body: createWorkspaceBody,
                response: {
                    201: Type.Object({ workspace: workspaceListItemSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'createWorkspace',
                    summary: 'Create a workspace for the Postdot instance',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                if (!access.isInstanceAdmin(user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'An instance administrator session is required',
                        },
                    })
                }

                const name = body.name.trim()
                if (name === '') {
                    return status(400, {
                        error: {
                            code: 'invalid_workspace_name',
                            message: 'A workspace name is required',
                        },
                    })
                }

                const slugBase = name
                    .normalize('NFKD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .slice(0, 48)
                const slug = `${slugBase || 'workspace'}-${crypto.randomUUID().slice(0, 8)}`

                let organization: Awaited<ReturnType<PostdotAuth['api']['createOrganization']>>
                try {
                    organization = await auth.api.createOrganization({
                        body: {
                            name,
                            slug,
                            userId: user.id,
                            metadata: { postdotResource: 'workspace' },
                        },
                    })
                } catch {
                    return status(409, {
                        error: {
                            code: 'workspace_creation_failed',
                            message: 'The workspace could not be created',
                        },
                    })
                }

                try {
                    const workspace = access.createWorkspaceProjection({
                        organizationId: organization.id,
                        name,
                        slug,
                        ownerUserId: user.id,
                    })
                    return status(201, {
                        workspace: {
                            ...toWorkspaceResponse(workspace),
                            role: 'owner' as const,
                        },
                    })
                } catch {
                    try {
                        await auth.api.deleteOrganization({
                            body: { organizationId: organization.id },
                            headers: request.headers,
                        })
                    } catch {
                        // Leave the original failure visible; a retry can be
                        // handled by the instance administrator if cleanup is
                        // rejected by the auth adapter.
                    }
                    return status(503, workspaceOperationFailedResponse())
                }
            }
        )
        .get(
            '/api/workspaces',
            {
                auth: true,
                query: Type.Object({ includeArchived: Type.Optional(Type.Boolean()) }),
                response: {
                    200: workspaceListResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'listWorkspaces',
                    summary: 'List workspaces available to the current user',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, status, user, query }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                return {
                    canCreateWorkspace: access.isInstanceAdmin(user.id),
                    workspaces: access
                        .listWorkspacesForUser(user.id)
                        .filter(
                            workspace =>
                                query.includeArchived ||
                                !lifecycle ||
                                lifecycle.state('workspace', workspace.id) === 'active'
                        )
                        .map(workspace => {
                            const { organizationId: _organizationId, ...publicWorkspace } =
                                workspace
                            return publicWorkspace
                        }),
                }
            }
        )
        .get(
            '/api/workspaces/:workspaceId',
            {
                auth: true,
                params: workspaceParams,
                response: {
                    200: workspaceSummarySchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'getWorkspace',
                    summary: 'Get a workspace and its groups',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'member')) {
                    return status(403, workspaceForbiddenResponse())
                }

                try {
                    const [members, teams] = await Promise.all([
                        auth.api.listMembers({
                            query: { organizationId: workspace.organizationId, limit: 1_000 },
                            headers: request.headers,
                        }),
                        auth.api.listOrganizationTeams({
                            query: { organizationId: workspace.organizationId },
                            headers: request.headers,
                        }),
                    ])
                    return {
                        workspace: toWorkspaceResponse(workspace),
                        membership: {
                            role:
                                access.getWorkspaceMembership(workspace.id, user.id)?.role ??
                                'member',
                        },
                        members: members.members.map(toWorkspaceMember),
                        teams: teams.map(team => toWorkspaceTeam(team, workspace.id)),
                    }
                } catch {
                    return status(503, workspaceOperationFailedResponse())
                }
            }
        )
        .patch(
            '/api/workspaces/:workspaceId/members/:memberId',
            {
                auth: true,
                body: workspaceMemberRoleBody,
                params: workspaceMemberParams,
                response: {
                    200: Type.Object({ member: workspaceMemberSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'updateWorkspaceMemberRole',
                    summary: 'Update a workspace member role',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }

                try {
                    const members = await auth.api.listMembers({
                        query: { organizationId: workspace.organizationId, limit: 1_000 },
                        headers: request.headers,
                    })
                    const member = members.members.find(
                        candidate => candidate.id === params.memberId
                    )
                    if (member === undefined) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace member not found' },
                        })
                    }
                    if (hasOrganizationRole(member.role, 'owner')) {
                        return status(409, workspaceOwnerProtectedResponse())
                    }
                    if (member.userId === user.id) {
                        return status(409, workspaceSelfUpdateResponse())
                    }
                    if (
                        body.role === 'member' &&
                        hasOrganizationRole(member.role, 'admin') &&
                        !members.members.some(
                            candidate =>
                                candidate.userId !== member.userId &&
                                hasOrganizationRole(candidate.role, 'owner')
                        ) &&
                        !members.members.some(
                            candidate =>
                                candidate.userId !== member.userId &&
                                hasOrganizationRole(candidate.role, 'admin')
                        )
                    ) {
                        return status(409, workspaceLastAdminResponse())
                    }

                    await auth.api.updateMemberRole({
                        body: {
                            memberId: member.id,
                            role: body.role,
                            organizationId: workspace.organizationId,
                        },
                        headers: request.headers,
                    })
                    const updatedMembers = await auth.api.listMembers({
                        query: { organizationId: workspace.organizationId, limit: 1_000 },
                        headers: request.headers,
                    })
                    const updated = updatedMembers.members.find(
                        candidate => candidate.id === member.id
                    )
                    if (updated === undefined) {
                        return status(503, workspaceOperationFailedResponse())
                    }
                    return { member: toWorkspaceMember(updated) }
                } catch {
                    return status(503, workspaceOperationFailedResponse())
                }
            }
        )
        .delete(
            '/api/workspaces/:workspaceId/members/:memberId',
            {
                auth: true,
                params: workspaceMemberParams,
                response: {
                    200: Type.Object({ removed: Type.Literal(true) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'removeWorkspaceMember',
                    summary: 'Remove a member from a workspace',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }

                try {
                    const members = await auth.api.listMembers({
                        query: { organizationId: workspace.organizationId, limit: 1_000 },
                        headers: request.headers,
                    })
                    const member = members.members.find(
                        candidate => candidate.id === params.memberId
                    )
                    if (member === undefined) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace member not found' },
                        })
                    }
                    if (hasOrganizationRole(member.role, 'owner')) {
                        return status(409, workspaceOwnerProtectedResponse())
                    }
                    if (member.userId === user.id) {
                        return status(409, workspaceSelfRemovalResponse())
                    }

                    const teams = await auth.api.listOrganizationTeams({
                        query: { organizationId: workspace.organizationId },
                        headers: request.headers,
                    })
                    const teamMemberships = teams.flatMap(team =>
                        access
                            .listWorkspaceTeamMembers(workspace.id, team.id)
                            .filter(teamMember => teamMember.userId === member.userId)
                            .map(teamMember => ({ teamId: team.id, userId: teamMember.userId }))
                    )
                    await Promise.all(
                        teamMemberships.map(teamMember =>
                            auth.api.removeTeamMember({
                                body: {
                                    teamId: teamMember.teamId,
                                    userId: teamMember.userId,
                                    organizationId: workspace.organizationId,
                                },
                                headers: request.headers,
                            })
                        )
                    )
                    await auth.api.removeMember({
                        body: {
                            memberIdOrEmail: member.id,
                            organizationId: workspace.organizationId,
                        },
                        headers: request.headers,
                    })
                    return { removed: true }
                } catch {
                    return status(503, workspaceOperationFailedResponse())
                }
            }
        )
        .post(
            '/api/workspaces/:workspaceId/teams',
            {
                auth: true,
                body: workspaceTeamBody,
                params: workspaceParams,
                response: {
                    201: Type.Object({ team: workspaceTeamSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'createWorkspaceTeam',
                    summary: 'Create a workspace group',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }
                const name = body.name.trim()
                if (name.length === 0) {
                    return status(400, {
                        error: { code: 'invalid_team_name', message: 'A group name is required' },
                    })
                }

                try {
                    const team = await auth.api.createTeam({
                        body: { name, organizationId: workspace.organizationId },
                        headers: request.headers,
                    })
                    return status(201, { team: toWorkspaceTeam(team, workspace.id) })
                } catch {
                    return status(409, workspaceOperationFailedResponse())
                }
            }
        )
        .patch(
            '/api/workspaces/:workspaceId/teams/:teamId',
            {
                auth: true,
                body: workspaceTeamBody,
                params: workspaceTeamParams,
                response: {
                    200: Type.Object({ team: workspaceTeamSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'renameWorkspaceTeam',
                    summary: 'Rename a workspace group',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }
                const name = body.name.trim()
                if (name.length === 0) {
                    return status(400, {
                        error: { code: 'invalid_team_name', message: 'A group name is required' },
                    })
                }

                try {
                    const existing = await findWorkspaceTeam(
                        auth,
                        workspace,
                        params.teamId,
                        request.headers
                    )
                    if (existing === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace group not found' },
                        })
                    }
                    const team = await auth.api.updateTeam({
                        body: {
                            teamId: existing.id,
                            data: { name, organizationId: workspace.organizationId },
                        },
                        headers: request.headers,
                    })
                    return { team: toWorkspaceTeam(team, workspace.id) }
                } catch {
                    return status(409, workspaceOperationFailedResponse())
                }
            }
        )
        .get(
            '/api/workspaces/:workspaceId/teams/:teamId/members',
            {
                auth: true,
                params: workspaceTeamParams,
                response: {
                    200: Type.Object({ members: Type.Array(workspaceTeamMemberSchema) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'listWorkspaceTeamMembers',
                    summary: 'List members of a workspace group',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'member')) {
                    return status(403, workspaceForbiddenResponse())
                }

                try {
                    const team = await findWorkspaceTeam(
                        auth,
                        workspace,
                        params.teamId,
                        request.headers
                    )
                    if (team === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace group not found' },
                        })
                    }
                    return {
                        members: access
                            .listWorkspaceTeamMembers(workspace.id, team.id)
                            .map(toWorkspaceTeamMember),
                    }
                } catch {
                    return status(503, workspaceOperationFailedResponse())
                }
            }
        )
        .post(
            '/api/workspaces/:workspaceId/teams/:teamId/members',
            {
                auth: true,
                body: workspaceTeamMemberBody,
                params: workspaceTeamParams,
                response: {
                    200: Type.Object({ member: workspaceTeamMemberSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'addWorkspaceTeamMember',
                    summary: 'Add a member to a workspace group',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }

                try {
                    const team = await findWorkspaceTeam(
                        auth,
                        workspace,
                        params.teamId,
                        request.headers
                    )
                    if (team === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace group not found' },
                        })
                    }
                    if (access.getWorkspaceMembership(workspace.id, body.userId) === null) {
                        return status(404, {
                            error: {
                                code: 'workspace_member_not_found',
                                message: 'The user is not a member of this workspace',
                            },
                        })
                    }
                    const member = await auth.api.addTeamMember({
                        body: {
                            organizationId: workspace.organizationId,
                            teamId: team.id,
                            userId: body.userId,
                        },
                        headers: request.headers,
                    })
                    return { member: toWorkspaceTeamMember(member) }
                } catch {
                    return status(409, workspaceOperationFailedResponse())
                }
            }
        )
        .delete(
            '/api/workspaces/:workspaceId/teams/:teamId/members/:userId',
            {
                auth: true,
                params: workspaceTeamMemberParams,
                response: {
                    200: Type.Object({ removed: Type.Literal(true) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'removeWorkspaceTeamMember',
                    summary: 'Remove a member from a workspace group',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }

                try {
                    const team = await findWorkspaceTeam(
                        auth,
                        workspace,
                        params.teamId,
                        request.headers
                    )
                    if (team === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace group not found' },
                        })
                    }
                    await auth.api.removeTeamMember({
                        body: {
                            organizationId: workspace.organizationId,
                            teamId: team.id,
                            userId: params.userId,
                        },
                        headers: request.headers,
                    })
                    return { removed: true }
                } catch {
                    return status(409, workspaceOperationFailedResponse())
                }
            }
        )
        .get(
            '/api/workspaces/:workspaceId/invitations',
            {
                auth: true,
                params: workspaceParams,
                response: {
                    200: workspaceInvitationListSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'listWorkspaceInvitations',
                    summary: 'List pending workspace invitations',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }

                try {
                    const invitations = await auth.api.listInvitations({
                        query: { organizationId: workspace.organizationId },
                        headers: request.headers,
                    })
                    return {
                        invitations: invitations
                            .filter(invitation => invitation.projectId == null)
                            .map(toWorkspaceInvitation),
                    }
                } catch {
                    return status(503, workspaceOperationFailedResponse())
                }
            }
        )
        .post(
            '/api/workspaces/:workspaceId/invitations',
            {
                auth: true,
                body: workspaceInvitationBody,
                params: workspaceParams,
                response: {
                    201: workspaceInvitationResponseSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'createWorkspaceInvitation',
                    summary: 'Invite a member to a workspace group',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }

                try {
                    const invitation = await auth.api.createInvitation({
                        body: {
                            email: body.email.trim().toLowerCase(),
                            role: body.role ?? 'member',
                            organizationId: workspace.organizationId,
                            ...(body.resend === undefined ? {} : { resend: body.resend }),
                            ...(body.teamId === undefined ? {} : { teamId: body.teamId }),
                        },
                        headers: request.headers,
                    })
                    return status(201, { invitation: toWorkspaceInvitation(invitation) })
                } catch {
                    return status(409, workspaceOperationFailedResponse())
                }
            }
        )
        .delete(
            '/api/workspaces/:workspaceId/invitations/:invitationId',
            {
                auth: true,
                params: workspaceInvitationParams,
                response: {
                    200: workspaceInvitationResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'cancelWorkspaceInvitation',
                    summary: 'Cancel a workspace invitation',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!hasWorkspaceRole(access, workspace.id, user.id, 'admin')) {
                    return status(403, workspaceAdminForbiddenResponse())
                }

                try {
                    const invitations = await auth.api.listInvitations({
                        query: { organizationId: workspace.organizationId },
                        headers: request.headers,
                    })
                    const invitation = invitations.find(item => item.id === params.invitationId)
                    if (invitation === undefined) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace invitation not found' },
                        })
                    }
                    const canceled = await auth.api.cancelInvitation({
                        body: { invitationId: params.invitationId },
                        headers: request.headers,
                    })
                    return { invitation: toWorkspaceInvitation(canceled) }
                } catch {
                    return status(409, workspaceOperationFailedResponse())
                }
            }
        )
        .post(
            '/api/workspaces/:workspaceId/invitations/:invitationId/accept',
            {
                auth: true,
                params: workspaceInvitationParams,
                response: {
                    200: workspaceInvitationAcceptanceSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'acceptWorkspaceInvitation',
                    summary: 'Accept a workspace invitation',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, sessionOnlyForbiddenResponse())
                const workspace = access.getWorkspace(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }

                try {
                    const invitation = await auth.api.getInvitation({
                        query: { id: params.invitationId },
                        headers: request.headers,
                    })
                    if (invitation.organizationId !== workspace.organizationId) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace invitation not found' },
                        })
                    }

                    const accepted = await auth.api.acceptInvitation({
                        body: { invitationId: params.invitationId },
                        headers: request.headers,
                    })
                    const membership = access.getWorkspaceMembership(workspace.id, user.id)
                    if (membership === null) {
                        return status(503, workspaceOperationFailedResponse())
                    }
                    return {
                        workspace: toWorkspaceResponse(workspace),
                        membership: { role: membership.role },
                        invitation: toWorkspaceInvitation(accepted.invitation),
                    }
                } catch {
                    return status(409, workspaceOperationFailedResponse())
                }
            }
        )
}
