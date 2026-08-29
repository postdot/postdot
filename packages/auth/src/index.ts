import type { HeraldDatabase } from '@herald/db'
import * as schema from '@herald/db/schema'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

export type HeraldAuthRuntimeOptions = Pick<
    BetterAuthOptions,
    'baseURL' | 'secret' | 'trustedOrigins'
> & {
    readonly linkedin?: {
        readonly clientId: string
        readonly clientSecret: string
    }
}

export function createAuth(
    database: HeraldDatabase,
    runtimeOptions: HeraldAuthRuntimeOptions = {}
) {
    const { linkedin, ...betterAuthRuntimeOptions } = runtimeOptions

    return betterAuth({
        ...betterAuthRuntimeOptions,
        account: {
            encryptOAuthTokens: true,
            accountLinking: {
                allowDifferentEmails: true,
                disableImplicitLinking: true,
            },
        },
        ...(linkedin === undefined
            ? {}
            : {
                  socialProviders: {
                      linkedin: {
                          clientId: linkedin.clientId,
                          clientSecret: linkedin.clientSecret,
                          disableSignUp: true,
                      },
                  },
              }),
        database: drizzleAdapter(database, {
            provider: 'sqlite',
            schema,
        }),
        emailAndPassword: {
            enabled: true,
        },
    })
}

export type HeraldAuth = ReturnType<typeof createAuth>
