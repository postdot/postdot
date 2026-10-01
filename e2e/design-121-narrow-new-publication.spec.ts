import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps failed publication feedback on its originating navigation entry', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await createChannel(page, `Feedback test ${suffix}`)
    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    const message = page.getByText('Add content or at least one media attachment.', { exact: true })
    await expect(message).toBeVisible()
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    await expect(message).toHaveCount(0)
    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'New publication', exact: true })).toBeVisible()
    await expect(message).toHaveCount(0)
})

test('resolves an interrupted composition before a new one can replace it', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await createChannel(page, `Recovery destination ${suffix}`)
    await page.getByRole('link', { name: 'New publication', exact: true }).click()

    const editor = page.getByRole('textbox', { name: 'Content', exact: true })
    await expect(page.locator('[data-new-publication-form="true"]')).not.toHaveAttribute(
        'inert',
        ''
    )
    const original = `Previous composition ${suffix}`
    const firstSave = page.waitForResponse(
        response =>
            response.url().includes('/publication-composer-draft') &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
    await editor.fill(original)
    await firstSave
    await page.reload()

    const recovery = page.locator('[data-new-publication-recovery="true"]')
    await expect(recovery).toBeVisible()
    await expect(recovery).toContainText(original)
    await expect(recovery).toHaveAttribute('role', 'dialog')
    await expect(recovery).toHaveAccessibleName('Previous draft')
    await page.keyboard.press('Escape')
    await expect(recovery).toBeVisible()
    await expect(page.locator('[data-new-publication-form="true"]')).toHaveAttribute('inert', '')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
    await recovery.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(recovery).toHaveCount(0)
    await expect(editor).toHaveValue(original)

    const secondSave = page.waitForResponse(
        response =>
            response.url().includes('/publication-composer-draft') &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
    await editor.fill(`Current composition ${suffix}`)
    await secondSave
    await page.reload()
    await expect(recovery).toContainText(`Current composition ${suffix}`)
    await recovery.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(recovery).toHaveCount(0)
    await expect(editor).toHaveValue('')
    await expect(page.locator('[data-new-publication-form="true"]')).not.toHaveAttribute(
        'inert',
        ''
    )
})

test('offers local recovery when composition autosave is unavailable', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await createChannel(page, `Local recovery ${suffix}`)
    await page.route('**/api/projects/*/publication-composer-draft', async route => {
        if (route.request().method() !== 'PUT') return route.continue()
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'unavailable', message: 'Unavailable' } }),
        })
    })
    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    const form = page.locator('[data-new-publication-form="true"]')
    await expect(form).not.toHaveAttribute('inert', '')
    const editor = page.getByRole('textbox', { name: 'Content', exact: true })
    const text = `Locally saved composition ${suffix}`
    await editor.fill(text)
    await expect
        .poll(() =>
            page.evaluate(() =>
                Object.values(localStorage).some(value =>
                    value.includes('Locally saved composition')
                )
            )
        )
        .toBe(true)
    await page.reload()
    const recovery = page.locator('[data-new-publication-recovery="true"]')
    await expect(recovery).toContainText(text)
    await expect(form).toHaveAttribute('inert', '')
    await recovery.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(editor).toHaveValue(text)
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
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/publications\/new(?:\?.*)?$/)
    await expect(page.getByRole('link', { name: 'New publication', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const firstDestination = page.getByRole('button', { name: firstChannelName, exact: true })
    const secondDestination = page.getByRole('button', { name: secondChannelName, exact: true })
    await expect(firstDestination).toBeVisible()
    await expect(secondDestination).toHaveCount(0)
    const availableDestination = page.getByRole('button', {
        name: `Add ${secondChannelName}`,
        exact: true,
    })
    await expect(availableDestination).toBeVisible()
    await expect(page.locator('[data-header-context="true"]')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Select workspace' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Select project' })).toBeVisible()
    await expect(page.locator('[data-dashboard-header="true"]')).not.toContainText('/')
    await page.getByRole('combobox', { name: 'Select workspace' }).click()
    await expect(page.getByRole('combobox', { name: 'Find a workspace...' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create workspace' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('combobox', { name: 'Find a workspace...' })).toBeHidden()
    await page.getByRole('combobox', { name: 'Select project' }).click()
    await expect(page.getByRole('combobox', { name: 'Find a project...' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create project' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Project configuration' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('combobox', { name: 'Find a project...' })).toBeHidden()
    await page.setViewportSize({ width: 320, height: 700 })
    await expectNoHorizontalOverflow(page)
    const scopeOverlap = await page.locator('[data-header-context="true"]').evaluate(context => {
        const workspace = context
            .querySelector('[data-context-kind="workspace"]')
            ?.getBoundingClientRect()
        const project = context
            .querySelector('[data-context-kind="project"]')
            ?.getBoundingClientRect()
        return workspace && project ? workspace.right - project.left : 0
    })
    expect(scopeOverlap).toBeLessThanOrEqual(0)
    await page.getByRole('combobox', { name: 'Select project' }).click()
    await page.getByRole('link', { name: 'Project configuration' }).click()
    await expect(page.getByRole('combobox', { name: 'Find a project...' })).toBeHidden()
    await expectNoHorizontalOverflow(page)
    await expect(page.locator('[data-header-context="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Back to project' }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await page.getByRole('button', { name: 'New publication', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })

    await expect(page.locator('[data-new-publication-workspace="true"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Publish to', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Source', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Destinations', exact: true })).toHaveCount(0)
    await expect(
        page.locator('[data-new-publication-workspace="true"] [data-publication-channel-selection]')
    ).toBeVisible()
    const scheduleDetails = page.locator('[data-publication-schedule-disclosure="true"]')
    await expect(scheduleDetails).not.toHaveAttribute('open')
    await expect(scheduleDetails).toContainText('Manual publication')
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

    await availableDestination.focus()
    await availableDestination.press('Enter')
    await expect(secondDestination).toBeVisible()
    await expect(secondDestination).toBeFocused()
    await expect(availableDestination).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    const removeSecondDestination = page.getByRole('button', {
        name: `Remove ${secondChannelName}`,
        exact: true,
    })
    await secondDestination.click()
    await removeSecondDestination.focus()
    await removeSecondDestination.press('Enter')
    await expect(availableDestination).toBeVisible()
    await expect(availableDestination).toBeFocused()
    await availableDestination.press('Enter')
    await expect(secondDestination).toBeVisible()

    await page.getByRole('button', { name: 'Common', exact: true }).click()
    const preview = page.locator('[data-publication-draft-preview="true"]')
    await expect(preview).toBeVisible()
    await expect(preview).toContainText(firstChannelName)
    await expect(page.getByRole('button', { name: 'Common', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    )

    await expect(page.getByLabel('Title', { exact: true })).toHaveCount(0)
    const sharedContent = 'E2E-121 narrow new publication content'
    await page.getByLabel('Content', { exact: true }).fill(sharedContent)
    await expect(preview.locator('[data-publication-preview-content="true"]')).toHaveText(
        sharedContent
    )
    await expect(preview).toContainText(firstChannelName)

    await secondDestination.click()
    const targetOverride = page.getByRole('textbox', {
        name: 'Channel content',
        exact: true,
    })
    const overrideContent = 'E2E-121 second-channel adaptation'
    await targetOverride.fill(overrideContent)
    await page.waitForResponse(
        response =>
            response.url().includes('/publication-composer-draft') &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
    await expect(preview.locator('[data-publication-preview-content="true"]')).toHaveText(
        overrideContent
    )
    await expect(preview).toContainText(secondChannelName)

    await page.getByRole('link', { name: 'Overview', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await page.getByRole('button', { name: 'New publication', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/publications\/new(?:\?.*)?$/)
    await expect(secondDestination).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-publication-preview-content="true"]')).toHaveText(
        overrideContent
    )

    await firstDestination.click()
    await expect(preview).toContainText(firstChannelName)
    await expect(preview.locator('[data-publication-preview-content="true"]')).toHaveText(
        sharedContent
    )

    await scheduleDetails.locator('> summary').click()
    await page.locator('#publication-default-schedule').click()
    const scheduleTime = page.locator('#publication-default-schedule-time')
    await scheduleTime.fill('23:59')
    await scheduleTime.press('Tab')

    const createResponse = await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/posts') && response.request().method() === 'POST',
            { timeout: 10_000 }
        ),
        page.getByRole('button', { name: 'Schedule 2 publications', exact: true }).click(),
    ]).then(([response]) => response)
    expect(createResponse.status(), await createResponse.text()).toBe(201)

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
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
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
