import { describe, expect, it } from 'bun:test'

import {
    createPostdotConfig,
    createPostdotMaintenanceConfig,
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
            },
            web: {
                origin: 'http://localhost:5173',
                assetsDirectory: '/tmp/postdot-web',
            },
            logging: {
                enabled: true,
                level: 'debug',
                pretty: false,
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
            web: { origin: 'http://localhost:5173' },
            logging: { enabled: true, level: 'info', pretty: true },
        })
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
