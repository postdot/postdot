import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps publication detail actions aligned with the scheduled lifecycle', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E detail destination ${suffix}`

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await page.getByLabel('Content', { exact: true }).fill('E2E detail lifecycle content')
    await page.locator('button[name="publication-action"][value="schedule"]').click()

    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    const publicationLink = page.locator('a[data-publication-edit-link="true"]').first()
    await expect(publicationLink).toBeVisible()
    await publicationLink.click()

    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/publications/[^/]+$`))
    await expect(page.getByRole('link', { name: 'Queue', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).not.toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(page.locator('[data-publication-action="cancel"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark published', exact: true })).toHaveCount(0)

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
    await expect(page.locator('[data-publication-lifecycle="true"]')).toContainText(
        'Publication is locked'
    )
})

async function createAccountAndProject(page: Page, suffix: string) {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E detail ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-detail-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-detail-password')
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
    await page
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E detail project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
