import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

const rootDirectory = process.cwd()
const e2eDirectory = join(tmpdir(), 'herald-e2e-data')
const apiPort = parsePort(process.env.HERALD_E2E_API_PORT, 3101)
const webPort = parsePort(process.env.HERALD_E2E_WEB_PORT, 5174)
const apiOrigin = `http://127.0.0.1:${apiPort}`
const webOrigin = `http://127.0.0.1:${webPort}`

const apiEnvironment = {
    NODE_ENV: 'test',
    PORT: String(apiPort),
    DB_FILE_NAME: join(e2eDirectory, 'herald.sqlite'),
    HERALD_E2E_DATA_DIRECTORY: e2eDirectory,
    HERALD_MIGRATIONS_DIR: resolve(rootDirectory, 'packages/db/drizzle'),
    HERALD_MEDIA_STORE: 'local',
    HERALD_MEDIA_DIRECTORY: join(e2eDirectory, 'media'),
    HERALD_MEDIA_STORE_ID: 'e2e-local',
    BETTER_AUTH_URL: apiOrigin,
    BETTER_AUTH_SECRET: 'herald-e2e-auth-secret-which-is-long-enough',
    HERALD_MEDIA_PUBLIC_URL_SECRET: 'herald-e2e-media-secret-which-is-long-enough',
    HERALD_PUBLISHER_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    HERALD_PUBLISHER_ENCRYPTION_KEY_ID: 'e2e-v1',
    HERALD_WEB_ORIGIN: webOrigin,
    LOG_LEVEL: 'silent',
    LOG_PRETTY: 'false',
} as const

export default defineConfig({
    testDir: './e2e',
    outputDir: './test-results',
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

function parsePort(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback

    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`E2E port must be an integer between 1 and 65535, received ${value}`)
    }

    return port
}
