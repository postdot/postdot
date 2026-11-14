import { createHash } from 'node:crypto'

import type {
    PostdotApiKeyRecord,
    PostdotAuth,
    PostdotOrganizationInvitation,
    PostdotOrganizationMember,
    PostdotOrganizationTeam,
    PostdotOrganizationTeamMember,
} from './index'

type WhereOperator = 'eq' | 'in' | 'lt' | 'gte'

interface AdapterWhere {
    readonly field: string
    readonly value: unknown
    readonly operator?: WhereOperator
}

interface AuthAdapter {
    create<T extends Record<string, unknown>>(input: {
        readonly model: string
        readonly data: Record<string, unknown>
        readonly forceAllowId?: boolean
    }): Promise<T>
    findOne<T extends Record<string, unknown>>(input: {
        readonly model: string
        readonly where: readonly AdapterWhere[]
    }): Promise<T | null>
    findMany<T extends Record<string, unknown>>(input: {
        readonly model: string
        readonly where?: readonly AdapterWhere[]
        readonly limit?: number
        readonly offset?: number
        readonly sortBy?: { readonly field: string; readonly direction: 'asc' | 'desc' }
    }): Promise<T[]>
    count(input: {
        readonly model: string
        readonly where?: readonly AdapterWhere[]
    }): Promise<number>
    update<T extends Record<string, unknown>>(input: {
        readonly model: string
        readonly where: readonly AdapterWhere[]
        readonly update: Record<string, unknown>
    }): Promise<T | null>
    updateMany(input: {
        readonly model: string
        readonly where: readonly AdapterWhere[]
        readonly update: Record<string, unknown>
    }): Promise<number>
    delete<T extends Record<string, unknown>>(input: {
        readonly model: string
        readonly where: readonly AdapterWhere[]
    }): Promise<T | null>
    deleteMany(input: {
        readonly model: string
        readonly where: readonly AdapterWhere[]
    }): Promise<number>
    transaction<Result>(callback: (adapter: AuthAdapter) => Promise<Result>): Promise<Result>
}

interface AuthUserRow {
    readonly id: string
    readonly email: string
    readonly name: string
    readonly image?: string | null
    readonly role?: string | null
    readonly banned?: boolean | null
    readonly banReason?: string | null
    readonly banExpires?: Date | null
}

interface AuthInternalAdapter {
    findUserById(userId: string): Promise<AuthUserRow | null>
    findUserByEmail(
        email: string,
        options?: { readonly includeAccounts?: boolean }
    ): Promise<{ readonly user: AuthUserRow } | null>
    updateUser(userId: string, data: Record<string, unknown>): Promise<AuthUserRow | null>
    deleteUser(userId: string): Promise<void>
    deleteUserSessions(userId: string): Promise<void>
}

interface OrganizationHookContext {
    readonly invitationExpiresIn?: number
    readonly cancelPendingInvitationsOnReInvite?: boolean
    readonly sendInvitationEmail?: (data: {
        readonly id: string
        readonly email: string
        readonly role: string
        readonly organization: {
            readonly id: string
            readonly name: string
            readonly slug: string
        }
        readonly invitation: Record<string, unknown> & {
            readonly id: string
            readonly email: string
            readonly role: string
            readonly organizationId: string
            readonly inviterId: string
            readonly status: string
            readonly expiresAt: Date
        }
        readonly inviter: {
            readonly id: string
            readonly organizationId: string
            readonly userId: string
            readonly role: string
            readonly user: AuthUserRow
        }
    }) => Promise<void> | void
    readonly organizationHooks?: {
        readonly afterAddTeamMember?: (data: {
            readonly teamMember: Record<string, unknown>
            readonly team: Record<string, unknown>
            readonly user: AuthUserRow
            readonly organization: Record<string, unknown>
        }) => Promise<void> | void
        readonly afterRemoveTeamMember?: (data: {
            readonly teamMember: Record<string, unknown>
            readonly team: Record<string, unknown>
            readonly user: AuthUserRow
            readonly organization: Record<string, unknown>
        }) => Promise<void> | void
        readonly beforeRemoveMember?: (data: {
            readonly member: Record<string, unknown>
            readonly user: AuthUserRow
            readonly organization: Record<string, unknown>
        }) => Promise<void> | void
        readonly afterRemoveMember?: (data: {
            readonly member: Record<string, unknown>
            readonly user: AuthUserRow
            readonly organization: Record<string, unknown>
        }) => Promise<void> | void
    }
}

