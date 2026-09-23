import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

type ComputedStyleView = {
    getComputedStyle: (element: unknown) => {
        overflowX: string
    }
}

test('wraps queue filters without introducing horizontal scrolling', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    await page.goto(page.url().replace(/\/overview$/, '/queue'))

    const filterList = page.getByRole('tablist').first()
    await expect(filterList).toBeVisible()

    for (const width of [1280, 768, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const metrics = await filterList.evaluate(element => {
            const view = element.ownerDocument.defaultView as unknown as ComputedStyleView
            const style = view.getComputedStyle(element)
            return {
                clientHeight: element.clientHeight,
                clientWidth: element.clientWidth,
                overflowX: style.overflowX,
                scrollHeight: element.scrollHeight,
                scrollWidth: element.scrollWidth,
            }
        })

        expect(metrics.overflowX).not.toBe('auto')
        expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1)
        expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.clientHeight)
        expect(metrics.clientWidth).toBeGreaterThan(0)
    }

    await page.getByRole('tab', { name: 'Drafts (0)', exact: true }).click()
    await expect(page).toHaveURL(/\/queue\?filter=draft$/)
    await expect(page.getByText('No drafts', { exact: true })).toBeVisible()
    await expect(page.locator('[data-publication-empty-state="true"]')).toBeVisible()
    await expect(page.locator('[data-publication-empty-illustration="true"]')).toHaveCount(1)
    await expect(page.getByText('Saved drafts will appear here.', { exact: true })).toHaveCount(0)

    await page.getByRole('tab', { name: 'All (0)', exact: true }).click()
    await expect(page).toHaveURL(/\/queue$/)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-121 filters ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-121-filters-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-121-filters-password')
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
        .fill(`E2E-121 filters project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
}
