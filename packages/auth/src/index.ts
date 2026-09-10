import { createAccessStore, type AccessStore, type HeraldDatabase } from '@herald/db'
import * as schema from '@herald/db/schema'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

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

export function createAuth(
    database: HeraldDatabase,
    runtimeOptions: HeraldAuthRuntimeOptions = {}
) {
    const {
        access: accessOption,
        allowAdditionalSignups = false,
        ...betterAuthOptions
    } = runtimeOptions
    const access = accessOption ?? createAccessStore(database)

    return betterAuth({
        ...betterAuthOptions,
        database: drizzleAdapter(database, {
            provider: 'sqlite',
            schema,
            transaction: true,
        }),
        emailAndPassword: {
            enabled: true,
        },
        databaseHooks: {
            user: {
                create: {
                    before: async () => {
                        // The first account is claimed from account.create.before,
                        // after Better Auth has inserted the user in the same
                        // transaction. This early guard keeps public signup closed
                        // without creating an orphan user row.
                        return allowAdditionalSignups || access.isSignupAllowed()
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
    })
}

export type HeraldAuth = ReturnType<typeof createAuth>
