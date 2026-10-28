import { fileURLToPath } from 'node:url'

import { parsePrivateDestinationRules, type PrivateDestinationRule } from '@postdot/custom-http'
import type { LevelWithSilent } from 'pino'

import {
    createEnvironment,
    env,
    type EnvironmentSource,
    type InferEnvironment,
} from './environment'
import { mediaPublicDeliveryLimits } from './modules/media/public-delivery'

export const defaultDatabaseFileName = fileURLToPath(
    new URL('../../../postdot.sqlite', import.meta.url)
)
const defaultMigrationsDirectory = fileURLToPath(
    new URL('../../../packages/db/drizzle', import.meta.url)
)
const defaultWebAssetsDirectory = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url))
export const defaultMediaDirectory = fileURLToPath(new URL('../../../data/media', import.meta.url))
const exampleBetterAuthSecret = 'replace-with-a-random-secret-of-at-least-32-characters'
const exampleMediaPublicUrlSecret = 'replace-with-a-random-secret-of-at-least-32-characters'
const examplePublisherEncryptionKey = 'replace-with-64-hex-characters'

const mediaEnvironmentDefinitions = {
    DB_FILE_NAME: env.string({ defaultValue: defaultDatabaseFileName }),
    POSTDOT_MEDIA_STORE: env.enum(['local', 's3'], { defaultValue: 'local' }),
    POSTDOT_MEDIA_DIRECTORY: env.string({ defaultValue: defaultMediaDirectory, minLength: 1 }),
    POSTDOT_MEDIA_STORE_ID: env.string({ defaultValue: 'local-default', minLength: 1 }),
    POSTDOT_MEDIA_MAX_OBJECT_BYTES: env.integer({
        defaultValue: 100_000_000,
        minimum: 1,
    }),
    POSTDOT_MEDIA_UPLOAD_TTL_MS: env.integer({
        defaultValue: 15 * 60 * 1_000,
        minimum: 1,
    }),
    POSTDOT_MEDIA_DELETION_GRACE_MS: env.integer({
        defaultValue: 24 * 60 * 60 * 1_000,
        minimum: 0,
    }),
    POSTDOT_MEDIA_PUBLIC_URL_TTL_MS: env.integer({
        defaultValue: mediaPublicDeliveryLimits.defaultLifetimeMs,
        minimum: 60 * 1_000,
        maximum: mediaPublicDeliveryLimits.maximumLifetimeMs,
    }),
    POSTDOT_MEDIA_S3_BUCKET: env.optionalString({ minLength: 1 }),
    POSTDOT_MEDIA_S3_REGION: env.optionalString({ minLength: 1 }),
    POSTDOT_MEDIA_S3_ENDPOINT: env.optionalString({ minLength: 1 }),
    POSTDOT_MEDIA_S3_ACCESS_KEY_ID: env.optionalString({ minLength: 1 }),
    POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY: env.optionalString({ minLength: 1 }),
    POSTDOT_MEDIA_S3_SESSION_TOKEN: env.optionalString({ minLength: 1 }),
    POSTDOT_MEDIA_S3_PREFIX: env.optionalString({ minLength: 1 }),
} as const

