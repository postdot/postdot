import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test('distinguishes repeated platforms and creates a channel without leaving the composition', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    for (const [name, profile] of [
        ['Community announcements', 'manual-message'],
        ['X.com', 'x'],
        ['X.com', 'x'],
        ['LinkedIn', 'linkedin'],
        ['Discord', 'discord'],
        ['Mastodon', 'mastodon'],
    ]) {
        expect(
            (
                await page.request.post(`/api/projects/${projectId}/channels`, {
                    data: { name, profile },
                })
            ).status()
        ).toBe(201)
    }
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await expect(page.getByRole('heading', { name: en.nav_channels, exact: true })).toBeVisible()
    for (const theme of ['light', 'dark'] as const) {
        if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
            await page
                .getByRole('button', {
                    name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                    exact: true,
                })
                .click()
        }
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({ path: testInfo.outputPath(`channels-surfaces-${theme}.png`) })
    }
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    await expect(page.locator('[data-new-publication-form]')).toHaveAttribute('aria-busy', 'false')
    for (const theme of ['light', 'dark'] as const) {
        await page
            .getByRole('button', {
                name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                exact: true,
            })
            .click()
        await page.screenshot({ path: testInfo.outputPath(`compose-surfaces-${theme}.png`) })
    }

    const content = page.getByRole('textbox', {
        name: en.publication_new_source_content,
        exact: true,
    })
    const body = 'Keep this composition while choosing another destination.'
    await content.fill(body)
    const sidebar = page.locator('[data-slot="sidebar-inner"]')
    await expect(sidebar.getByRole('link', { name: en.nav_channels, exact: true })).toHaveCount(1)
    await expect(sidebar.locator('[data-channel-avatar]')).toHaveCount(0)
    const rail = page.locator('[data-publication-channel-selection]')
    const xA = en.publication_new_add_channel_named.replace('{channel}', 'X.com · A')
    const xB = en.publication_new_add_channel_named.replace('{channel}', 'X.com · B')
    await rail.getByRole('button', { name: xA, exact: true }).click()
    await rail.getByRole('button', { name: xB, exact: true }).click()
    await expect(rail.getByRole('button', { name: 'X.com · A', exact: true })).toBeVisible()
    await expect(rail.getByRole('button', { name: 'X.com · B', exact: true })).toBeVisible()
    await rail.getByRole('button', { name: 'X.com · B', exact: true }).click()
    await expect(rail.getByRole('button', { name: 'X.com · B', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await rail.getByRole('button', { name: en.channel_add, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: en.channel_x_profile, exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: en.channel_name, exact: true })).toHaveValue(
        'X.com C'
    )
    const order = await dialog.evaluate(element => {
        const choices = element.querySelector('[role="radiogroup"]')!
        const name = element.querySelector('#new-channel-name')!
        return choices.getBoundingClientRect().bottom <= name.getBoundingClientRect().top
    })
    expect(order).toBe(true)
    await dialog.getByRole('textbox', { name: en.channel_name, exact: true }).fill('X.com')
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    await expect(dialog).toContainText(en.channel_name_exists)
    await dialog.getByRole('textbox', { name: en.channel_name, exact: true }).fill('X.com C')
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    await expect(content).toHaveText(body)
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/publications/new$`))
    await expect(
        rail.getByRole('button', {
            name: en.publication_new_add_channel_named.replace('{channel}', 'X.com C · C'),
            exact: true,
        })
    ).toBeVisible()
    const createControl = await rail
        .getByRole('button', { name: en.channel_add, exact: true })
        .boundingBox()
    const availableControl = await rail.locator('[data-channel-available]').first().boundingBox()
    expect(createControl).not.toBeNull()
    expect(availableControl).not.toBeNull()
    expect(Math.abs(createControl!.y - availableControl!.y)).toBeLessThanOrEqual(1)
    expect(createControl!.height).toBe(availableControl!.height)
    for (const name of ['LinkedIn', 'Discord', 'Mastodon', 'X.com C · C']) {
        await rail
            .getByRole('button', {
                name: en.publication_new_add_channel_named.replace('{channel}', name),
                exact: true,
            })
            .click()
    }
    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        expect(
            await page
                .locator('[data-dashboard-scroll]')
                .evaluate(element => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({ path: testInfo.outputPath(`channel-rail-${width}.png`) })
    }
    await rail.getByRole('button', { name: 'X.com · A', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(rail.getByRole('button', { name: 'X.com · A', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    const editorTop = await page
        .locator('#new-post-content')
        .evaluate(element => element.getBoundingClientRect().top)
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    expect(
        await page
            .locator('#new-post-content')
            .evaluate(element => element.getBoundingClientRect().top)
    ).toBe(editorTop)
    await rail.getByRole('button', { name: 'X.com · A', exact: true }).click()
    await expect(
        rail.getByRole('button', {
            name: en.publication_new_remove_channel.replace('{channel}', 'X.com · B'),
            exact: true,
        })
    ).toHaveCount(0)
    const channelCopy = page.getByRole('textbox', {
        name: en.publication_new_channel_copy,
        exact: true,
    })
    await channelCopy.fill(`${body} A destination-only sentence.`)
    const removeA = rail.getByRole('button', {
        name: en.publication_new_remove_channel.replace('{channel}', 'X.com · A'),
        exact: true,
    })
    await removeA.click()
    const removal = page.getByRole('dialog')
    await expect(removal).toContainText(en.publication_remove_customized_description)
    await removal
        .getByRole('button', { name: en.publication_remove_customized_cancel, exact: true })
        .click()
    await expect(channelCopy).toHaveText(`${body} A destination-only sentence.`)
    await removeA.click()
    await removal
        .getByRole('button', { name: en.publication_remove_customized_confirm, exact: true })
        .click()
    await expect(rail.getByRole('button', { name: 'X.com · A', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    await expect(content).toHaveText(body)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-124 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-124-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-124-password')
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
        .fill(`E2E-124 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}

test('keeps Bluesky connection failures inside the dialog and preserves the handle', async ({
    page,
}) => {
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    expect(
        (
            await page.request.post(`/api/projects/${projectId}/channels`, {
                data: { name: 'Bluesky test', profile: 'bluesky' },
            })
        ).status()
    ).toBe(201)
    await page.route('**/publisher/bluesky/connect', route =>
        route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
                error: { code: 'provider_unavailable', message: 'Unavailable' },
            }),
        })
    )
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await expect(page.getByText(en.publisher_oauth_setup_required, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect Bluesky', exact: true })).toHaveCount(0)
    await page.route('**/publishers', async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({
            response,
            json: { ...body, oauthReadiness: { ...body.oauthReadiness, bluesky: 'ready' } },
        })
    })
    await page.reload()
    await page.getByRole('button', { name: 'Connect Bluesky', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const handle = dialog.getByLabel(en.provider_handle, { exact: true })
    await handle.fill('test.bsky.social')
    await dialog.getByRole('button', { name: en.provider_continue, exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(en.api_provider_unavailable)
    await expect(handle).toHaveValue('test.bsky.social')
    await expect(page.getByText(en.api_provider_unavailable, { exact: true })).toHaveCount(1)
    await handle.fill('other.bsky.social')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
})
