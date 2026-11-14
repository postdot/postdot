import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

async function allocateFreePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (address === null || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to allocate isolated API port')))
                return
            }
            server.close(error => (error ? reject(error) : resolvePort(address.port)))
        })
    })
}

async function waitForReady(apiOrigin: string): Promise<void> {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${apiOrigin}/ready`)
            if (response.status === 200) return
        } catch {
            // Keep polling until the isolated server starts listening.
        }
        await sleep(100)
    }
    throw new Error(`Isolated Postdot API did not become ready at ${apiOrigin}`)
}

test('requires the instance bootstrap token on /setup in production mode and claims the instance cleanly', async ({
    page,
    baseURL,
}) => {
    test.setTimeout(60_000)
    const studioOrigin = baseURL ?? `http://127.0.0.1:${process.env.POSTDOT_E2E_WEB_PORT}`
    const dataDirectory = await mkdtemp(join(tmpdir(), 'postdot-e2e-token-bootstrap-'))
    const isolatedPort = await allocateFreePort()
    const isolatedOrigin = `http://127.0.0.1:${isolatedPort}`

    const server = spawn('bun', ['./apps/api/src/index.ts'], {
        cwd: process.cwd(),
        stdio: 'ignore',
        env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: String(isolatedPort),
            DB_FILE_NAME: join(dataDirectory, 'postdot.sqlite'),
            POSTDOT_MIGRATIONS_DIR: resolve(process.cwd(), 'packages/db/migrations'),
            POSTDOT_MEDIA_STORE: 'local',
            POSTDOT_MEDIA_DIRECTORY: join(dataDirectory, 'media'),
            POSTDOT_MEDIA_STORE_ID: 'e2e-token-local',
            POSTDOT_WEB_ENABLED: 'false',
            POSTDOT_E2E_ALLOW_ADDITIONAL_SIGNUPS: 'false',
            BETTER_AUTH_URL: studioOrigin,
            BETTER_AUTH_SECRET: 'postdot-e2e-production-auth-secret-long-enough',
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: 'postdot-e2e-production-media-secret-long',
            POSTDOT_PUBLISHER_ENCRYPTION_KEY:
                '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            POSTDOT_PUBLISHER_ENCRYPTION_KEY_ID: 'e2e-v1',
            POSTDOT_WEB_ORIGIN: studioOrigin,
            LOG_LEVEL: 'silent',
            LOG_PRETTY: 'false',
        },
    })
    const exited = new Promise<void>(resolveExit => {
        server.once('exit', () => resolveExit())
    })

    try {
        await waitForReady(isolatedOrigin)

        const tokenFilePath = join(dataDirectory, 'bootstrap-token')
        const tokenStat = await lstat(tokenFilePath)
        expect(tokenStat.isFile()).toBe(true)
        expect(tokenStat.mode & 0o777).toBe(0o600)
        const bootstrapToken = (await readFile(tokenFilePath, 'utf8')).trim()
        expect(bootstrapToken.length).toBeGreaterThanOrEqual(16)

        await page.addInitScript(() => localStorage.setItem('PARAGLIDE_LOCALE', 'en'))
        await page.route('**/api/**', async route => {
            const url = new URL(route.request().url())
            const targetUrl = `${isolatedOrigin}${url.pathname}${url.search}`
            const response = await route.fetch({ url: targetUrl })
            await route.fulfill({ response })
        })

        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/setup')

        await expect(page.getByText(en.auth_setup_administrator_description)).toBeVisible()
        const tokenInput = page.getByLabel(en.auth_bootstrap_token, { exact: true })
        await expect(tokenInput).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        )

        const email = `token-admin-${randomUUID()}@example.test`
        const password = 'token-bootstrap-admin-password-123'
        await page.getByLabel(en.auth_name, { exact: true }).fill('Bootstrap Admin')
        await page.getByLabel(en.auth_email, { exact: true }).fill(email)
        await page.getByLabel(en.auth_password, { exact: true }).fill(password)

        await tokenInput.fill('wrong-bootstrap-token')
        await page.getByRole('button', { name: en.auth_create_account_button }).click()
        await expect(page.getByRole('alert')).toHaveText(en.auth_setup_invalid_bootstrap_token)

        await tokenInput.fill(bootstrapToken)
        await page.getByRole('button', { name: en.auth_create_account_button }).click()
        await expect(page).toHaveURL(/\/dashboard/)
        expect(existsSync(tokenFilePath)).toBe(false)

        await page.goto('/setup')
        await expect(page).not.toHaveURL(/\/setup/)
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
        server.kill('SIGTERM')
        await exited
        await rm(dataDirectory, { recursive: true, force: true })
    }
})
