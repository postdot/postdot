import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps narrow compose and queue usable with long channel names', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const firstChannelName = `E2E-121 long destination alpha ${suffix} for a publishing workspace`
    const secondChannelName = `E2E-121 long destination beta ${suffix} for a publishing workspace`
    const publicationTitle = `E2E-121 narrow compose ${suffix}`

    await createAccountAndProject(page, suffix)

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await createChannel(page, firstChannelName)
    await createChannel(page, secondChannelName)

    await page.getByRole('link', { name: 'Compose', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/compose$/)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const firstTab = page.getByRole('tab', { name: new RegExp(firstChannelName) })
    const addDestination = page.getByRole('button', { name: 'Add destination', exact: true })
    await expect(firstTab).toBeVisible()
    await expect(addDestination).toBeVisible()

    await firstTab.focus()
    await expect(firstTab).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(addDestination).toBeFocused()
    await page.keyboard.press('Enter')

    const secondTab = page.getByRole('tab', { name: new RegExp(secondChannelName) })
    await expect(secondTab).toBeVisible()
    await expect(secondTab).toHaveAttribute('aria-selected', 'true')
    await expectNoHorizontalOverflow(page)

    await page.getByLabel('Title', { exact: true }).fill(publicationTitle)
    await page.getByLabel('Content', { exact: true }).fill('E2E-121 narrow compose content')
    await page.getByRole('button', { name: 'Schedule 2', exact: true }).click()

    await page.getByRole('button', { name: 'Toggle workspace navigation', exact: true }).click()
    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/queue$/)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expectNoHorizontalOverflow(page)
    await expect(page.getByRole('link').filter({ hasText: publicationTitle })).toHaveCount(2)

    await page.setViewportSize({ width: 768, height: 900 })
    await expectNoHorizontalOverflow(page)
})

async function createChannel(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await page.getByLabel('Channel name').fill(name)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: name }).first()).toBeVisible()
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
    const layout = await page.locator('[data-dashboard-scroll]').evaluate(scrollRegion => ({
        clientWidth: (scrollRegion as unknown as { clientWidth: number }).clientWidth,
        scrollWidth: (scrollRegion as unknown as { scrollWidth: number }).scrollWidth,
    }))
    expect(
        layout.scrollWidth,
        'dashboard content should not overflow horizontally'
    ).toBeLessThanOrEqual(layout.clientWidth)
}
