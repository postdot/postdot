import { describe, expect, it } from 'bun:test'

import { createHeraldConfig, createHeraldMaintenanceConfig, defaultMediaDirectory } from './config'

const secret = 'herald-test-secret-with-at-least-32-characters'
const mediaPublicUrlSecret = 'herald-media-public-url-secret-with-at-least-32-characters'
const publisherEncryptionKey = '0123456789abcdef'.repeat(4)

describe('Herald configuration', () => {
    it('parses environment variables into one normalized configuration', () => {
        expect(
            createHeraldConfig({
                NODE_ENV: 'development',
                PORT: '3100',
                DB_FILE_NAME: ':memory:',
                HERALD_MIGRATIONS_DIR: '/tmp/herald-migrations',
                HERALD_WEB_ASSETS_DIR: '/tmp/herald-web',
                BETTER_AUTH_URL: 'http://localhost:3100/some-path',
                BETTER_AUTH_SECRET: secret,
                HERALD_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION: 'true',
                HERALD_EMAIL_SMTP_HOST: 'smtp.example.test',
                HERALD_EMAIL_SMTP_PORT: '2525',
                HERALD_EMAIL_SMTP_SECURE: 'true',
                HERALD_EMAIL_SMTP_USERNAME: 'smtp-user',
                HERALD_EMAIL_SMTP_PASSWORD: 'smtp-password',
                HERALD_EMAIL_FROM: 'Herald <no-reply@example.test>',
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_WEB_ORIGIN: 'http://localhost:5173/dashboard',
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
                migrationsDirectory: '/tmp/herald-migrations',
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
                    from: 'Herald <no-reply@example.test>',
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
                assetsDirectory: '/tmp/herald-web',
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
            createHeraldConfig({
                PORT: '3200',
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
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
            HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
            HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
        }

        expect(createHeraldConfig(requiredSecrets).metrics).toBeUndefined()
        expect(
            createHeraldConfig({
                ...requiredSecrets,
                HERALD_METRICS_TOKEN: 'stale-token-ignored-while-disabled',
            }).metrics
        ).toBeUndefined()
        expect(() =>
            createHeraldConfig({
                ...requiredSecrets,
                HERALD_METRICS_ENABLED: 'true',
            })
        ).toThrow('HERALD_METRICS_TOKEN is required')
        expect(() =>
            createHeraldConfig({
                ...requiredSecrets,
                HERALD_METRICS_ENABLED: 'true',
                HERALD_METRICS_TOKEN: 'short-token',
            })
        ).toThrow('HERALD_METRICS_TOKEN')

        const token = 'herald-monitoring-token-for-tests-more-than-32-characters'
        expect(
            createHeraldConfig({
                ...requiredSecrets,
                HERALD_METRICS_ENABLED: 'true',
                HERALD_METRICS_TOKEN: token,
            }).metrics
        ).toEqual({ bearerToken: token })
    })

    it('keeps email delivery optional and rejects incomplete SMTP configuration', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            }).email
        ).toBeUndefined()

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_EMAIL_FROM: 'Herald <no-reply@example.test>',
            })
        ).toThrow('HERALD_EMAIL_SMTP_HOST')

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_EMAIL_SMTP_HOST: 'smtp.example.test',
                HERALD_EMAIL_SMTP_USERNAME: 'smtp-user',
            })
        ).toThrow('HERALD_EMAIL_FROM')

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_EMAIL_SMTP_HOST: 'smtp.example.test',
                HERALD_EMAIL_FROM: 'Herald <no-reply@example.test>',
                HERALD_EMAIL_SMTP_USERNAME: 'smtp-user',
            })
        ).toThrow('HERALD_EMAIL_SMTP_USERNAME and HERALD_EMAIL_SMTP_PASSWORD')

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION: 'true',
            })
        ).toThrow('requires a configured email transport')
    })

    it('parses operator-owned private outbound destinations', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_OUTBOUND_PRIVATE_DESTINATIONS: JSON.stringify([
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
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_OUTBOUND_PRIVATE_DESTINATIONS: '{not-json}',
            })
        ).toThrow('HERALD_OUTBOUND_PRIVATE_DESTINATIONS')
    })

    it('disables logging by default in production', () => {
        expect(
            createHeraldConfig({
                NODE_ENV: 'production',
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            }).logging
        ).toEqual({
            enabled: false,
            level: 'silent',
            pretty: false,
        })
    })

    it('normalizes an S3-compatible media store without changing the domain contract', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_MEDIA_STORE: 's3',
                HERALD_MEDIA_STORE_ID: 'r2-primary',
                HERALD_MEDIA_S3_BUCKET: 'herald-media',
                HERALD_MEDIA_S3_ENDPOINT: 'https://r2.example.test',
                HERALD_MEDIA_S3_ACCESS_KEY_ID: 'access-key',
                HERALD_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
                HERALD_MEDIA_S3_PREFIX: 'production',
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
                bucket: 'herald-media',
                endpoint: 'https://r2.example.test',
                accessKeyId: 'access-key',
                secretAccessKey: 'secret-key',
                prefix: 'production',
            },
        })
    })

    it('requires complete S3 media credentials and a region or endpoint', () => {
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_MEDIA_STORE: 's3',
            })
        ).toThrow('HERALD_MEDIA_S3_BUCKET')

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                HERALD_MEDIA_STORE: 's3',
                HERALD_MEDIA_S3_BUCKET: 'herald-media',
                HERALD_MEDIA_S3_ACCESS_KEY_ID: 'access-key',
                HERALD_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
            })
        ).toThrow('HERALD_MEDIA_S3_REGION or HERALD_MEDIA_S3_ENDPOINT')
    })

    it('reports missing and invalid environment variables together', () => {
        expect(() => createHeraldConfig({})).toThrow('BETTER_AUTH_SECRET is required')
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: 'not-long-enough',
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            })
        ).toThrow('BETTER_AUTH_SECRET')
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                PORT: '70000',
                LOG_PRETTY: 'sometimes',
            })
        ).toThrow('PORT')
    })

    it('rejects the example secret and invalid URLs', () => {
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters',
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            })
        ).toThrow('replace the example placeholder')
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                BETTER_AUTH_URL: 'sqlite://local',
            })
        ).toThrow('BETTER_AUTH_URL')
    })

    it('keeps LinkedIn publisher configuration separate from application authentication', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                LINKEDIN_CLIENT_ID: '',
                LINKEDIN_CLIENT_SECRET: '   ',
            }).publishers.linkedin
        ).toBeUndefined()

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                LINKEDIN_CLIENT_ID: 'client-id',
            })
        ).toThrow('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set together')
    })

    it('normalizes the optional LinkedIn publisher configuration', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
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
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
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
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                BLUESKY_CLIENT_METADATA_URL: 'http://localhost:3000/oauth/client-metadata.json',
            })
        ).toThrow('BLUESKY_CLIENT_METADATA_URL must use https')

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                BLUESKY_CLIENT_METADATA_URL: 'https://app.example.test/oauth/client-metadata.json',
            })
        ).toThrow('BETTER_AUTH_URL must use 127.0.0.1 or HTTPS')
    })

    it('rejects an invalid publisher encryption key', () => {
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_MEDIA_PUBLIC_URL_SECRET: mediaPublicUrlSecret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: 'not-a-hex-key',
            })
        ).toThrow('HERALD_PUBLISHER_ENCRYPTION_KEY')
    })
})

