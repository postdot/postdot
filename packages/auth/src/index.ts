import { createAccessStore, type AccessStore, type HeraldDatabase } from '@herald/db'
import * as schema from '@herald/db/schema'
import { APIError, betterAuth, type Auth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

import {
    createHeraldAuthPlugins,
    type HeraldAuthPluginHooks,
    type HeraldAuthPlugins,
} from './plugins'

export interface HeraldAuthRuntimeOptions extends Pick<
    BetterAuthOptions,
    'baseURL' | 'secret' | 'trustedOrigins'
> {
    /** Shared Herald access state used by the Better Auth bootstrap hooks. */
    readonly access?: AccessStore
    /**
     * Test-only escape hatch for parallel browser fixtures. Production callers
     * must leave this disabled so the first account remains the sole bootstrap
     * path and later users arrive through invitations.
     */
    readonly allowAdditionalSignups?: boolean
}

type HeraldAuthOptions = BetterAuthOptions & {
    database: NonNullable<BetterAuthOptions['database']>
    databaseHooks: NonNullable<BetterAuthOptions['databaseHooks']>
    emailAndPassword: { enabled: true } & NonNullable<BetterAuthOptions['emailAndPassword']>
    plugins: HeraldAuthPlugins
}

/**
 * These Better Auth mutations are deliberately server-only in Herald. Their
 * native handlers do not know about Herald's instance membership invariants or
 * the actor projection, so exposing them over the public auth mount would let
 * a caller bypass the guarded Herald routes. The plugin remains the owner of
 * the underlying records and server-side `auth.api` calls continue to use it.
 */
const heraldManagedAuthMutationPaths = new Set([
    '/admin/create-user',
    '/admin/remove-user',
    '/admin/set-role',
    '/admin/ban-user',
    '/admin/unban-user',
    '/api-key/create',
    '/api-key/update',
    '/api-key/delete',
    '/organization/invite-member',
    '/organization/cancel-invitation',
    '/organization/remove-member',
    '/organization/update-member-role',
    '/organization/delete',
    '/organization/update',
    '/organization/leave',
])

function isHeraldManagedAuthMutation(path: string): boolean {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return [...heraldManagedAuthMutationPaths].some(
        candidate => normalizedPath === candidate || normalizedPath.endsWith(candidate)
    )
}

/**
 * The Better Auth router type cannot infer endpoints from a tuple assembled by
 * a factory. Keep the small server-only surface Herald calls explicitly typed
 * instead of spreading an `any` cast into the API layer.
 */
export interface HeraldOrganizationAuthApi {
    createOrganization(input: {
        body: {
            name: string
            slug: string
            userId?: string
            logo?: string | null
            metadata?: Record<string, unknown>
        }
        headers?: Headers
    }): Promise<{ readonly id: string; readonly name: string; readonly slug: string }>
    deleteOrganization(input: {
        body: { organizationId: string }
        headers: Headers
    }): Promise<unknown>
    addMember(input: {
        body: {
            organizationId: string
            userId?: string
            email?: string
            role: string | string[]
        }
        headers?: Headers
    }): Promise<{
        readonly id: string
        readonly organizationId: string
        readonly userId: string
        readonly role: string
    }>
    updateMemberRole(input: {
        body: {
            memberId: string
            role: string | string[]
            organizationId: string
        }
        headers: Headers
    }): Promise<unknown>
    removeMember(input: {
        body: { memberIdOrEmail: string; organizationId: string }
        headers: Headers
    }): Promise<unknown>
    leaveOrganization(input: {
        body: { organizationId: string }
        headers: Headers
    }): Promise<unknown>
}

export interface HeraldOrganizationMember {
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
}

export interface HeraldApiKeyRecord {
    readonly id: string
    readonly name: string | null
    readonly referenceId: string
    readonly key?: string
    readonly prefix: string | null
    readonly start: string | null
    readonly enabled: boolean
    readonly expiresAt: Date | null
    readonly createdAt: Date
    readonly updatedAt: Date
    readonly metadata: unknown
    readonly permissions: Record<string, readonly string[]> | null
}

export interface HeraldApiKeyAuthApi {
    createApiKey(input: {
        body: {
            name: string
            organizationId: string
            userId?: string
            expiresIn?: number | null
            metadata?: unknown
        }
        headers?: Headers
    }): Promise<HeraldApiKeyRecord & { readonly key: string }>
    listApiKeys(input: {
        query: { organizationId: string; limit?: number; offset?: number }
        headers: Headers
    }): Promise<{ readonly apiKeys: readonly HeraldApiKeyRecord[]; readonly total: number }>
    deleteApiKey(input: {
        body: { keyId: string }
        headers: Headers
    }): Promise<{ readonly success: boolean }>
    verifyApiKey(input: {
        body: { key: string }
    }): Promise<
        | { readonly valid: true; readonly error: null; readonly key: HeraldApiKeyRecord }
        | { readonly valid: false; readonly error: unknown; readonly key: null }
    >
}

export interface HeraldOrganizationInvitation {
    readonly id: string
    readonly email: string
    readonly role: string
    readonly organizationId: string
    readonly inviterId: string
    readonly status: string
    readonly expiresAt: Date
    readonly createdAt: Date
}

export interface HeraldOrganizationInvitationAuthApi {
    listMembers(input: {
        query: { organizationId: string; limit?: number; offset?: number }
        headers: Headers
    }): Promise<{
        readonly members: readonly HeraldOrganizationMember[]
        readonly total: number
    }>
    listInvitations(input: {
        query: { organizationId: string }
        headers: Headers
    }): Promise<readonly HeraldOrganizationInvitation[]>
    createInvitation(input: {
        body: {
            email: string
            role: string | string[]
            organizationId: string
            resend?: boolean
        }
        headers: Headers
    }): Promise<HeraldOrganizationInvitation>
    acceptInvitation(input: { body: { invitationId: string }; headers: Headers }): Promise<{
        readonly invitation: HeraldOrganizationInvitation
        readonly member: {
            readonly id: string
            readonly organizationId: string
            readonly userId: string
            readonly role: string
            readonly createdAt: Date
        }
    }>
    cancelInvitation(input: {
        body: { invitationId: string }
        headers: Headers
    }): Promise<HeraldOrganizationInvitation>
}

export interface HeraldAdminAuthApi {
    setRole(input: {
        body: { userId: string; role: string | string[] }
        headers: Headers
    }): Promise<unknown>
    banUser(input: {
        body: { userId: string; banReason?: string; banExpiresIn?: number }
        headers: Headers
    }): Promise<unknown>
    unbanUser(input: { body: { userId: string }; headers: Headers }): Promise<unknown>
}

export type HeraldAuth = Auth<HeraldAuthOptions> & {
    readonly api: Auth<HeraldAuthOptions>['api'] &
        HeraldOrganizationAuthApi &
        HeraldApiKeyAuthApi &
        HeraldOrganizationInvitationAuthApi &
        HeraldAdminAuthApi
}

export function createAuth(
    database: HeraldDatabase,
    runtimeOptions: HeraldAuthRuntimeOptions = {}
): HeraldAuth {
    const {
        access: accessOption,
        allowAdditionalSignups = false,
        ...betterAuthOptions
    } = runtimeOptions
    const access = accessOption ?? createAccessStore(database)
    const hasPendingBetterAuthInvitationForEmail = (email: string): boolean =>
        database.$client
            .query<{ readonly id: string }, [email: string, now: number]>(`
                select id
                from invitation
                where lower(email) = lower(?1)
                  and status = 'pending'
                  and expires_at > ?2
                limit 1
            `)
            .get(email.trim(), Date.now()) !== null

    return betterAuth({
        ...betterAuthOptions,
        database: drizzleAdapter(database, {
            provider: 'sqlite',
            schema,
            transaction: true,
        }),
        hooks: {
            before: async context => {
                // Better Auth exposes `path` on the runtime middleware context,
                // but it is not part of the public hook type in 1.7 yet.
                const authContext = context as typeof context & {
                    readonly path?: string
                }

                if (
                    authContext.request !== undefined &&
                    authContext.path !== undefined &&
                    isHeraldManagedAuthMutation(authContext.path)
                ) {
                    throw new APIError('FORBIDDEN', {
                        message: 'Use the corresponding Herald access route for this operation',
                    })
                }
            },
        },
        emailAndPassword: {
            enabled: true,
        },
        plugins: createHeraldAuthPlugins({
            afterOrganizationMemberAdded: ({ organizationId, userId, role, displayName }) => {
                access.syncProjectMembershipFromOrganizationMember({
                    organizationId,
                    userId,
                    role,
                    displayName,
                })
            },
            afterOrganizationMemberRemoved: ({ organizationId, userId }) => {
                access.removeProjectMembershipForOrganizationMember({ organizationId, userId })
            },
            afterOrganizationMemberRoleUpdated: ({ organizationId, userId, role, displayName }) => {
                access.updateProjectMembershipForOrganizationMember({
                    organizationId,
                    userId,
                    role,
                    displayName,
                })
            },
            afterOrganizationInvitationAccepted: ({
                organizationId,
                userId,
                role,
                displayName,
            }) => {
                access.ensureProjectMembershipForOrganizationInvitation({
                    organizationId,
                    userId,
                    role,
                    displayName,
                })
            },
        } satisfies HeraldAuthPluginHooks),
        databaseHooks: {
            user: {
                create: {
                    before: async data => {
                        // The first account is claimed from account.create.before,
                        // after Better Auth has inserted the user in the same
                        // transaction. This early guard keeps public signup closed
                        // without creating an orphan user row.
                        const invited =
                            access.hasPendingInvitationForEmail(data.email) ||
                            hasPendingBetterAuthInvitationForEmail(data.email)
                        if (!allowAdditionalSignups && !access.isSignupAllowed() && !invited) {
                            return false
                        }

                        // Better Auth Admin owns the durable instance-admin role.
                        // Herald's instance membership remains the installation-level
                        // access boundary while preserving route and audit context.
                        return access.getInstanceState().state === 'claimable'
                            ? { data: { ...data, role: 'admin' } }
                            : { data }
                    },
                },
            },
            account: {
                create: {
                    before: async account => {
                        // A claimed instance must not reject later account links. The
                        // user hook above has already closed public user creation; this
                        // hook only performs the atomic first-account claim while the
                        // instance is still claimable. Returning false after bootstrap
                        // would also break OAuth/account-link flows for existing users.
                        if (allowAdditionalSignups) {
                            if (access.getInstanceState().state === 'claimable') {
                                const result = access.claimFirstAccountInCurrentTransaction({
                                    userId: account.userId,
                                })
                                return result.kind === 'claimed'
                            }
                            access.ensureTestAdminMembershipInCurrentTransaction({
                                userId: account.userId,
                            })
                            return true
                        }

                        if (access.getInstanceState().state !== 'claimable') return true

                        const result = access.claimFirstAccountInCurrentTransaction({
                            userId: account.userId,
                        })
                        return result.kind === 'claimed'
                    },
                },
            },
        },
    }) as unknown as HeraldAuth
}
