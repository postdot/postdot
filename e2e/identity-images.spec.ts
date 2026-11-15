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
    await expect(
        imageSection.getByRole('button', { name: en.common_save, exact: true })
    ).toBeDisabled()
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
    await imageUrlDialog.getByRole('button', { name: en.identity_choose, exact: true }).click()
    await workspaceSection.getByRole('button', { name: en.common_save, exact: true }).click()
    await expect(
        workspaceSection.getByRole('button', { name: en.common_save, exact: true })
    ).toBeDisabled()
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
    await page.getByRole('menuitem', { name: en.identity_remove, exact: true }).click()
    await workspaceSection.getByRole('button', { name: en.common_save, exact: true }).click()
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
