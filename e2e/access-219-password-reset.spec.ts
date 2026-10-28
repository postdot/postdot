import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

const resetSubject = 'Reset your Postdot password'

test('requests and completes a password reset through the configured mail relay', async ({
    page,
}) => {
    test.setTimeout(90_000)

    const suffix = randomUUID().slice(0, 8)
    const email = `e2e-access-219-${suffix}@postdot.local`
    const oldPassword = 'old-reset-password-219'
    const newPassword = 'new-reset-password-219'
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: { email, name: `Reset User ${suffix}`, password: oldPassword },
    })
    expect(signup.status()).toBe(200)

    await page.goto('/forgot-password')
    await page.getByLabel('Email', { exact: true }).fill(`unknown-${suffix}@postdot.local`)
    const unknownRequest = page.waitForResponse(isResetRequest)
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
    const unknownResponse = await unknownRequest
    expect(unknownResponse.status()).toBe(200)
    const unknownBody = await unknownResponse.json()
    await expect(page.getByRole('status')).toHaveText(
        'If an account exists for this email address, a reset link will be sent.'
    )

    await page.goto('/forgot-password')
    await page.getByLabel('Email', { exact: true }).fill(email)
    const knownRequest = page.waitForResponse(isResetRequest)
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
    const knownResponse = await knownRequest
    expect(knownResponse.status()).toBe(200)
    expect(await knownResponse.json()).toEqual(unknownBody)
    await expect(page.getByRole('status')).toHaveText(
        'If an account exists for this email address, a reset link will be sent.'
    )

    await expect
        .poll(async () => (await listResetMessages(page)).length, { timeout: 15_000 })
        .toBe(1)
    const messages = await listResetMessages(page)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.recipients).toEqual([email])
    const detailResponse = await page.request.get(
        `${mailpitOrigin()}/api/v1/message/${messages[0]!.ID}`
    )
    expect(detailResponse.ok()).toBe(true)
    const detail = (await detailResponse.json()) as { readonly Text?: string }
    const resetLink = detail.Text?.match(/https?:\/\/[^\s<>]+/)?.[0]?.replace(/[),.;]+$/, '')
    expect(resetLink).toBeDefined()

    await page.goto(resetLink!)
    await expect(page).toHaveURL(/\/reset-password\?token=/)
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm password', { exact: true }).fill(`${newPassword}-mismatch`)
    await page.getByRole('button', { name: 'Change password', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('The passwords do not match.')

    await page.getByLabel('Confirm password', { exact: true }).fill(newPassword)
    await page.getByRole('button', { name: 'Change password', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Password updated', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(newPassword)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()

    await page.goto(resetLink!)
    await expect(
        page.getByRole('heading', { name: 'Reset link unavailable', exact: true })
    ).toBeVisible()
})

test('shows a localized recovery path for missing and invalid reset tokens', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(
        page.getByRole('heading', { name: 'Reset link unavailable', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('button', { name: 'Request a new reset link', exact: true })
    ).toBeVisible()

    await page.goto('/reset-password?token=invalid-token')
    await page.getByLabel('New password', { exact: true }).fill('valid-length-password')
    await page.getByLabel('Confirm password', { exact: true }).fill('valid-length-password')
    await page.getByRole('button', { name: 'Change password', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(
        'This link is invalid or expired. Request a new reset link.'
    )
})

async function listResetMessages(
    page: Page
): Promise<Array<{ readonly ID: string; readonly recipients: readonly string[] }>> {
    const response = await page.request.get(`${mailpitOrigin()}/api/v1/messages?limit=100`)
    expect(response.ok()).toBe(true)
    const body = (await response.json()) as {
        readonly messages?: readonly {
            readonly ID: string
            readonly Subject: string
            readonly To?: readonly { readonly Address: string }[]
        }[]
    }
    return (body.messages ?? [])
        .filter(message => message.Subject === resetSubject)
        .map(message => ({
            ID: message.ID,
            recipients: (message.To ?? []).map(recipient => recipient.Address),
        }))
}

function mailpitOrigin(): string {
    const port = process.env.POSTDOT_E2E_MAILPIT_UI_PORT
    if (port === undefined) throw new Error('The Mailpit E2E port is not configured')
    return `http://127.0.0.1:${port}`
}

function isResetRequest(response: { url(): string; request(): { method(): string } }): boolean {
    return (
        response.url().endsWith('/api/auth/request-password-reset') &&
        response.request().method() === 'POST'
    )
}

test('opts into project outcome email through the preferences and real SMTP relay', async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8)
    const email = `alerts-${suffix}@postdot.local`
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: { email, name: 'Alert recipient', password: 'outcome-alert-password' },
    })
    expect(signup.status()).toBe(200)
    const userId = (await signup.json()).user.id
    const created = await page.request.post('/api/projects', {
        data: { name: 'Email alert project' },
    })
    expect(created.status()).toBe(201)
    const projectId = (await created.json()).project.id
    // An isolated fixture establishes a durable failure fact. Verification, SMTP,
    // projection, preferences and UI are real; no provider publication is claimed.
    const { spawnSync } = await import('node:child_process')
    const { join } = await import('node:path')
    const { isSafeE2EDataDirectory } = await import('../scripts/e2e-runtime')
    const directory = process.env.POSTDOT_E2E_DATA_DIRECTORY
    if (!isSafeE2EDataDirectory(directory)) throw new Error('Unsafe alert fixture directory')
    function seed() {
        const result = spawnSync(
            'bun',
            [
                '-e',
                `
            import {createDatabase, closeDatabase, createEventJournalStore} from './packages/db/src/index.ts';
            const [file,userId,projectId] = Bun.argv.slice(1);
            const db = createDatabase(file);

                const actor = db.$client.query('select id from actors where project_id = ?1 and subject_id = ?2').get(projectId,userId);
                createEventJournalStore(db).append({id: crypto.randomUUID(), projectId, actorId: actor.id,
                    name: 'publication.execution.failed', version: 1, subject: {type: 'publication',id: 'fixture-publication'}, occurredAt: Date.now()});

            closeDatabase(db);`,
                join(directory!, 'postdot.sqlite'),
                userId,
                projectId,
            ],
            { encoding: 'utf8' }
        )
        expect(result.status, result.stderr).toBe(0)
    }
    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await page.getByRole('button', { name: 'Open notifications', exact: true }).click()
    await page.getByRole('button', { name: 'Open notification preferences', exact: true }).click()
    const toggle = page.getByRole('switch', { name: 'Email outcome alerts', exact: true })
    await expect(toggle).toBeDisabled()
    await page.getByRole('button', { name: 'Send verification link', exact: true }).click()
    await expect(
        page
            .getByRole('status')
            .filter({ hasText: 'Verification requested. Check your email for the link.' })
    ).toBeVisible()
    let verificationLink: string | undefined
    await expect
        .poll(async () => {
            const { messages } = await (
                await page.request.get(`${mailpitOrigin()}/api/v1/messages?limit=100`)
            ).json()
            for (const message of messages.filter(
                (message: { Subject: string; To: { Address: string }[] }) =>
                    message.Subject === 'Verify your Postdot email address' &&
                    message.To.some(to => to.Address === email)
            )) {
                const detail = await (
                    await page.request.get(`${mailpitOrigin()}/api/v1/message/${message.ID}`)
                ).json()
                const link = detail.Text?.match(/https?:\/\/[^\s<>]+/)?.[0]?.replace(/[),.;]+$/, '')
                if (link?.includes(projectId)) {
                    verificationLink = link
                    return true
                }
            }
            return false
        })
        .toBe(true)
    await page.goto(verificationLink!)
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/overview`))
    await page.getByRole('button', { name: 'Open notifications', exact: true }).click()
    await page.getByRole('button', { name: 'Open notification preferences', exact: true }).click()
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    seed()
    // A real committed project mutation wakes the independent journal projector.
    expect(
        (
            await page.request.patch(`/api/projects/${projectId}`, {
                data: { timeZone: 'Europe/Paris' },
            })
        ).ok()
    ).toBe(true)
    await expect
        .poll(async () => {
            const response = await page.request.get(`${mailpitOrigin()}/api/v1/messages?limit=100`)
            const { messages } = await response.json()
            return messages.filter(
                (message: { Subject: string; To: { Address: string }[] }) =>
                    message.Subject === 'Postdot — Publication failed' &&
                    message.To.some(to => to.Address === email)
            ).length
        })
        .toBe(1)
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    const preference = await page.request.get(`/api/projects/${projectId}/email-alerts`)
    expect(await preference.json()).toMatchObject({
        enabled: false,
        available: true,
        verified: true,
        email,
    })
})

test('configures SMTP in administration and sends a real test without exposing credentials', async ({
    page,
}, testInfo) => {
    const email = `smtp-admin-${randomUUID().slice(0, 8)}@postdot.local`
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: { email, name: 'SMTP administrator', password: 'smtp-administrator-password' },
    })
    expect(signup.status()).toBe(200)
    await page.goto('/dashboard/preferences')
    await page.getByRole('link', { name: 'Email delivery', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/settings/)
    await expect(page.getByRole('heading', { name: 'Email delivery', exact: true })).toBeVisible()
    await expect(
        page.getByText('Current settings come from the deployment. Saving here replaces them.')
    ).toBeVisible()
    await page.getByLabel('Sender address', { exact: true }).fill('postdot-test@postdot.local')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
        page.getByRole('status').filter({ hasText: 'Email settings saved.' })
    ).toBeVisible()
    const stored = await page.request.get('/api/settings/email')
    expect(stored.status()).toBe(200)
    expect(await stored.json()).toMatchObject({
        source: 'database',
        enabled: true,
        hasPassword: false,
        from: 'postdot-test@postdot.local',
    })
    await page.getByRole('button', { name: 'Send me a test email', exact: true }).click()
    await expect(
        page.getByRole('status').filter({ hasText: 'SMTP accepted the test email.' })
    ).toBeVisible()
    await expect
        .poll(async () => {
            const body = await (
                await page.request.get(`${mailpitOrigin()}/api/v1/messages?limit=100`)
            ).json()
            return body.messages.filter(
                (message: { Subject: string; To: { Address: string }[] }) =>
                    message.Subject === 'Postdot — SMTP test' &&
                    message.To.some(to => to.Address === email)
            ).length
        })
        .toBe(1)
    // A real connection refusal remains a recoverable, non-secret UI error.
    await page.getByLabel('Port', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
        page.getByRole('status').filter({ hasText: 'Email settings saved.' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Send me a test email', exact: true }).click()
    await expect(
        page.getByRole('alert').filter({ hasText: 'SMTP did not confirm the test.' })
    ).toBeVisible()
    await page.getByLabel('Port', { exact: true }).fill(process.env.POSTDOT_E2E_MAILPIT_SMTP_PORT!)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
        page.getByRole('status').filter({ hasText: 'Email settings saved.' })
    ).toBeVisible()
    await page.getByRole('switch', { name: 'Enable email delivery', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
        page.getByRole('status').filter({ hasText: 'Email settings saved.' })
    ).toBeVisible()
    await page.reload()
    await expect(
        page.getByRole('switch', { name: 'Enable email delivery', exact: true })
    ).not.toBeChecked()
    await expect(
        page.getByRole('button', { name: 'Send me a test email', exact: true })
    ).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('smtp-desktop.png'), fullPage: true })
    await page.getByRole('button', { name: 'Save', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('smtp-desktop-fields.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByLabel('SMTP server', { exact: true })).toBeVisible()
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('smtp-narrow.png'), fullPage: true })
    await page.getByRole('button', { name: 'Save', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('smtp-narrow-fields.png'), fullPage: true })
})
