import { basename, join, resolve } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { createE2ERuntimeResources } from './scripts/e2e-runtime'

const rootDirectory = process.cwd()
const runtime = await createE2ERuntimeResources()
const { apiOrigin, apiPort, dataDirectory, mediaDirectory, webOrigin, webPort } = runtime

process.env.HERALD_E2E_API_PORT = String(apiPort)
process.env.HERALD_E2E_DATA_DIRECTORY = dataDirectory
process.env.HERALD_E2E_WEB_PORT = String(webPort)

const apiEnvironment = {
    NODE_ENV: 'test',
    PORT: String(apiPort),
    DB_FILE_NAME: runtime.databaseFile,
    HERALD_E2E_DATA_DIRECTORY: dataDirectory,
    HERALD_MIGRATIONS_DIR: resolve(rootDirectory, 'packages/db/drizzle'),
    HERALD_MEDIA_STORE: 'local',
    HERALD_MEDIA_DIRECTORY: mediaDirectory,
    HERALD_MEDIA_STORE_ID: 'e2e-local',
    BETTER_AUTH_URL: apiOrigin,
    BETTER_AUTH_SECRET: 'herald-e2e-auth-secret-which-is-long-enough',
    HERALD_MEDIA_PUBLIC_URL_SECRET: 'herald-e2e-media-secret-which-is-long-enough',
    HERALD_PUBLISHER_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    HERALD_PUBLISHER_ENCRYPTION_KEY_ID: 'e2e-v1',
    HERALD_WEB_ORIGIN: webOrigin,
    HERALD_E2E_ALLOW_ADDITIONAL_SIGNUPS: 'true',
    LOG_LEVEL: 'silent',
    LOG_PRETTY: 'false',
} as const

export default defineConfig({
    testDir: './e2e',
    outputDir: join(rootDirectory, 'test-results', basename(dataDirectory)),
    metadata: {
        heraldE2eDataDirectory: dataDirectory,
    },
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? 'github' : 'list',
    globalTeardown: './e2e/global-teardown.ts',
    use: {
        baseURL: webOrigin,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        ...devices['Desktop Chrome'],
    },
    webServer: [
        {
            command: 'bun ./scripts/e2e-api.ts',
            url: `${apiOrigin}/ready`,
            timeout: 120_000,
            reuseExistingServer: false,
            env: apiEnvironment,
        },
        {
            command: `bun run --cwd apps/web dev -- --host 127.0.0.1 --port ${webPort}`,
            url: webOrigin,
            timeout: 120_000,
            reuseExistingServer: false,
            env: {
                HERALD_API_ORIGIN: apiOrigin,
                NODE_ENV: 'test',
            },
        },
    ],
})
