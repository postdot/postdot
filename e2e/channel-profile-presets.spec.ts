import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('offers provider profiles as editable custom channel starters', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const channelName = `E2E-142 preset channel ${suffix}`
    await createAccountAndProject(page, suffix)

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Channel name').fill(channelName)

    await page.getByRole('radio', { name: 'Custom runtime profile', exact: true }).click()

    const starter = page.getByRole('combobox', { name: 'Starter template', exact: true })
    await starter.click()
    await expect(page.getByRole('option', { name: 'Bluesky post', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'Bluesky post', exact: true }).click()

    await expect(
        page.getByText('A copy of the provider profile. Edit it to fit this custom channel.', {
            exact: true,
        })
    ).toBeVisible()
    const profileJson = page.getByLabel('Custom profile JSON')
    await expect(profileJson).toHaveValue(/"id": "custom-bluesky"/)
    await expect(profileJson).toHaveValue(/"origin": "custom"/)
    await expect(profileJson).toHaveValue(/"contractId": "bluesky"/)

    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()
})

test('makes profile impact inspectable without activating or rewriting publications', async ({
    page,
}, info) => {
    test.setTimeout(60_000)
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click()
    const projectId = new URL(page.url()).pathname.split('/')[3]!
    const channelName = `Impact channel ${suffix}`
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: channelName },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    const profileUrl = `/api/projects/${projectId}/channels/${channel.id}/profile`
    const originalProfile = (await (await page.request.get(profileUrl)).json()).active
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: `Manage ${channelName}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const json = dialog.getByLabel('Profile JSON', { exact: true })
    await expect(json).toHaveValue(/manual-message/)
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    const impact = dialog.locator('[data-profile-impact]')
    await expect(impact).toContainText(
        'No editable drafts or pending publications use this channel.'
    )
    await expect(json).not.toBeVisible()
    await expect(
        dialog.getByRole('button', { name: 'Activate profile', exact: true })
    ).toBeEnabled()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()

    const publications = []
    for (const [title, body] of [
        ['Short publication', 'OK'],
        ['Long publication', 'This publication has a longer body.'],
    ]) {
        const response = await page.request.post(`/api/projects/${projectId}/posts`, {
            data: {
                title,
                sourceContent: { body: { text: body, format: 'plain_text' }, media: [] },
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'manual',
                        scheduledAt: Date.now() + 86_400_000,
                        targetContent: { body, media: [] },
                    },
                ],
            },
        })
        expect(response.status()).toBe(201)
        publications.push((await response.json()).publications[0])
    }
    const baseline = await Promise.all(
        publications.map(
            async publication =>
                (
                    await (
                        await page.request.get(
                            `/api/projects/${projectId}/publications/${publication.id}/editor`
                        )
                    ).json()
                ).editor
        )
    )
    const namesRoute = `**/api/projects/${projectId}/publications?*`
    await page.route(namesRoute, async route => {
        if (new URL(route.request().url()).searchParams.get('limit') === '100') {
            await route.fulfill({
                status: 503,
                json: { error: { code: 'test_unavailable', message: 'Names unavailable' } },
            })
        } else await route.continue()
    })
    await page.reload()
    await page.getByRole('button', { name: `Manage ${channelName}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    await expect(json).toHaveValue(/manual-message/)
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    await expect(impact).toContainText('Publication names could not be loaded.')
    await expect(impact.locator('[data-profile-impact-publication]')).toHaveCount(2)
    await expect(
        impact.getByRole('link', { name: 'Inspect publication', exact: true })
    ).toHaveCount(2)
    await page.unroute(namesRoute)
    await impact.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(impact.getByText('Short publication', { exact: true })).toBeVisible()
    await expect(impact.locator('[data-profile-impact-publication]')).toHaveCount(2)
    await expect(impact).not.toContainText('Needs review')
    await expect(
        dialog.getByRole('button', { name: 'Activate profile', exact: true })
    ).toBeEnabled()

    await dialog.locator('details > summary').filter({ hasText: 'Profile JSON' }).click()
    const proposed = JSON.parse(await json.inputValue())
    proposed.profileHash = `sha256:impact-profile-${suffix}`
    proposed.schemaHash = `sha256:impact-schema-${suffix}`
    proposed.contentSchema.properties.body.maxLength = 12
    proposed.capabilities.textFields.find(
        (field: { bindingId: string }) => field.bindingId === 'body'
    ).maxLength = 12
    await json.fill(JSON.stringify(proposed, null, 2))
    await expect(impact).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeDisabled()
    await expect(
        dialog.getByRole('button', { name: 'Activate profile', exact: true })
    ).toBeDisabled()
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    const longRow = impact.locator(`[data-profile-impact-publication="${publications[1].id}"]`)
    await expect(longRow).toContainText('Long publication')
    await expect(longRow).toContainText('Working draft')
    await expect(longRow).toContainText('Selected target awaiting delivery')
    await expect(longRow.getByText('Needs review', { exact: true })).toHaveCount(2)
    await expect(longRow).toContainText('/body')
    await expect(impact.locator('[data-profile-impact-publication]').first()).toHaveAttribute(
        'data-profile-impact-publication',
        publications[1].id
    )
    await expect(
        dialog.getByRole('button', { name: 'Activate profile', exact: true })
    ).toBeDisabled()
    await expect(
        longRow.getByRole('link', { name: 'Inspect publication', exact: true })
    ).toHaveAttribute('href', `/dashboard/projects/${projectId}/publications/${publications[1].id}`)

    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(longRow.getByRole('link')).toBeVisible()
        const dimensions = await dialog.evaluate(element => ({
            client: element.clientWidth,
            scroll: element.scrollWidth,
        }))
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
        await page.screenshot({ path: info.outputPath(`profile-impact-${width}.png`) })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click()
    await page.getByRole('button', { name: `Manage ${channelName}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    await expect(json).toHaveValue(/manual-message/)
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    await expect(longRow).toContainText('Long publication')
    await page.screenshot({ path: info.outputPath('profile-impact-dark.png') })
    expect((await (await page.request.get(profileUrl)).json()).active).toEqual(originalProfile)
    for (const [index, publication] of publications.entries()) {
        expect(
            (
                await (
                    await page.request.get(
                        `/api/projects/${projectId}/publications/${publication.id}/editor`
                    )
                ).json()
            ).editor
        ).toEqual(baseline[index])
    }
    await longRow.getByRole('link', { name: 'Inspect publication', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/publications/${publications[1].id}$`))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('#source-body')).toContainText('This publication has a longer body.')
})

async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-142 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-142-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-142-password')
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
        .fill(`E2E-142 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
}
