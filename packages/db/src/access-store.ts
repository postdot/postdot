import { createHash, randomBytes } from 'node:crypto'

import { requireNonBlank } from '@herald/core'

import type { HeraldDatabase } from './client'

export const accessInstanceId = 'default'
export const defaultInvitationTtlMs = 7 * 24 * 60 * 60 * 1_000
export const maximumInvitationTtlMs = 30 * 24 * 60 * 60 * 1_000

export const instanceStates = ['claimable', 'claimed'] as const
export const instanceMembershipStates = ['enabled', 'disabled'] as const
export const instanceRoles = ['admin', 'member'] as const
export const projectMembershipStates = ['active', 'removed'] as const
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
    /** True when migration found project data without an account owner. */
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

export interface AccessInvitation {
    readonly id: string
    readonly targetEmail: string
    readonly instanceRole: 'member'
    readonly projectId: string | null
    readonly projectRole: AccessProjectRole | null
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
    readonly projectId?: string | null
    readonly projectRole?: AccessProjectRole | null
    readonly expiresAt?: number
}

export type CreateAccessInvitationResult =
    | CreatedAccessInvitation
    | { readonly kind: 'project_not_found' }

export type RevokeAccessInvitationResult =
    | { readonly kind: 'revoked'; readonly invitation: AccessInvitation }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_pending' }

export type AcceptAccessInvitationResult =
    | {
          readonly kind: 'accepted'
          readonly invitation: AccessInvitation
          readonly instanceMembership: AccessInstanceMembership
          readonly projectMembership: AccessProjectMembership | null
      }
    | { readonly kind: 'invalid' }

export interface AccessMigrationReport {
    readonly instanceState: AccessInstanceStateRecord
    readonly instanceMemberships: number
    readonly activeInstanceAdmins: number
    readonly projects: number
    readonly projectMemberships: number
    readonly usersWithoutProjectMembership: number
    readonly orphanedHumanActors: number
}

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
    readonly state: AccessProjectMembershipState
    readonly createdAt: number
    readonly updatedAt: number
}

