import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps publication detail actions aligned with the scheduled lifecycle', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E detail destination ${suffix}`

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    await page.getByRole('button', { name: 'New publication', exact: true }).click()
    await page.getByLabel('Content', { exact: true }).fill('E2E detail lifecycle content')
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()

    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    const publicationLink = page.getByRole('link').filter({ hasText: 'Untitled post' }).first()
    await expect(publicationLink).toBeVisible()
    await publicationLink.click()

    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/publications/[^/]+$`))
    await expect(page.locator('[data-publication-action="cancel"]')).toBeVisible()
    await expect(
        page.getByRole('button', { name: 'Record as published', exact: true })
    ).toHaveCount(0)

    await page.locator('[data-publication-action="cancel"]').click()
    await expect(
        page.getByRole('heading', { name: 'Cancel publication?', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('button', { name: 'Cancel publication', exact: true })
    ).toBeVisible()
    await expect(page.locator('[data-publication-cancel-confirm="true"]')).toBeVisible()

    await page.locator('[data-publication-cancel-confirm="true"]').click()
    await expect(page.getByText('Publication cancelled.', { exact: true })).toBeVisible()
    await expect(page.locator('[data-publication-action="cancel"]')).toHaveCount(0)
    await expect(page.locator('[data-publication-read-only="true"]')).toContainText(
        'Publication is locked'
    )
})

async function createAccountAndProject(page: Page, suffix: string) {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E detail ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-detail-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-detail-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    await page.locator('#new-project').fill(`E2E detail project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
