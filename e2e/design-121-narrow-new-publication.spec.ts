import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps failed publication feedback on its originating navigation entry', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await createChannel(page, `Feedback test ${suffix}`)
    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    const message = page.getByText('Add content or at least one media attachment.', { exact: true })
    await expect(message).toBeVisible()
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    await expect(message).toHaveCount(0)
    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'New publication', exact: true })).toBeVisible()
    await expect(message).toHaveCount(0)
})

test('keeps narrow new-publication flow and queue usable with long channel names', async ({
    page,
}) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const firstChannelName = `E2E-121 long destination alpha ${suffix} for a publishing workspace`
    const secondChannelName = `E2E-121 long destination beta ${suffix} for a publishing workspace`

    await createAccountAndProject(page, suffix)

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    await createChannel(page, firstChannelName)
    await createChannel(page, secondChannelName)

    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/publications\/new$/)
    await expect(page.getByRole('link', { name: 'New publication', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const firstTab = page.getByRole('button', { name: new RegExp(firstChannelName) })
    const addChannel = page.getByRole('button', { name: secondChannelName, exact: true })
    await expect(firstTab).toBeVisible()
    await expect(addChannel).toBeVisible()

    await expect(page.locator('[data-new-publication-workspace="true"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Publish to', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Source', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Destinations', exact: true })).toHaveCount(0)
    await expect(
        page.locator('[data-new-publication-workspace="true"] [data-publication-channel-selection]')
    ).toBeVisible()
    await expect(
        page.locator('[data-new-publication-workspace="true"] [data-publication-shared-settings]')
    ).toBeVisible()
    const workspaceOrder = await page
        .locator('[data-new-publication-workspace="true"]')
        .evaluate(element =>
            Array.from(
                element.querySelectorAll(
                    '[data-publication-channel-selection], [data-publication-shared-settings]'
                )
            ).map(item =>
                item.hasAttribute('data-publication-channel-selection') ? 'channels' : 'settings'
            )
        )
    expect(workspaceOrder).toEqual(['channels', 'settings'])

    await firstTab.focus()
    await expect(firstTab).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(addChannel).toBeFocused()
    await page.keyboard.press('Enter')

    const secondTab = page.getByRole('button', { name: new RegExp(secondChannelName) })
    await expect(secondTab).toBeVisible()
    await expect(secondTab).toHaveAttribute('data-active-channel', 'true')
    await expectNoHorizontalOverflow(page)

    const preview = page.locator('[data-publication-draft-preview="true"]')
    await expect(preview).toBeVisible()

    await expect(page.getByLabel('Title', { exact: true })).toHaveCount(0)
    const sharedContent = 'E2E-121 narrow new publication content'
    await page.getByLabel('Content', { exact: true }).fill(sharedContent)
    await expect(preview.locator('[data-publication-preview-content="true"]')).toHaveText(
        sharedContent
    )
    await expect(preview).toContainText(secondChannelName)

    await page.getByRole('button', { name: 'Customize for this channel', exact: true }).click()
    const targetOverride = page.getByRole('textbox', {
        name: 'Channel content',
        exact: true,
    })
    const overrideContent = 'E2E-121 second-channel adaptation'
    await targetOverride.fill(overrideContent)
    await expect(preview.locator('[data-publication-preview-content="true"]')).toHaveText(
        overrideContent
    )

    await firstTab.click()
    await expect(firstTab).toHaveAttribute('data-active-channel', 'true')
    await expect(preview).toContainText(firstChannelName)
    await expect(preview.locator('[data-publication-preview-content="true"]')).toHaveText(
        sharedContent
    )

    await page.getByRole('button', { name: 'Schedule 2', exact: true }).click()

    await page.getByRole('button', { name: 'Toggle workspace navigation', exact: true }).click()
    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/queue$/)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expectNoHorizontalOverflow(page)
    const publicationLinks = page.locator('a[data-publication-edit-link="true"]')
    await expect(publicationLinks).toHaveCount(2)
    await expect(publicationLinks.nth(0)).toContainText('E2E-121 narrow new publication content')

    await page.setViewportSize({ width: 768, height: 900 })
    await expectNoHorizontalOverflow(page)
})

async function createChannel(page: Page, name: string): Promise<void> {
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Channel name').fill(name)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: name }).first()).toBeVisible()
}

async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-121 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-121-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-121-password')
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
        .fill(`E2E-121 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
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