interface BetterAuthRuntimeContext {
    readonly adapter: AuthAdapter
    readonly internalAdapter: AuthInternalAdapter
    getPlugin(id: string): { readonly options?: OrganizationHookContext } | undefined | null
}

function asDate(value: unknown, fallback = new Date()): Date {
    if (value instanceof Date) return value
    if (typeof value === 'number' || typeof value === 'string') {
        const parsed = new Date(value)
        if (!Number.isNaN(parsed.getTime())) return parsed
    }
    return fallback
}

function asNullableDate(value: unknown): Date | null {
    if (value === null || value === undefined) return null
    if (value instanceof Date) return value
    if (typeof value === 'number' || typeof value === 'string') {
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }
    return null
}

function asBoolean(value: unknown, fallback = true): boolean {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    return fallback
}

function parseJsonValue(value: unknown): unknown {
    let current = value
    for (let depth = 0; depth < 2 && typeof current === 'string'; depth += 1) {
        const trimmed = current.trim()
        if (trimmed.length === 0) return null
        try {
            current = JSON.parse(trimmed)
        } catch {
            return current
        }
    }
    return current
}

function parseApiKeyPermissions(value: unknown): Record<string, readonly string[]> | null {
    const parsed = parseJsonValue(value)
    if (
        parsed === null ||
        parsed === undefined ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        return null
    }
    const result: Record<string, readonly string[]> = {}
    for (const [resource, actions] of Object.entries(parsed)) {
        if (Array.isArray(actions)) {
            result[resource] = actions.filter(
                (action): action is string => typeof action === 'string'
            )
        }
    }
    return result
}

function toApiKeyRecord(row: Record<string, unknown>): PostdotApiKeyRecord {
    const createdAt = asDate(row.createdAt)
    return {
        id: String(row.id),
        configId: String(row.configId ?? 'default'),
        name: typeof row.name === 'string' ? row.name : null,
        referenceId: String(row.referenceId),
        prefix: typeof row.prefix === 'string' ? row.prefix : null,
        start: typeof row.start === 'string' ? row.start : null,
        enabled: asBoolean(row.enabled, true),
        expiresAt: asNullableDate(row.expiresAt),
        createdAt,
        updatedAt: asDate(row.updatedAt, createdAt),
        metadata: row.metadata === undefined ? null : parseJsonValue(row.metadata),
        permissions: parseApiKeyPermissions(row.permissions),
    }
}

function toOrganizationTeam(row: Record<string, unknown>): PostdotOrganizationTeam {
    const createdAt = asDate(row.createdAt)
    return {
        id: String(row.id),
        name: String(row.name),
        organizationId: String(row.organizationId),
        ...(typeof row.memberCount === 'number' ? { memberCount: row.memberCount } : {}),
        createdAt,
        ...(row.updatedAt === undefined || row.updatedAt === null
            ? {}
            : { updatedAt: asDate(row.updatedAt, createdAt) }),
    }
}

function toOrganizationTeamMember(row: Record<string, unknown>): PostdotOrganizationTeamMember {
    return {
        id: String(row.id),
        teamId: String(row.teamId),
        userId: String(row.userId),
        createdAt: asDate(row.createdAt),
    }
}

function toOrganizationInvitation(row: Record<string, unknown>): PostdotOrganizationInvitation {
    return {
        id: String(row.id),
        email: String(row.email),
        role: String(row.role),
        organizationId: String(row.organizationId),
        ...(typeof row.projectId === 'string' || row.projectId === null
            ? { projectId: row.projectId }
            : {}),
        ...(typeof row.projectRole === 'string' || row.projectRole === null
            ? { projectRole: row.projectRole }
            : {}),
        inviterId: String(row.inviterId),
        status: String(row.status),
        expiresAt: asDate(row.expiresAt),
        createdAt: asDate(row.createdAt),
        ...(typeof row.teamId === 'string' && row.teamId.length > 0 ? { teamId: row.teamId } : {}),
    }
}

function computeTeamMembershipKey(teamId: string, userId: string): string {
    return createHash('sha256')
        .update(JSON.stringify([teamId, userId]))
        .digest('base64url')
}

async function getContext(auth: PostdotAuth): Promise<BetterAuthRuntimeContext> {
    return (await auth.$context) as unknown as BetterAuthRuntimeContext
}

