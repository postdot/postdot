import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import { switchTheme } from './locale'

const png = readFileSync(new URL('./fixtures/identity.png', import.meta.url))

test('uploads a project image and uses a channel website favicon throughout Studio', async ({
    page,
}, info) => {
    test.setTimeout(90_000)
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/setup')
    await page.getByLabel('Name', { exact: true }).fill(`Identity owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(`identity-${suffix}@postdot.local`)
    await page.getByLabel('Password', { exact: true }).fill('identity-e2e-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    const projectResponse = await page.request.post('/api/projects', {
        data: { name: `Identity project ${suffix}` },
    })
    expect(projectResponse.status()).toBe(201)
    const { project } = await projectResponse.json()
    await page.goto(`/dashboard/projects/${project.id}/settings`)
    const imageSection = page.getByRole('region', { name: en.identity_image, exact: true })
    await imageSection
        .locator('input[type="file"]')
        .setInputFiles({ name: 'project.png', mimeType: 'image/png', buffer: Buffer.from(png) })
    await imageSection.getByRole('button', { name: en.common_save, exact: true }).click()
    // Save shows only while something is unsaved.
    await expect(
        imageSection.getByRole('button', { name: en.common_save, exact: true })
    ).toHaveCount(0)
    const persisted = (await (await page.request.get('/api/projects')).json()).projects.find(
        (item: { id: string }) => item.id === project.id
    )
    expect(persisted.imageUrl).toMatch(/^\/api\/identity-images\/[a-f0-9]{64}$/)
    await expect(page.locator('[data-context-kind="project"] img')).toHaveAttribute(
        'src',
        persisted.imageUrl
    )
    await expect
        .poll(() =>
            page
                .locator('[data-context-kind="project"] img')
                .evaluate((element: HTMLImageElement) => element.naturalWidth)
        )
        .toBeGreaterThan(0)
    const projectAvatar = imageSection.locator('[data-resource-avatar]')
    await imageSection
        .locator('input[type="file"]')
        .setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(png) })
    await expect(projectAvatar.locator('img')).toHaveAttribute('src', /^blob:/)
    await expect(imageSection.getByText(en.identity_upload_selected, { exact: true })).toBeVisible()
    await imageSection.getByRole('button', { name: en.identity_undo_change, exact: true }).click()
    await expect(projectAvatar.locator('img')).toHaveAttribute('src', persisted.imageUrl)
    await expect(
        imageSection.getByRole('button', { name: en.identity_undo_change, exact: true })
    ).toHaveCount(0)
    await expect(
        imageSection.getByRole('button', { name: en.common_save, exact: true })
    ).toHaveCount(0)
    await page.goto('/dashboard?projectId=none')
    await expect(
        page.locator(`a[href="/dashboard/projects/${project.id}/overview"] img`).first()
    ).toHaveAttribute('src', persisted.imageUrl)

    const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: `Site ${suffix}` },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'Platform brand', profile: 'bluesky' },
    })
    await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'A longer custom channel name for the editorial announcements' },
    })
    await page.goto(`/dashboard/projects/${project.id}/channels`)
    const row = page.getByRole('article').filter({ hasText: `Site ${suffix}` })
    await row
        .getByRole('button', {
            name: en.channel_manage.replace('{channel}', channel.name),
            exact: true,
        })
        .click()
    await page.getByRole('menuitem', { name: en.channel_rename, exact: true }).click()
    const dialog = page.getByRole('dialog', {
        name: en.channel_lifecycle_rename_title,
        exact: true,
    })
    const website = `http://127.0.0.1:${process.env.POSTDOT_E2E_RECEIVER_PORT}/identity`
    await dialog.getByLabel(en.identity_website, { exact: true }).fill(website)
    await dialog.getByRole('button', { name: en.common_save, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const updated = (
        await (await page.request.get(`/api/projects/${project.id}/channels`)).json()
    ).channels.find((item: { id: string }) => item.id === channel.id)
    expect(updated).toMatchObject({ websiteUrl: website, imageSource: 'favicon' })
    await expect(row.locator('[data-channel-avatar] img')).toHaveAttribute('src', updated.imageUrl)
    await expect
        .poll(() =>
            row
                .locator('[data-channel-avatar] img')
                .evaluate((element: HTMLImageElement) => element.naturalWidth)
        )
        .toBeGreaterThan(0)
    await expect(
        page
            .getByRole('article')
            .filter({ hasText: 'Platform brand' })
            .locator('[data-channel-avatar] svg')
    ).toBeVisible()

    await page.goto(
        `/dashboard/settings/workspace/settings?workspaceId=${project.workspaceId}&projectId=${project.id}`
    )
    const workspaceSection = page.getByRole('region', { name: en.identity_image, exact: true })
    await workspaceSection
        .getByRole('button', { name: en.identity_change_image, exact: true })
        .click()
    await page.getByRole('menuitem', { name: en.identity_from_url, exact: true }).click()
    const imageUrlDialog = page.getByRole('dialog', { name: en.identity_from_url, exact: true })
    await imageUrlDialog
        .getByLabel(en.identity_image_url, { exact: true })
        .fill(`http://127.0.0.1:${process.env.POSTDOT_E2E_RECEIVER_PORT}/identity/icon.png`)
    await expect
        .poll(() =>
            imageUrlDialog.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)
        )
        .toBeGreaterThan(0)
    await imageUrlDialog.getByRole('button', { name: en.common_cancel, exact: true }).click()
    await workspaceSection
        .getByRole('button', { name: en.identity_change_image, exact: true })
        .click()
    await page.getByRole('menuitem', { name: en.identity_from_url, exact: true }).click()
    await expect(imageUrlDialog.getByLabel(en.identity_image_url, { exact: true })).toHaveValue('')
    await imageUrlDialog
        .getByLabel(en.identity_image_url, { exact: true })
        .fill(`http://127.0.0.1:${process.env.POSTDOT_E2E_RECEIVER_PORT}/identity/missing.png`)
    await expect(
        imageUrlDialog.getByText(en.identity_url_no_preview, { exact: true })
    ).toBeVisible()
    await imageUrlDialog
        .getByLabel(en.identity_image_url, { exact: true })
        .fill(`http://127.0.0.1:${process.env.POSTDOT_E2E_RECEIVER_PORT}/identity/icon.png`)
    await expect
        .poll(() =>
            imageUrlDialog.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)
        )
        .toBeGreaterThan(0)
    await imageUrlDialog.getByRole('button', { name: en.identity_choose, exact: true }).click()
    await workspaceSection.getByRole('button', { name: en.common_save, exact: true }).click()
    // Save shows only while something is unsaved.
    await expect(
        workspaceSection.getByRole('button', { name: en.common_save, exact: true })
    ).toHaveCount(0)
    await expect(page.locator('[data-context-kind="workspace"] img')).toHaveAttribute(
        'src',
        updated.imageUrl
    )
    for (const theme of ['light', 'dark'] as const) {
        await switchTheme(page, theme)
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await page.screenshot({ path: info.outputPath(`image-settings-${theme}-${width}.png`) })
        }
    }
    await workspaceSection
        .getByRole('button', { name: en.identity_change_image, exact: true })
        .click()
    await page.getByRole('menuitem', { name: en.identity_use_default, exact: true }).click()
    await expect(
        workspaceSection.getByText(en.identity_remove_selected, { exact: true })
    ).toBeVisible()
    await workspaceSection.getByRole('button', { name: en.common_save, exact: true }).click()
    await expect(
        workspaceSection.getByRole('button', { name: en.common_save, exact: true })
    ).toHaveCount(0)
    await expect(workspaceSection.locator('[data-resource-avatar] img')).toHaveCount(0)
    await expect(workspaceSection.locator('[data-resource-avatar]')).toHaveText('MW')
    await expect(page.locator('[data-context-kind="workspace"] img')).toHaveCount(0)
    await page.goto(`/dashboard/projects/${project.id}/channels`)
    for (const theme of ['light', 'dark'] as const) {
        await switchTheme(page, theme)
        for (const width of [1440, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
            ).toBe(true)
            await page.screenshot({ path: info.outputPath(`identity-${theme}-${width}.png`) })
        }
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.reload()
    await expect(row.locator('[data-channel-avatar] img')).toHaveAttribute('src', updated.imageUrl)
})

test('favicon saves reuse a website image and failures show only icon guidance', async ({
    page,
}) => {
    test.setTimeout(60_000)
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/setup')
    await page.getByLabel('Name', { exact: true }).fill(`Icon owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(`icon-${suffix}@postdot.local`)
    await page.getByLabel('Password', { exact: true }).fill('identity-e2e-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    const projectResponse = await page.request.post('/api/projects', {
        data: { name: `Icon project ${suffix}` },
    })
    expect(projectResponse.status()).toBe(201)
    const { project } = await projectResponse.json()
    await page.goto(`/dashboard/projects/${project.id}/settings`)
    const section = page.getByRole('region', { name: en.identity_image, exact: true })
    const changeImage = section.getByRole('button', { name: en.identity_change_image, exact: true })
    const save = section.getByRole('button', { name: en.common_save, exact: true })
    await changeImage.click()
    await expect(
        page.getByRole('menuitem', { name: en.identity_use_icon, exact: true })
    ).toHaveCount(0)
    await expect(
        page.getByRole('menuitem', { name: en.identity_use_default, exact: true })
    ).toHaveCount(0)
    await page.keyboard.press('Escape')

    const website = `http://127.0.0.1:${process.env.POSTDOT_E2E_RECEIVER_PORT}/identity`
    let faviconRequests = 0
    await page.route(`**/api/projects/${project.id}/image/favicon`, async route => {
        faviconRequests += 1
        await route.continue()
    })
    await section.getByLabel(en.identity_website, { exact: true }).fill(website)
    await changeImage.click()
    await page.getByRole('menuitem', { name: en.identity_use_icon, exact: true }).click()
    await expect(
        section.getByText(en.identity_icon_host_selected.replace('{host}', '127.0.0.1'), {
            exact: true,
        })
    ).toBeVisible()
    await save.click()
    await expect(save).toHaveCount(0)
    await expect(section.locator('[data-resource-avatar] img')).toHaveAttribute(
        'src',
        /^\/api\/identity-images\//
    )
    expect(faviconRequests).toBe(0)
    await page.unroute(`**/api/projects/${project.id}/image/favicon`)

    await changeImage.click()
    await page.getByRole('menuitem', { name: en.identity_use_default, exact: true }).click()
    await save.click()
    await expect(save).toHaveCount(0)
    await section.getByLabel(en.identity_website, { exact: true }).fill(`${website}/missing`)
    await changeImage.click()
    await page.getByRole('menuitem', { name: en.identity_use_icon, exact: true }).click()
    // The receiver serves no icon here; both the page and /favicon.ico return 404.
    await save.click()
    await expect(section.getByRole('alert')).toHaveText(en.identity_error_icon)
    await expect(section.getByText(en.identity_error_size, { exact: true })).toHaveCount(0)
    await expect(section.getByText(en.identity_icon_unavailable, { exact: true })).toHaveCount(0)

    for (const code of [
        'identity_image_size',
        'identity_image_format',
        'identity_image_empty',
        'identity_remote_unavailable',
        'identity_remote_http_error',
    ]) {
        await page.route(`**/api/projects/${project.id}/image/favicon`, route =>
            route.fulfill({
                status: code === 'identity_image_size' ? 413 : 422,
                json: { error: { code, message: 'Remote icon refused' } },
            })
        )
        await Promise.all([
            page.waitForResponse(response =>
                response.url().endsWith(`/api/projects/${project.id}/image/favicon`)
            ),
            save.click(),
        ])
        await expect(section.getByRole('alert')).toHaveText(en.identity_error_icon)
        await expect(section.getByText(en.identity_error_size, { exact: true })).toHaveCount(0)
        await expect(section.getByText(en.identity_icon_unavailable, { exact: true })).toHaveCount(
            0
        )
        await page.unroute(`**/api/projects/${project.id}/image/favicon`)
    }
    await section.getByRole('button', { name: en.identity_undo_change, exact: true }).click()
    await expect(section.getByRole('alert')).toHaveCount(0)
    await expect(
        section.getByRole('button', { name: en.identity_undo_change, exact: true })
    ).toHaveCount(0)
})
