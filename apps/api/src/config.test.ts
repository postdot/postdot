import { describe, expect, it } from 'bun:test'

import {
    createPostdotConfig,
    createPostdotMaintenanceConfig,
    createPostdotTransferConfig,
    defaultMediaDirectory,
} from './config'

const secret = 'postdot-test-secret-with-at-least-32-characters'
const mediaPublicUrlSecret = 'postdot-media-public-url-secret-with-at-least-32-characters'
const publisherEncryptionKey = '0123456789abcdef'.repeat(4)

describe('Postdot configuration', () => {
    it('parses environment variables into one normalized configuration', () => {
        expect(
            createPostdotConfig({
                NODE_ENV: 'development',
                PORT: '3100',
                DB_FILE_NAME: ':memory:',
                POSTDOT_MIGRATIONS_DIR: '/tmp/postdot-migrations',
                POSTDOT_WEB_ASSETS_DIR: '/tmp/postdot-web',
                BETTER_AUTH_URL: 'http://localhost:3100/some-path',
                BETTER_AUTH_SECRET: secret,
                POSTDOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION: 'true',
                POSTDOT_EMAIL_SMTP_HOST: 'smtp.example.test',
                POSTDOT_EMAIL_SMTP_PORT: '2525',
                POSTDOT_EMAIL_SMTP_SECURE: 'true',
                POSTDOT_EMAIL_SMTP_USERNAME: 'smtp-user',
                POSTDOT_EMAIL_SMTP_PASSWORD: 'smtp-password',
                POSTDOT_EMAIL_FROM: 'Postdot <no-reply@example.test>',
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_WEB_ORIGIN: 'http://localhost:5173/dashboard',
                LOG_LEVEL: 'debug',
                LOG_PRETTY: 'false',
            })
        ).toEqual({
            environment: 'development',
            server: {
                port: 3100,
            },
            database: {
                engine: 'sqlite',
                fileName: ':memory:',
                migrationsDirectory: '/tmp/postdot-migrations',
            },
            media: {
                driver: 'local',
                directory: defaultMediaDirectory,
                storeId: 'local-default',
                maxObjectBytes: 100_000_000,
                uploadIntentTtlMs: 900_000,
                deletionGracePeriodMs: 86_400_000,
                publicUrlLifetimeMs: 900_000,
            },
            auth: {
                baseURL: 'http://localhost:3100',
                secret,
                requireEmailVerificationOnInvitation: true,
            },
            email: {
                smtp: {
                    host: 'smtp.example.test',
                    port: 2525,
                    secure: true,
                    from: 'Postdot <no-reply@example.test>',
                    username: 'smtp-user',
                    password: 'smtp-password',
                },
            },
            security: {
                mediaPublicUrlSecret,
                publisherEncryptionKey,
                publisherEncryptionKeyId: 'v1',
            },
            publishers: {},
            network: {
                privateDestinations: [],
                trustedProxies: [],
            },
            mcp: { enabled: true },
            web: {
                enabled: true,
                origin: 'http://localhost:5173',
                assetsDirectory: '/tmp/postdot-web',
            },
            logging: {
                enabled: true,
                level: 'debug',
                pretty: false,
            },
            bootstrap: {
                mode: 'open',
            },
        })
    })

    it('derives development defaults from the environment', () => {
        expect(
            createPostdotConfig({
                PORT: '3200',
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            })
        ).toMatchObject({
            environment: 'development',
            server: { port: 3200 },
            auth: { baseURL: 'http://localhost:3200' },
            web: { enabled: true, origin: 'http://localhost:5173' },
            logging: { enabled: true, level: 'info', pretty: true },
        })
    })

    it('disables only Studio asset serving explicitly and rejects malformed flags', () => {
        const base = {
            NODE_ENV: 'production',
            BETTER_AUTH_URL: 'https://postdot.example.test',
            POSTDOT_WEB_ORIGIN: 'https://postdot.example.test',
            BETTER_AUTH_SECRET: secret,
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
            POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
        }
        expect(createPostdotConfig(base).web.enabled).toBe(true)
        expect(createPostdotConfig({ ...base, POSTDOT_WEB_ENABLED: 'false' }).web).toMatchObject({
            enabled: false,
            origin: base.POSTDOT_WEB_ORIGIN,
        })
        expect(() => createPostdotConfig({ ...base, POSTDOT_WEB_ENABLED: 'disabled' })).toThrow(
            'POSTDOT_WEB_ENABLED'
        )
    })

    it('validates trusted proxy configuration independently of public origins', () => {
        const base = {
            BETTER_AUTH_SECRET: secret,
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
            POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
        }
        const config = createPostdotConfig({ ...base, POSTDOT_TRUSTED_PROXIES: '127.0.0.1/32,::1' })
        expect(config.network.trustedProxies).toEqual(['127.0.0.1/32', '::1'])
        expect(config.auth.baseURL).toBe('http://localhost:3000')
        for (const value of ['*', '0.0.0.0/0', 'proxy.example.test', '127.0.0.1,'])
            expect(() => createPostdotConfig({ ...base, POSTDOT_TRUSTED_PROXIES: value })).toThrow(
                'POSTDOT_TRUSTED_PROXIES'
            )
    })

    it('selects PostgreSQL when a database URL is configured', () => {
        const base = {
            BETTER_AUTH_SECRET: secret,
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
            POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
        }
        expect(
            createPostdotConfig({
                ...base,
                POSTDOT_DATABASE_URL: 'postgres://postdot@db.internal:5432/postdot',
                POSTDOT_DATABASE_POOL_SIZE: '4',
            }).database
        ).toEqual({
            engine: 'postgres',
            url: 'postgres://postdot@db.internal:5432/postdot',
            poolSize: 4,
            migrationsDirectory: expect.any(String),
        })
        // The image always sets DB_FILE_NAME; a PostgreSQL URL takes precedence.
        expect(
            createPostdotConfig({
                ...base,
                POSTDOT_DATABASE_URL: 'postgres://postdot@db.internal/postdot',
                DB_FILE_NAME: '/data/postdot.sqlite',
            }).database
        ).toMatchObject({ engine: 'postgres' })
        expect(() =>
            createPostdotConfig({ ...base, POSTDOT_DATABASE_URL: 'mysql://db.internal/postdot' })
        ).toThrow('postgres:// or postgresql://')
        expect(() =>
            createPostdotMaintenanceConfig({
                POSTDOT_DATABASE_URL: 'postgres://postdot@db.internal/postdot',
            })
        ).toThrow('pg_dump')
    })

    it('reads the transfer target from the usual variables and its media source from SOURCE_ variables', () => {
        const target = createPostdotTransferConfig({
            POSTDOT_DATABASE_URL: 'postgres://postdot@db.internal/postdot',
            POSTDOT_MEDIA_STORE: 's3',
            POSTDOT_MEDIA_STORE_ID: 'shared-media',
            POSTDOT_MEDIA_S3_BUCKET: 'postdot',
            POSTDOT_MEDIA_S3_REGION: 'eu-west-3',
            POSTDOT_MEDIA_S3_ACCESS_KEY_ID: 'key',
            POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY: 'secret',
            SOURCE_POSTDOT_MEDIA_STORE: 'local',
            SOURCE_POSTDOT_MEDIA_STORE_ID: 'local-default',
            SOURCE_POSTDOT_MEDIA_DIRECTORY: '/data/media',
        })
        expect(target.database).toMatchObject({ engine: 'postgres' })
        expect(target.media).toMatchObject({ driver: 's3', storeId: 'shared-media' })
        expect(target.sourceMedia).toMatchObject({
            driver: 'local',
            storeId: 'local-default',
            directory: '/data/media',
        })
        expect(createPostdotTransferConfig({}).sourceMedia).toBeUndefined()
        // The source is never guessed from defaults.
        expect(() => createPostdotTransferConfig({ SOURCE_POSTDOT_MEDIA_STORE: 'local' })).toThrow(
            'SOURCE_POSTDOT_MEDIA_STORE_ID'
        )
    })

    it('keeps Prometheus metrics disabled by default and requires a dedicated token to enable them', () => {
        const requiredSecrets = {
            BETTER_AUTH_SECRET: secret,
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
            POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
        }

        expect(createPostdotConfig(requiredSecrets).metrics).toBeUndefined()
        expect(
            createPostdotConfig({
                ...requiredSecrets,
                POSTDOT_METRICS_TOKEN: 'stale-token-ignored-while-disabled',
            }).metrics
        ).toBeUndefined()
        expect(() =>
            createPostdotConfig({
                ...requiredSecrets,
                POSTDOT_METRICS_ENABLED: 'true',
            })
        ).toThrow('POSTDOT_METRICS_TOKEN is required')
        expect(() =>
            createPostdotConfig({
                ...requiredSecrets,
                POSTDOT_METRICS_ENABLED: 'true',
                POSTDOT_METRICS_TOKEN: 'short-token',
            })
        ).toThrow('POSTDOT_METRICS_TOKEN')

        const token = 'postdot-monitoring-token-for-tests-more-than-32-characters'
        expect(
            createPostdotConfig({
                ...requiredSecrets,
                POSTDOT_METRICS_ENABLED: 'true',
                POSTDOT_METRICS_TOKEN: token,
            }).metrics
        ).toEqual({ bearerToken: token })
    })

    it('keeps email delivery optional and rejects incomplete SMTP configuration', () => {
        expect(
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            }).email
        ).toBeUndefined()

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_EMAIL_FROM: 'Postdot <no-reply@example.test>',
            })
        ).toThrow('POSTDOT_EMAIL_SMTP_HOST')

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_EMAIL_SMTP_HOST: 'smtp.example.test',
                POSTDOT_EMAIL_SMTP_USERNAME: 'smtp-user',
            })
        ).toThrow('POSTDOT_EMAIL_FROM')

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_EMAIL_SMTP_HOST: 'smtp.example.test',
                POSTDOT_EMAIL_FROM: 'Postdot <no-reply@example.test>',
                POSTDOT_EMAIL_SMTP_USERNAME: 'smtp-user',
            })
        ).toThrow('POSTDOT_EMAIL_SMTP_USERNAME and POSTDOT_EMAIL_SMTP_PASSWORD')

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION: 'true',
            })
        ).toThrow('requires a configured email transport')
    })

    it('parses operator-owned private outbound destinations', () => {
        expect(
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_OUTBOUND_PRIVATE_DESTINATIONS: JSON.stringify([
                    {
                        kind: 'cidr',
                        cidr: '10.0.0.0/8',
                        port: 8080,
                        schemes: ['http'],
                    },
                ]),
            }).network.privateDestinations
        ).toEqual([
            {
                kind: 'cidr',
                cidr: '10.0.0.0/8',
                port: 8080,
                schemes: ['http'],
            },
        ])

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_OUTBOUND_PRIVATE_DESTINATIONS: '{not-json}',
            })
        ).toThrow('POSTDOT_OUTBOUND_PRIVATE_DESTINATIONS')
    })

    it('logs server errors by default in production without logging successful requests', () => {
        expect(
            createPostdotConfig({
                NODE_ENV: 'production',
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            }).logging
        ).toEqual({
            enabled: true,
            level: 'error',
            pretty: false,
        })
    })

    it('allows operators to explicitly disable all logging', () => {
        expect(
            createPostdotConfig({
                NODE_ENV: 'production',
                LOG_LEVEL: 'silent',
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            }).logging
        ).toEqual({
            enabled: false,
            level: 'silent',
            pretty: false,
        })
    })

    it('normalizes an S3-compatible media store without changing the domain contract', () => {
        expect(
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_MEDIA_STORE: 's3',
                POSTDOT_MEDIA_STORE_ID: 'r2-primary',
                POSTDOT_MEDIA_S3_BUCKET: 'postdot-media',
                POSTDOT_MEDIA_S3_ENDPOINT: 'https://r2.example.test',
                POSTDOT_MEDIA_S3_ACCESS_KEY_ID: 'access-key',
                POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
                POSTDOT_MEDIA_S3_PREFIX: 'production',
            }).media
        ).toEqual({
            driver: 's3',
            directory: defaultMediaDirectory,
            storeId: 'r2-primary',
            maxObjectBytes: 100_000_000,
            uploadIntentTtlMs: 900_000,
            deletionGracePeriodMs: 86_400_000,
            publicUrlLifetimeMs: 900_000,
            s3: {
                bucket: 'postdot-media',
                endpoint: 'https://r2.example.test',
                accessKeyId: 'access-key',
                secretAccessKey: 'secret-key',
                prefix: 'production',
            },
        })
    })

    it('requires complete S3 media credentials and a region or endpoint', () => {
        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_MEDIA_STORE: 's3',
            })
        ).toThrow('POSTDOT_MEDIA_S3_BUCKET')

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                POSTDOT_MEDIA_STORE: 's3',
                POSTDOT_MEDIA_S3_BUCKET: 'postdot-media',
                POSTDOT_MEDIA_S3_ACCESS_KEY_ID: 'access-key',
                POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
            })
        ).toThrow('POSTDOT_MEDIA_S3_REGION or POSTDOT_MEDIA_S3_ENDPOINT')
    })

    it('reports missing and invalid environment variables together', () => {
        expect(() => createPostdotConfig({})).toThrow('BETTER_AUTH_SECRET is required')
        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: 'not-long-enough',
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            })
        ).toThrow('BETTER_AUTH_SECRET')
        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                PORT: '70000',
                LOG_PRETTY: 'sometimes',
            })
        ).toThrow('PORT')
    })

    it('rejects the example secret and invalid URLs', () => {
        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters',
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            })
        ).toThrow('replace the example placeholder')
        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                BETTER_AUTH_URL: 'sqlite://local',
            })
        ).toThrow('BETTER_AUTH_URL')
    })

    it('keeps LinkedIn publisher configuration separate from application authentication', () => {
        expect(
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                LINKEDIN_CLIENT_ID: '',
                LINKEDIN_CLIENT_SECRET: '   ',
            }).publishers.linkedin
        ).toBeUndefined()

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                LINKEDIN_CLIENT_ID: 'client-id',
            })
        ).toThrow('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set together')
    })

    it('normalizes the optional LinkedIn publisher configuration', () => {
        expect(
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                LINKEDIN_CLIENT_ID: ' client-id ',
                LINKEDIN_CLIENT_SECRET: ' client-secret ',
            }).publishers.linkedin
        ).toEqual({
            clientId: 'client-id',
            clientSecret: 'client-secret',
        })
    })

    it('normalizes the optional Bluesky OAuth client metadata configuration', () => {
        expect(
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                BETTER_AUTH_URL: 'https://api.example.test',
                BLUESKY_CLIENT_METADATA_URL:
                    'https://app.example.test/oauth/bluesky/client-metadata.json',
                BLUESKY_HANDLE_RESOLVER: 'https://bsky.example.test',
            }).publishers.bluesky
        ).toEqual({
            clientMetadataUrl: 'https://app.example.test/oauth/bluesky/client-metadata.json',
            handleResolver: 'https://bsky.example.test',
        })

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                BLUESKY_CLIENT_METADATA_URL: 'http://localhost:3000/oauth/client-metadata.json',
            })
        ).toThrow('BLUESKY_CLIENT_METADATA_URL must use https')

        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                BLUESKY_CLIENT_METADATA_URL: 'https://app.example.test/oauth/client-metadata.json',
            })
        ).toThrow('BETTER_AUTH_URL must use 127.0.0.1 or HTTPS')
    })

    it('rejects an invalid publisher encryption key', () => {
        expect(() =>
            createPostdotConfig({
                BETTER_AUTH_SECRET: secret,
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: 'not-a-hex-key',
            })
        ).toThrow('POSTDOT_PUBLISHER_ENCRYPTION_KEY')
    })

    it('defaults bootstrap mode to open outside production and token_required in production', () => {
        const base = {
            BETTER_AUTH_SECRET: secret,
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
            POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
        }

        expect(createPostdotConfig(base).bootstrap).toEqual({ mode: 'open' })
        expect(createPostdotConfig({ ...base, NODE_ENV: 'production' }).bootstrap).toEqual({
            mode: 'token_required',
        })
        expect(
            createPostdotConfig({
                ...base,
                NODE_ENV: 'production',
                POSTDOT_BOOTSTRAP_MODE: 'open',
            }).bootstrap
        ).toEqual({ mode: 'open' })
        expect(
            createPostdotConfig({
                ...base,
                POSTDOT_BOOTSTRAP_TOKEN: 'setup-token-with-enough-length',
            }).bootstrap
        ).toEqual({
            mode: 'token_required',
            token: 'setup-token-with-enough-length',
        })
        expect(
            createPostdotConfig({
                ...base,
                POSTDOT_BOOTSTRAP_TOKEN_HASH: `SHA256:${'ab'.repeat(32)}`,
            }).bootstrap
        ).toEqual({
            mode: 'token_required',
            tokenHash: 'ab'.repeat(32),
        })
    })

    it('rejects conflicting bootstrap token sources and open mode with a token', () => {
        const base = {
            BETTER_AUTH_SECRET: secret,
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
            POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
        }

        expect(() =>
            createPostdotConfig({
                ...base,
                POSTDOT_BOOTSTRAP_TOKEN: 'setup-token-with-enough-length',
                POSTDOT_BOOTSTRAP_TOKEN_FILE: '/run/secrets/bootstrap-token',
            })
        ).toThrow('Specify at most one')

        expect(() =>
            createPostdotConfig({
                ...base,
                POSTDOT_BOOTSTRAP_MODE: 'open',
                POSTDOT_BOOTSTRAP_TOKEN: 'setup-token-with-enough-length',
            })
        ).toThrow('POSTDOT_BOOTSTRAP_MODE=open cannot be combined')

        expect(() =>
            createPostdotConfig({
                ...base,
                POSTDOT_BOOTSTRAP_TOKEN_HASH:
                    'not-a-valid-sha256-digest-at-all-not-even-64-hex-characters-long',
            })
        ).toThrow('POSTDOT_BOOTSTRAP_TOKEN_HASH')
    })
})