const environmentDefinitions = {
    NODE_ENV: env.enum(['development', 'test', 'production'], {
        defaultValue: 'development',
    }),
    PORT: env.integer({ defaultValue: 3000, minimum: 1, maximum: 65_535 }),
    POSTDOT_MIGRATIONS_DIR: env.string({ defaultValue: defaultMigrationsDirectory }),
    POSTDOT_WEB_ASSETS_DIR: env.string({ defaultValue: defaultWebAssetsDirectory }),
    ...mediaEnvironmentDefinitions,
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
    POSTDOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION: env.boolean({
        defaultValue: false,
    }),
    POSTDOT_EMAIL_SMTP_HOST: env.optionalString({ minLength: 1 }),
    POSTDOT_EMAIL_SMTP_PORT: env.optionalInteger({ minimum: 1, maximum: 65_535 }),
    POSTDOT_EMAIL_SMTP_SECURE: env.boolean({ defaultValue: false }),
    POSTDOT_EMAIL_SMTP_USERNAME: env.optionalString({ minLength: 1 }),
    POSTDOT_EMAIL_SMTP_PASSWORD: env.optionalString({ minLength: 1 }),
    POSTDOT_EMAIL_FROM: env.optionalString({ minLength: 1 }),
    POSTDOT_MEDIA_PUBLIC_URL_SECRET: env.secret({ example: exampleMediaPublicUrlSecret }),
    POSTDOT_PUBLISHER_ENCRYPTION_KEY: env.hexSecret({ example: examplePublisherEncryptionKey }),
    POSTDOT_PUBLISHER_ENCRYPTION_KEY_ID: env.string({ defaultValue: 'v1', minLength: 1 }),
    LINKEDIN_CLIENT_ID: env.optionalString({ minLength: 1 }),
    LINKEDIN_CLIENT_SECRET: env.optionalString({ minLength: 1 }),
    BLUESKY_CLIENT_METADATA_URL: env.optionalString({ minLength: 1 }),
    BLUESKY_HANDLE_RESOLVER: env.url({ defaultValue: 'https://bsky.social' }),
    X_CLIENT_ID: env.optionalString({ minLength: 1 }),
    X_CLIENT_SECRET: env.optionalString({ minLength: 1 }),
    POSTDOT_WEB_ORIGIN: env.url({ defaultValue: 'http://localhost:5173' }),
    POSTDOT_OUTBOUND_PRIVATE_DESTINATIONS: env.optionalString(),
    POSTDOT_METRICS_ENABLED: env.boolean({ defaultValue: false }),
    POSTDOT_MCP_ENABLED: env.boolean({ defaultValue: true }),
    POSTDOT_METRICS_TOKEN: env.optionalString(),
    LOG_LEVEL: env.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
        defaultValue: values => (values.NODE_ENV === 'production' ? 'error' : 'info'),
    }),
    LOG_PRETTY: env.boolean({
        defaultValue: values => values.NODE_ENV !== 'production',
    }),
} as const

type PostdotEnvironment = InferEnvironment<typeof environmentDefinitions>

export interface PostdotLoggingConfig {
    readonly enabled: boolean
    readonly level: LevelWithSilent
    readonly pretty: boolean
}

export interface PostdotConfig {
    readonly environment: PostdotEnvironment['NODE_ENV']
    readonly server: {
        readonly port: number
    }
    readonly database: {
        readonly fileName: string
        readonly migrationsDirectory: string
    }
    readonly media: {
        readonly driver: 'local' | 's3'
        readonly directory: string
        readonly storeId: string
        readonly maxObjectBytes: number
        readonly uploadIntentTtlMs: number
        readonly deletionGracePeriodMs: number
        readonly publicUrlLifetimeMs: number
        readonly s3?: {
            readonly bucket: string
            readonly region?: string
            readonly endpoint?: string
            readonly accessKeyId: string
            readonly secretAccessKey: string
            readonly sessionToken?: string
            readonly prefix?: string
        }
    }
    readonly auth: {
        readonly baseURL: string
        readonly secret: string
        readonly requireEmailVerificationOnInvitation: boolean
    }
    readonly email?: {
        readonly smtp: {
            readonly host: string
            readonly port: number
            readonly secure: boolean
            readonly from: string
            readonly username?: string
            readonly password?: string
        }
    }
    readonly security: {
        readonly mediaPublicUrlSecret: string
        readonly publisherEncryptionKey: string
        readonly publisherEncryptionKeyId: string
    }
    readonly publishers: {
        readonly linkedin?: {
            readonly clientId: string
            readonly clientSecret: string
        }
        readonly bluesky?: {
            readonly clientMetadataUrl: string
            readonly handleResolver: string
        }
        readonly x?: {
            readonly clientId: string
            readonly clientSecret: string
        }
    }
    readonly network: {
        readonly privateDestinations: readonly PrivateDestinationRule[]
    }
    readonly metrics?: {
        readonly bearerToken: string
    }
    readonly mcp: {
        readonly enabled: boolean
    }
    readonly web: {
        readonly origin: string
        readonly assetsDirectory: string
    }
    readonly logging: PostdotLoggingConfig
}

