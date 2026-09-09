import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('makes the calendar the first project view while keeping Queue focused', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await expect(page.locator('[data-calendar-view="month"]')).toBeVisible()
    await expect(
        page.getByText('Schedule a destination to make it appear on the project calendar.', {
            exact: true,
        })
    ).toBeVisible()
    await expect(
        page.locator('a[href*="/compose"]').filter({ hasText: 'New publication' })
    ).toHaveCount(1)

    await page.goto(page.url().replace(/\/overview$/, '/queue'))
    await expect(page.getByText('Queue is empty', { exact: true })).toBeVisible()
    await expect(
        page.getByText('Create a publication to add work here.', { exact: true })
    ).toBeVisible()
    await expect(
        page.locator('a[href*="/compose"]').filter({ hasText: 'New publication' })
    ).toHaveCount(2)

    await page.getByRole('tab', { name: 'Needs attention (0)', exact: true }).click()
    await expect(page.getByText('Nothing needs attention', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show all', exact: true })).toBeVisible()
    await expect(
        page.locator('a[href*="/compose"]').filter({ hasText: 'New publication' })
    ).toHaveCount(1)

    await page.getByRole('button', { name: 'Show all', exact: true }).click()
    await expect(page.getByText('Queue is empty', { exact: true })).toBeVisible()
})

async function createAccountAndProject(page: Page, suffix: string) {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-122 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-122-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-122-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByText('Create project', { exact: true }).click()
    await page.locator('#new-project').fill(`E2E-122 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
}