describe('Postdot maintenance configuration', () => {
    it('loads database and local media settings without requiring server secrets', () => {
        expect(
            createPostdotMaintenanceConfig({
                DB_FILE_NAME: '/data/postdot.sqlite',
                BETTER_AUTH_SECRET: 'unused',
                POSTDOT_MEDIA_PUBLIC_URL_SECRET: 'unused',
                POSTDOT_PUBLISHER_ENCRYPTION_KEY: 'unused',
            })
        ).toEqual({
            databaseFileName: '/data/postdot.sqlite',
            media: {
                driver: 'local',
                directory: defaultMediaDirectory,
                storeId: 'local-default',
                maxObjectBytes: 100_000_000,
                uploadIntentTtlMs: 900_000,
                deletionGracePeriodMs: 86_400_000,
                publicUrlLifetimeMs: 900_000,
            },
        })
    })

    it('retains and validates credentials required by the configured S3 media store', () => {
        expect(
            createPostdotMaintenanceConfig({
                DB_FILE_NAME: '/data/postdot.sqlite',
                POSTDOT_MEDIA_STORE: 's3',
                POSTDOT_MEDIA_S3_BUCKET: 'postdot-media',
                POSTDOT_MEDIA_S3_REGION: 'us-east-1',
                POSTDOT_MEDIA_S3_ACCESS_KEY_ID: 'access-key',
                POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
            }).media
        ).toMatchObject({
            driver: 's3',
            s3: {
                bucket: 'postdot-media',
                region: 'us-east-1',
                accessKeyId: 'access-key',
                secretAccessKey: 'secret-key',
            },
        })

        expect(() =>
            createPostdotMaintenanceConfig({
                POSTDOT_MEDIA_STORE: 's3',
                POSTDOT_MEDIA_S3_BUCKET: 'postdot-media',
            })
        ).toThrow(
            'POSTDOT_MEDIA_S3_BUCKET, POSTDOT_MEDIA_S3_ACCESS_KEY_ID, and POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY'
        )
    })
})

it('validates the optional deployment Instagram configuration ID without changing direct-login defaults', () => {
    const base = {
        BETTER_AUTH_SECRET: secret,
        POSTDOT_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
        POSTDOT_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
    }
    expect(createPostdotConfig(base).publishers.instagram).toBeUndefined()
    expect(
        createPostdotConfig({ ...base, POSTDOT_INSTAGRAM_CONFIG_ID: ' 123456 ' }).publishers
            .instagram
    ).toEqual({ configId: '123456' })
    for (const configId of ['0', '-1', '0123', '1.5', 'https://example.test'])
        expect(() =>
            createPostdotConfig({ ...base, POSTDOT_INSTAGRAM_CONFIG_ID: configId })
        ).toThrow('POSTDOT_INSTAGRAM_CONFIG_ID must be a positive numeric identifier')
})
