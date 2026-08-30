import type { HeraldDatabase } from '@herald/db'
import * as schema from '@herald/db/schema'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

export type HeraldAuthRuntimeOptions = Pick<
    BetterAuthOptions,
    'baseURL' | 'secret' | 'trustedOrigins'
>

export function createAuth(
    database: HeraldDatabase,
    runtimeOptions: HeraldAuthRuntimeOptions = {}
) {
    return betterAuth({
        ...runtimeOptions,
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
