import { createAccessStore, type AccessStore, type PostdotDatabase } from '@postdot/db'
import * as schema from '@postdot/db/schema'
import { APIError, betterAuth, type Auth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { hashPassword } from 'better-auth/crypto'

import {
    createPostdotAuthPlugins,
    type PostdotAuthInvitationOptions,
    type PostdotAuthPluginHooks,
    type PostdotAuthPlugins,
} from './plugins'

export type { PostdotAuthInvitationOptions, PostdotOrganizationInvitationEmail } from './plugins'
export { postdotUserApiKeyConfigId } from './plugins'

export const postdotPasswordPolicy = {
    minimumLength: 8,
    maximumLength: 128,
} as const

/** Hashes an offline-recovered password with the same format used by Better Auth. */
export function hashPostdotPassword(password: string): Promise<string> {
    return hashPassword(password)
}

export interface PostdotAuthVerificationEmail {
    readonly user: {
        readonly email: string
        readonly name: string
    }
    readonly url: string
    readonly token: string
}

export interface PostdotAuthEmailOptions {
    /** Live transport availability for explicit email requests. */
    readonly emailDeliveryAvailable?: () => boolean
    /** Optional deployment-provided account verification mail delivery. */
    readonly sendEmailVerification?: (input: PostdotAuthVerificationEmail) => Promise<void> | void
    /** Optional deployment-provided password reset mail delivery. */
    readonly sendPasswordResetEmail?: (input: PostdotAuthVerificationEmail) => Promise<void> | void
    /** Send account verification mail after a successful email/password signup. */
    readonly sendEmailVerificationOnSignUp?: boolean
}

export interface PostdotAuthRuntimeOptions
    extends
        Pick<BetterAuthOptions, 'baseURL' | 'secret' | 'trustedOrigins' | 'logger'>,
        PostdotAuthInvitationOptions,
        PostdotAuthEmailOptions {
    /** Shared Postdot access state used by the Better Auth bootstrap hooks. */
    readonly access?: AccessStore
    /**
     * Test-only escape hatch for parallel browser fixtures. Production callers
     * must leave this disabled so the first account remains the sole bootstrap
     * path and later users arrive through invitations.
     */
    readonly allowAdditionalSignups?: boolean
}

type PostdotAuthOptions = BetterAuthOptions & {
    database: NonNullable<BetterAuthOptions['database']>
    databaseHooks: NonNullable<BetterAuthOptions['databaseHooks']>
    emailAndPassword: { enabled: true } & NonNullable<BetterAuthOptions['emailAndPassword']>
    plugins: PostdotAuthPlugins
}

/**
 * These Better Auth mutations are deliberately server-only in Postdot. Their
 * native handlers do not know about Postdot's instance membership invariants or
 * the actor projection, so exposing them over the public auth mount would let
 * a caller bypass the guarded Postdot routes. The plugin remains the owner of
 * the underlying records and server-side `auth.api` calls continue to use it.
 */
const postdotManagedAuthMutationPaths = new Set([
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
    '/organization/create-team',
    '/organization/update-team',
    '/organization/remove-team',
    '/organization/add-team-member',
    '/organization/remove-team-member',
    '/organization/delete',
    '/organization/update',
    '/organization/leave',
])

function isPostdotManagedAuthMutation(path: string): boolean {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return [...postdotManagedAuthMutationPaths].some(
        candidate => normalizedPath === candidate || normalizedPath.endsWith(candidate)
    )
}

/**
 * The Better Auth router type cannot infer endpoints from a tuple assembled by
 * a factory. Keep the small server-only surface Postdot calls explicitly typed
 * instead of spreading an `any` cast into the API layer.
 */
export interface PostdotOrganizationAuthApi {
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

export interface PostdotOrganizationMember {
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

export interface PostdotApiKeyRecord {
    readonly id: string
    readonly configId: string
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

export interface PostdotApiKeyAuthApi {
    createApiKey(input: {
        body: {
            configId?: string
            name: string
            organizationId?: string
            userId?: string
            expiresIn?: number | null
            metadata?: unknown
            permissions?: Record<string, string[]>
        }
        headers?: Headers
    }): Promise<PostdotApiKeyRecord & { readonly key: string }>
    listApiKeys(input: {
        query: { configId?: string; organizationId?: string; limit?: number; offset?: number }
        headers: Headers
    }): Promise<{ readonly apiKeys: readonly PostdotApiKeyRecord[]; readonly total: number }>
    deleteApiKey(input: {
        body: { configId?: string; keyId: string }
        headers: Headers
    }): Promise<{ readonly success: boolean }>
    updateApiKey(input: {
        body: {
            configId?: string
            keyId: string
            userId?: string
            metadata?: unknown
            name?: string
            expiresIn?: number | null
            permissions?: Record<string, string[]> | null
        }
        headers?: Headers
    }): Promise<PostdotApiKeyRecord>
    verifyApiKey(input: {
        body: { configId?: string; key: string }
    }): Promise<
        | { readonly valid: true; readonly error: null; readonly key: PostdotApiKeyRecord }
        | { readonly valid: false; readonly error: unknown; readonly key: null }
    >
}

export interface PostdotOrganizationInvitation {
    readonly id: string
    readonly email: string
    readonly role: string
    readonly organizationId: string
    readonly projectId?: string | null
    readonly projectRole?: string | null
    readonly inviterId: string
    readonly status: string
    readonly expiresAt: Date
    readonly createdAt: Date
    readonly teamId?: string
}

export interface PostdotOrganizationInvitationDetails extends PostdotOrganizationInvitation {
    readonly organizationName: string
    readonly organizationSlug: string
    readonly inviterEmail: string
}

export interface PostdotOrganizationTeam {
    readonly id: string
    readonly name: string
    readonly organizationId: string
    readonly memberCount?: number
    readonly createdAt: Date
    readonly updatedAt?: Date
}

export interface PostdotOrganizationTeamMember {
    readonly id: string
    readonly teamId: string
    readonly userId: string
    readonly createdAt: Date
}

export interface PostdotOrganizationInvitationAuthApi {
    listMembers(input: {
        query: { organizationId: string; limit?: number; offset?: number }
        headers: Headers
    }): Promise<{
        readonly members: readonly PostdotOrganizationMember[]
        readonly total: number
    }>
    listInvitations(input: {
        query: { organizationId: string }
        headers: Headers
    }): Promise<readonly PostdotOrganizationInvitation[]>
    createInvitation(input: {
        body: {
            email: string
            role: string | string[]
            organizationId: string
            resend?: boolean
            teamId?: string | string[]
            projectId?: string
            projectRole?: string
        }
        headers: Headers
    }): Promise<PostdotOrganizationInvitation>
    getInvitation(input: {
        query: { id: string }
        headers: Headers
    }): Promise<PostdotOrganizationInvitationDetails>
    acceptInvitation(input: { body: { invitationId: string }; headers: Headers }): Promise<{
        readonly invitation: PostdotOrganizationInvitation
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
    }): Promise<PostdotOrganizationInvitation>
    listOrganizationTeams(input: {
        query: { organizationId: string }
        headers: Headers
    }): Promise<readonly PostdotOrganizationTeam[]>
    createTeam(input: {
        body: { name: string; organizationId: string }
        headers: Headers
    }): Promise<PostdotOrganizationTeam>
    updateTeam(input: {
        body: {
            teamId: string
            data: { name?: string; organizationId?: string }
        }
        headers: Headers
    }): Promise<PostdotOrganizationTeam>
    listTeamMembers(input: {
        query: { teamId: string }
        headers: Headers
    }): Promise<readonly PostdotOrganizationTeamMember[]>
    addTeamMember(input: {
        body: { teamId: string; userId: string; organizationId: string }
        headers: Headers
    }): Promise<PostdotOrganizationTeamMember>
    removeTeamMember(input: {
        body: { teamId: string; userId: string; organizationId: string }
        headers: Headers
    }): Promise<{ readonly message: string }>
}

export interface PostdotAdminAuthApi {
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

export type PostdotAuth = Auth<PostdotAuthOptions> & {
    readonly api: Auth<PostdotAuthOptions>['api'] &
        PostdotOrganizationAuthApi &
        PostdotApiKeyAuthApi &
        PostdotOrganizationInvitationAuthApi &
        PostdotAdminAuthApi
}

export function createAuth(
    database: PostdotDatabase,
    runtimeOptions: PostdotAuthRuntimeOptions = {}
): PostdotAuth {
    const {
        access: accessOption,
        allowAdditionalSignups = false,
        organizationInvitationURL,
        requireEmailVerificationOnInvitation,
        sendOrganizationInvitationEmail,
        sendEmailVerification,
        sendEmailVerificationOnSignUp,
        sendPasswordResetEmail,
        emailDeliveryAvailable,
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

                if (emailDeliveryAvailable?.() === false) {
                    if (authContext.path === '/request-password-reset') {
                        throw new APIError('BAD_REQUEST', {
                            code: 'RESET_PASSWORD_DISABLED',
                            message:
                                'Password recovery is unavailable because email delivery is not configured',
                        })
                    }
                    if (authContext.path === '/send-verification-email') {
                        throw new APIError('BAD_REQUEST', {
                            code: 'VERIFICATION_EMAIL_NOT_ENABLED',
                            message: 'Verification email delivery is not configured',
                        })
                    }
                }

                if (authContext.path === '/update-user') {
                    const body = authContext.body as Record<string, unknown> | undefined
                    if (body && Object.hasOwn(body, 'image')) {
                        throw new APIError('BAD_REQUEST', {
                            message: 'Use the personal avatar route to update an image',
                        })
                    }
                    if (
                        !body ||
                        typeof body.name !== 'string' ||
                        body.name.trim().length === 0 ||
                        body.name.trim().length > 100
                    ) {
                        throw new APIError('BAD_REQUEST', {
                            message: 'Name must contain between 1 and 100 characters',
                        })
                    }
                    body.name = body.name.trim()
                }

                if (
                    authContext.request !== undefined &&
                    authContext.path !== undefined &&
                    isPostdotManagedAuthMutation(authContext.path)
                ) {
                    throw new APIError('FORBIDDEN', {
                        message: 'Use the corresponding Postdot access route for this operation',
                    })
                }
            },
        },
        emailAndPassword: {
            enabled: true,
            minPasswordLength: postdotPasswordPolicy.minimumLength,
            maxPasswordLength: postdotPasswordPolicy.maximumLength,
            ...(sendPasswordResetEmail === undefined
                ? {}
                : {
                      sendResetPassword: async (data: {
                          user: { email: string; name: string }
                          url: string
                          token: string
                      }) => {
                          await sendPasswordResetEmail(data)
                      },
                  }),
        },
        ...(sendEmailVerification === undefined && sendEmailVerificationOnSignUp === undefined
            ? {}
            : {
                  emailVerification: {
                      ...(sendEmailVerification === undefined
                          ? {}
                          : {
                                sendVerificationEmail: async (data: {
                                    user: { email: string; name: string }
                                    url: string
                                    token: string
                                }) => {
                                    await sendEmailVerification(data)
                                },
                            }),
                      ...(sendEmailVerificationOnSignUp === undefined
                          ? {}
                          : { sendOnSignUp: sendEmailVerificationOnSignUp }),
                  },
              }),
        plugins: createPostdotAuthPlugins(
            {
                afterOrganizationInvitationAccepted: ({
                    organizationId,
                    userId,
                    displayName,
                    teamId,
                    projectId,
                    projectRole,
                }) => {
                    // Workspace invitations are the product-level membership
                    // flow. Keep the legacy instance projection in sync, but
                    // do not try to interpret workspace roles as project roles.
                    const workspace = access.ensureInstanceMembershipForWorkspaceMember({
                        organizationId,
                        userId,
                    })
                    if (workspace !== null) {
                        if (
                            projectId !== undefined &&
                            (projectRole === 'editor' || projectRole === 'viewer')
                        ) {
                            access.grantProjectUserAccess({
                                projectId,
                                userId,
                                role: projectRole,
                            })
                        }
                        if (teamId !== undefined) {
                            access.syncTeamMemberToProjectGrants({
                                teamId,
                                userId,
                                displayName,
                            })
                        }
                        return
                    }

                    // A Better Auth organization that is not backed by a
                    // Postdot workspace is legacy data. It must not grant
                    // project access after the workspace/grant boundary is
                    // established.
                },
                afterOrganizationTeamMemberAdded: ({
                    organizationId,
                    teamId,
                    userId,
                    displayName,
                }) => {
                    // Only workspace teams can grant Postdot project access.
                    // Legacy Better Auth organizations are not part of the
                    // product-level group model.
                    if (access.getWorkspaceByOrganizationId(organizationId) === null) return
                    access.syncTeamMemberToProjectGrants({ teamId, userId, displayName })
                },
            } satisfies PostdotAuthPluginHooks,
            {
                organizationInvitationURL,
                requireEmailVerificationOnInvitation,
                sendOrganizationInvitationEmail,
            }
        ),
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
                        // Postdot's instance membership remains the installation-level
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
    }) as unknown as PostdotAuth
}
