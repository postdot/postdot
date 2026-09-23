import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps narrow new-publication flow and queue usable with long channel names', async ({
    page,
}) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const firstChannelName = `E2E-121 long destination alpha ${suffix} for a publishing workspace`
    const secondChannelName = `E2E-121 long destination beta ${suffix} for a publishing workspace`
    const publicationTitle = `E2E-121 narrow new publication ${suffix}`

    await createAccountAndProject(page, suffix)

    await page.locator('a[href$="/publications/new"]').click()
    await expect(page.locator('[data-publication-draft-preview="true"]')).toHaveCount(0)
    await expect(
        page.getByText('Add a channel before scheduling a publication.', { exact: true })
    ).toBeVisible()

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await createChannel(page, firstChannelName)
    await createChannel(page, secondChannelName)

    await page.getByRole('button', { name: 'New publication', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/publications\/new$/)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const firstTab = page.getByRole('tab', { name: new RegExp(firstChannelName) })
    const addChannel = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(firstTab).toBeVisible()
    await expect(addChannel).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Publish to', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Source', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Destinations', exact: true })).toHaveCount(0)
    await expect(
        page.locator(
            '[data-new-publication-publish-to="true"] [data-publication-channel-selection]'
        )
    ).toBeVisible()
    await expect(
        page.locator('[data-new-publication-publish-to="true"] [data-publication-shared-settings]')
    ).toBeVisible()
    const publishToOrder = await page
        .locator('[data-new-publication-publish-to="true"]')
        .evaluate(element =>
            Array.from(
                element.querySelectorAll(
                    '[data-publication-channel-selection], [data-publication-shared-settings]'
                )
            ).map(item =>
                item.hasAttribute('data-publication-channel-selection') ? 'channels' : 'settings'
            )
        )
    expect(publishToOrder).toEqual(['channels', 'settings'])

    await firstTab.focus()
    await expect(firstTab).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(addChannel).toBeFocused()
    await page.keyboard.press('Enter')

    const secondTab = page.getByRole('tab', { name: new RegExp(secondChannelName) })
    await expect(secondTab).toBeVisible()
    await expect(secondTab).toHaveAttribute('aria-selected', 'true')
    await expectNoHorizontalOverflow(page)

    const preview = page.locator('[data-publication-draft-preview="true"]')
    await expect(preview).toBeVisible()

    await page.getByLabel('Title', { exact: true }).fill(publicationTitle)
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
    await expect(firstTab).toHaveAttribute('aria-selected', 'true')
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

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
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
