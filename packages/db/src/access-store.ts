import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { requireNonBlank } from '@postdot/core'

import type { PostdotDatabase } from './client'
import { defineTransaction } from './client'

export const accessInstanceId = 'default'
export const defaultInvitationTtlMs = 7 * 24 * 60 * 60 * 1_000
export const maximumInvitationTtlMs = 30 * 24 * 60 * 60 * 1_000

export const instanceStates = ['claimable', 'claimed'] as const
export const instanceMembershipStates = ['enabled', 'disabled'] as const
export const instanceRoles = ['admin', 'member'] as const
export const workspaceRoles = ['owner', 'admin', 'member'] as const
export const projectMembershipStates = ['active'] as const
export const projectRoles = ['owner', 'editor', 'viewer'] as const
export const invitationStates = ['pending', 'accepted', 'revoked', 'expired'] as const

export type AccessInstanceState = (typeof instanceStates)[number]
export type AccessInstanceMembershipState = (typeof instanceMembershipStates)[number]
export type AccessInstanceRole = (typeof instanceRoles)[number]
export type AccessWorkspaceRole = (typeof workspaceRoles)[number]
export type AccessProjectMembershipState = (typeof projectMembershipStates)[number]
export type AccessProjectRole = (typeof projectRoles)[number]
export type AccessInvitationState = (typeof invitationStates)[number]

export interface AccessStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
    readonly invitationTtlMs?: number
}