export interface PostdotAuthServerActions {
    setUserRole(input: { readonly userId: string; readonly role: 'admin' | 'user' }): Promise<void>
    banUser(input: { readonly userId: string; readonly banReason?: string }): Promise<void>
    unbanUser(input: { readonly userId: string }): Promise<void>
    deleteUser(input: { readonly userId: string }): Promise<void>
    listUserApiKeys(input: {
        readonly userId: string
        readonly configId: string
    }): Promise<readonly PostdotApiKeyRecord[]>
    deleteUserApiKey(input: {
        readonly userId: string
        readonly keyId: string
        readonly configId: string
    }): Promise<void>
    deleteOrganization(input: { readonly organizationId: string }): Promise<void>
    listOrganizationMembers(input: { readonly organizationId: string }): Promise<{
        readonly members: readonly PostdotOrganizationMember[]
        readonly total: number
    }>
    updateOrganizationMemberRole(input: {
        readonly organizationId: string
        readonly memberId: string
        readonly role: string | readonly string[]
    }): Promise<PostdotOrganizationMember>
    removeOrganizationMember(input: {
        readonly organizationId: string
        readonly memberIdOrEmail: string
    }): Promise<void>
    listOrganizationTeams(input: {
        readonly organizationId: string
    }): Promise<readonly PostdotOrganizationTeam[]>
    createOrganizationTeam(input: {
        readonly organizationId: string
        readonly name: string
    }): Promise<PostdotOrganizationTeam>
    updateOrganizationTeam(input: {
        readonly organizationId: string
        readonly teamId: string
        readonly name: string
    }): Promise<PostdotOrganizationTeam>
    addOrganizationTeamMember(input: {
        readonly organizationId: string
        readonly teamId: string
        readonly userId: string
    }): Promise<PostdotOrganizationTeamMember>
    removeOrganizationTeamMember(input: {
        readonly organizationId: string
        readonly teamId: string
        readonly userId: string
    }): Promise<void>
    listOrganizationInvitations(input: {
        readonly organizationId: string
    }): Promise<readonly PostdotOrganizationInvitation[]>
    createOrganizationInvitation(input: {
        readonly organizationId: string
        readonly inviterUserId: string
        readonly email: string
        readonly role: string | readonly string[]
        readonly resend?: boolean
        readonly teamId?: string | readonly string[]
        readonly projectId?: string
        readonly projectRole?: string
    }): Promise<PostdotOrganizationInvitation>
    cancelOrganizationInvitation(input: {
        readonly invitationId: string
    }): Promise<PostdotOrganizationInvitation>
}

