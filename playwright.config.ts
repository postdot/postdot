import { createServer } from 'node:net'
import { basename, join, resolve } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { createE2ERuntimeResources } from './scripts/e2e-runtime'

const rootDirectory = process.cwd()
const productionWeb = process.env.POSTBOT_E2E_PRODUCTION_WEB === 'true'
const useMailpit = process.env.POSTBOT_E2E_MAILPIT === 'true'
const tlsProxy = process.env.POSTBOT_E2E_TLS_PROXY === 'true'
const realtimeAcceptance = process.env.POSTBOT_E2E_REALTIME_ACCEPTANCE === 'true'
if (tlsProxy && !realtimeAcceptance)
    throw new Error('The TLS proxy requires isolated realtime acceptance')
const runtime = await createE2ERuntimeResources()
const { apiOrigin, apiPort, dataDirectory, mediaDirectory, webOrigin, webPort } = runtime
const receiverPort = realtimeAcceptance
    ? await allocateTestPort('POSTBOT_E2E_RECEIVER_PORT', [apiPort, webPort])
    : undefined
if (receiverPort !== undefined) process.env.POSTBOT_E2E_RECEIVER_PORT = String(receiverPort)
const tlsProxyPort = tlsProxy
    ? await allocateTestPort('POSTBOT_E2E_TLS_PROXY_PORT', [
          apiPort,
          webPort,
          ...(receiverPort === undefined ? [] : [receiverPort]),
      ])
    : undefined
if (tlsProxyPort !== undefined) process.env.POSTBOT_E2E_TLS_PROXY_PORT = String(tlsProxyPort)
const browserOrigin = tlsProxyPort === undefined ? webOrigin : `https://127.0.0.1:${tlsProxyPort}`

async function allocateTestPort(variable: string, reserved: readonly number[]): Promise<number> {
    const configured = process.env[variable]
    if (configured !== undefined) {
        const port = Number(configured)
        if (!Number.isInteger(port) || port < 1 || port > 65_535 || reserved.includes(port))
            throw new Error(`Invalid isolated E2E port: ${variable}`)
        return port
    }
    const port = await new Promise<number>((resolvePort, reject) => {
        const socket = createServer()
        socket.once('error', reject)
        socket.listen(0, '127.0.0.1', () => {
            const address = socket.address()
            if (address === null || typeof address === 'string') {
                socket.close(() => reject(new Error('E2E port allocation failed')))
                return
            }
            socket.close(error => (error ? reject(error) : resolvePort(address.port)))
        })
    })
    return reserved.includes(port) ? allocateTestPort(variable, reserved) : port
}

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
    BETTER_AUTH_URL: tlsProxy ? browserOrigin : apiOrigin,
    BETTER_AUTH_SECRET: 'postbot-e2e-auth-secret-which-is-long-enough',
    POSTBOT_MEDIA_PUBLIC_URL_SECRET: 'postbot-e2e-media-secret-which-is-long-enough',
    POSTBOT_PUBLISHER_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    POSTBOT_PUBLISHER_ENCRYPTION_KEY_ID: 'e2e-v1',
    POSTBOT_WEB_ORIGIN: browserOrigin,
    POSTBOT_E2E_ALLOW_ADDITIONAL_SIGNUPS: 'true',
    LOG_LEVEL: 'silent',
    LOG_PRETTY: 'false',
    ...(receiverPort === undefined
        ? {}
        : {
              POSTBOT_OUTBOUND_PRIVATE_DESTINATIONS: JSON.stringify([
                  { kind: 'cidr', cidr: '127.0.0.1/32', port: receiverPort, schemes: ['http'] },
              ]),
          }),
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
    testIgnore: [
        ...(useMailpit ? [] : ['**/access-219-password-reset.spec.ts']),
        ...(realtimeAcceptance ? [] : ['**/realtime-automatic-acceptance.spec.ts']),
    ],
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
        baseURL: browserOrigin,
        ignoreHTTPSErrors: tlsProxy,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        ...devices['Desktop Chrome'],
    },
    webServer: [
        ...(receiverPort === undefined
            ? []
            : [
                  {
                      command: 'bun ./scripts/e2e-realtime-receiver.ts',
                      url: `http://127.0.0.1:${receiverPort}/ready`,
                      reuseExistingServer: false,
                      gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 10_000 },
                      env: { ...apiEnvironment, POSTBOT_E2E_RECEIVER_PORT: String(receiverPort) },
                  },
              ]),
        {
            command: 'bun ./scripts/e2e-api.ts',
            url: `${apiOrigin}/ready`,
            timeout: 120_000,
            reuseExistingServer: false,
            gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
            env: apiEnvironment,
        },
        {
            command: productionWeb
                ? `bun run --cwd apps/web --bun vite preview --configLoader native --host 127.0.0.1 --port ${webPort} --strictPort`
                : `bun run --cwd apps/web dev -- --host 127.0.0.1 --port ${webPort}`,
            url: webOrigin,
            timeout: 120_000,
            reuseExistingServer: false,
            gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
            env: {
                POSTBOT_API_ORIGIN: apiOrigin,
                NODE_ENV: 'test',
            },
        },
        ...(tlsProxyPort === undefined
            ? []
            : [
                  {
                      command: 'bun ./scripts/e2e-realtime-tls-proxy.ts',
                      url: `${browserOrigin}/__realtime_tls_ready`,
                      ignoreHTTPSErrors: true,
                      reuseExistingServer: false,
                      gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 10_000 },
                      env: {
                          ...apiEnvironment,
                          POSTBOT_E2E_REALTIME_ACCEPTANCE: 'true',
                          POSTBOT_E2E_TLS_PROXY: 'true',
                          POSTBOT_E2E_TLS_PROXY_PORT: String(tlsProxyPort),
                          POSTBOT_E2E_TLS_PROXY_TARGET: webOrigin,
                      },
                  },
              ]),
    ],
})
