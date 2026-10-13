import { basename, join, resolve } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { createE2ERuntimeResources } from './scripts/e2e-runtime'

const rootDirectory = process.cwd()
const useMailpit = process.env.POSTBOT_E2E_MAILPIT === 'true'
const runtime = await createE2ERuntimeResources()
const { apiOrigin, apiPort, dataDirectory, mediaDirectory, webOrigin, webPort } = runtime

if (useMailpit !== (runtime.mailpit !== undefined)) {
    throw new Error('Mailpit E2E resources are not configured consistently')
}

process.env.POSTBOT_E2E_API_PORT = String(apiPort)
process.env.POSTBOT_E2E_DATA_DIRECTORY = dataDirectory
process.env.POSTBOT_E2E_WEB_PORT = String(webPort)
if (runtime.mailpit !== undefined) {
    process.env.POSTBOT_E2E_MAILPIT_SMTP_PORT = String(runtime.mailpit.smtpPort)
    process.env.POSTBOT_E2E_MAILPIT_UI_PORT = String(runtime.mailpit.uiPort)
}

const apiEnvironment = {
    NODE_ENV: 'test',
    PORT: String(apiPort),
    DB_FILE_NAME: runtime.databaseFile,
    POSTBOT_E2E_DATA_DIRECTORY: dataDirectory,
    POSTBOT_MIGRATIONS_DIR: resolve(rootDirectory, 'packages/db/drizzle'),
    POSTBOT_MEDIA_STORE: 'local',
    POSTBOT_MEDIA_DIRECTORY: mediaDirectory,
    POSTBOT_MEDIA_STORE_ID: 'e2e-local',
    BETTER_AUTH_URL: apiOrigin,
    BETTER_AUTH_SECRET: 'postbot-e2e-auth-secret-which-is-long-enough',
    POSTBOT_MEDIA_PUBLIC_URL_SECRET: 'postbot-e2e-media-secret-which-is-long-enough',
    POSTBOT_PUBLISHER_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    POSTBOT_PUBLISHER_ENCRYPTION_KEY_ID: 'e2e-v1',
    POSTBOT_WEB_ORIGIN: webOrigin,
    POSTBOT_E2E_ALLOW_ADDITIONAL_SIGNUPS: 'true',
    LOG_LEVEL: 'silent',
    LOG_PRETTY: 'false',
    ...(runtime.mailpit === undefined
        ? {}
        : {
              POSTBOT_EMAIL_SMTP_HOST: '127.0.0.1',
              POSTBOT_EMAIL_SMTP_PORT: String(runtime.mailpit.smtpPort),
              POSTBOT_EMAIL_SMTP_SECURE: 'false',
              POSTBOT_EMAIL_FROM: 'Postbot <no-reply@postbot.local>',
          }),
} as const

export default defineConfig({
    testDir: './e2e',
    testIgnore: useMailpit ? [] : ['**/access-219-password-reset.spec.ts'],
    outputDir: join(rootDirectory, 'test-results', basename(dataDirectory)),
    metadata: {
        postbotE2eDataDirectory: dataDirectory,
    },
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    // All specs share one isolated API/database runtime; parallel workers can
    // mutate the instance bootstrap state and make otherwise independent flows
    // observe another test's project or session.
    workers: 1,
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
                POSTBOT_API_ORIGIN: apiOrigin,
                NODE_ENV: 'test',
            },
        },
    ],
})
