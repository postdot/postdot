import { describe, expect, it } from 'bun:test'

import { createHeraldConfig } from './config'

const secret = 'herald-test-secret-with-at-least-32-characters'

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
            })
        ).toThrow('BETTER_AUTH_SECRET')
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                PORT: '70000',
                LOG_PRETTY: 'sometimes',
            })
        ).toThrow('PORT')
    })

    it('rejects the example secret and invalid URLs', () => {
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters',
            })
        ).toThrow('replace the example placeholder')
        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                BETTER_AUTH_URL: 'sqlite://local',
            })
        ).toThrow('BETTER_AUTH_URL')
    })

    it('keeps LinkedIn disabled unless both client credentials are configured', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                LINKEDIN_CLIENT_ID: '',
                LINKEDIN_CLIENT_SECRET: '   ',
            }).auth.linkedin
        ).toBeUndefined()

        expect(() =>
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                LINKEDIN_CLIENT_ID: 'client-id',
            })
        ).toThrow('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set together')
    })

    it('normalizes the optional LinkedIn configuration as one auth boundary', () => {
        expect(
            createHeraldConfig({
                BETTER_AUTH_SECRET: secret,
                LINKEDIN_CLIENT_ID: ' client-id ',
                LINKEDIN_CLIENT_SECRET: ' client-secret ',
            }).auth.linkedin
        ).toEqual({
            clientId: 'client-id',
            clientSecret: 'client-secret',
        })
    })
})
