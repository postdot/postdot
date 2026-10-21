import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps the empty project overview focused while Queue remains usable', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await expect(page.locator('[data-calendar="reui"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New publication', exact: true })).toBeVisible()
    await expect(
        page.locator('a[href*="/publications/new"]').filter({ hasText: 'New publication' })
    ).toHaveCount(1)

    await page.goto(page.url().replace(/\/overview(?:\?.*)?$/, '/queue'))
    await expect(page.getByText('Queue is empty', { exact: true })).toBeVisible()
    await expect(page.locator('[data-publication-empty-state="true"]')).toBeVisible()
    await expect(page.locator('[data-publication-empty-illustration="true"]')).toHaveCount(1)
    await expect(
        page.getByText('Create a publication to add work here.', { exact: true })
    ).toBeVisible()
    await expect(
        page.locator('a[href*="/publications/new"]').filter({ hasText: 'New publication' })
    ).toHaveCount(2)

    await page.getByRole('tab', { name: 'Needs attention (0)', exact: true }).click()
    await expect(page.getByText('Nothing needs attention', { exact: true })).toBeVisible()
    await expect(page.locator('[data-publication-empty-illustration="true"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Show all', exact: true })).toBeVisible()
    await expect(
        page.locator('a[href*="/publications/new"]').filter({ hasText: 'New publication' })
    ).toHaveCount(1)

    await page.getByRole('button', { name: 'Show all', exact: true }).click()
    await expect(page.getByText('Queue is empty', { exact: true })).toBeVisible()
})

async function createAccountAndProject(page: Page, suffix: string) {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-122 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-122-${suffix}@postbot.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-122-password')
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
        .fill(`E2E-122 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
}