interface InvitationRow {
    readonly id: string
    readonly targetEmail: string
    readonly instanceRole: 'member'
    readonly projectId: string | null
    readonly projectRole: AccessProjectRole | null
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
    return {
        id: row.id,
        userId: row.userId,
        email: row.email,
        name: row.name,
        role: row.role,
        state: row.state,
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
        projectId: row.projectId,
        projectRole: row.projectRole,
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

export function createAccessStore(database: HeraldDatabase, options: AccessStoreOptions = {}) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
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
    const loadInstanceMembershipStatement = client.query<InstanceMembershipRow, [userId: string]>(`
        select memberships.id,
               memberships.user_id as userId,
               users.email,
               users.name,
               memberships.role,
               memberships.state,
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
               memberships.created_at as createdAt,
               memberships.updated_at as updatedAt
        from instance_memberships as memberships
        inner join user as users on users.id = memberships.user_id
        order by memberships.created_at, memberships.id
    `)
    const loadProjectMembershipStatement = client.query<
        ProjectMembershipRow,
        [projectId: string, userId: string]
    >(`
        select memberships.id,
               memberships.project_id as projectId,
               memberships.user_id as userId,
               users.email,
               users.name,
               memberships.role,
               memberships.state,
               memberships.created_at as createdAt,
               memberships.updated_at as updatedAt
        from project_memberships as memberships
        inner join user as users on users.id = memberships.user_id
        inner join instance_memberships as instance_members
            on instance_members.user_id = memberships.user_id
           and instance_members.state = 'enabled'
        where memberships.project_id = ?1
          and memberships.user_id = ?2
    `)
    const listProjectMembershipsStatement = client.query<
        ProjectMembershipRow,
        [projectId: string]
    >(`
        select memberships.id,
               memberships.project_id as projectId,
               memberships.user_id as userId,
               users.email,
               users.name,
               memberships.role,
               memberships.state,
               memberships.created_at as createdAt,
               memberships.updated_at as updatedAt
        from project_memberships as memberships
        inner join user as users on users.id = memberships.user_id
        where memberships.project_id = ?1
        order by memberships.created_at, memberships.id
    `)
    const projectExistsStatement = client.query<{ readonly id: string }, [projectId: string]>(`
        select id from projects where id = ?1
    `)
    const loadInvitationByHashStatement = client.query<InvitationRow, [tokenHash: string]>(`
        select id,
               target_email as targetEmail,
               instance_role as instanceRole,
               project_id as projectId,
               project_role as projectRole,
               state,
               created_by_user_id as createdByUserId,
               expires_at as expiresAt,
               accepted_at as acceptedAt,
               accepted_by_user_id as acceptedByUserId,
               revoked_at as revokedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from access_invitations
        where token_hash = ?1
    `)
    const listInvitationsStatement = client.query<InvitationRow, []>(`
        select id,
               target_email as targetEmail,
               instance_role as instanceRole,
               project_id as projectId,
               project_role as projectRole,
               state,
               created_by_user_id as createdByUserId,
               expires_at as expiresAt,
               accepted_at as acceptedAt,
               accepted_by_user_id as acceptedByUserId,
               revoked_at as revokedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from access_invitations
        order by created_at desc, id desc
    `)
    const expireInvitationsStatement = client.query<
        { readonly changes: number },
        [updatedAt: number, now: number]
    >(`
        update access_invitations
        set state = 'expired', updated_at = ?1
        where state = 'pending' and expires_at <= ?2
    `)
    const insertInvitationStatement = client.query<
        void,
        [
            id: string,
            targetEmail: string,
            tokenHash: string,
            projectId: string | null,
            projectRole: AccessProjectRole | null,
            createdByUserId: string,
            expiresAt: number,
            createdAt: number,
        ]
    >(`
        insert into access_invitations (
            id, target_email, token_hash, instance_role, project_id, project_role,
            state, created_by_user_id, expires_at, created_at, updated_at
        ) values (?1, ?2, ?3, 'member', ?4, ?5, 'pending', ?6, ?7, ?8, ?8)
    `)
    const revokeInvitationStatement = client.query<
        { readonly changes: number },
        [updatedAt: number, revokedAt: number, invitationId: string]
    >(`
        update access_invitations
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
        update access_invitations
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
    const upsertProjectMembershipStatement = client.query<
        void,
        [id: string, projectId: string, userId: string, role: AccessProjectRole, now: number]
    >(`
        insert into project_memberships (id, project_id, user_id, role, state, created_at, updated_at)
        values (?1, ?2, ?3, ?4, 'active', ?5, ?5)
        on conflict (project_id, user_id) do update set
            role = case when project_memberships.role = 'owner' then 'owner' else excluded.role end,
            state = 'active',
            updated_at = excluded.updated_at
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

    const expirePendingInvitations = (timestamp: number): void => {
        expireInvitationsStatement.run(timestamp, timestamp)
    }

    const claimFirstAccountInCurrentTransaction = (
        input: BootstrapFirstAccountInput
    ): BootstrapFirstAccountResult => {
        const userId = requireNonBlank(input.userId, 'userId')
        const timestamp = now()
        const update = claimInstanceStatement.run(userId, timestamp, timestamp)
        if (update.changes !== 1) return { kind: 'already_claimed' }

        const membershipId = `instance-membership:${userId}`
        insertInstanceMembershipStatement.run(membershipId, userId, 'admin', 'enabled', timestamp)
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

    const createInvitationTransaction = client.transaction(
        (input: CreateAccessInvitationInput): CreateAccessInvitationResult => {
            const targetEmail = normalizeEmail(input.targetEmail)
            const createdByUserId = requireNonBlank(input.createdByUserId, 'createdByUserId')
            const projectId = input.projectId === undefined ? null : input.projectId
            const projectRole = input.projectRole === undefined ? null : input.projectRole
            if ((projectId === null) !== (projectRole === null)) {
                throw new Error('projectId and projectRole must be provided together')
            }
            if (projectId !== null && projectExistsStatement.get(projectId) === null) {
                return { kind: 'project_not_found' }
            }

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
                projectId,
                projectRole,
                createdByUserId,
                expiresAt,
                createdAt
            )
            const invitation = listInvitationsStatement
                .all()
                .find(candidate => candidate.id === invitationId)
            if (invitation === undefined) throw new Error('The invitation was not persisted')
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
            let projectMembership: AccessProjectMembership | null = null
            if (invitation.projectId !== null && invitation.projectRole !== null) {
                upsertProjectMembershipStatement.run(
                    `project-membership:${invitation.projectId}:${userId}`,
                    invitation.projectId,
                    userId,
                    invitation.projectRole,
                    timestamp
                )
                if (loadHumanActorStatement.get(invitation.projectId, userId) === null) {
                    insertHumanActorStatement.run(
                        createId(),
                        invitation.projectId,
                        userId,
                        requireNonBlank(input.displayName, 'displayName'),
                        timestamp
                    )
                }
                const membership = loadProjectMembershipStatement.get(invitation.projectId, userId)
                if (membership === null) throw new Error('The project membership was not persisted')
                projectMembership = toProjectMembership(membership)
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
                projectMembership,
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

        /**
         * Called by Better Auth's user.create.before hook. Better Auth's Drizzle
         * transaction owns the surrounding SQLite transaction, so this method
         * deliberately does not open a nested transaction.
         */
        claimFirstAccountInCurrentTransaction,

        /**
         * Isolated browser fixtures may opt into additional independent admin
         * accounts. This is intentionally not used by the production runtime.
         */
        ensureTestAdminMembershipInCurrentTransaction(input: BootstrapFirstAccountInput): void {
            const userId = requireNonBlank(input.userId, 'userId')
            const timestamp = now()
            ensureTestAdminMembershipStatement.run(
                `instance-membership:${userId}`,
                userId,
                timestamp
            )
        },

        getInstanceMembership(userId: string): AccessInstanceMembership | null {
            const row = loadInstanceMembershipStatement.get(requireNonBlank(userId, 'userId'))
            return row === null ? null : toInstanceMembership(row)
        },

        isInstanceAdmin(userId: string): boolean {
            const membership = this.getInstanceMembership(userId)
            return membership?.state === 'enabled' && membership.role === 'admin'
        },

        getProjectMembership(projectId: string, userId: string): AccessProjectMembership | null {
            const row = loadProjectMembershipStatement.get(
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(userId, 'userId')
            )
            return row === null || row.state !== 'active' ? null : toProjectMembership(row)
        },

        canAccessProject(
            projectId: string,
            userId: string,
            minimumRole: AccessProjectRole = 'viewer'
        ): boolean {
            const membership = this.getProjectMembership(projectId, userId)
            return membership !== null && hasProjectRole(membership.role, minimumRole)
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
            const existing = client
                .query<InvitationRow, [id: string]>(`
                    select id,
                           target_email as targetEmail,
                           instance_role as instanceRole,
                           project_id as projectId,
                           project_role as projectRole,
                           state,
                           created_by_user_id as createdByUserId,
                           expires_at as expiresAt,
                           accepted_at as acceptedAt,
                           accepted_by_user_id as acceptedByUserId,
                           revoked_at as revokedAt,
                           created_at as createdAt,
                           updated_at as updatedAt
                    from access_invitations where id = ?1
                `)
                .get(id)
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

        getMigrationReport(): AccessMigrationReport {
            const state = this.getInstanceState()
            const count = (query: string): number =>
                client.query<{ readonly count: number }, []>(query).get()?.count ?? 0
            return {
                instanceState: state,
                instanceMemberships: count('select count(*) as count from instance_memberships'),
                activeInstanceAdmins: count(
                    `select count(*) as count from instance_memberships where role = 'admin' and state = 'enabled'`
                ),
                projects: count('select count(*) as count from projects'),
                projectMemberships: count(
                    `select count(*) as count from project_memberships where state = 'active'`
                ),
                usersWithoutProjectMembership: count(`
                    select count(*) as count
                    from user
                    where not exists (
                        select 1 from project_memberships
                        where project_memberships.user_id = user.id
                          and project_memberships.state = 'active'
                    )
                `),
                orphanedHumanActors: count(`
                    select count(*) as count
                    from actors
                    left join user on user.id = actors.subject_id
                    where actors.kind = 'human' and user.id is null
                `),
            }
        },
    }
}

export type AccessStore = ReturnType<typeof createAccessStore>
