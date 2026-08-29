import { describe, expect, it } from 'bun:test'

import { createHeraldConfig } from './config'

const secret = 'herald-test-secret-with-at-least-32-characters'
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
            auth: {
                baseURL: 'http://localhost:3100',
                secret,
            },
            security: {
                publisherEncryptionKey,
                publisherEncryptionKeyId: 'v1',
            },
            publishers: {},
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

    it('disables logging by default in production', () => {
        expect(
            createHeraldConfig({
                NODE_ENV: 'production',
                BETTER_AUTH_SECRET: secret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            }).logging
        ).toEqual({
            enabled: false,
            level: 'silent',
            pretty: false,
        })
    })

    it('reports missing and invalid environment variables together', () => {
        expect(() => createHeraldConfig({})).toThrow('BETTER_AUTH_SECRET is required')
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: 'not-long-enough',
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            })
        ).toThrow('BETTER_AUTH_SECRET')
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
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
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
            })
        ).toThrow('replace the example placeholder')
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                BETTER_AUTH_URL: 'sqlite://local',
            })
        ).toThrow('BETTER_AUTH_URL')
    })

    it('keeps LinkedIn publisher configuration separate from application authentication', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                LINKEDIN_CLIENT_ID: '',
                LINKEDIN_CLIENT_SECRET: '   ',
            }).publishers.linkedin
        ).toBeUndefined()

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                LINKEDIN_CLIENT_ID: 'client-id',
            })
        ).toThrow('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set together')
    })

    it('normalizes the optional LinkedIn publisher configuration', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: publisherEncryptionKey,
                LINKEDIN_CLIENT_ID: ' client-id ',
                LINKEDIN_CLIENT_SECRET: ' client-secret ',
            }).publishers.linkedin
        ).toEqual({
            clientId: 'client-id',
            clientSecret: 'client-secret',
        })
    })

    it('rejects an invalid publisher encryption key', () => {
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                HERALD_PUBLISHER_ENCRYPTION_KEY: 'not-a-hex-key',
            })
        ).toThrow('HERALD_PUBLISHER_ENCRYPTION_KEY')
    })
})
