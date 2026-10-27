import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { requireNonBlank } from '@postdot/core'

import type { PostdotDatabase } from './client'

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
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? randomUUID
    const invitationTtlMs = options.invitationTtlMs ?? defaultInvitationTtlMs

    if (invitationTtlMs <= 0 || invitationTtlMs > maximumInvitationTtlMs) {
        throw new Error(`invitationTtlMs must be between 1 and ${maximumInvitationTtlMs}`)
    }

    const loadInstanceStateStatement = client.query<InstanceStateRow, []>(`
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
    const loadDefaultWorkspaceStatement = client.query<WorkspaceRow, []>(`
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
    const loadWorkspaceStatement = client.query<WorkspaceRow, [workspaceId: string]>(`
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
    const loadWorkspaceByOrganizationStatement = client.query<
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
    const listWorkspacesForUserStatement = client.query<
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
    const loadWorkspaceMembershipStatement = client.query<
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
    const loadWorkspaceMemberStatement = client.query<
        { readonly role: string },
        [organizationId: string, userId: string]
    >(`
        select role
        from member
        where organization_id = ?1 and user_id = ?2
    `)
    const insertWorkspaceOrganizationStatement = client.query<
        void,
        [id: string, name: string, slug: string, metadata: string, createdAt: number]
    >(`
        insert into organization (id, name, slug, metadata, created_at)
        values (?1, ?2, ?3, ?4, ?5)
    `)
    const insertWorkspaceStatement = client.query<
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
    const setDefaultWorkspaceStatement = client.query<
        { readonly changes: number },
        [workspaceId: string, updatedAt: number]
    >(`
        update instance_state
        set default_workspace_id = ?1,
            updated_at = ?2
        where id = 'default'
    `)
    const insertWorkspaceMemberStatement = client.query<
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
    const insertWorkspaceTeamStatement = client.query<
        void,
        [id: string, name: string, organizationId: string, createdAt: number]
    >(`
        insert into team (id, name, member_count, organization_id, created_at, updated_at)
        values (?1, ?2, 0, ?3, ?4, ?4)
    `)
    const addWorkspaceTeamMemberStatement = client.query<
        void,
        [id: string, teamId: string, userId: string, createdAt: number]
    >(`
        insert into team_member (id, team_id, user_id, membership_key, created_at)
        values (?1, ?2, ?3, ?1, ?4)
        on conflict (team_id, user_id) do nothing
    `)
    const refreshWorkspaceTeamMemberCountStatement = client.query<void, [teamId: string]>(`
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
    const listWorkspaceTeamMembersStatement = client.query<
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
    const claimInstanceStatement = client.query<
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
    const insertInstanceMembershipStatement = client.query<
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
    const ensureTestAdminMembershipStatement = client.query<
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
    const ensureTestAdminUserStatement = client.query<void, [userId: string]>(`
        update user
        set role = 'admin',
            banned = 0,
            ban_reason = null,
            ban_expires = null
        where id = ?1
    `)
    const hasPendingOrganizationInvitationForUserStatement = client.query<
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
    const loadInstanceMembershipStatement = client.query<InstanceMembershipRow, [userId: string]>(`
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
    const listInstanceMembershipsStatement = client.query<InstanceMembershipRow, []>(`
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
    const countEnabledInstanceAdminsStatement = client.query<{ readonly count: number }, []>(`
        select count(*) as count
        from instance_memberships as memberships
        inner join user as users on users.id = memberships.user_id
        where memberships.state = 'enabled'
          and (users.banned is null or users.banned = 0)
          and instr(',' || coalesce(users.role, memberships.role) || ',', ',admin,') > 0
    `)
    const updateInstanceMembershipStatement = client.query<
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
    const loadProjectUserGrantMembershipStatement = client.query<
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
    const listProjectUserGrantMembershipsStatement = client.query<
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
    const loadProjectTeamGrantMembershipStatement = client.query<
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
    const listProjectTeamGrantMembershipsStatement = client.query<
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
    const listProjectUserGrantsStatement = client.query<ProjectUserGrantRow, [projectId: string]>(`
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
    const listProjectTeamGrantsStatement = client.query<ProjectTeamGrantRow, [projectId: string]>(`
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
    const loadProjectUserGrantStatement = client.query<
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
    const loadProjectTeamGrantStatement = client.query<
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
    const projectExistsStatement = client.query<{ readonly id: string }, [projectId: string]>(`
        select id from projects where id = ?1
    `)
    const loadProjectWorkspaceStatement = client.query<
        { readonly workspaceId: string | null },
        [projectId: string]
    >(`
        select workspace_id as workspaceId
        from projects
        where id = ?1
    `)
    const loadInvitationByHashStatement = client.query<InvitationRow, [tokenHash: string]>(`
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
    const listInvitationsStatement = client.query<InvitationRow, []>(`
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
    const loadInvitationByIdStatement = client.query<InvitationRow, [id: string]>(`
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
    const expireInvitationsStatement = client.query<
        { readonly changes: number },
        [updatedAt: number, now: number]
    >(`
        update instance_access_invitations
        set state = 'expired', updated_at = ?1
        where state = 'pending' and expires_at <= ?2
    `)
    const insertInvitationStatement = client.query<
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
    const revokeInvitationStatement = client.query<
        { readonly changes: number },
        [updatedAt: number, revokedAt: number, invitationId: string]
    >(`
        update instance_access_invitations
        set state = 'revoked', revoked_at = ?2, updated_at = ?1
        where id = ?3 and state = 'pending'
    `)
    const acceptInvitationStatement = client.query<
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
    const upsertInstanceMembershipStatement = client.query<
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
    const ensureOrganizationMemberInstanceMembershipStatement = client.query<
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
    const upsertProjectUserGrantStatement = client.query<
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
    const deleteProjectUserGrantStatement = client.query<
        { readonly changes: number },
        [projectId: string, userId: string]
    >(`
        delete from project_user_grants
        where project_id = ?1 and user_id = ?2
    `)
    const upsertProjectTeamGrantStatement = client.query<
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
    const deleteProjectTeamGrantStatement = client.query<
        { readonly changes: number },
        [projectId: string, teamId: string]
    >(`
        delete from project_team_grants
        where project_id = ?1 and team_id = ?2
    `)
    const loadProjectTeamGrantTargetStatement = client.query<
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
    const listTeamMembersForGrantStatement = client.query<
        { readonly userId: string; readonly displayName: string },
        [teamId: string]
    >(`
        select team_members.user_id as userId, users.name as displayName
        from team_member as team_members
        inner join user as users on users.id = team_members.user_id
        where team_members.team_id = ?1
    `)
    const listProjectTeamGrantProjectsForMemberStatement = client.query<
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
    const loadHumanActorStatement = client.query<
        { readonly id: string },
        [projectId: string, userId: string]
    >(`
        select id from actors
        where project_id = ?1 and subject_id = ?2 and kind = 'human'
        order by created_at, id
        limit 1
    `)
    const insertHumanActorStatement = client.query<
        void,
        [id: string, projectId: string, userId: string, displayName: string, now: number]
    >(`
        insert into actors (id, project_id, kind, subject_id, display_name, created_at, updated_at)
        values (?1, ?2, 'human', ?3, ?4, ?5, ?5)
    `)
    const updateHumanActorStatement = client.query<
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
    const listWorkspaceProjectsStatement = client.query<
        { readonly projectId: string },
        [workspaceId: string]
    >(`
        select id as projectId
        from projects
        where workspace_id = ?1
    `)
    const loadWorkspaceOrganizationStatement = client.query<
        { readonly organizationId: string },
        [workspaceId: string]
    >(`
        select organization_id as organizationId
        from workspaces
        where id = ?1
    `)

    const ensureHumanActor = (input: {
        readonly projectId: string
        readonly userId: string
        readonly displayName: string
    }): void => {
        const timestamp = now()
        if (loadHumanActorStatement.get(input.projectId, input.userId) === null) {
            insertHumanActorStatement.run(
                createId(),
                input.projectId,
                input.userId,
                input.displayName,
                timestamp
            )
        } else {
            updateHumanActorStatement.run(
                input.displayName,
                timestamp,
                input.projectId,
                input.userId
            )
        }
    }

    const syncWorkspaceMemberToProject = (input: {
        readonly projectId: string
        readonly userId: string
        readonly displayName: string
    }): void => {
        const timestamp = now()
        upsertProjectUserGrantStatement.run(
            `postdot-project-user-grant:${input.projectId}:${input.userId}`,
            input.projectId,
            input.userId,
            'viewer',
            timestamp,
            timestamp
        )
        ensureHumanActor(input)
    }

    const syncWorkspaceMemberToProjects = (input: {
        readonly workspaceId: string
        readonly userId: string
        readonly displayName: string
    }): void => {
        for (const project of listWorkspaceProjectsStatement.all(input.workspaceId)) {
            syncWorkspaceMemberToProject({
                projectId: project.projectId,
                userId: input.userId,
                displayName: input.displayName,
            })
        }
    }

    const syncTeamMemberToProjectGrants = (input: {
        readonly teamId: string
        readonly userId: string
        readonly displayName: string
    }): void => {
        for (const project of listProjectTeamGrantProjectsForMemberStatement.all(input.teamId)) {
            ensureHumanActor({
                projectId: project.projectId,
                userId: input.userId,
                displayName: input.displayName,
            })
        }
    }

    const addWorkspaceMemberInCurrentTransaction = (input: {
        readonly workspace: AccessWorkspace
        readonly userId: string
        readonly role: 'owner' | 'admin' | 'member'
        readonly displayName: string
    }): void => {
        const timestamp = now()
        insertWorkspaceMemberStatement.run(
            `postdot-workspace-member:${input.workspace.id}:${input.userId}`,
            input.workspace.organizationId,
            input.userId,
            input.role,
            timestamp
        )
        const viewerTeamId = defaultWorkspaceTeamId(input.workspace.id, 'Viewers')
        addWorkspaceTeamMemberStatement.run(
            `postdot-team-member:${viewerTeamId}:${input.userId}`,
            viewerTeamId,
            input.userId,
            timestamp
        )
        refreshWorkspaceTeamMemberCountStatement.run(viewerTeamId)
        syncWorkspaceMemberToProjects({
            workspaceId: input.workspace.id,
            userId: input.userId,
            displayName: input.displayName,
        })
    }

    const expirePendingInvitations = (timestamp: number): void => {
        expireInvitationsStatement.run(timestamp, timestamp)
    }

    const defaultWorkspaceTeamId = (workspaceId: string, name: string): string =>
        `postdot-workspace-team:${workspaceId}:${name.toLowerCase()}`

    const ensureDefaultWorkspaceInCurrentTransaction = (userId: string): AccessWorkspace => {
        const existing = loadDefaultWorkspaceStatement.get()
        if (existing !== null) {
            insertWorkspaceMemberStatement.run(
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
        insertWorkspaceOrganizationStatement.run(
            organizationId,
            name,
            slug,
            JSON.stringify({ postdotResource: 'workspace', postdotDefault: true }),
            timestamp
        )
        insertWorkspaceStatement.run(workspaceId, organizationId, name, slug, 1, timestamp)
        insertWorkspaceMemberStatement.run(
            `postdot-workspace-member:${workspaceId}:${userId}`,
            organizationId,
            userId,
            'owner',
            timestamp
        )

        for (const teamName of ['Administrators', 'Editors', 'Reviewers', 'Viewers']) {
            const teamId = defaultWorkspaceTeamId(workspaceId, teamName)
            insertWorkspaceTeamStatement.run(teamId, teamName, organizationId, timestamp)
            if (teamName === 'Administrators') {
                addWorkspaceTeamMemberStatement.run(
                    `postdot-team-member:${teamId}:${userId}`,
                    teamId,
                    userId,
                    timestamp
                )
                refreshWorkspaceTeamMemberCountStatement.run(teamId)
            }
        }

        setDefaultWorkspaceStatement.run(workspaceId, timestamp)
        const workspace = loadDefaultWorkspaceStatement.get()
        if (workspace === null) throw new Error('The default Postdot workspace was not persisted')
        return toWorkspace(workspace)
    }

    const createWorkspaceProjectionTransaction = client.transaction(
        (input: CreateWorkspaceProjectionInput): AccessWorkspace => {
            const organizationId = requireNonBlank(input.organizationId, 'organizationId')
            const name = requireNonBlank(input.name, 'name')
            const slug = requireNonBlank(input.slug, 'slug')
            const ownerUserId = requireNonBlank(input.ownerUserId, 'ownerUserId')
            const timestamp = now()
            const workspaceId = createId()

            insertWorkspaceStatement.run(workspaceId, organizationId, name, slug, 0, timestamp)
            insertWorkspaceMemberStatement.run(
                `postdot-workspace-member:${workspaceId}:${ownerUserId}`,
                organizationId,
                ownerUserId,
                'owner',
                timestamp
            )

            for (const teamName of ['Administrators', 'Editors', 'Reviewers', 'Viewers']) {
                const teamId = defaultWorkspaceTeamId(workspaceId, teamName)
                insertWorkspaceTeamStatement.run(teamId, teamName, organizationId, timestamp)
                if (teamName === 'Administrators') {
                    addWorkspaceTeamMemberStatement.run(
                        `postdot-team-member:${teamId}:${ownerUserId}`,
                        teamId,
                        ownerUserId,
                        timestamp
                    )
                    refreshWorkspaceTeamMemberCountStatement.run(teamId)
                }
            }

            const workspace = loadWorkspaceStatement.get(workspaceId)
            if (workspace === null) {
                throw new Error('The Postdot workspace projection was not persisted')
            }
            return toWorkspace(workspace)
        }
    )

    const hasPendingInvitationForEmail = (email: string): boolean =>
        client
            .query<{ readonly id: string }, [email: string, now: number]>(`
            select id
            from instance_access_invitations
            where target_email = ?1
              and state = 'pending'
              and expires_at > ?2
            limit 1
        `)
            .get(normalizeEmail(email), now()) !== null

    const claimFirstAccountInCurrentTransaction = (
        input: BootstrapFirstAccountInput
    ): BootstrapFirstAccountResult => {
        const userId = requireNonBlank(input.userId, 'userId')
        const timestamp = now()
        const update = claimInstanceStatement.run(userId, timestamp, timestamp)
        if (update.changes !== 1) return { kind: 'already_claimed' }

        insertInstanceMembershipStatement.run(
            `instance-membership:${userId}`,
            userId,
            'admin',
            'enabled',
            timestamp
        )
        ensureDefaultWorkspaceInCurrentTransaction(userId)
        const membership = loadInstanceMembershipStatement.get(userId)
        if (membership === null) {
            throw new Error('The first account membership could not be read after claiming Postdot')
        }
        return { kind: 'claimed', membership: toInstanceMembership(membership) }
    }

    const claimFirstAccountTransaction = client.transaction(
        (input: BootstrapFirstAccountInput): BootstrapFirstAccountResult =>
            claimFirstAccountInCurrentTransaction(input)
    )

    const updateInstanceMembershipTransaction = client.transaction(
        (input: UpdateInstanceMembershipInput): UpdateInstanceMembershipResult => {
            const actorUserId = requireNonBlank(input.actorUserId, 'actorUserId')
            const userId = requireNonBlank(input.userId, 'userId')
            if (input.role === undefined && input.state === undefined) {
                throw new Error('At least one instance membership field must be provided')
            }

            const existing = loadInstanceMembershipStatement.get(userId)
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
                (countEnabledInstanceAdminsStatement.get()?.count ?? 0) <= 1
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
            const update = updateInstanceMembershipStatement.run(role, state, timestamp, userId)
            if (update.changes !== 1) return { kind: 'not_found' }

            const membership = loadInstanceMembershipStatement.get(userId)
            if (membership === null) throw new Error('The instance membership was not persisted')
            return { kind: 'updated', membership: toInstanceMembership(membership) }
        }
    )

    const createInvitationTransaction = client.transaction(
        (input: CreateAccessInvitationInput): CreateAccessInvitationResult => {
            const targetEmail = normalizeEmail(input.targetEmail)
            const createdByUserId = requireNonBlank(input.createdByUserId, 'createdByUserId')
            const createdAt = now()
            const expiresAt = input.expiresAt ?? createdAt + invitationTtlMs
            if (expiresAt <= createdAt || expiresAt - createdAt > maximumInvitationTtlMs) {
                throw new Error('Invitation expiry is outside the supported range')
            }

            const token = randomBytes(32).toString('base64url')
            const invitationId = createId()
            insertInvitationStatement.run(
                invitationId,
                targetEmail,
                hashInvitationToken(token),
                createdByUserId,
                expiresAt,
                createdAt
            )
            const invitation = loadInvitationByIdStatement.get(invitationId)
            if (invitation === null) throw new Error('The invitation was not persisted')
            return { invitation: toInvitation(invitation), token }
        }
    )

    const acceptInvitationTransaction = client.transaction(
        (input: {
            readonly token: string
            readonly userId: string
            readonly email: string
            readonly displayName: string
        }): AcceptAccessInvitationResult => {
            const userId = requireNonBlank(input.userId, 'userId')
            const email = normalizeEmail(input.email)
            const tokenHash = hashInvitationToken(requireNonBlank(input.token, 'token'))
            const timestamp = now()
            expirePendingInvitations(timestamp)
            const invitation = loadInvitationByHashStatement.get(tokenHash)
            if (
                invitation === null ||
                invitation.state !== 'pending' ||
                invitation.expiresAt <= timestamp ||
                invitation.targetEmail !== email
            ) {
                return { kind: 'invalid' }
            }

            const accepted = acceptInvitationStatement.run(
                timestamp,
                userId,
                invitation.id,
                tokenHash,
                email
            )
            if (accepted.changes !== 1) return { kind: 'invalid' }

            upsertInstanceMembershipStatement.run(
                `instance-membership:${userId}`,
                userId,
                timestamp
            )
            const workspace = loadDefaultWorkspaceStatement.get()
            if (workspace !== null) {
                addWorkspaceMemberInCurrentTransaction({
                    workspace: toWorkspace(workspace),
                    userId,
                    role: 'member',
                    displayName: input.displayName,
                })
            }
            const instanceMembership = loadInstanceMembershipStatement.get(userId)
            const acceptedInvitation = loadInvitationByHashStatement.get(tokenHash)
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
        getInstanceState(): AccessInstanceStateRecord {
            const row = loadInstanceStateStatement.get()
            if (row === null) throw new Error('The Postdot instance state row is missing')
            return toInstanceState(row)
        },

        getDefaultWorkspace(): AccessWorkspace | null {
            const row = loadDefaultWorkspaceStatement.get()
            return row === null ? null : toWorkspace(row)
        },

        getWorkspace(workspaceId: string): AccessWorkspace | null {
            const row = loadWorkspaceStatement.get(requireNonBlank(workspaceId, 'workspaceId'))
            return row === null ? null : toWorkspace(row)
        },

        getWorkspaceByOrganizationId(organizationId: string): AccessWorkspace | null {
            const row = loadWorkspaceByOrganizationStatement.get(
                requireNonBlank(organizationId, 'organizationId')
            )
            return row === null ? null : toWorkspace(row)
        },

        createWorkspaceProjection(input: CreateWorkspaceProjectionInput): AccessWorkspace {
            return createWorkspaceProjectionTransaction(input)
        },

        listWorkspacesForUser(
            userId: string
        ): Array<AccessWorkspace & { readonly role: AccessWorkspaceRole }> {
            return listWorkspacesForUserStatement
                .all(requireNonBlank(userId, 'userId'))
                .map(row => ({ ...toWorkspace(row), role: normalizeWorkspaceRole(row.role) }))
        },

        getWorkspaceMembership(
            workspaceId: string,
            userId: string
        ): AccessWorkspaceMembership | null {
            const row = loadWorkspaceMembershipStatement.get(
                requireNonBlank(workspaceId, 'workspaceId'),
                requireNonBlank(userId, 'userId')
            )
            return row === null ? null : toWorkspaceMembership(row)
        },

        listWorkspaceTeamMembers(workspaceId: string, teamId: string): AccessWorkspaceTeamMember[] {
            return listWorkspaceTeamMembersStatement
                .all(requireNonBlank(workspaceId, 'workspaceId'), requireNonBlank(teamId, 'teamId'))
                .map(row => ({
                    id: row.id,
                    teamId: row.teamId,
                    userId: row.userId,
                    createdAt: new Date(row.createdAt),
                }))
        },

        canAccessWorkspace(workspaceId: string, userId: string): boolean {
            return this.getWorkspaceMembership(workspaceId, userId) !== null
        },

        canManageWorkspace(workspaceId: string, userId: string): boolean {
            if (this.getInstanceMembership(userId)?.state !== 'enabled') return false
            const membership = this.getWorkspaceMembership(workspaceId, userId)
            return membership?.role === 'owner' || membership?.role === 'admin'
        },

        /**
         * Keep the legacy instance membership projection in sync when a user
         * joins a workspace through Better Auth's native invitation flow.
         */
        ensureInstanceMembershipForWorkspaceMember(input: {
            readonly organizationId: string
            readonly userId: string
        }): AccessWorkspace | null {
            const workspace = this.getWorkspaceByOrganizationId(input.organizationId)
            if (workspace === null) return null
            if (loadWorkspaceMemberStatement.get(workspace.organizationId, input.userId) === null) {
                return null
            }
            const timestamp = now()
            ensureOrganizationMemberInstanceMembershipStatement.run(
                `instance-membership:${requireNonBlank(input.userId, 'userId')}`,
                input.userId,
                timestamp
            )
            return workspace
        },

        getDefaultWorkspaceForUser(userId: string): AccessWorkspace | null {
            const workspace = this.getDefaultWorkspace()
            if (workspace === null) return null
            return loadWorkspaceMemberStatement.get(workspace.organizationId, userId) === null
                ? null
                : workspace
        },

        canManageDefaultWorkspace(userId: string): boolean {
            if (this.getInstanceMembership(userId)?.state !== 'enabled') return false
            const workspace = this.getDefaultWorkspaceForUser(userId)
            if (workspace === null) return false
            const membership = loadWorkspaceMemberStatement.get(workspace.organizationId, userId)
            return membership?.role === 'owner' || membership?.role === 'admin'
        },

        isSignupAllowed(): boolean {
            const state = this.getInstanceState()
            return state.state === 'claimable' && !state.bootstrapBlocked
        },

        claimFirstAccount(input: BootstrapFirstAccountInput): BootstrapFirstAccountResult {
            return claimFirstAccountTransaction(input)
        },

        /** Called by Better Auth's user.create.before hook inside its transaction. */
        claimFirstAccountInCurrentTransaction,

        /** Test-only fixture helper for independent browser sessions. */
        ensureTestAdminMembershipInCurrentTransaction(input: BootstrapFirstAccountInput): void {
            const userId = requireNonBlank(input.userId, 'userId')
            const timestamp = now()
            ensureTestAdminMembershipStatement.run(
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
                hasPendingOrganizationInvitationForUserStatement.get(userId, now()) !== null
            if (!hasPendingOrganizationInvitation) {
                ensureDefaultWorkspaceInCurrentTransaction(userId)
            }
            ensureTestAdminUserStatement.run(userId)
        },

        updateInstanceMembership(
            input: UpdateInstanceMembershipInput
        ): UpdateInstanceMembershipResult {
            return updateInstanceMembershipTransaction(input)
        },

        getInstanceMembership(userId: string): AccessInstanceMembership | null {
            const row = loadInstanceMembershipStatement.get(requireNonBlank(userId, 'userId'))
            return row === null ? null : toInstanceMembership(row)
        },

        hasPendingInvitationForEmail,

        isInstanceAdmin(userId: string): boolean {
            const membership = this.getInstanceMembership(userId)
            return membership?.state === 'enabled' && membership.role === 'admin'
        },

        getProjectMembership(projectId: string, userId: string): AccessProjectMembership | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedUserId = requireNonBlank(userId, 'userId')
            const row = selectBestProjectMembership([
                loadProjectUserGrantMembershipStatement.get(normalizedProjectId, normalizedUserId),
                loadProjectTeamGrantMembershipStatement.get(normalizedProjectId, normalizedUserId),
            ])
            return row === null ? null : toProjectMembership(row)
        },

        listProjectUserGrants(projectId: string): AccessProjectUserGrant[] {
            return listProjectUserGrantsStatement
                .all(requireNonBlank(projectId, 'projectId'))
                .map(toProjectUserGrant)
        },

        listProjectTeamGrants(projectId: string): AccessProjectTeamGrant[] {
            return listProjectTeamGrantsStatement
                .all(requireNonBlank(projectId, 'projectId'))
                .map(toProjectTeamGrant)
        },

        grantProjectUserAccess(input: {
            readonly projectId: string
            readonly userId: string
            readonly role: AccessProjectRole
        }): AccessProjectUserGrant | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const userId = requireNonBlank(input.userId, 'userId')
            if (projectExistsStatement.get(projectId) === null) return null

            const instanceMembership = loadInstanceMembershipStatement.get(userId)
            if (instanceMembership === null || instanceMembership.state !== 'enabled') {
                return null
            }

            const workspaceId = loadProjectWorkspaceStatement.get(projectId)?.workspaceId ?? null
            if (workspaceId !== null) {
                const organizationId = loadWorkspaceOrganizationStatement.get(workspaceId)
                if (
                    organizationId === null ||
                    loadWorkspaceMemberStatement.get(organizationId.organizationId, userId) === null
                ) {
                    return null
                }
            }

            const timestamp = now()
            upsertProjectUserGrantStatement.run(
                `postdot-project-user-grant:${projectId}:${userId}`,
                projectId,
                userId,
                input.role,
                timestamp,
                timestamp
            )
            const identity = client
                .query<{ readonly name: string }, [userId: string]>(
                    'select name from user where id = ?1'
                )
                .get(userId)
            if (identity !== null)
                ensureHumanActor({ projectId, userId, displayName: identity.name })

            const grant = loadProjectUserGrantStatement.get(projectId, userId)
            return grant === null ? null : toProjectUserGrant(grant)
        },

        removeProjectUserAccess(projectId: string, userId: string): boolean {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedUserId = requireNonBlank(userId, 'userId')
            const grant = loadProjectUserGrantStatement.get(normalizedProjectId, normalizedUserId)
            if (grant === null || grant.role === 'owner') return false
            return (
                deleteProjectUserGrantStatement.run(normalizedProjectId, normalizedUserId)
                    .changes === 1
            )
        },

        grantProjectTeamAccess(input: {
            readonly projectId: string
            readonly teamId: string
            readonly role: AccessProjectRole
        }): AccessProjectTeamGrant | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const teamId = requireNonBlank(input.teamId, 'teamId')
            const target = loadProjectTeamGrantTargetStatement.get(projectId, teamId)
            if (target === null) return null

            const timestamp = now()
            upsertProjectTeamGrantStatement.run(
                `postdot-project-team-grant:${projectId}:${teamId}`,
                projectId,
                teamId,
                input.role,
                timestamp,
                timestamp
            )
            for (const member of listTeamMembersForGrantStatement.all(teamId)) {
                ensureHumanActor({
                    projectId,
                    userId: member.userId,
                    displayName: member.displayName,
                })
            }

            const grant = loadProjectTeamGrantStatement.get(projectId, teamId)
            return grant === null ? null : toProjectTeamGrant(grant)
        },

        removeProjectTeamAccess(projectId: string, teamId: string): boolean {
            return (
                deleteProjectTeamGrantStatement.run(
                    requireNonBlank(projectId, 'projectId'),
                    requireNonBlank(teamId, 'teamId')
                ).changes === 1
            )
        },

        syncTeamMemberToProjectGrants(input: {
            readonly teamId: string
            readonly userId: string
            readonly displayName: string
        }): void {
            syncTeamMemberToProjectGrants({
                teamId: requireNonBlank(input.teamId, 'teamId'),
                userId: requireNonBlank(input.userId, 'userId'),
                displayName: requireNonBlank(input.displayName, 'displayName'),
            })
        },

        getProjectWorkspaceId(projectId: string): string | null {
            const row = loadProjectWorkspaceStatement.get(requireNonBlank(projectId, 'projectId'))
            return row?.workspaceId ?? null
        },

        getProjectWorkspaceOrganizationId(projectId: string): string | null {
            const workspaceId = this.getProjectWorkspaceId(projectId)
            if (workspaceId === null) return null
            const workspace = loadWorkspaceOrganizationStatement.get(workspaceId)
            return workspace?.organizationId ?? null
        },

        canAccessProject(
            projectId: string,
            userId: string,
            minimumRole: AccessProjectRole = 'viewer'
        ): boolean {
            const membership = this.getProjectMembership(projectId, userId)
            return membership !== null && hasProjectRole(membership.role, minimumRole)
        },

        ensureProjectOwnerMembership(input: {
            readonly projectId: string
            readonly userId: string
        }): AccessProjectMembership | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const userId = requireNonBlank(input.userId, 'userId')
            if (projectExistsStatement.get(projectId) === null) return null

            const instanceMembership = loadInstanceMembershipStatement.get(userId)
            if (instanceMembership === null || instanceMembership.state !== 'enabled') return null

            const workspaceId = loadProjectWorkspaceStatement.get(projectId)?.workspaceId ?? null
            if (
                workspaceId !== null &&
                loadWorkspaceMemberStatement.get(
                    loadWorkspaceOrganizationStatement.get(workspaceId)?.organizationId ?? '',
                    userId
                ) === null
            ) {
                return null
            }

            const timestamp = now()
            upsertProjectUserGrantStatement.run(
                `postdot-project-user-grant:${projectId}:${userId}`,
                projectId,
                userId,
                'owner',
                timestamp,
                timestamp
            )
            const user = client
                .query<{ readonly name: string }, [userId: string]>(
                    'select name from user where id = ?1'
                )
                .get(userId)
            if (user !== null) ensureHumanActor({ projectId, userId, displayName: user.name })

            const membership = this.getProjectMembership(projectId, userId)
            if (membership === null)
                throw new Error('The project owner membership was not persisted')
            return membership
        },

        listInstanceMemberships(): AccessInstanceMembership[] {
            return listInstanceMembershipsStatement.all().map(toInstanceMembership)
        },

        listProjectMemberships(projectId: string): AccessProjectMembership[] {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const byUser = new Map<string, ProjectMembershipRow>()
            const candidates = [
                ...listProjectUserGrantMembershipsStatement.all(normalizedProjectId),
                ...listProjectTeamGrantMembershipsStatement.all(normalizedProjectId),
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
        },

        createInvitation(input: CreateAccessInvitationInput): CreateAccessInvitationResult {
            return createInvitationTransaction(input)
        },

        listInvitations(): AccessInvitation[] {
            expirePendingInvitations(now())
            return listInvitationsStatement.all().map(toInvitation)
        },

        getInvitationByToken(token: string): AccessInvitation | null {
            expirePendingInvitations(now())
            const tokenHash = hashInvitationToken(requireNonBlank(token, 'token'))
            const invitation = loadInvitationByHashStatement.get(tokenHash)
            return invitation === null ? null : toInvitation(invitation)
        },

        revokeInvitation(invitationId: string): RevokeAccessInvitationResult {
            const id = requireNonBlank(invitationId, 'invitationId')
            const timestamp = now()
            const existing = loadInvitationByIdStatement.get(id)
            if (existing === null) return { kind: 'not_found' }
            if (existing.state !== 'pending') return { kind: 'not_pending' }

            const result = revokeInvitationStatement.run(timestamp, timestamp, id)
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
        },

        acceptInvitation(input: {
            readonly token: string
            readonly userId: string
            readonly email: string
            readonly displayName: string
        }): AcceptAccessInvitationResult {
            return acceptInvitationTransaction(input)
        },
    }
}

export type AccessStore = ReturnType<typeof createAccessStore>