describe('Herald maintenance configuration', () => {
    it('loads database and local media settings without requiring server secrets', () => {
        expect(
            createHeraldMaintenanceConfig({
                DB_FILE_NAME: '/data/herald.sqlite',
                BETTER_AUTH_SECRET: 'unused',
                HERALD_MEDIA_PUBLIC_URL_SECRET: 'unused',
                HERALD_PUBLISHER_ENCRYPTION_KEY: 'unused',
            })
        ).toEqual({
            databaseFileName: '/data/herald.sqlite',
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
            createHeraldMaintenanceConfig({
                DB_FILE_NAME: '/data/herald.sqlite',
                HERALD_MEDIA_STORE: 's3',
                HERALD_MEDIA_S3_BUCKET: 'herald-media',
                HERALD_MEDIA_S3_REGION: 'us-east-1',
                HERALD_MEDIA_S3_ACCESS_KEY_ID: 'access-key',
                HERALD_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
            }).media
        ).toMatchObject({
            driver: 's3',
            s3: {
                bucket: 'herald-media',
                region: 'us-east-1',
                accessKeyId: 'access-key',
                secretAccessKey: 'secret-key',
            },
        })

        expect(() =>
            createHeraldMaintenanceConfig({
                HERALD_MEDIA_STORE: 's3',
                HERALD_MEDIA_S3_BUCKET: 'herald-media',
            })
        ).toThrow(
            'HERALD_MEDIA_S3_BUCKET, HERALD_MEDIA_S3_ACCESS_KEY_ID, and HERALD_MEDIA_S3_SECRET_ACCESS_KEY'
        )
    })
})
