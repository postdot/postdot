import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { requireNonBlank } from '@herald/core'

import type { HeraldDatabase } from './client'

export const accessInstanceId = 'default'
export const defaultInvitationTtlMs = 7 * 24 * 60 * 60 * 1_000
export const maximumInvitationTtlMs = 30 * 24 * 60 * 60 * 1_000

export const instanceStates = ['claimable', 'claimed'] as const
export const instanceMembershipStates = ['enabled', 'disabled'] as const
export const instanceRoles = ['admin', 'member'] as const
export const projectMembershipStates = ['active'] as const
export const projectRoles = ['owner', 'editor', 'viewer'] as const
export const invitationStates = ['pending', 'accepted', 'revoked', 'expired'] as const

export type AccessInstanceState = (typeof instanceStates)[number]
export type AccessInstanceMembershipState = (typeof instanceMembershipStates)[number]
export type AccessInstanceRole = (typeof instanceRoles)[number]
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
    readonly createdAt: number
    readonly updatedAt: number
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

/** Instance invitations are the only invitation records owned by Herald. */
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
    readonly createdAt: number
    readonly updatedAt: number
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
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
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

function parseOrganizationProjectRole(role: string): AccessProjectRole | null {
    const rank: Record<AccessProjectRole, number> = { viewer: 1, editor: 2, owner: 3 }
    let selected: AccessProjectRole | null = null
    for (const candidate of role.split(',').map(value => value.trim())) {
        if (candidate !== 'owner' && candidate !== 'editor' && candidate !== 'viewer') continue
        if (selected === null || rank[candidate] > rank[selected]) selected = candidate
    }
    return selected
}

