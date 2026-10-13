import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

test('keeps core project surfaces free of automated accessibility violations', async ({ page }) => {
    test.setTimeout(60_000)

    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))

    for (const path of ['overview', 'performance', 'queue', 'media', 'channels']) {
        await page.goto(`/dashboard/projects/${projectId}/${path}`)
        await expect(page.locator('[data-dashboard-scroll]')).toBeVisible()

        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, `Accessibility violations on ${path}`).toEqual([])
    }
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postbot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E accessibility ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-accessibility-${suffix}@postbot.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-accessibility-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    await page.goto('/dashboard?projectId=none')
    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    await page
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E accessibility project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const projectId = page.url().match(/\/projects\/([^/]+)\/overview$/)?.[1]
    if (projectId === undefined) throw new Error('Expected the created project id in the URL')
    return projectId
}
