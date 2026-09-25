import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('shows X weighted text feedback in the publication composer', async ({ page }) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: `E2E X destination ${suffix}`, profile: 'x' },
    })
    expect(channelResponse.status()).toBe(201)

    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    const source = page.getByRole('textbox', { name: 'Content', exact: true })
    const count = page.locator('[data-weighted-count="true"]')
    await expect(source).toBeVisible()
    await expect(count).toHaveText('0 / 280 weighted characters')

    await source.fill(`https://example.com/${'a'.repeat(300)}`)
    await expect(count).toHaveText('23 / 280 weighted characters')

    await source.fill('日'.repeat(141))
    await expect(count).toHaveText('282 / 280 weighted characters')
    await expect(source).toHaveAttribute('aria-invalid', 'true')

    await page.getByRole('button', { name: 'Customize for this channel', exact: true }).click()
    const targetContent = page.getByRole('textbox', { name: 'Channel content', exact: true })
    await targetContent.fill('日'.repeat(140))
    await expect(count).toHaveText('280 / 280 weighted characters')
    await expect(targetContent).not.toHaveAttribute('aria-invalid', 'true')
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill(`E2E X owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(`e2e-x-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-x-owner-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])

    await page.goto('/dashboard?projectId=none')
    await expect(page).toHaveURL(/\/dashboard\?projectId=none$/)
    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    const projectDialog = page.getByRole('dialog')
    await projectDialog
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E X project ${suffix}`)
    await projectDialog.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}
