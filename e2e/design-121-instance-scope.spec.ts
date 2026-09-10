import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps instance settings separate from project navigation', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('link', { name: 'Settings', exact: true }).click()

    await expect(page).toHaveURL(
        new RegExp(`/dashboard/settings/provider-applications\\?projectId=${projectId}$`)
    )
    await expect(page.getByRole('combobox', { name: 'Select project' }).first()).toHaveText(
        `E2E-121 scope project ${suffix}`
    )
    const dashboardHeader = page.locator('[data-dashboard-header="true"]:visible')
    await expect(
        dashboardHeader.getByText('Instance settings', { exact: true }).first()
    ).toBeVisible()
    await expect(dashboardHeader.first()).not.toContainText(`E2E-121 scope project ${suffix}`)
    await expect(
        page.getByText('Configure OAuth apps shared across Herald projects.', { exact: true })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Overview', exact: true }).first()).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Project management navigation', exact: true }).first()
    ).toBeVisible()

    await page.getByRole('link', { name: 'Overview', exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/overview$`))

    await page.goto('/dashboard/settings/provider-applications')

    await expect(page).toHaveURL(/\/dashboard\/settings\/provider-applications$/)
    await expect(
        page.getByRole('heading', { name: 'Provider applications', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Instance settings navigation', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Work navigation', exact: true })
    ).toHaveCount(0)
    await expect(
        page.getByRole('navigation', { name: 'Project management navigation', exact: true })
    ).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Calendar', exact: true })).toHaveCount(0)

    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(
        page.getByRole('navigation', { name: 'Work navigation', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-121 scope ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-121-scope-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-121-scope-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByText('Create project', { exact: true }).click()
    await page.locator('#new-project').fill(`E2E-121 scope project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}