export interface PostdotMaintenanceConfig {
    readonly databaseFileName: string
    readonly media: PostdotConfig['media']
}

type PostdotMediaEnvironment = Omit<
    InferEnvironment<typeof mediaEnvironmentDefinitions>,
    'DB_FILE_NAME'
>

export function createPostdotBootstrapConfig(source: EnvironmentSource = Bun.env) {
    return createEnvironment(
        {
            POSTDOT_MIGRATIONS_DIR: environmentDefinitions.POSTDOT_MIGRATIONS_DIR,
        },
        source
    )
}

export function createPostdotMaintenanceConfig(
    source: EnvironmentSource = Bun.env
): PostdotMaintenanceConfig {
    const environment = createEnvironment(mediaEnvironmentDefinitions, source)
    return {
        databaseFileName: environment.DB_FILE_NAME,
        media: createMediaConfig(environment),
    }
}

export function createPostdotConfig(source: EnvironmentSource = Bun.env): PostdotConfig {
    const environment = createEnvironment(environmentDefinitions, source)
    if (environment.POSTDOT_METRICS_ENABLED && environment.POSTDOT_METRICS_TOKEN === undefined) {
        throw new Error('POSTDOT_METRICS_TOKEN is required when POSTDOT_METRICS_ENABLED=true')
    }
    if (environment.POSTDOT_METRICS_ENABLED && environment.POSTDOT_METRICS_TOKEN!.length < 32) {
        throw new Error('POSTDOT_METRICS_TOKEN must contain at least 32 characters')
    }
    const hasLinkedInClientId = environment.LINKEDIN_CLIENT_ID !== undefined
    const hasLinkedInClientSecret = environment.LINKEDIN_CLIENT_SECRET !== undefined

    if (hasLinkedInClientId !== hasLinkedInClientSecret) {
        throw new Error(
            'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set together to enable LinkedIn'
        )
    }

    const hasXClientId = environment.X_CLIENT_ID !== undefined
    const hasXClientSecret = environment.X_CLIENT_SECRET !== undefined

    if (hasXClientId !== hasXClientSecret) {
        throw new Error('X_CLIENT_ID and X_CLIENT_SECRET must be set together to enable X')
    }

    const linkedin =
        hasLinkedInClientId && hasLinkedInClientSecret
            ? {
                  clientId: environment.LINKEDIN_CLIENT_ID,
                  clientSecret: environment.LINKEDIN_CLIENT_SECRET,
              }
            : undefined
    const x =
        hasXClientId && hasXClientSecret
            ? {
                  clientId: environment.X_CLIENT_ID,
                  clientSecret: environment.X_CLIENT_SECRET,
              }
            : undefined
    const bluesky =
        environment.BLUESKY_CLIENT_METADATA_URL === undefined
            ? undefined
            : (() => {
                  validateHttpsUrl(
                      environment.BLUESKY_CLIENT_METADATA_URL!,
                      'BLUESKY_CLIENT_METADATA_URL'
                  )
                  const authUrl = new URL(environment.BETTER_AUTH_URL)
                  if (authUrl.protocol === 'http:' && authUrl.hostname === 'localhost') {
                      throw new Error(
                          'BETTER_AUTH_URL must use 127.0.0.1 or HTTPS when Bluesky OAuth is enabled'
                      )
                  }
                  return {
                      clientMetadataUrl: environment.BLUESKY_CLIENT_METADATA_URL!,
                      handleResolver: environment.BLUESKY_HANDLE_RESOLVER,
                  }
              })()
    const outboundPrivateDestinations = parsePrivateDestinationRules(
        environment.POSTDOT_OUTBOUND_PRIVATE_DESTINATIONS,
        'POSTDOT_OUTBOUND_PRIVATE_DESTINATIONS'
    )
    const email = createEmailConfig(environment)
    if (environment.POSTDOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION && email === undefined) {
        throw new Error(
            'POSTDOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION requires a configured email transport'
        )
    }

    return {
        environment: environment.NODE_ENV,
        server: {
            port: environment.PORT,
        },
        database: {
            fileName: environment.DB_FILE_NAME,
            migrationsDirectory: environment.POSTDOT_MIGRATIONS_DIR,
        },
        media: createMediaConfig(environment),
        auth: {
            baseURL: environment.BETTER_AUTH_URL,
            secret: environment.BETTER_AUTH_SECRET,
            requireEmailVerificationOnInvitation:
                environment.POSTDOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION,
        },
        ...(email === undefined ? {} : { email }),
        security: {
            mediaPublicUrlSecret: environment.POSTDOT_MEDIA_PUBLIC_URL_SECRET,
            publisherEncryptionKey: environment.POSTDOT_PUBLISHER_ENCRYPTION_KEY,
            publisherEncryptionKeyId: environment.POSTDOT_PUBLISHER_ENCRYPTION_KEY_ID,
        },
        publishers: {
            ...(linkedin === undefined ? {} : { linkedin }),
            ...(bluesky === undefined ? {} : { bluesky }),
            ...(x === undefined ? {} : { x }),
        },
        network: {
            privateDestinations: outboundPrivateDestinations,
        },
        web: {
            origin: environment.POSTDOT_WEB_ORIGIN,
            assetsDirectory: environment.POSTDOT_WEB_ASSETS_DIR,
        },
        logging: {
            enabled: environment.LOG_LEVEL !== 'silent',
            level: environment.LOG_LEVEL,
            pretty: environment.LOG_PRETTY,
        },
        ...(environment.POSTDOT_METRICS_ENABLED
            ? { metrics: { bearerToken: environment.POSTDOT_METRICS_TOKEN! } }
            : {}),
        mcp: { enabled: environment.POSTDOT_MCP_ENABLED },
    }
}

