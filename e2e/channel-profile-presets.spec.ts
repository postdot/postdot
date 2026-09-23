import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('offers provider profiles as editable custom channel starters', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const channelName = `E2E-142 preset channel ${suffix}`
    await createAccountAndProject(page, suffix)

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await page.getByLabel('Channel name').fill(channelName)

    await page.getByRole('combobox', { name: 'Profile', exact: true }).click()
    await page.getByRole('option', { name: 'Custom runtime profile', exact: true }).click()

    const starter = page.getByRole('combobox', { name: 'Starter template', exact: true })
    await starter.click()
    await expect(page.getByRole('option', { name: 'Bluesky post', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'Bluesky post', exact: true }).click()

    await expect(
        page.getByText('A copy of the provider profile. Edit it to fit this custom channel.', {
            exact: true,
        })
    ).toBeVisible()
    const profileJson = page.getByLabel('Custom profile JSON')
    await expect(profileJson).toHaveValue(/"id": "custom-bluesky"/)
    await expect(profileJson).toHaveValue(/"origin": "custom"/)
    await expect(profileJson).toHaveValue(/"contractId": "bluesky"/)

    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()
})

async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-142 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-142-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-142-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    await page.locator('#new-project').fill(`E2E-142 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
}