export function createPostdotAuthServerActions(auth: PostdotAuth): PostdotAuthServerActions {
    return {
        async setUserRole({ userId, role }) {
            const ctx = await getContext(auth)
            const user = await ctx.internalAdapter.findUserById(userId)
            if (user === null) {
                throw new Error('User not found')
            }
            await ctx.internalAdapter.updateUser(userId, { role, updatedAt: new Date() })
        },

        async banUser({ userId, banReason }) {
            const ctx = await getContext(auth)
            const user = await ctx.internalAdapter.findUserById(userId)
            if (user === null) {
                throw new Error('User not found')
            }
            await ctx.internalAdapter.updateUser(userId, {
                banned: true,
                banReason: banReason ?? 'No reason',
                banExpires: null,
                updatedAt: new Date(),
            })
            await ctx.internalAdapter.deleteUserSessions(userId)
        },

        async unbanUser({ userId }) {
            const ctx = await getContext(auth)
            const user = await ctx.internalAdapter.findUserById(userId)
            if (user === null) {
                throw new Error('User not found')
            }
            await ctx.internalAdapter.updateUser(userId, {
                banned: false,
                banExpires: null,
                banReason: null,
                updatedAt: new Date(),
            })
        },

        async deleteUser({ userId }) {
            const ctx = await getContext(auth)
            await ctx.internalAdapter.deleteUserSessions(userId)
            await ctx.adapter.deleteMany({
                model: 'apikey',
                where: [{ field: 'referenceId', value: userId }],
            })
            await ctx.adapter.deleteMany({
                model: 'teamMember',
                where: [{ field: 'userId', value: userId }],
            })
            await ctx.adapter.deleteMany({
                model: 'member',
                where: [{ field: 'userId', value: userId }],
            })
            await ctx.internalAdapter.deleteUser(userId)
        },

        async listUserApiKeys({ userId, configId }) {
            const ctx = await getContext(auth)
            const rows = await ctx.adapter.findMany({
                model: 'apikey',
                where: [
                    { field: 'referenceId', value: userId },
                    { field: 'configId', value: configId },
                ],
                limit: 1_000,
                sortBy: { field: 'createdAt', direction: 'asc' },
            })
            return rows.map(toApiKeyRecord)
        },

        async deleteUserApiKey({ userId, keyId, configId }) {
            const ctx = await getContext(auth)
            const existing = await ctx.adapter.findOne({
                model: 'apikey',
                where: [
                    { field: 'id', value: keyId },
                    { field: 'referenceId', value: userId },
                    { field: 'configId', value: configId },
                ],
            })
            if (existing === null) {
                throw new Error('API key not found')
            }
            await ctx.adapter.delete({
                model: 'apikey',
                where: [{ field: 'id', value: keyId }],
            })
        },

        async deleteOrganization({ organizationId }) {
            const ctx = await getContext(auth)
            await ctx.adapter.transaction(async adapter => {
                const teams = await adapter.findMany({
                    model: 'team',
                    where: [{ field: 'organizationId', value: organizationId }],
                    limit: 1_000,
                })
                for (const team of teams) {
                    await adapter.deleteMany({
                        model: 'teamMember',
                        where: [{ field: 'teamId', value: String(team.id) }],
                    })
                }
                await adapter.deleteMany({
                    model: 'team',
                    where: [{ field: 'organizationId', value: organizationId }],
                })
                await adapter.deleteMany({
                    model: 'invitation',
                    where: [{ field: 'organizationId', value: organizationId }],
                })
                await adapter.deleteMany({
                    model: 'member',
                    where: [{ field: 'organizationId', value: organizationId }],
                })
                await adapter.delete({
                    model: 'organization',
                    where: [{ field: 'id', value: organizationId }],
                })
            })
        },

        async listOrganizationMembers({ organizationId }) {
            const ctx = await getContext(auth)
            const members = await ctx.adapter.findMany({
                model: 'member',
                where: [{ field: 'organizationId', value: organizationId }],
                limit: 10_000,
                sortBy: { field: 'createdAt', direction: 'asc' },
            })
            if (members.length === 0) {
                return { members: [], total: 0 }
            }
            const userIds = [...new Set(members.map(member => String(member.userId)))]
            const users = await ctx.adapter.findMany<Record<string, unknown>>({
                model: 'user',
                where: [{ field: 'id', value: userIds, operator: 'in' }],
                limit: userIds.length,
            })
            const usersById = new Map(users.map(user => [String(user.id), user]))
            const hydrated: PostdotOrganizationMember[] = members.map(member => {
                const userId = String(member.userId)
                const user = usersById.get(userId)
                if (user === undefined) {
                    throw new Error(`User not found for organization member ${String(member.id)}`)
                }
                return {
                    id: String(member.id),
                    organizationId: String(member.organizationId),
                    role: String(member.role),
                    createdAt: asDate(member.createdAt),
                    userId,
                    user: {
                        id: userId,
                        email: String(user.email),
                        name: String(user.name),
                        image: typeof user.image === 'string' ? user.image : null,
                    },
                }
            })
            return { members: hydrated, total: hydrated.length }
        },

        async updateOrganizationMemberRole({ organizationId, memberId, role }) {
            const ctx = await getContext(auth)
            const normalizedRole = Array.isArray(role) ? role.join(',') : String(role)
            const updated = await ctx.adapter.update({
                model: 'member',
                where: [
                    { field: 'id', value: memberId },
                    { field: 'organizationId', value: organizationId },
                ],
                update: { role: normalizedRole },
            })
            if (updated === null) {
                throw new Error('Organization member not found')
            }
            const user = await ctx.internalAdapter.findUserById(String(updated.userId))
            if (user === null) {
                throw new Error('User not found for organization member')
            }
            return {
                id: String(updated.id),
                organizationId: String(updated.organizationId),
                role: String(updated.role),
                createdAt: asDate(updated.createdAt),
                userId: user.id,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    image: user.image ?? null,
                },
            }
        },

        async removeOrganizationMember({ organizationId, memberIdOrEmail }) {
            const ctx = await getContext(auth)
            const orgOptions = ctx.getPlugin('organization')?.options
            const organization = await ctx.adapter.findOne({
                model: 'organization',
                where: [{ field: 'id', value: organizationId }],
            })
            if (organization === null) {
                throw new Error('Organization not found')
            }
            let targetMember: Record<string, unknown> | null = null
            if (memberIdOrEmail.includes('@')) {
                const foundUser = await ctx.internalAdapter.findUserByEmail(
                    memberIdOrEmail.trim().toLowerCase()
                )
                if (foundUser !== null) {
                    targetMember = await ctx.adapter.findOne({
                        model: 'member',
                        where: [
                            { field: 'organizationId', value: organizationId },
                            { field: 'userId', value: foundUser.user.id },
                        ],
                    })
                }
            } else {
                targetMember = await ctx.adapter.findOne({
                    model: 'member',
                    where: [
                        { field: 'id', value: memberIdOrEmail },
                        { field: 'organizationId', value: organizationId },
                    ],
                })
            }
            if (targetMember === null) {
                throw new Error('Organization member not found')
            }
            const targetUserId = String(targetMember.userId)
            const user = await ctx.internalAdapter.findUserById(targetUserId)
            if (user === null) {
                throw new Error('User not found for organization member')
            }
            if (orgOptions?.organizationHooks?.beforeRemoveMember !== undefined) {
                await orgOptions.organizationHooks.beforeRemoveMember({
                    member: targetMember,
                    user,
                    organization,
                })
            }

            await ctx.adapter.transaction(async adapter => {
                await adapter.delete({
                    model: 'member',
                    where: [
                        { field: 'id', value: String(targetMember.id) },
                        { field: 'organizationId', value: organizationId },
                    ],
                })
                const teams = await adapter.findMany({
                    model: 'team',
                    where: [{ field: 'organizationId', value: organizationId }],
                    limit: 1_000,
                })
                for (const team of teams) {
                    const teamId = String(team.id)
                    const removedCount = await adapter.deleteMany({
                        model: 'teamMember',
                        where: [
                            { field: 'teamId', value: teamId },
                            { field: 'userId', value: targetUserId },
                        ],
                    })
                    if (removedCount > 0) {
                        const remaining = await adapter.count({
                            model: 'teamMember',
                            where: [{ field: 'teamId', value: teamId }],
                        })
                        await adapter.update({
                            model: 'team',
                            where: [{ field: 'id', value: teamId }],
                            update: { memberCount: remaining, updatedAt: new Date() },
                        })
                    }
                }
            })

            if (orgOptions?.organizationHooks?.afterRemoveMember !== undefined) {
                await orgOptions.organizationHooks.afterRemoveMember({
                    member: targetMember,
                    user,
                    organization,
                })
            }
        },

        async listOrganizationTeams({ organizationId }) {
            const ctx = await getContext(auth)
            const teams = await ctx.adapter.findMany({
                model: 'team',
                where: [{ field: 'organizationId', value: organizationId }],
                limit: 1_000,
                sortBy: { field: 'createdAt', direction: 'asc' },
            })
            return teams.map(toOrganizationTeam)
        },

        async createOrganizationTeam({ organizationId, name }) {
            const ctx = await getContext(auth)
            const now = new Date()
            const created = await ctx.adapter.create({
                model: 'team',
                data: {
                    name,
                    organizationId,
                    memberCount: 0,
                    createdAt: now,
                    updatedAt: now,
                },
            })
            return toOrganizationTeam(created)
        },

        async updateOrganizationTeam({ organizationId, teamId, name }) {
            const ctx = await getContext(auth)
            const updated = await ctx.adapter.update({
                model: 'team',
                where: [
                    { field: 'id', value: teamId },
                    { field: 'organizationId', value: organizationId },
                ],
                update: { name, updatedAt: new Date() },
            })
            if (updated === null) {
                throw new Error('Organization team not found')
            }
            return toOrganizationTeam(updated)
        },

        async addOrganizationTeamMember({ organizationId, teamId, userId }) {
            const ctx = await getContext(auth)
            const orgOptions = ctx.getPlugin('organization')?.options
            const [organization, team, user] = await Promise.all([
                ctx.adapter.findOne({
                    model: 'organization',
                    where: [{ field: 'id', value: organizationId }],
                }),
                ctx.adapter.findOne({
                    model: 'team',
                    where: [
                        { field: 'id', value: teamId },
                        { field: 'organizationId', value: organizationId },
                    ],
                }),
                ctx.internalAdapter.findUserById(userId),
            ])
            if (organization === null || team === null || user === null) {
                throw new Error('Organization team or user not found')
            }

            const { created, teamMember } = await ctx.adapter.transaction(async adapter => {
                const membershipKey = computeTeamMembershipKey(teamId, userId)
                const existing =
                    (await adapter.findOne({
                        model: 'teamMember',
                        where: [{ field: 'membershipKey', value: membershipKey }],
                    })) ??
                    (await adapter.findOne({
                        model: 'teamMember',
                        where: [
                            { field: 'teamId', value: teamId },
                            { field: 'userId', value: userId },
                        ],
                    }))
                if (existing !== null) {
                    return { created: false, teamMember: existing }
                }
                const inserted = await adapter.create({
                    model: 'teamMember',
                    data: {
                        teamId,
                        userId,
                        membershipKey,
                        createdAt: new Date(),
                    },
                })
                const total = await adapter.count({
                    model: 'teamMember',
                    where: [{ field: 'teamId', value: teamId }],
                })
                await adapter.update({
                    model: 'team',
                    where: [{ field: 'id', value: teamId }],
                    update: { memberCount: total, updatedAt: new Date() },
                })
                return { created: true, teamMember: inserted }
            })

            if (created && orgOptions?.organizationHooks?.afterAddTeamMember !== undefined) {
                await orgOptions.organizationHooks.afterAddTeamMember({
                    teamMember,
                    team,
                    user,
                    organization,
                })
            }
            return toOrganizationTeamMember(teamMember)
        },

        async removeOrganizationTeamMember({ organizationId, teamId, userId }) {
            const ctx = await getContext(auth)
            const orgOptions = ctx.getPlugin('organization')?.options
            const [organization, team, user, existing] = await Promise.all([
                ctx.adapter.findOne({
                    model: 'organization',
                    where: [{ field: 'id', value: organizationId }],
                }),
                ctx.adapter.findOne({
                    model: 'team',
                    where: [
                        { field: 'id', value: teamId },
                        { field: 'organizationId', value: organizationId },
                    ],
                }),
                ctx.internalAdapter.findUserById(userId),
                ctx.adapter.findOne({
                    model: 'teamMember',
                    where: [
                        { field: 'teamId', value: teamId },
                        { field: 'userId', value: userId },
                    ],
                }),
            ])
            if (organization === null || team === null) {
                throw new Error('Organization team not found')
            }
            if (existing === null) {
                return
            }

            await ctx.adapter.transaction(async adapter => {
                await adapter.deleteMany({
                    model: 'teamMember',
                    where: [
                        { field: 'teamId', value: teamId },
                        { field: 'userId', value: userId },
                    ],
                })
                const total = await adapter.count({
                    model: 'teamMember',
                    where: [{ field: 'teamId', value: teamId }],
                })
                await adapter.update({
                    model: 'team',
                    where: [{ field: 'id', value: teamId }],
                    update: { memberCount: total, updatedAt: new Date() },
                })
            })

            if (
                user !== null &&
                orgOptions?.organizationHooks?.afterRemoveTeamMember !== undefined
            ) {
                await orgOptions.organizationHooks.afterRemoveTeamMember({
                    teamMember: existing,
                    team,
                    user,
                    organization,
                })
            }
        },

        async listOrganizationInvitations({ organizationId }) {
            const ctx = await getContext(auth)
            const invitations = await ctx.adapter.findMany({
                model: 'invitation',
                where: [{ field: 'organizationId', value: organizationId }],
                limit: 1_000,
                sortBy: { field: 'createdAt', direction: 'desc' },
            })
            return invitations.map(toOrganizationInvitation)
        },

        async createOrganizationInvitation({
            organizationId,
            inviterUserId,
            email,
            role,
            resend,
            teamId,
            projectId,
            projectRole,
        }) {
            const ctx = await getContext(auth)
            const orgOptions = ctx.getPlugin('organization')?.options
            const normalizedEmail = email.trim().toLowerCase()
            const normalizedRole = Array.isArray(role) ? role.join(',') : String(role)
            const organization = await ctx.adapter.findOne({
                model: 'organization',
                where: [{ field: 'id', value: organizationId }],
            })
            if (organization === null) {
                throw new Error('Organization not found')
            }

            const inviterUser = await ctx.internalAdapter.findUserById(inviterUserId)
            const inviterMember = await ctx.adapter.findOne({
                model: 'member',
                where: [
                    { field: 'organizationId', value: organizationId },
                    { field: 'userId', value: inviterUserId },
                ],
            })
            if (inviterUser === null || inviterMember === null) {
                throw new Error('Inviter is not a member of this organization')
            }

            const existingTargetUser = await ctx.internalAdapter.findUserByEmail(normalizedEmail)
            if (existingTargetUser !== null) {
                const existingMember = await ctx.adapter.findOne({
                    model: 'member',
                    where: [
                        { field: 'organizationId', value: organizationId },
                        { field: 'userId', value: existingTargetUser.user.id },
                    ],
                })
                if (existingMember !== null) {
                    throw new Error('User is already a member of this organization')
                }
            }

            const nowMs = Date.now()
            const expiresInSec = orgOptions?.invitationExpiresIn ?? 7 * 24 * 60 * 60
            const expiresAt = new Date(nowMs + expiresInSec * 1_000)

            const pendingRows = (
                await ctx.adapter.findMany({
                    model: 'invitation',
                    where: [
                        { field: 'email', value: normalizedEmail },
                        { field: 'organizationId', value: organizationId },
                        { field: 'status', value: 'pending' },
                    ],
                    limit: 100,
                })
            ).filter(row => asDate(row.expiresAt).getTime() > nowMs)

            let persisted: Record<string, unknown> | null = null
            if (pendingRows.length > 0 && resend === true) {
                const target = pendingRows[0]!
                persisted = await ctx.adapter.update({
                    model: 'invitation',
                    where: [{ field: 'id', value: String(target.id) }],
                    update: { expiresAt },
                })
            } else {
                if (pendingRows.length > 0) {
                    if (orgOptions?.cancelPendingInvitationsOnReInvite !== true) {
                        throw new Error('User is already invited to this organization')
                    }
                    for (const row of pendingRows) {
                        await ctx.adapter.update({
                            model: 'invitation',
                            where: [{ field: 'id', value: String(row.id) }],
                            update: { status: 'canceled' },
                        })
                    }
                }

                const teamIds =
                    teamId === undefined
                        ? []
                        : Array.isArray(teamId)
                          ? teamId.filter(id => id.length > 0)
                          : [teamId]
                persisted = await ctx.adapter.create({
                    model: 'invitation',
                    data: {
                        email: normalizedEmail,
                        role: normalizedRole,
                        organizationId,
                        inviterId: inviterUserId,
                        status: 'pending',
                        expiresAt,
                        createdAt: new Date(nowMs),
                        teamId: teamIds.length > 0 ? teamIds.join(',') : null,
                        ...(projectId === undefined ? {} : { projectId }),
                        ...(projectRole === undefined ? {} : { projectRole }),
                    },
                })
            }

            if (persisted === null) {
                throw new Error('The organization invitation could not be persisted')
            }

            if (orgOptions?.sendInvitationEmail !== undefined) {
                await orgOptions.sendInvitationEmail({
                    id: String(persisted.id),
                    email: normalizedEmail,
                    role: String(persisted.role),
                    organization: {
                        id: String(organization.id),
                        name: String(organization.name),
                        slug: String(organization.slug),
                    },
                    invitation: {
                        ...persisted,
                        id: String(persisted.id),
                        email: normalizedEmail,
                        role: String(persisted.role),
                        organizationId: String(persisted.organizationId),
                        inviterId: String(persisted.inviterId),
                        status: String(persisted.status),
                        expiresAt: asDate(persisted.expiresAt),
                    },
                    inviter: {
                        id: String(inviterMember.id),
                        organizationId: String(inviterMember.organizationId),
                        userId: String(inviterMember.userId),
                        role: String(inviterMember.role),
                        user: inviterUser,
                    },
                })
            }

            return toOrganizationInvitation(persisted)
        },

        async cancelOrganizationInvitation({ invitationId }) {
            const ctx = await getContext(auth)
            const updated = await ctx.adapter.update({
                model: 'invitation',
                where: [{ field: 'id', value: invitationId }],
                update: { status: 'canceled' },
            })
            if (updated === null) {
                throw new Error('Invitation not found')
            }
            return toOrganizationInvitation(updated)
        },
    }
}