function createMediaConfig(environment: PostdotMediaEnvironment): PostdotConfig['media'] {
    const mediaS3Values = {
        bucket: environment.POSTDOT_MEDIA_S3_BUCKET,
        region: environment.POSTDOT_MEDIA_S3_REGION,
        endpoint: environment.POSTDOT_MEDIA_S3_ENDPOINT,
        accessKeyId: environment.POSTDOT_MEDIA_S3_ACCESS_KEY_ID,
        secretAccessKey: environment.POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY,
        sessionToken: environment.POSTDOT_MEDIA_S3_SESSION_TOKEN,
        prefix: environment.POSTDOT_MEDIA_S3_PREFIX,
    }

    if (environment.POSTDOT_MEDIA_STORE === 's3') {
        if (
            mediaS3Values.bucket === undefined ||
            mediaS3Values.accessKeyId === undefined ||
            mediaS3Values.secretAccessKey === undefined
        ) {
            throw new Error(
                'POSTDOT_MEDIA_S3_BUCKET, POSTDOT_MEDIA_S3_ACCESS_KEY_ID, and POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY are required when POSTDOT_MEDIA_STORE=s3'
            )
        }
        if (mediaS3Values.region === undefined && mediaS3Values.endpoint === undefined) {
            throw new Error(
                'POSTDOT_MEDIA_S3_REGION or POSTDOT_MEDIA_S3_ENDPOINT is required when POSTDOT_MEDIA_STORE=s3'
            )
        }
    }

    return {
        driver: environment.POSTDOT_MEDIA_STORE,
        directory: environment.POSTDOT_MEDIA_DIRECTORY,
        storeId: environment.POSTDOT_MEDIA_STORE_ID,
        maxObjectBytes: environment.POSTDOT_MEDIA_MAX_OBJECT_BYTES,
        uploadIntentTtlMs: environment.POSTDOT_MEDIA_UPLOAD_TTL_MS,
        deletionGracePeriodMs: environment.POSTDOT_MEDIA_DELETION_GRACE_MS,
        publicUrlLifetimeMs: environment.POSTDOT_MEDIA_PUBLIC_URL_TTL_MS,
        ...(environment.POSTDOT_MEDIA_STORE === 's3' && mediaS3Values.bucket !== undefined
            ? {
                  s3: {
                      bucket: mediaS3Values.bucket,
                      ...(mediaS3Values.region === undefined
                          ? {}
                          : { region: mediaS3Values.region }),
                      ...(mediaS3Values.endpoint === undefined
                          ? {}
                          : { endpoint: mediaS3Values.endpoint }),
                      accessKeyId: mediaS3Values.accessKeyId!,
                      secretAccessKey: mediaS3Values.secretAccessKey!,
                      ...(mediaS3Values.sessionToken === undefined
                          ? {}
                          : { sessionToken: mediaS3Values.sessionToken }),
                      ...(mediaS3Values.prefix === undefined
                          ? {}
                          : { prefix: mediaS3Values.prefix }),
                  },
              }
            : {}),
    }
}

