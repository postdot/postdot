import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

type ComputedStyleView = {
    getComputedStyle: (element: unknown) => {
        gap: string
        margin: string
        padding: string
    }
}

test('keeps the workspace navigation reachable when reduced and on mobile', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const toggle = page.getByRole('button', { name: 'Toggle workspace navigation', exact: true })
    await toggle.click()
    await expect(page.getByRole('link', { name: 'Calendar', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Calendar', exact: true }).click()
    await expect(page).toHaveURL(/\/calendar$/)

    const monthCalendar = page.locator('[data-calendar-view="month"]')
    await expect(monthCalendar).toBeVisible()
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-variant', 'inset')
    await expect(page.locator('[data-slot="sidebar-inset"]')).toBeVisible()

    const calendarLayout = await monthCalendar.evaluate(calendar => {
        const grid = calendar.firstElementChild
        if (grid === null) {
            throw new Error('Expected the month calendar to contain a grid')
        }

        const firstDay = grid.querySelector('[role="gridcell"] > a')
        if (firstDay === null) {
            throw new Error('Expected the month calendar to contain a day cell')
        }

        const view = calendar.ownerDocument.defaultView as unknown as ComputedStyleView
        const gridStyle = view.getComputedStyle(grid)
        const dayStyle = view.getComputedStyle(firstDay)
        return {
            dayMargin: dayStyle.margin,
            gridGap: gridStyle.gap,
            gridPadding: view.getComputedStyle(calendar).padding,
        }
    })
    expect(calendarLayout.gridGap).not.toBe('0px')
    expect(calendarLayout.gridPadding).not.toBe('0px')
    expect(calendarLayout.dayMargin).toBe('0px')

    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Calendrier', exact: true })).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(50)
    await expect(page.getByRole('heading', { name: 'Calendrier', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page
        .getByRole('button', {
            name: 'Afficher ou masquer la navigation de l’espace de travail',
            exact: true,
        })
        .click()
    await expect(
        page.getByRole('navigation', { name: 'Navigation du travail', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fermer', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fermer', exact: true }).click()
    await expect(
        page.getByRole('navigation', { name: 'Navigation du travail', exact: true })
    ).toBeHidden()

    await page
        .getByRole('button', {
            name: 'Afficher ou masquer la navigation de l’espace de travail',
            exact: true,
        })
        .click()
    await expect(page.getByRole('link', { name: 'Composer', exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Composer', exact: true }).click()
    await expect(page).toHaveURL(/\/compose$/)
    await expectNoHorizontalOverflow(page)
})

async function expectNoHorizontalOverflow(page: Page) {
    const layout = await page.locator('[data-dashboard-scroll]').evaluate(scrollRegion => ({
        clientWidth: (scrollRegion as unknown as { clientWidth: number }).clientWidth,
        scrollWidth: (scrollRegion as unknown as { scrollWidth: number }).scrollWidth,
    }))
    expect(
        layout.scrollWidth,
        'dashboard content should not overflow horizontally'
    ).toBeLessThanOrEqual(layout.clientWidth)
}

async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-121 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-121-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-121-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByText('Create project', { exact: true }).click()
    await page.locator('#new-project').fill(`E2E-121 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
}