export interface AccessInstanceStateRecord {
    readonly id: typeof accessInstanceId
    readonly state: AccessInstanceState
    /** Reserved for an explicit operator recovery workflow. */
    readonly bootstrapBlocked: boolean
    readonly claimedByUserId: string | null
    readonly claimedAt: number | null
    readonly defaultWorkspaceId: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessWorkspace {
    readonly id: string
    readonly organizationId: string
    readonly name: string
    readonly slug: string
    readonly isDefault: boolean
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessWorkspaceMembership {
    readonly id: string
    readonly workspaceId: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly role: AccessWorkspaceRole
    readonly createdAt: number
}

export interface AccessWorkspaceTeamMember {
    readonly id: string
    readonly teamId: string
    readonly userId: string
    readonly createdAt: Date
}

export interface AccessInstanceMembership {
    readonly id: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly role: AccessInstanceRole
    readonly state: AccessInstanceMembershipState
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessProjectMembership {
    readonly id: string
    readonly projectId: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly role: AccessProjectRole
    readonly state: AccessProjectMembershipState
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessProjectUserGrant {
    readonly id: string
    readonly projectId: string
    readonly userId: string
    readonly role: AccessProjectRole
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessProjectTeamGrant {
    readonly id: string
    readonly projectId: string
    readonly teamId: string
    readonly teamName: string
    readonly role: AccessProjectRole
    readonly createdAt: number
    readonly updatedAt: number
}

/** Instance invitations are the only invitation records owned by Postdot. */
export interface AccessInvitation {
    readonly id: string
    readonly targetEmail: string
    readonly instanceRole: 'member'
    readonly state: AccessInvitationState
    readonly createdByUserId: string
    readonly expiresAt: number
    readonly acceptedAt: number | null
    readonly acceptedByUserId: string | null
    readonly revokedAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface CreatedAccessInvitation {
    readonly invitation: AccessInvitation
    /** The raw token is returned only at creation and is never persisted. */
    readonly token: string
}

export interface BootstrapFirstAccountInput {
    readonly userId: string
}

export interface CreateWorkspaceProjectionInput {
    readonly organizationId: string
    readonly name: string
    readonly slug: string
    readonly ownerUserId: string
}

export type BootstrapFirstAccountResult =
    | { readonly kind: 'claimed'; readonly membership: AccessInstanceMembership }
    | { readonly kind: 'already_claimed' }

export interface CreateAccessInvitationInput {
    readonly targetEmail: string
    readonly createdByUserId: string
    readonly expiresAt?: number
}

export interface UpdateInstanceMembershipInput {
    readonly actorUserId: string
    readonly userId: string
    readonly role?: AccessInstanceRole
    readonly state?: AccessInstanceMembershipState
}

export type UpdateInstanceMembershipResult =
    | { readonly kind: 'updated'; readonly membership: AccessInstanceMembership }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'last_admin' }
    | { readonly kind: 'self_update' }

export type CreateAccessInvitationResult = CreatedAccessInvitation

export type RevokeAccessInvitationResult =
    | { readonly kind: 'revoked'; readonly invitation: AccessInvitation }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_pending' }

export type AcceptAccessInvitationResult =
    | {
          readonly kind: 'accepted'
          readonly invitation: AccessInvitation
          readonly instanceMembership: AccessInstanceMembership
      }
    | { readonly kind: 'invalid' }

interface InstanceStateRow {
    readonly id: string
    readonly state: AccessInstanceState
    readonly bootstrapBlocked: number
    readonly claimedByUserId: string | null
    readonly claimedAt: number | null
    readonly defaultWorkspaceId: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface WorkspaceRow {
    readonly id: string
    readonly organizationId: string
    readonly name: string
    readonly slug: string
    readonly isDefault: number
    readonly createdAt: number
    readonly updatedAt: number
}

interface WorkspaceMembershipRow {
    readonly id: string
    readonly workspaceId: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly role: string
    readonly createdAt: number
}

interface InstanceMembershipRow {
    readonly id: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly role: AccessInstanceRole
    readonly state: AccessInstanceMembershipState
    readonly authRole: string | null
    readonly authBanned: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface ProjectMembershipRow {
    readonly id: string
    readonly projectId: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly role: AccessProjectRole
    readonly state: 'active'
    readonly createdAt: number
    readonly updatedAt: number
}

interface ProjectUserGrantRow {
    readonly id: string
    readonly projectId: string
    readonly userId: string
    readonly role: AccessProjectRole
    readonly createdAt: number
    readonly updatedAt: number
}

interface ProjectTeamGrantRow {
    readonly id: string
    readonly projectId: string
    readonly teamId: string
    readonly teamName: string
    readonly role: AccessProjectRole
    readonly createdAt: number
    readonly updatedAt: number
}

interface InvitationRow {
    readonly id: string
    readonly targetEmail: string
    readonly instanceRole: 'member'
    readonly state: AccessInvitationState
    readonly createdByUserId: string
    readonly expiresAt: number
    readonly acceptedAt: number | null
    readonly acceptedByUserId: string | null
    readonly revokedAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

function normalizeEmail(email: string): string {
    return requireNonBlank(email, 'targetEmail').trim().toLowerCase()
}

function hashInvitationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

function toInstanceState(row: InstanceStateRow): AccessInstanceStateRecord {
    return {
        id: accessInstanceId,
        state: row.state,
        bootstrapBlocked: row.bootstrapBlocked === 1,
        claimedByUserId: row.claimedByUserId,
        claimedAt: row.claimedAt,
        defaultWorkspaceId: row.defaultWorkspaceId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toWorkspace(row: WorkspaceRow): AccessWorkspace {
    return {
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        slug: row.slug,
        isDefault: row.isDefault === 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function normalizeWorkspaceRole(role: string): AccessWorkspaceRole {
    const roles = role.split(',').map(value => value.trim())
    if (roles.includes('owner')) return 'owner'
    if (roles.includes('admin')) return 'admin'
    if (roles.includes('member')) return 'member'
    throw new Error(`Unsupported Better Auth workspace role: ${role}`)
}

function toWorkspaceMembership(row: WorkspaceMembershipRow): AccessWorkspaceMembership {
    return {
        id: row.id,
        workspaceId: row.workspaceId,
        userId: row.userId,
        email: row.email,
        name: row.name,
        role: normalizeWorkspaceRole(row.role),
        createdAt: row.createdAt,
    }
}

function toInstanceMembership(row: InstanceMembershipRow): AccessInstanceMembership {
    const authRoles = row.authRole?.split(',').map(role => role.trim()) ?? []
    return {
        id: row.id,
        userId: row.userId,
        email: row.email,
        name: row.name,
        role: row.authRole === null ? row.role : authRoles.includes('admin') ? 'admin' : 'member',
        state: row.authBanned === 1 ? 'disabled' : row.state,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toProjectMembership(row: ProjectMembershipRow): AccessProjectMembership {
    return {
        id: row.id,
        projectId: row.projectId,
        userId: row.userId,
        email: row.email,
        name: row.name,
        role: row.role,
        state: row.state,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toProjectUserGrant(row: ProjectUserGrantRow): AccessProjectUserGrant {
    return {
        id: row.id,
        projectId: row.projectId,
        userId: row.userId,
        role: row.role,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toProjectTeamGrant(row: ProjectTeamGrantRow): AccessProjectTeamGrant {
    return {
        id: row.id,
        projectId: row.projectId,
        teamId: row.teamId,
        teamName: row.teamName,
        role: row.role,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toInvitation(row: InvitationRow): AccessInvitation {
    return {
        id: row.id,
        targetEmail: row.targetEmail,
        instanceRole: row.instanceRole,
        state: row.state,
        createdByUserId: row.createdByUserId,
        expiresAt: row.expiresAt,
        acceptedAt: row.acceptedAt,
        acceptedByUserId: row.acceptedByUserId,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function hasProjectRole(role: AccessProjectRole, minimumRole: AccessProjectRole): boolean {
    const rank: Record<AccessProjectRole, number> = { viewer: 1, editor: 2, owner: 3 }
    return rank[role] >= rank[minimumRole]
}

function selectBestProjectMembership(
    rows: Array<ProjectMembershipRow | null>
): ProjectMembershipRow | null {
    const rank: Record<AccessProjectRole, number> = { viewer: 1, editor: 2, owner: 3 }
    return rows.reduce<ProjectMembershipRow | null>((selected, candidate) => {
        if (candidate === null) return selected
        if (selected === null) return candidate
        if (rank[candidate.role] > rank[selected.role]) return candidate
        if (rank[candidate.role] < rank[selected.role]) return selected

        // Prefer a direct grant over an inherited team grant when both produce
        // the same role.
        const candidateIsDirect = !candidate.id.startsWith('project-team-grant:')
        const selectedIsDirect = !selected.id.startsWith('project-team-grant:')
        if (candidateIsDirect && !selectedIsDirect) return candidate
        return selected
    }, null)
}

export function createAccessStore(database: PostdotDatabase, options: AccessStoreOptions = {}) {
    const sql = database.sql
    const now = options.now ?? Date.now
    const createId = options.createId ?? randomUUID
    const invitationTtlMs = options.invitationTtlMs ?? defaultInvitationTtlMs

    if (invitationTtlMs <= 0 || invitationTtlMs > maximumInvitationTtlMs) {
        throw new Error(`invitationTtlMs must be between 1 and ${maximumInvitationTtlMs}`)
    }

    const loadInstanceStateStatement = sql.statement<InstanceStateRow, []>(`
        select id,
               state,
               bootstrap_blocked as bootstrapBlocked,
               claimed_by_user_id as claimedByUserId,
               claimed_at as claimedAt,
               default_workspace_id as defaultWorkspaceId,
               created_at as createdAt,
               updated_at as updatedAt
        from instance_state
        where id = 'default'
    `)
    const loadDefaultWorkspaceStatement = sql.statement<WorkspaceRow, []>(`
        select workspaces.id,
               workspaces.organization_id as organizationId,
               workspaces.name,
               workspaces.slug,
               workspaces.is_default as isDefault,
               workspaces.created_at as createdAt,
               workspaces.updated_at as updatedAt
        from instance_state
        inner join workspaces on workspaces.id = instance_state.default_workspace_id
        where instance_state.id = 'default'
    `)
    const loadWorkspaceStatement = sql.statement<WorkspaceRow, [workspaceId: string]>(`
        select id,
               organization_id as organizationId,
               name,
               slug,
               is_default as isDefault,
               created_at as createdAt,
               updated_at as updatedAt
        from workspaces
        where id = ?1
    `)
    const loadWorkspaceByOrganizationStatement = sql.statement<
        WorkspaceRow,
        [organizationId: string]
    >(`
        select id,
               organization_id as organizationId,
               name,
               slug,
               is_default as isDefault,
               created_at as createdAt,
               updated_at as updatedAt
        from workspaces
        where organization_id = ?1
    `)
    const listWorkspacesForUserStatement = sql.statement<
        WorkspaceRow & { readonly role: string },
        [userId: string]
    >(`
        select workspaces.id,
               workspaces.organization_id as organizationId,
               workspaces.name,
               workspaces.slug,
               workspaces.is_default as isDefault,
               workspaces.created_at as createdAt,
               workspaces.updated_at as updatedAt,
               members.role
        from workspaces
        inner join member as members on members.organization_id = workspaces.organization_id
        where members.user_id = ?1
        order by workspaces.is_default desc, workspaces.created_at, workspaces.id
    `)
    const loadWorkspaceMembershipStatement = sql.statement<
        WorkspaceMembershipRow,
        [workspaceId: string, userId: string]
    >(`
        select members.id,
               workspaces.id as workspaceId,
               members.user_id as userId,
               users.email,
               users.name,
               members.role,
               members.created_at as createdAt
        from workspaces
        inner join member as members on members.organization_id = workspaces.organization_id
        inner join user as users on users.id = members.user_id
        where workspaces.id = ?1
          and members.user_id = ?2
    `)
    const loadWorkspaceMemberStatement = sql.statement<
        { readonly role: string },
        [organizationId: string, userId: string]
    >(`
        select role
        from member
        where organization_id = ?1 and user_id = ?2
    `)
    const insertWorkspaceOrganizationStatement = sql.statement<
        void,
        [id: string, name: string, slug: string, metadata: string, createdAt: number]
    >(`
        insert into organization (id, name, slug, metadata, created_at)
        values (?1, ?2, ?3, ?4, ?5)
    `)
    const insertWorkspaceStatement = sql.statement<
        void,
        [
            id: string,
            organizationId: string,
            name: string,
            slug: string,
            isDefault: number,
            createdAt: number,
        ]
    >(`
        insert into workspaces (id, organization_id, name, slug, is_default, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `)
    const setDefaultWorkspaceStatement = sql.statement<
        { readonly changes: number },
        [workspaceId: string, updatedAt: number]
    >(`
        update instance_state
        set default_workspace_id = ?1,
            updated_at = ?2
        where id = 'default'
    `)
    const insertWorkspaceMemberStatement = sql.statement<
        void,
        [id: string, organizationId: string, userId: string, role: string, createdAt: number]
    >(`
        insert into member (id, organization_id, user_id, role, created_at)
        values (?1, ?2, ?3, ?4, ?5)
        on conflict (organization_id, user_id) do update set
            role = case
                when member.role in ('owner', 'admin') then member.role
                else excluded.role
            end
    `)
    const insertWorkspaceTeamStatement = sql.statement<
        void,
        [id: string, name: string, organizationId: string, createdAt: number]
    >(`
        insert into team (id, name, member_count, organization_id, created_at, updated_at)
        values (?1, ?2, 0, ?3, ?4, ?4)
    `)
    const addWorkspaceTeamMemberStatement = sql.statement<
        void,
        [id: string, teamId: string, userId: string, createdAt: number]
    >(`
        insert into team_member (id, team_id, user_id, membership_key, created_at)
        values (?1, ?2, ?3, ?1, ?4)
        on conflict (team_id, user_id) do nothing
    `)
    const refreshWorkspaceTeamMemberCountStatement = sql.statement<void, [teamId: string]>(`
        update team
        set member_count = (
                select count(*)
                from team_member as team_members
                inner join team as teams on teams.id = team_members.team_id
                inner join member as workspace_members
                    on workspace_members.organization_id = teams.organization_id
                   and workspace_members.user_id = team_members.user_id
                where team_members.team_id = ?1
            ),
            updated_at = cast(unixepoch('subsecond') * 1000 as integer)
        where id = ?1
    `)
    const listWorkspaceTeamMembersStatement = sql.statement<
        {
            readonly id: string
            readonly teamId: string
            readonly userId: string
            readonly createdAt: number
        },
        [workspaceId: string, teamId: string]
    >(`
        select team_members.id,
               team_members.team_id as teamId,
               team_members.user_id as userId,
               team_members.created_at as createdAt
        from workspaces
        inner join team
            on team.organization_id = workspaces.organization_id
        inner join team_member as team_members
            on team_members.team_id = team.id
        inner join member as workspace_members
            on workspace_members.organization_id = workspaces.organization_id
           and workspace_members.user_id = team_members.user_id
        where workspaces.id = ?1
          and team.id = ?2
        order by team_members.created_at, team_members.id
    `)
    const claimInstanceStatement = sql.statement<
        { readonly changes: number },
        [userId: string, claimedAt: number, updatedAt: number]
    >(`
        update instance_state
        set state = 'claimed',
            claimed_by_user_id = ?1,
            claimed_at = ?2,
            updated_at = ?3
        where id = 'default'
          and state = 'claimable'
          and bootstrap_blocked = 0
    `)
    const insertInstanceMembershipStatement = sql.statement<
        void,
        [
            id: string,
            userId: string,
            role: AccessInstanceRole,
            state: AccessInstanceMembershipState,
            now: number,
        ]
    >(`
        insert into instance_memberships (id, user_id, role, state, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?5)
    `)
    const ensureTestAdminMembershipStatement = sql.statement<
        void,
        [id: string, userId: string, now: number]
    >(`
        insert into instance_memberships (id, user_id, role, state, created_at, updated_at)
        values (?1, ?2, 'admin', 'enabled', ?3, ?3)
        on conflict (user_id) do update set
            role = 'admin',
            state = 'enabled',
            updated_at = excluded.updated_at
    `)
    const ensureTestAdminUserStatement = sql.statement<void, [userId: string]>(`
        update user
        set role = 'admin',
            banned = 0,
            ban_reason = null,
            ban_expires = null
        where id = ?1
    `)
    const hasPendingOrganizationInvitationForUserStatement = sql.statement<
        { readonly id: string },
        [userId: string, now: number]
    >(`
        select invitations.id
        from invitation as invitations
        inner join user as users on lower(users.email) = lower(invitations.email)
        where users.id = ?1
          and invitations.status = 'pending'
          and invitations.expires_at > ?2
        limit 1
    `)
    const loadInstanceMembershipStatement = sql.statement<InstanceMembershipRow, [userId: string]>(`
        select memberships.id,
               memberships.user_id as userId,
               users.email,
               users.name,
               memberships.role,
               memberships.state,
               users.role as authRole,
               users.banned as authBanned,
               memberships.created_at as createdAt,
               memberships.updated_at as updatedAt
        from instance_memberships as memberships
        inner join user as users on users.id = memberships.user_id
        where memberships.user_id = ?1
    `)
    const listInstanceMembershipsStatement = sql.statement<InstanceMembershipRow, []>(`
        select memberships.id,
               memberships.user_id as userId,
               users.email,
               users.name,
               memberships.role,
               memberships.state,
               users.role as authRole,
               users.banned as authBanned,
               memberships.created_at as createdAt,
               memberships.updated_at as updatedAt
        from instance_memberships as memberships
        inner join user as users on users.id = memberships.user_id
        order by memberships.created_at, memberships.id
    `)
    const countEnabledInstanceAdminsStatement = sql.statement<{ readonly count: number }, []>(`
        select count(*) as count
        from instance_memberships as memberships
        inner join user as users on users.id = memberships.user_id
        where memberships.state = 'enabled'
          and (users.banned is null or users.banned = 0)
          and instr(',' || coalesce(users.role, memberships.role) || ',', ',admin,') > 0
    `)
    const updateInstanceMembershipStatement = sql.statement<
        { readonly changes: number },
        [
            role: AccessInstanceRole,
            state: AccessInstanceMembershipState,
            updatedAt: number,
            userId: string,
        ]
    >(`
        update instance_memberships
        set role = ?1,
            state = ?2,
            updated_at = ?3
        where user_id = ?4
    `)
    const loadProjectUserGrantMembershipStatement = sql.statement<
        ProjectMembershipRow,
        [projectId: string, userId: string]
    >(`
        select grants.id,
               projects.id as projectId,
               grants.user_id as userId,
               users.email,
               users.name,
               grants.role,
               'active' as state,
               grants.created_at as createdAt,
               grants.updated_at as updatedAt
        from projects
        inner join project_user_grants as grants on grants.project_id = projects.id
        inner join user as users
            on users.id = grants.user_id
           and (users.banned is null or users.banned = 0)
        inner join instance_memberships
            on instance_memberships.user_id = grants.user_id
           and instance_memberships.state = 'enabled'
        where projects.id = ?1
          and grants.user_id = ?2
          and (
              projects.workspace_id is null
              or exists (
                  select 1
                  from workspaces
                  inner join member as workspace_members
                      on workspace_members.organization_id = workspaces.organization_id
                     and workspace_members.user_id = grants.user_id
                  where workspaces.id = projects.workspace_id
              )
          )
    `)
    const listProjectUserGrantMembershipsStatement = sql.statement<
        ProjectMembershipRow,
        [projectId: string]
    >(`
        select grants.id,
               projects.id as projectId,
               grants.user_id as userId,
               users.email,
               users.name,
               grants.role,
               'active' as state,
               grants.created_at as createdAt,
               grants.updated_at as updatedAt
        from projects
        inner join project_user_grants as grants on grants.project_id = projects.id
        inner join user as users
            on users.id = grants.user_id
           and (users.banned is null or users.banned = 0)
        inner join instance_memberships
            on instance_memberships.user_id = grants.user_id
           and instance_memberships.state = 'enabled'
        where projects.id = ?1
          and (
              projects.workspace_id is null
              or exists (
                  select 1
                  from workspaces
                  inner join member as workspace_members
                      on workspace_members.organization_id = workspaces.organization_id
                     and workspace_members.user_id = grants.user_id
                  where workspaces.id = projects.workspace_id
              )
          )
    `)
    const loadProjectTeamGrantMembershipStatement = sql.statement<
        ProjectMembershipRow,
        [projectId: string, userId: string]
    >(`
        select 'project-team-grant:' || grants.id as id,
               projects.id as projectId,
               team_members.user_id as userId,
               users.email,
               users.name,
               grants.role,
               'active' as state,
               grants.created_at as createdAt,
               grants.updated_at as updatedAt
        from projects
        inner join workspaces on workspaces.id = projects.workspace_id
        inner join project_team_grants as grants on grants.project_id = projects.id
        inner join team on team.id = grants.team_id
                       and team.organization_id = workspaces.organization_id
        inner join team_member as team_members on team_members.team_id = team.id
        inner join member as workspace_members
            on workspace_members.organization_id = workspaces.organization_id
           and workspace_members.user_id = team_members.user_id
        inner join user as users
            on users.id = team_members.user_id
           and (users.banned is null or users.banned = 0)
        inner join instance_memberships
            on instance_memberships.user_id = team_members.user_id
           and instance_memberships.state = 'enabled'
        where projects.id = ?1
          and team_members.user_id = ?2
    `)
    const listProjectTeamGrantMembershipsStatement = sql.statement<
        ProjectMembershipRow,
        [projectId: string]
    >(`
        select 'project-team-grant:' || grants.id as id,
               projects.id as projectId,
               team_members.user_id as userId,
               users.email,
               users.name,
               grants.role,
               'active' as state,
               grants.created_at as createdAt,
               grants.updated_at as updatedAt
        from projects
        inner join workspaces on workspaces.id = projects.workspace_id
        inner join project_team_grants as grants on grants.project_id = projects.id
        inner join team on team.id = grants.team_id
                       and team.organization_id = workspaces.organization_id
        inner join team_member as team_members on team_members.team_id = team.id
        inner join member as workspace_members
            on workspace_members.organization_id = workspaces.organization_id
           and workspace_members.user_id = team_members.user_id
        inner join user as users
            on users.id = team_members.user_id
           and (users.banned is null or users.banned = 0)
        inner join instance_memberships
            on instance_memberships.user_id = team_members.user_id
           and instance_memberships.state = 'enabled'
        where projects.id = ?1
    `)
    const listProjectUserGrantsStatement = sql.statement<ProjectUserGrantRow, [projectId: string]>(`
        select id,
               project_id as projectId,
               user_id as userId,
               role,
               created_at as createdAt,
               updated_at as updatedAt
        from project_user_grants
        where project_id = ?1
        order by created_at, id
    `)
    const listProjectTeamGrantsStatement = sql.statement<ProjectTeamGrantRow, [projectId: string]>(`
        select grants.id,
               grants.project_id as projectId,
               grants.team_id as teamId,
               team.name as teamName,
               grants.role,
               grants.created_at as createdAt,
               grants.updated_at as updatedAt
        from project_team_grants as grants
        inner join team on team.id = grants.team_id
        where grants.project_id = ?1
        order by grants.created_at, grants.id
    `)
    const loadProjectUserGrantStatement = sql.statement<
        ProjectUserGrantRow,
        [projectId: string, userId: string]
    >(`
        select id,
               project_id as projectId,
               user_id as userId,
               role,
               created_at as createdAt,
               updated_at as updatedAt
        from project_user_grants
        where project_id = ?1 and user_id = ?2
    `)
    const loadProjectTeamGrantStatement = sql.statement<
        ProjectTeamGrantRow,
        [projectId: string, teamId: string]
    >(`
        select grants.id,
               grants.project_id as projectId,
               grants.team_id as teamId,
               team.name as teamName,
               grants.role,
               grants.created_at as createdAt,
               grants.updated_at as updatedAt
        from project_team_grants as grants
        inner join team on team.id = grants.team_id
        where grants.project_id = ?1 and grants.team_id = ?2
    `)
    const projectExistsStatement = sql.statement<{ readonly id: string }, [projectId: string]>(`
        select id from projects where id = ?1
    `)
    const loadProjectWorkspaceStatement = sql.statement<
        { readonly workspaceId: string | null },
        [projectId: string]
    >(`
        select workspace_id as workspaceId
        from projects
        where id = ?1
    `)
    const loadInvitationByHashStatement = sql.statement<InvitationRow, [tokenHash: string]>(`
        select id,
               target_email as targetEmail,
               instance_role as instanceRole,
               state,
               created_by_user_id as createdByUserId,
               expires_at as expiresAt,
               accepted_at as acceptedAt,
               accepted_by_user_id as acceptedByUserId,
               revoked_at as revokedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from instance_access_invitations
        where token_hash = ?1
    `)
    const listInvitationsStatement = sql.statement<InvitationRow, []>(`
        select id,
               target_email as targetEmail,
               instance_role as instanceRole,
               state,
               created_by_user_id as createdByUserId,
               expires_at as expiresAt,
               accepted_at as acceptedAt,
               accepted_by_user_id as acceptedByUserId,
               revoked_at as revokedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from instance_access_invitations
        order by created_at desc, id desc
    `)
    const loadInvitationByIdStatement = sql.statement<InvitationRow, [id: string]>(`
        select id,
               target_email as targetEmail,
               instance_role as instanceRole,
               state,
               created_by_user_id as createdByUserId,
               expires_at as expiresAt,
               accepted_at as acceptedAt,
               accepted_by_user_id as acceptedByUserId,
               revoked_at as revokedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from instance_access_invitations
        where id = ?1
    `)
    const expireInvitationsStatement = sql.statement<
        { readonly changes: number },
        [updatedAt: number, now: number]
    >(`
        update instance_access_invitations
        set state = 'expired', updated_at = ?1
        where state = 'pending' and expires_at <= ?2
    `)
    const insertInvitationStatement = sql.statement<
        void,
        [
            id: string,
            targetEmail: string,
            tokenHash: string,
            createdByUserId: string,
            expiresAt: number,
            createdAt: number,
        ]
    >(`
        insert into instance_access_invitations (
            id, target_email, token_hash, instance_role, state,
            created_by_user_id, expires_at, created_at, updated_at
        ) values (?1, ?2, ?3, 'member', 'pending', ?4, ?5, ?6, ?6)
    `)
    const revokeInvitationStatement = sql.statement<
        { readonly changes: number },
        [updatedAt: number, revokedAt: number, invitationId: string]
    >(`
        update instance_access_invitations
        set state = 'revoked', revoked_at = ?2, updated_at = ?1
        where id = ?3 and state = 'pending'
    `)
    const acceptInvitationStatement = sql.statement<
        { readonly changes: number },
        [
            acceptedAt: number,
            acceptedByUserId: string,
            invitationId: string,
            tokenHash: string,
            targetEmail: string,
        ]
    >(`
        update instance_access_invitations
        set state = 'accepted', accepted_at = ?1, accepted_by_user_id = ?2, updated_at = ?1
        where id = ?3
          and token_hash = ?4
          and target_email = ?5
          and state = 'pending'
          and expires_at > ?1
    `)
    const upsertInstanceMembershipStatement = sql.statement<
        void,
        [id: string, userId: string, now: number]
    >(`
        insert into instance_memberships (id, user_id, role, state, created_at, updated_at)
        values (?1, ?2, 'member', 'enabled', ?3, ?3)
        on conflict (user_id) do update set
            role = case when instance_memberships.role = 'admin' then 'admin' else 'member' end,
            state = 'enabled',
            updated_at = excluded.updated_at
    `)
    const ensureOrganizationMemberInstanceMembershipStatement = sql.statement<
        void,
        [id: string, userId: string, now: number]
    >(`
        insert into instance_memberships (id, user_id, role, state, created_at, updated_at)
        values (?1, ?2, 'member', 'enabled', ?3, ?3)
        on conflict (user_id) do update set
            role = case when instance_memberships.role = 'admin' then 'admin' else 'member' end,
            state = instance_memberships.state,
            updated_at = excluded.updated_at
    `)
    const upsertProjectUserGrantStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            userId: string,
            role: AccessProjectRole,
            createdAt: number,
            updatedAt: number,
        ]
    >(`
        insert into project_user_grants (id, project_id, user_id, role, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6)
        on conflict (project_id, user_id) do update set
            role = case
                when project_user_grants.role = 'owner' then 'owner'
                else excluded.role
            end,
            updated_at = excluded.updated_at
    `)
    const deleteProjectUserGrantStatement = sql.statement<
        { readonly changes: number },
        [projectId: string, userId: string]
    >(`
        delete from project_user_grants
        where project_id = ?1 and user_id = ?2
    `)
    const upsertProjectTeamGrantStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            teamId: string,
            role: AccessProjectRole,
            createdAt: number,
            updatedAt: number,
        ]
    >(`
        insert into project_team_grants (id, project_id, team_id, role, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6)
        on conflict (project_id, team_id) do update set
            role = case
                when project_team_grants.role = 'owner' then 'owner'
                else excluded.role
            end,
            updated_at = excluded.updated_at
    `)
    const deleteProjectTeamGrantStatement = sql.statement<
        { readonly changes: number },
        [projectId: string, teamId: string]
    >(`
        delete from project_team_grants
        where project_id = ?1 and team_id = ?2
    `)
    const loadProjectTeamGrantTargetStatement = sql.statement<
        { readonly projectId: string; readonly teamId: string; readonly organizationId: string },
        [projectId: string, teamId: string]
    >(`
        select projects.id as projectId,
               team.id as teamId,
               workspaces.organization_id as organizationId
        from projects
        inner join workspaces on workspaces.id = projects.workspace_id
        inner join team
            on team.id = ?2
           and team.organization_id = workspaces.organization_id
        where projects.id = ?1
    `)
    const listTeamMembersForGrantStatement = sql.statement<
        { readonly userId: string; readonly displayName: string },
        [teamId: string]
    >(`
        select team_members.user_id as userId, users.name as displayName
        from team_member as team_members
        inner join user as users on users.id = team_members.user_id
        where team_members.team_id = ?1
    `)
    const listProjectTeamGrantProjectsForMemberStatement = sql.statement<
        { readonly projectId: string },
        [teamId: string]
    >(`
        select grants.project_id as projectId
        from project_team_grants as grants
        inner join projects on projects.id = grants.project_id
        inner join workspaces on workspaces.id = projects.workspace_id
        inner join team
            on team.id = grants.team_id
           and team.organization_id = workspaces.organization_id
        where grants.team_id = ?1
    `)
    const loadHumanActorStatement = sql.statement<
        { readonly id: string },
        [projectId: string, userId: string]
    >(`
        select id from actors
        where project_id = ?1 and subject_id = ?2 and kind = 'human'
        order by created_at, id
        limit 1
    `)
    const insertHumanActorStatement = sql.statement<
        void,
        [id: string, projectId: string, userId: string, displayName: string, now: number]
    >(`
        insert into actors (id, project_id, kind, subject_id, display_name, created_at, updated_at)
        values (?1, ?2, 'human', ?3, ?4, ?5, ?5)
    `)
    const updateHumanActorStatement = sql.statement<
        void,
        [displayName: string, updatedAt: number, projectId: string, userId: string]
    >(`
        update actors
        set display_name = ?1,
            updated_at = ?2
        where project_id = ?3
          and subject_id = ?4
          and kind = 'human'
    `)
    const listWorkspaceProjectsStatement = sql.statement<
        { readonly projectId: string },
        [workspaceId: string]
    >(`
        select id as projectId
        from projects
        where workspace_id = ?1
    `)
    const loadWorkspaceOrganizationStatement = sql.statement<
        { readonly organizationId: string },
        [workspaceId: string]
    >(`
        select organization_id as organizationId
        from workspaces
        where id = ?1
    `)

    const ensureHumanActor = async (input: {
        readonly projectId: string
        readonly userId: string
        readonly displayName: string
    }): Promise<void> => {
        return database.sql.transaction(async () => {
            const timestamp = now()
            if ((await loadHumanActorStatement.get(input.projectId, input.userId)) === null) {
                await insertHumanActorStatement.run(
                    createId(),
                    input.projectId,
                    input.userId,
                    input.displayName,
                    timestamp
                )
            } else {
                await updateHumanActorStatement.run(
                    input.displayName,
                    timestamp,
                    input.projectId,
                    input.userId
                )
            }
        }, 'immediate')
    }

    const syncWorkspaceMemberToProject = async (input: {
        readonly projectId: string
        readonly userId: string
        readonly displayName: string
    }): Promise<void> => {
        return database.sql.transaction(async () => {
            const timestamp = now()
            await upsertProjectUserGrantStatement.run(
                `postdot-project-user-grant:${input.projectId}:${input.userId}`,
                input.projectId,
                input.userId,
                'viewer',
                timestamp,
                timestamp
            )
            await ensureHumanActor(input)
        }, 'immediate')
    }

    const syncWorkspaceMemberToProjects = async (input: {
        readonly workspaceId: string
        readonly userId: string
        readonly displayName: string
    }): Promise<void> => {
        return database.sql.transaction(async () => {
            for (const project of await listWorkspaceProjectsStatement.all(input.workspaceId)) {
                await syncWorkspaceMemberToProject({
                    projectId: project.projectId,
                    userId: input.userId,
                    displayName: input.displayName,
                })
            }
        }, 'immediate')
    }

    const syncTeamMemberToProjectGrants = async (input: {
        readonly teamId: string
        readonly userId: string
        readonly displayName: string
    }): Promise<void> => {
        return database.sql.transaction(async () => {
            for (const project of await listProjectTeamGrantProjectsForMemberStatement.all(
                input.teamId
            )) {
                await ensureHumanActor({
                    projectId: project.projectId,
                    userId: input.userId,
                    displayName: input.displayName,
                })
            }
        }, 'immediate')
    }

    const addWorkspaceMemberInCurrentTransaction = async (input: {
        readonly workspace: AccessWorkspace
        readonly userId: string
        readonly role: 'owner' | 'admin' | 'member'
        readonly displayName: string
    }): Promise<void> => {
        const timestamp = now()
        await insertWorkspaceMemberStatement.run(
            `postdot-workspace-member:${input.workspace.id}:${input.userId}`,
            input.workspace.organizationId,
            input.userId,
            input.role,
            timestamp
        )
        const viewerTeamId = defaultWorkspaceTeamId(input.workspace.id, 'Viewers')
        await addWorkspaceTeamMemberStatement.run(
            `postdot-team-member:${viewerTeamId}:${input.userId}`,
            viewerTeamId,
            input.userId,
            timestamp
        )
        await refreshWorkspaceTeamMemberCountStatement.run(viewerTeamId)
        await syncWorkspaceMemberToProjects({
            workspaceId: input.workspace.id,
            userId: input.userId,
            displayName: input.displayName,
        })
    }

    const expirePendingInvitations = async (timestamp: number): Promise<void> => {
        await expireInvitationsStatement.run(timestamp, timestamp)
    }

    const defaultWorkspaceTeamId = (workspaceId: string, name: string): string =>
        `postdot-workspace-team:${workspaceId}:${name.toLowerCase()}`

    const ensureDefaultWorkspaceInCurrentTransaction = async (
        userId: string
    ): Promise<AccessWorkspace> => {
        const existing = await loadDefaultWorkspaceStatement.get()
        if (existing !== null) {
            await insertWorkspaceMemberStatement.run(
                `postdot-workspace-member:${existing.id}:${userId}`,
                existing.organizationId,
                userId,
                'owner',
                now()
            )
            return toWorkspace(existing)
        }

        const timestamp = now()
        const workspaceId = createId()
        const organizationId = createId()
        const name = 'My workspace'
        const slug = `postdot-workspace-${workspaceId}`
        await insertWorkspaceOrganizationStatement.run(
            organizationId,
            name,
            slug,
            JSON.stringify({ postdotResource: 'workspace', postdotDefault: true }),
            timestamp
        )
        await insertWorkspaceStatement.run(workspaceId, organizationId, name, slug, 1, timestamp)
        await insertWorkspaceMemberStatement.run(
            `postdot-workspace-member:${workspaceId}:${userId}`,
            organizationId,
            userId,
            'owner',
            timestamp
        )

        for (const teamName of ['Administrators', 'Editors', 'Reviewers', 'Viewers']) {
            const teamId = defaultWorkspaceTeamId(workspaceId, teamName)
            await insertWorkspaceTeamStatement.run(teamId, teamName, organizationId, timestamp)
            if (teamName === 'Administrators') {
                await addWorkspaceTeamMemberStatement.run(
                    `postdot-team-member:${teamId}:${userId}`,
                    teamId,
                    userId,
                    timestamp
                )
                await refreshWorkspaceTeamMemberCountStatement.run(teamId)
            }
        }

        await setDefaultWorkspaceStatement.run(workspaceId, timestamp)
        const workspace = await loadDefaultWorkspaceStatement.get()
        if (workspace === null) throw new Error('The default Postdot workspace was not persisted')
        return toWorkspace(workspace)
    }

    const createWorkspaceProjectionTransaction = defineTransaction(
        database,
        async (input: CreateWorkspaceProjectionInput): Promise<AccessWorkspace> => {
            const organizationId = requireNonBlank(input.organizationId, 'organizationId')
            const name = requireNonBlank(input.name, 'name')
            const slug = requireNonBlank(input.slug, 'slug')
            const ownerUserId = requireNonBlank(input.ownerUserId, 'ownerUserId')
            const timestamp = now()
            const workspaceId = createId()

            await insertWorkspaceStatement.run(
                workspaceId,
                organizationId,
                name,
                slug,
                0,
                timestamp
            )
            await insertWorkspaceMemberStatement.run(
                `postdot-workspace-member:${workspaceId}:${ownerUserId}`,
                organizationId,
                ownerUserId,
                'owner',
                timestamp
            )

            for (const teamName of ['Administrators', 'Editors', 'Reviewers', 'Viewers']) {
                const teamId = defaultWorkspaceTeamId(workspaceId, teamName)
                await insertWorkspaceTeamStatement.run(teamId, teamName, organizationId, timestamp)
                if (teamName === 'Administrators') {
                    await addWorkspaceTeamMemberStatement.run(
                        `postdot-team-member:${teamId}:${ownerUserId}`,
                        teamId,
                        ownerUserId,
                        timestamp
                    )
                    await refreshWorkspaceTeamMemberCountStatement.run(teamId)
                }
            }

            const workspace = await loadWorkspaceStatement.get(workspaceId)
            if (workspace === null) {
                throw new Error('The Postdot workspace projection was not persisted')
            }
            return toWorkspace(workspace)
        }
    )

    const hasPendingInvitationForEmail = async (email: string): Promise<boolean> =>
        (await sql
            .statement<{ readonly id: string }, [email: string, now: number]>(`
            select id
            from instance_access_invitations
            where target_email = ?1
              and state = 'pending'
              and expires_at > ?2
            limit 1
        `)
            .get(normalizeEmail(email), now())) !== null

    const claimFirstAccountInCurrentTransaction = async (
        input: BootstrapFirstAccountInput
    ): Promise<BootstrapFirstAccountResult> => {
        const userId = requireNonBlank(input.userId, 'userId')
        const timestamp = now()
        const update = await claimInstanceStatement.run(userId, timestamp, timestamp)
        if (update.changes !== 1) return { kind: 'already_claimed' }

        await insertInstanceMembershipStatement.run(
            `instance-membership:${userId}`,
            userId,
            'admin',
            'enabled',
            timestamp
        )
        await ensureDefaultWorkspaceInCurrentTransaction(userId)
        const membership = await loadInstanceMembershipStatement.get(userId)
        if (membership === null) {
            throw new Error('The first account membership could not be read after claiming Postdot')
        }
        return { kind: 'claimed', membership: toInstanceMembership(membership) }
    }

    const claimFirstAccountTransaction = defineTransaction(
        database,
        async (input: BootstrapFirstAccountInput): Promise<BootstrapFirstAccountResult> =>
            claimFirstAccountInCurrentTransaction(input)
    )

    const updateInstanceMembershipTransaction = defineTransaction(
        database,
        async (input: UpdateInstanceMembershipInput): Promise<UpdateInstanceMembershipResult> => {
            const actorUserId = requireNonBlank(input.actorUserId, 'actorUserId')
            const userId = requireNonBlank(input.userId, 'userId')
            if (input.role === undefined && input.state === undefined) {
                throw new Error('At least one instance membership field must be provided')
            }

            const existing = await loadInstanceMembershipStatement.get(userId)
            if (existing === null) return { kind: 'not_found' }

            const role = input.role ?? existing.role
            const state = input.state ?? existing.state
            if (role === existing.role && state === existing.state) {
                return { kind: 'updated', membership: toInstanceMembership(existing) }
            }

            const isRemovingEnabledAdmin =
                existing.role === 'admin' &&
                existing.state === 'enabled' &&
                (role !== 'admin' || state !== 'enabled')
            if (
                isRemovingEnabledAdmin &&
                ((await countEnabledInstanceAdminsStatement.get())?.count ?? 0) <= 1
            ) {
                return { kind: 'last_admin' }
            }

            if (
                actorUserId === userId &&
                existing.role === 'admin' &&
                existing.state === 'enabled'
            ) {
                return { kind: 'self_update' }
            }

            const timestamp = now()
            const update = await updateInstanceMembershipStatement.run(
                role,
                state,
                timestamp,
                userId
            )
            if (update.changes !== 1) return { kind: 'not_found' }

            const membership = await loadInstanceMembershipStatement.get(userId)
            if (membership === null) throw new Error('The instance membership was not persisted')
            return { kind: 'updated', membership: toInstanceMembership(membership) }
        }
    )

    const createInvitationTransaction = defineTransaction(
        database,
        async (input: CreateAccessInvitationInput): Promise<CreateAccessInvitationResult> => {
            const targetEmail = normalizeEmail(input.targetEmail)
            const createdByUserId = requireNonBlank(input.createdByUserId, 'createdByUserId')
            const createdAt = now()
            const expiresAt = input.expiresAt ?? createdAt + invitationTtlMs
            if (expiresAt <= createdAt || expiresAt - createdAt > maximumInvitationTtlMs) {
                throw new Error('Invitation expiry is outside the supported range')
            }

            const token = randomBytes(32).toString('base64url')
            const invitationId = createId()
            await insertInvitationStatement.run(
                invitationId,
                targetEmail,
                hashInvitationToken(token),
                createdByUserId,
                expiresAt,
                createdAt
            )
            const invitation = await loadInvitationByIdStatement.get(invitationId)
            if (invitation === null) throw new Error('The invitation was not persisted')
            return { invitation: toInvitation(invitation), token }
        }
    )

    const acceptInvitationTransaction = defineTransaction(
        database,
        async (input: {
            readonly token: string
            readonly userId: string
            readonly email: string
            readonly displayName: string
        }): Promise<AcceptAccessInvitationResult> => {
            const userId = requireNonBlank(input.userId, 'userId')
            const email = normalizeEmail(input.email)
            const tokenHash = hashInvitationToken(requireNonBlank(input.token, 'token'))
            const timestamp = now()
            await expirePendingInvitations(timestamp)
            const invitation = await loadInvitationByHashStatement.get(tokenHash)
            if (
                invitation === null ||
                invitation.state !== 'pending' ||
                invitation.expiresAt <= timestamp ||
                invitation.targetEmail !== email
            ) {
                return { kind: 'invalid' }
            }

            const accepted = await acceptInvitationStatement.run(
                timestamp,
                userId,
                invitation.id,
                tokenHash,
                email
            )
            if (accepted.changes !== 1) return { kind: 'invalid' }

            await upsertInstanceMembershipStatement.run(
                `instance-membership:${userId}`,
                userId,
                timestamp
            )
            const workspace = await loadDefaultWorkspaceStatement.get()
            if (workspace !== null) {
                await addWorkspaceMemberInCurrentTransaction({
                    workspace: toWorkspace(workspace),
                    userId,
                    role: 'member',
                    displayName: input.displayName,
                })
            }
            const instanceMembership = await loadInstanceMembershipStatement.get(userId)
            const acceptedInvitation = await loadInvitationByHashStatement.get(tokenHash)
            if (instanceMembership === null || acceptedInvitation === null) {
                throw new Error('The invitation acceptance was not persisted')
            }
            return {
                kind: 'accepted',
                invitation: toInvitation(acceptedInvitation),
                instanceMembership: toInstanceMembership(instanceMembership),
            }
        }
    )

    return {
        async getInstanceState(): Promise<AccessInstanceStateRecord> {
            const row = await loadInstanceStateStatement.get()
            if (row === null) throw new Error('The Postdot instance state row is missing')
            return toInstanceState(row)
        },

        async getDefaultWorkspace(): Promise<AccessWorkspace | null> {
            const row = await loadDefaultWorkspaceStatement.get()
            return row === null ? null : toWorkspace(row)
        },

        async getWorkspace(workspaceId: string): Promise<AccessWorkspace | null> {
            const row = await loadWorkspaceStatement.get(
                requireNonBlank(workspaceId, 'workspaceId')
            )
            return row === null ? null : toWorkspace(row)
        },

        async getWorkspaceByOrganizationId(
            organizationId: string
        ): Promise<AccessWorkspace | null> {
            const row = await loadWorkspaceByOrganizationStatement.get(
                requireNonBlank(organizationId, 'organizationId')
            )
            return row === null ? null : toWorkspace(row)
        },

        async createWorkspaceProjection(
            input: CreateWorkspaceProjectionInput
        ): Promise<AccessWorkspace> {
            return createWorkspaceProjectionTransaction(input)
        },

        async listWorkspacesForUser(
            userId: string
        ): Promise<Array<AccessWorkspace & { readonly role: AccessWorkspaceRole }>> {
            return (
                await listWorkspacesForUserStatement.all(requireNonBlank(userId, 'userId'))
            ).map(row => ({ ...toWorkspace(row), role: normalizeWorkspaceRole(row.role) }))
        },

        async getWorkspaceMembership(
            workspaceId: string,
            userId: string
        ): Promise<AccessWorkspaceMembership | null> {
            const row = await loadWorkspaceMembershipStatement.get(
                requireNonBlank(workspaceId, 'workspaceId'),
                requireNonBlank(userId, 'userId')
            )
            return row === null ? null : toWorkspaceMembership(row)
        },

        async listWorkspaceTeamMembers(
            workspaceId: string,
            teamId: string
        ): Promise<AccessWorkspaceTeamMember[]> {
            return (
                await listWorkspaceTeamMembersStatement.all(
                    requireNonBlank(workspaceId, 'workspaceId'),
                    requireNonBlank(teamId, 'teamId')
                )
            ).map(row => ({
                id: row.id,
                teamId: row.teamId,
                userId: row.userId,
                createdAt: new Date(row.createdAt),
            }))
        },

        async canAccessWorkspace(workspaceId: string, userId: string): Promise<boolean> {
            return (await this.getWorkspaceMembership(workspaceId, userId)) !== null
        },

        async canManageWorkspace(workspaceId: string, userId: string): Promise<boolean> {
            return database.sql.transaction(async () => {
                if ((await this.getInstanceMembership(userId))?.state !== 'enabled') return false
                const membership = await this.getWorkspaceMembership(workspaceId, userId)
                return membership?.role === 'owner' || membership?.role === 'admin'
            }, 'deferred')
        },

        /**
         * Keep the legacy instance membership projection in sync when a user
         * joins a workspace through Better Auth's native invitation flow.
         */
        async ensureInstanceMembershipForWorkspaceMember(input: {
            readonly organizationId: string
            readonly userId: string
        }): Promise<AccessWorkspace | null> {
            return database.sql.transaction(async () => {
                const workspace = await this.getWorkspaceByOrganizationId(input.organizationId)
                if (workspace === null) return null
                if (
                    (await loadWorkspaceMemberStatement.get(
                        workspace.organizationId,
                        input.userId
                    )) === null
                ) {
                    return null
                }
                const timestamp = now()
                await ensureOrganizationMemberInstanceMembershipStatement.run(
                    `instance-membership:${requireNonBlank(input.userId, 'userId')}`,
                    input.userId,
                    timestamp
                )
                return workspace
            }, 'immediate')
        },

        async getDefaultWorkspaceForUser(userId: string): Promise<AccessWorkspace | null> {
            return database.sql.transaction(async () => {
                const workspace = await this.getDefaultWorkspace()
                if (workspace === null) return null
                return (await loadWorkspaceMemberStatement.get(
                    workspace.organizationId,
                    userId
                )) === null
                    ? null
                    : workspace
            }, 'deferred')
        },

        async canManageDefaultWorkspace(userId: string): Promise<boolean> {
            return database.sql.transaction(async () => {
                if ((await this.getInstanceMembership(userId))?.state !== 'enabled') return false
                const workspace = await this.getDefaultWorkspaceForUser(userId)
                if (workspace === null) return false
                const membership = await loadWorkspaceMemberStatement.get(
                    workspace.organizationId,
                    userId
                )
                return membership?.role === 'owner' || membership?.role === 'admin'
            }, 'deferred')
        },

        async isSignupAllowed(): Promise<boolean> {
            const state = await this.getInstanceState()
            return state.state === 'claimable' && !state.bootstrapBlocked
        },

        async claimFirstAccount(
            input: BootstrapFirstAccountInput
        ): Promise<BootstrapFirstAccountResult> {
            return claimFirstAccountTransaction(input)
        },

        /** Called by Better Auth's user.create.before hook inside its transaction. */
        claimFirstAccountInCurrentTransaction,

        /** Test-only fixture helper for independent browser sessions. */
        async ensureTestAdminMembershipInCurrentTransaction(
            input: BootstrapFirstAccountInput
        ): Promise<void> {
            return database.sql.transaction(async () => {
                const userId = requireNonBlank(input.userId, 'userId')
                const timestamp = now()
                await ensureTestAdminMembershipStatement.run(
                    `instance-membership:${userId}`,
                    userId,
                    timestamp
                )
                // Test fixtures represent an independent browser session on the
                // same self-hosted installation. Give that fixture a workspace
                // owner membership so the production workspace gate remains
                // exercised, except when the account is being created for a
                // pending Better Auth invitation. In that case the invitation
                // acceptance must be the operation that creates its membership;
                // pre-seeding it would make Better Auth insert the same member a
                // second time and reject the acceptance.
                const hasPendingOrganizationInvitation =
                    (await hasPendingOrganizationInvitationForUserStatement.get(userId, now())) !==
                    null
                if (!hasPendingOrganizationInvitation) {
                    await ensureDefaultWorkspaceInCurrentTransaction(userId)
                }
                await ensureTestAdminUserStatement.run(userId)
            }, 'immediate')
        },

        async updateInstanceMembership(
            input: UpdateInstanceMembershipInput
        ): Promise<UpdateInstanceMembershipResult> {
            return updateInstanceMembershipTransaction(input)
        },

        async getInstanceMembership(userId: string): Promise<AccessInstanceMembership | null> {
            const row = await loadInstanceMembershipStatement.get(requireNonBlank(userId, 'userId'))
            return row === null ? null : toInstanceMembership(row)
        },

        hasPendingInvitationForEmail,

        async isInstanceAdmin(userId: string): Promise<boolean> {
            const membership = await this.getInstanceMembership(userId)
            return membership?.state === 'enabled' && membership.role === 'admin'
        },

        async getProjectMembership(
            projectId: string,
            userId: string
        ): Promise<AccessProjectMembership | null> {
            return database.sql.transaction(async () => {
                const normalizedProjectId = requireNonBlank(projectId, 'projectId')
                const normalizedUserId = requireNonBlank(userId, 'userId')
                const row = selectBestProjectMembership([
                    await loadProjectUserGrantMembershipStatement.get(
                        normalizedProjectId,
                        normalizedUserId
                    ),
                    await loadProjectTeamGrantMembershipStatement.get(
                        normalizedProjectId,
                        normalizedUserId
                    ),
                ])
                return row === null ? null : toProjectMembership(row)
            }, 'deferred')
        },

        async listProjectUserGrants(projectId: string): Promise<AccessProjectUserGrant[]> {
            return (
                await listProjectUserGrantsStatement.all(requireNonBlank(projectId, 'projectId'))
            ).map(toProjectUserGrant)
        },

        async listProjectTeamGrants(projectId: string): Promise<AccessProjectTeamGrant[]> {
            return (
                await listProjectTeamGrantsStatement.all(requireNonBlank(projectId, 'projectId'))
            ).map(toProjectTeamGrant)
        },

        async grantProjectUserAccess(input: {
            readonly projectId: string
            readonly userId: string
            readonly role: AccessProjectRole
        }): Promise<AccessProjectUserGrant | null> {
            return database.sql.transaction(async () => {
                const projectId = requireNonBlank(input.projectId, 'projectId')
                const userId = requireNonBlank(input.userId, 'userId')
                if ((await projectExistsStatement.get(projectId)) === null) return null

                const instanceMembership = await loadInstanceMembershipStatement.get(userId)
                if (instanceMembership === null || instanceMembership.state !== 'enabled') {
                    return null
                }

                const workspaceId =
                    (await loadProjectWorkspaceStatement.get(projectId))?.workspaceId ?? null
                if (workspaceId !== null) {
                    const organizationId = await loadWorkspaceOrganizationStatement.get(workspaceId)
                    if (
                        organizationId === null ||
                        (await loadWorkspaceMemberStatement.get(
                            organizationId.organizationId,
                            userId
                        )) === null
                    ) {
                        return null
                    }
                }

                const timestamp = now()
                await upsertProjectUserGrantStatement.run(
                    `postdot-project-user-grant:${projectId}:${userId}`,
                    projectId,
                    userId,
                    input.role,
                    timestamp,
                    timestamp
                )
                const identity = await sql
                    .statement<{ readonly name: string }, [userId: string]>(
                        'select name from user where id = ?1'
                    )
                    .get(userId)
                if (identity !== null)
                    await ensureHumanActor({ projectId, userId, displayName: identity.name })

                const grant = await loadProjectUserGrantStatement.get(projectId, userId)
                return grant === null ? null : toProjectUserGrant(grant)
            }, 'immediate')
        },

        async removeProjectUserAccess(projectId: string, userId: string): Promise<boolean> {
            return database.sql.transaction(async () => {
                const normalizedProjectId = requireNonBlank(projectId, 'projectId')
                const normalizedUserId = requireNonBlank(userId, 'userId')
                const grant = await loadProjectUserGrantStatement.get(
                    normalizedProjectId,
                    normalizedUserId
                )
                if (grant === null || grant.role === 'owner') return false
                return (
                    (
                        await deleteProjectUserGrantStatement.run(
                            normalizedProjectId,
                            normalizedUserId
                        )
                    ).changes === 1
                )
            }, 'immediate')
        },

        async grantProjectTeamAccess(input: {
            readonly projectId: string
            readonly teamId: string
            readonly role: AccessProjectRole
        }): Promise<AccessProjectTeamGrant | null> {
            return database.sql.transaction(async () => {
                const projectId = requireNonBlank(input.projectId, 'projectId')
                const teamId = requireNonBlank(input.teamId, 'teamId')
                const target = await loadProjectTeamGrantTargetStatement.get(projectId, teamId)
                if (target === null) return null

                const timestamp = now()
                await upsertProjectTeamGrantStatement.run(
                    `postdot-project-team-grant:${projectId}:${teamId}`,
                    projectId,
                    teamId,
                    input.role,
                    timestamp,
                    timestamp
                )
                for (const member of await listTeamMembersForGrantStatement.all(teamId)) {
                    await ensureHumanActor({
                        projectId,
                        userId: member.userId,
                        displayName: member.displayName,
                    })
                }

                const grant = await loadProjectTeamGrantStatement.get(projectId, teamId)
                return grant === null ? null : toProjectTeamGrant(grant)
            }, 'immediate')
        },

        async removeProjectTeamAccess(projectId: string, teamId: string): Promise<boolean> {
            return (
                (
                    await deleteProjectTeamGrantStatement.run(
                        requireNonBlank(projectId, 'projectId'),
                        requireNonBlank(teamId, 'teamId')
                    )
                ).changes === 1
            )
        },

        async syncTeamMemberToProjectGrants(input: {
            readonly teamId: string
            readonly userId: string
            readonly displayName: string
        }): Promise<void> {
            return database.sql.transaction(async () => {
                await syncTeamMemberToProjectGrants({
                    teamId: requireNonBlank(input.teamId, 'teamId'),
                    userId: requireNonBlank(input.userId, 'userId'),
                    displayName: requireNonBlank(input.displayName, 'displayName'),
                })
            }, 'immediate')
        },

        async getProjectWorkspaceId(projectId: string): Promise<string | null> {
            const row = await loadProjectWorkspaceStatement.get(
                requireNonBlank(projectId, 'projectId')
            )
            return row?.workspaceId ?? null
        },

        async getProjectWorkspaceOrganizationId(projectId: string): Promise<string | null> {
            return database.sql.transaction(async () => {
                const workspaceId = await this.getProjectWorkspaceId(projectId)
                if (workspaceId === null) return null
                const workspace = await loadWorkspaceOrganizationStatement.get(workspaceId)
                return workspace?.organizationId ?? null
            }, 'deferred')
        },

        async canAccessProject(
            projectId: string,
            userId: string,
            minimumRole: AccessProjectRole = 'viewer'
        ): Promise<boolean> {
            const membership = await this.getProjectMembership(projectId, userId)
            return membership !== null && hasProjectRole(membership.role, minimumRole)
        },

        async ensureProjectOwnerMembership(input: {
            readonly projectId: string
            readonly userId: string
        }): Promise<AccessProjectMembership | null> {
            return database.sql.transaction(async () => {
                const projectId = requireNonBlank(input.projectId, 'projectId')
                const userId = requireNonBlank(input.userId, 'userId')
                if ((await projectExistsStatement.get(projectId)) === null) return null

                const instanceMembership = await loadInstanceMembershipStatement.get(userId)
                if (instanceMembership === null || instanceMembership.state !== 'enabled')
                    return null

                const workspaceId =
                    (await loadProjectWorkspaceStatement.get(projectId))?.workspaceId ?? null
                if (
                    workspaceId !== null &&
                    (await loadWorkspaceMemberStatement.get(
                        (await loadWorkspaceOrganizationStatement.get(workspaceId))
                            ?.organizationId ?? '',
                        userId
                    )) === null
                ) {
                    return null
                }

                const timestamp = now()
                await upsertProjectUserGrantStatement.run(
                    `postdot-project-user-grant:${projectId}:${userId}`,
                    projectId,
                    userId,
                    'owner',
                    timestamp,
                    timestamp
                )
                const user = await sql
                    .statement<{ readonly name: string }, [userId: string]>(
                        'select name from user where id = ?1'
                    )
                    .get(userId)
                if (user !== null)
                    await ensureHumanActor({ projectId, userId, displayName: user.name })

                const membership = await this.getProjectMembership(projectId, userId)
                if (membership === null)
                    throw new Error('The project owner membership was not persisted')
                return membership
            }, 'immediate')
        },

        async listInstanceMemberships(): Promise<AccessInstanceMembership[]> {
            return (await listInstanceMembershipsStatement.all()).map(toInstanceMembership)
        },

        async listProjectMemberships(projectId: string): Promise<AccessProjectMembership[]> {
            return database.sql.transaction(async () => {
                const normalizedProjectId = requireNonBlank(projectId, 'projectId')
                const byUser = new Map<string, ProjectMembershipRow>()
                const candidates = [
                    ...(await listProjectUserGrantMembershipsStatement.all(normalizedProjectId)),
                    ...(await listProjectTeamGrantMembershipsStatement.all(normalizedProjectId)),
                ]
                for (const candidate of candidates) {
                    const selected = selectBestProjectMembership([
                        byUser.get(candidate.userId) ?? null,
                        candidate,
                    ])
                    if (selected !== null) byUser.set(candidate.userId, selected)
                }
                return [...byUser.values()]
                    .sort(
                        (left, right) =>
                            left.createdAt - right.createdAt || left.id.localeCompare(right.id)
                    )
                    .map(toProjectMembership)
            }, 'deferred')
        },

        async createInvitation(
            input: CreateAccessInvitationInput
        ): Promise<CreateAccessInvitationResult> {
            return createInvitationTransaction(input)
        },

        async listInvitations(): Promise<AccessInvitation[]> {
            return database.sql.transaction(async () => {
                await expirePendingInvitations(now())
                return (await listInvitationsStatement.all()).map(toInvitation)
            }, 'deferred')
        },

        async getInvitationByToken(token: string): Promise<AccessInvitation | null> {
            return database.sql.transaction(async () => {
                await expirePendingInvitations(now())
                const tokenHash = hashInvitationToken(requireNonBlank(token, 'token'))
                const invitation = await loadInvitationByHashStatement.get(tokenHash)
                return invitation === null ? null : toInvitation(invitation)
            }, 'deferred')
        },

        async revokeInvitation(invitationId: string): Promise<RevokeAccessInvitationResult> {
            return database.sql.transaction(async () => {
                const id = requireNonBlank(invitationId, 'invitationId')
                const timestamp = now()
                const existing = await loadInvitationByIdStatement.get(id)
                if (existing === null) return { kind: 'not_found' }
                if (existing.state !== 'pending') return { kind: 'not_pending' }

                const result = await revokeInvitationStatement.run(timestamp, timestamp, id)
                if (result.changes !== 1) return { kind: 'not_pending' }
                return {
                    kind: 'revoked',
                    invitation: toInvitation({
                        ...existing,
                        state: 'revoked',
                        revokedAt: timestamp,
                        updatedAt: timestamp,
                    }),
                }
            }, 'immediate')
        },

        async acceptInvitation(input: {
            readonly token: string
            readonly userId: string
            readonly email: string
            readonly displayName: string
        }): Promise<AcceptAccessInvitationResult> {
            return acceptInvitationTransaction(input)
        },
    }
}

export type AccessStore = ReturnType<typeof createAccessStore>