function createEmailConfig(environment: PostdotEnvironment): PostdotConfig['email'] | undefined {
    const hasEmailConfiguration =
        environment.POSTDOT_EMAIL_SMTP_HOST !== undefined ||
        environment.POSTDOT_EMAIL_SMTP_PORT !== undefined ||
        environment.POSTDOT_EMAIL_SMTP_SECURE ||
        environment.POSTDOT_EMAIL_SMTP_USERNAME !== undefined ||
        environment.POSTDOT_EMAIL_SMTP_PASSWORD !== undefined ||
        environment.POSTDOT_EMAIL_FROM !== undefined

    if (!hasEmailConfiguration) return undefined

    if (environment.POSTDOT_EMAIL_SMTP_HOST === undefined) {
        throw new Error(
            'POSTDOT_EMAIL_SMTP_HOST is required when email transport configuration is present'
        )
    }
    if (environment.POSTDOT_EMAIL_FROM === undefined) {
        throw new Error('POSTDOT_EMAIL_FROM is required when SMTP email delivery is enabled')
    }

    const hasUsername = environment.POSTDOT_EMAIL_SMTP_USERNAME !== undefined
    const hasPassword = environment.POSTDOT_EMAIL_SMTP_PASSWORD !== undefined
    if (hasUsername !== hasPassword) {
        throw new Error(
            'POSTDOT_EMAIL_SMTP_USERNAME and POSTDOT_EMAIL_SMTP_PASSWORD must be set together'
        )
    }

    return {
        smtp: {
            host: environment.POSTDOT_EMAIL_SMTP_HOST,
            port: environment.POSTDOT_EMAIL_SMTP_PORT ?? 587,
            secure: environment.POSTDOT_EMAIL_SMTP_SECURE,
            from: environment.POSTDOT_EMAIL_FROM,
            ...(hasUsername
                ? {
                      username: environment.POSTDOT_EMAIL_SMTP_USERNAME!,
                      password: environment.POSTDOT_EMAIL_SMTP_PASSWORD!,
                  }
                : {}),
        },
    }
}

function validateHttpUrl(value: string, variableName: string): void {
    let parsed: URL
    try {
        parsed = new URL(value)
    } catch {
        throw new Error(`${variableName} must be an absolute URL`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${variableName} must use http or https`)
    }
}

function validateHttpsUrl(value: string, variableName: string): void {
    validateHttpUrl(value, variableName)
    if (new URL(value).protocol !== 'https:') {
        throw new Error(`${variableName} must use https`)
    }
}

export function decodeHexKey(value: string): Uint8Array {
    if (!/^[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error('Publisher encryption key must be 64 hexadecimal characters')
    }

    const key = new Uint8Array(32)
    for (let index = 0; index < key.length; index += 1) {
        key[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    }
    return key
}
