import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps instance settings separate from project navigation', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('button', { name: 'Open account menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await page.goto(`/dashboard/settings?projectId=${projectId}`)

    await expect(page).toHaveURL(/\/dashboard\/settings(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Installation administration', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Work navigation', exact: true })
    ).toHaveCount(0)
    await expect(
        page.getByRole('navigation', { name: 'Project management navigation', exact: true })
    ).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'OAuth applications', exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'OAuth applications', exact: true }).click()

    await page.goto('/dashboard/settings/provider-applications')

    await expect(page).toHaveURL(/\/dashboard\/settings\/provider-applications$/)
    await expect(
        page.getByRole('heading', { name: 'OAuth applications', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Installation administration', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Work navigation', exact: true })
    ).toHaveCount(0)
    await expect(
        page.getByRole('navigation', { name: 'Project management navigation', exact: true })
    ).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Calendar', exact: true })).toHaveCount(0)

    await page.goto('/dashboard/settings/workspace')

    await expect(page).toHaveURL(/\/dashboard\/settings\/workspace(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'Members & groups', exact: true })).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Workspace navigation', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Installation administration', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Work navigation', exact: true })
    ).toHaveCount(0)
    await expect(
        page.getByRole('navigation', { name: 'Project management navigation', exact: true })
    ).toHaveCount(0)
    await expect(
        page
            .locator('[data-dashboard-header="true"]')
            .getByRole('combobox', { name: 'Select workspace', exact: true })
    ).toBeVisible()

    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(
        page.getByRole('navigation', { name: 'Work navigation', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
})

test('keeps the workspace administration error state actionable', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    const workspaceSummaryRoute = '**/api/workspaces/**'
    await page.route(workspaceSummaryRoute, async route => {
        const pathname = new URL(route.request().url()).pathname
        if (route.request().method() === 'GET' && pathname.split('/').length === 4) {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: { code: 'internal_error', message: 'Workspace load failed' },
                }),
            })
            return
        }
        await route.continue()
    })

    await page.goto('/dashboard/settings/workspace')
    await expect(page.getByRole('heading', { name: 'Members & groups', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('The server could not complete the action.')
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(page.locator('main').getByRole('status')).toHaveCount(0)

    await page.unroute(workspaceSummaryRoute)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-121 scope ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-121-scope-${suffix}@postbot.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-121-scope-password')
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
        .fill(`E2E-121 scope project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}
