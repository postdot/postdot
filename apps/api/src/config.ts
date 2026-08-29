import { fileURLToPath } from 'node:url'

import type { LevelWithSilent } from 'pino'

import {
    createEnvironment,
    env,
    type EnvironmentSource,
    type InferEnvironment,
} from './environment'

export const defaultDatabaseFileName = fileURLToPath(
    new URL('../../../herald.sqlite', import.meta.url)
)
const defaultMigrationsDirectory = fileURLToPath(
    new URL('../../../packages/db/drizzle', import.meta.url)
)
const defaultWebAssetsDirectory = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url))
const exampleBetterAuthSecret = 'replace-with-a-random-secret-of-at-least-32-characters'

const environmentDefinitions = {
    NODE_ENV: env.enum(['development', 'test', 'production'], {
        defaultValue: 'development',
    }),
    PORT: env.integer({ defaultValue: 3000, minimum: 1, maximum: 65_535 }),
    DB_FILE_NAME: env.string({ defaultValue: defaultDatabaseFileName }),
    HERALD_MIGRATIONS_DIR: env.string({ defaultValue: defaultMigrationsDirectory }),
    HERALD_WEB_ASSETS_DIR: env.string({ defaultValue: defaultWebAssetsDirectory }),
    BETTER_AUTH_URL: env.url({
        defaultValue: values => {
            const port = values.PORT
            if (typeof port !== 'number') {
                throw new Error('cannot derive the default URL because PORT is invalid')
            }

            return `http://localhost:${port}`
        },
    }),
    BETTER_AUTH_SECRET: env.secret({ example: exampleBetterAuthSecret }),
    LINKEDIN_CLIENT_ID: env.optionalString({ minLength: 1 }),
    LINKEDIN_CLIENT_SECRET: env.optionalString({ minLength: 1 }),
    HERALD_WEB_ORIGIN: env.url({ defaultValue: 'http://localhost:5173' }),
    LOG_LEVEL: env.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
        defaultValue: values => (values.NODE_ENV === 'production' ? 'silent' : 'info'),
    }),
    LOG_PRETTY: env.boolean({
        defaultValue: values => values.NODE_ENV !== 'production',
    }),
} as const

type HeraldEnvironment = InferEnvironment<typeof environmentDefinitions>

export interface HeraldLoggingConfig {
    readonly enabled: boolean
    readonly level: LevelWithSilent
    readonly pretty: boolean
}

export interface HeraldConfig {
    readonly environment: HeraldEnvironment['NODE_ENV']
    readonly server: {
        readonly port: number
    }
    readonly database: {
        readonly fileName: string
        readonly migrationsDirectory: string
    }
    readonly auth: {
        readonly baseURL: string
        readonly secret: string
        readonly linkedin?: {
            readonly clientId: string
            readonly clientSecret: string
        }
    }
    readonly web: {
        readonly origin: string
        readonly assetsDirectory: string
    }
    readonly logging: HeraldLoggingConfig
}

export function createHeraldConfig(source: EnvironmentSource = Bun.env): HeraldConfig {
    const environment = createEnvironment(environmentDefinitions, source)
    const hasLinkedInClientId = environment.LINKEDIN_CLIENT_ID !== undefined
    const hasLinkedInClientSecret = environment.LINKEDIN_CLIENT_SECRET !== undefined

    if (hasLinkedInClientId !== hasLinkedInClientSecret) {
        throw new Error(
            'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set together to enable LinkedIn'
        )
    }

    const linkedin =
        hasLinkedInClientId && hasLinkedInClientSecret
            ? {
                  clientId: environment.LINKEDIN_CLIENT_ID,
                  clientSecret: environment.LINKEDIN_CLIENT_SECRET,
              }
            : undefined

    return {
        environment: environment.NODE_ENV,
        server: {
            port: environment.PORT,
        },
        database: {
            fileName: environment.DB_FILE_NAME,
            migrationsDirectory: environment.HERALD_MIGRATIONS_DIR,
        },
        auth: {
            baseURL: environment.BETTER_AUTH_URL,
            secret: environment.BETTER_AUTH_SECRET,
            ...(linkedin === undefined ? {} : { linkedin }),
        },
        web: {
            origin: environment.HERALD_WEB_ORIGIN,
            assetsDirectory: environment.HERALD_WEB_ASSETS_DIR,
        },
        logging: {
            enabled: environment.LOG_LEVEL !== 'silent',
            level: environment.LOG_LEVEL,
            pretty: environment.LOG_PRETTY,
        },
    }
}
