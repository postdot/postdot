import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('makes the calendar the first project view while keeping Queue focused', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await expect(page.locator('[data-calendar="reui"]')).toBeVisible()
    await expect(page.locator('[data-calendar-view="month"]')).toBeVisible()
    await expect(
        page.locator('a[href*="/publications/new"]').filter({ hasText: 'New publication' })
    ).toHaveCount(2)

    await page.setViewportSize({ width: 1280, height: 900 })
    const calendar = page.locator('[data-calendar="reui"]')
    await calendar.getByRole('button', { name: 'Week', exact: true }).click()
    const emptyWeek = calendar.locator('[data-calendar-view="week"]')
    await expect(emptyWeek).toBeVisible()
    await expect(emptyWeek.locator('[data-slot="event-calendar-time-grid"]')).toBeVisible()
    await expect(
        emptyWeek.locator('[data-slot="event-calendar-time-slot"]').first()
    ).toHaveAttribute('data-time', '00:00')
    expect(
        await emptyWeek
            .locator('[data-slot="event-calendar-time-grid-scroll"]')
            .evaluate(element => element.scrollTop)
    ).toBe(0)

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
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-122 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-122-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-122-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    await page.locator('#new-project').fill(`E2E-122 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
}
