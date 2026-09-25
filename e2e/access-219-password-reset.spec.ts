import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

const resetSubject = 'Reset your Herald password'

test('requests and completes a password reset through the configured mail relay', async ({
    page,
}) => {
    test.setTimeout(90_000)

    const suffix = randomUUID().slice(0, 8)
    const email = `e2e-access-219-${suffix}@herald.local`
    const oldPassword = 'old-reset-password-219'
    const newPassword = 'new-reset-password-219'
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: { email, name: `Reset User ${suffix}`, password: oldPassword },
    })
    expect(signup.status()).toBe(200)

    await page.goto('/forgot-password')
    await page.getByLabel('Email', { exact: true }).fill(`unknown-${suffix}@herald.local`)
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
    await expect(
        page.getByRole('heading', { name: 'Create your first project', exact: true })
    ).toBeVisible()

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
    const port = process.env.HERALD_E2E_MAILPIT_UI_PORT
    if (port === undefined) throw new Error('The Mailpit E2E port is not configured')
    return `http://127.0.0.1:${port}`
}

function isResetRequest(response: { url(): string; request(): { method(): string } }): boolean {
    return (
        response.url().endsWith('/api/auth/request-password-reset') &&
        response.request().method() === 'POST'
    )
}