export function createAccessStore(database: HeraldDatabase, options: AccessStoreOptions = {}) {
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
               created_at as createdAt,
               updated_at as updatedAt
        from instance_state
        where id = 'default'
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
    const loadProjectMembershipStatement = client.query<
        ProjectMembershipRow,
        [projectId: string, userId: string]
    >(`
        select members.id,
               projects.id as projectId,
               members.user_id as userId,
               users.email,
               users.name,
               members.role,
               'active' as state,
               members.created_at as createdAt,
               members.created_at as updatedAt
        from projects
        inner join member as members
            on members.organization_id = projects.organization_id
           and members.user_id = ?2
        inner join user as users
            on users.id = members.user_id
           and (users.banned is null or users.banned = 0)
        inner join instance_memberships
            on instance_memberships.user_id = members.user_id
           and instance_memberships.state = 'enabled'
        where projects.id = ?1
          and projects.organization_id is not null
    `)
    const listProjectMembershipsStatement = client.query<
        ProjectMembershipRow,
        [projectId: string]
    >(`
        select members.id,
               projects.id as projectId,
               members.user_id as userId,
               users.email,
               users.name,
               members.role,
               'active' as state,
               members.created_at as createdAt,
               members.created_at as updatedAt
        from projects
        inner join member as members on members.organization_id = projects.organization_id
        inner join user as users
            on users.id = members.user_id
           and (users.banned is null or users.banned = 0)
        inner join instance_memberships
            on instance_memberships.user_id = members.user_id
           and instance_memberships.state = 'enabled'
        where projects.id = ?1
          and projects.organization_id is not null
        order by members.created_at, members.id
    `)
    const projectExistsStatement = client.query<{ readonly id: string }, [projectId: string]>(`
        select id from projects where id = ?1
    `)
    const loadProjectOrganizationStatement = client.query<
        { readonly organizationId: string | null },
        [projectId: string]
    >(`
        select organization_id as organizationId
        from projects
        where id = ?1
    `)
    const loadProjectByOrganizationStatement = client.query<
        { readonly projectId: string },
        [organizationId: string]
    >(`
        select id as projectId
        from projects
        where organization_id = ?1
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
    const upsertBetterAuthMemberStatement = client.query<
        void,
        [
            id: string,
            organizationId: string,
            userId: string,
            role: AccessProjectRole,
            createdAt: number,
        ]
    >(`
        insert into member (id, organization_id, user_id, role, created_at)
        values (?1, ?2, ?3, ?4, ?5)
        on conflict (organization_id, user_id) do update set
            role = case when member.role = 'owner' then 'owner' else excluded.role end
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

    const expirePendingInvitations = (timestamp: number): void => {
        expireInvitationsStatement.run(timestamp, timestamp)
    }

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
        const membership = loadInstanceMembershipStatement.get(userId)
        if (membership === null) {
            throw new Error('The first account membership could not be read after claiming Herald')
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
            if (row === null) throw new Error('The Herald instance state row is missing')
            return toInstanceState(row)
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
            const row = loadProjectMembershipStatement.get(normalizedProjectId, normalizedUserId)
            return row === null ? null : toProjectMembership(row)
        },

        getProjectOrganizationId(projectId: string): string | null {
            const row = loadProjectOrganizationStatement.get(
                requireNonBlank(projectId, 'projectId')
            )
            return row?.organizationId ?? null
        },

        getProjectIdForOrganization(organizationId: string): string | null {
            const row = loadProjectByOrganizationStatement.get(
                requireNonBlank(organizationId, 'organizationId')
            )
            return row?.projectId ?? null
        },

        /** Better Auth Organization membership is the project authorization source. */
        syncProjectMembershipFromOrganizationMember(input: {
            readonly organizationId: string
            readonly userId: string
            readonly displayName: string
            readonly role: string
        }): AccessProjectMembership | null {
            const organizationId = requireNonBlank(input.organizationId, 'organizationId')
            const userId = requireNonBlank(input.userId, 'userId')
            const displayName = requireNonBlank(input.displayName, 'displayName')
            const projectRole = parseOrganizationProjectRole(input.role)
            if (projectRole === null) return null

            const project = loadProjectByOrganizationStatement.get(organizationId)
            if (project === null) return null

            const timestamp = now()
            ensureOrganizationMemberInstanceMembershipStatement.run(
                `instance-membership:${userId}`,
                userId,
                timestamp
            )
            if (loadHumanActorStatement.get(project.projectId, userId) === null) {
                insertHumanActorStatement.run(
                    createId(),
                    project.projectId,
                    userId,
                    displayName,
                    timestamp
                )
            } else {
                updateHumanActorStatement.run(displayName, timestamp, project.projectId, userId)
            }

            const membership = loadProjectMembershipStatement.get(project.projectId, userId)
            return membership === null ? null : toProjectMembership(membership)
        },

        /** Better Auth already removed the authoritative member row; no projection remains. */
        removeProjectMembershipForOrganizationMember(input: {
            readonly organizationId: string
            readonly userId: string
        }): void {
            requireNonBlank(input.organizationId, 'organizationId')
            requireNonBlank(input.userId, 'userId')
        },

        updateProjectMembershipForOrganizationMember(input: {
            readonly organizationId: string
            readonly userId: string
            readonly displayName: string
            readonly role: string
        }): AccessProjectMembership | null {
            return this.syncProjectMembershipFromOrganizationMember(input)
        },

        ensureProjectMembershipForOrganizationInvitation(input: {
            readonly organizationId: string
            readonly userId: string
            readonly displayName: string
            readonly role: string
        }): AccessProjectMembership | null {
            return this.syncProjectMembershipFromOrganizationMember(input)
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

            const organization = loadProjectOrganizationStatement.get(projectId)
            if (organization?.organizationId === null || organization === null) return null

            const timestamp = now()
            upsertBetterAuthMemberStatement.run(
                `herald-project-member:${projectId}:${userId}`,
                organization.organizationId,
                userId,
                'owner',
                timestamp
            )
            if (loadHumanActorStatement.get(projectId, userId) === null) {
                const user = client
                    .query<{ readonly name: string }, [userId: string]>(
                        'select name from user where id = ?1'
                    )
                    .get(userId)
                if (user !== null) {
                    insertHumanActorStatement.run(
                        createId(),
                        projectId,
                        userId,
                        user.name,
                        timestamp
                    )
                }
            }

            const membership = loadProjectMembershipStatement.get(projectId, userId)
            if (membership === null)
                throw new Error('The project owner membership was not persisted')
            return toProjectMembership(membership)
        },

        listInstanceMemberships(): AccessInstanceMembership[] {
            return listInstanceMembershipsStatement.all().map(toInstanceMembership)
        },

        listProjectMemberships(projectId: string): AccessProjectMembership[] {
            return listProjectMembershipsStatement
                .all(requireNonBlank(projectId, 'projectId'))
                .map(toProjectMembership)
        },

        createInvitation(input: CreateAccessInvitationInput): CreateAccessInvitationResult {
            return createInvitationTransaction(input)
        },

        listInvitations(): AccessInvitation[] {
            expirePendingInvitations(now())
            return listInvitationsStatement.all().map(toInvitation)
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
