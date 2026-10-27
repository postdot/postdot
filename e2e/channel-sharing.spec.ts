import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

const fill = (template: string, values: Record<string, string>) =>
    template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')

for (const [locale, messages] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`shares a channel with another project, then withdraws it in ${locale}`, async ({
        page,
    }) => {
        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Sharing operator',
                email: `sharing-${randomUUID()}@example.test`,
                password: 'sharing-browser-password-123',
            },
        })
        expect(signup.status()).toBe(200)
        const suffix = randomUUID().slice(0, 6)
        const createProject = async (name: string) => {
            const response = await page.request.post('/api/projects', { data: { name } })
            expect(response.status()).toBe(201)
            return ((await response.json()) as { project: { id: string } }).project.id
        }
        const sourceName = `Source ${suffix}`
        const targetName = `Target ${suffix}`
        const source = await createProject(sourceName)
        const target = await createProject(targetName)
        const channelName = `Newsroom ${suffix}`
        const created = await page.request.post(`/api/projects/${source}/channels`, {
            data: { name: channelName },
        })
        expect(created.status()).toBe(201)

        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto(`/dashboard/projects/${source}/channels`)

        // The row is private until it is shared: no badge yet.
        const row = page.locator('[id^="publisher-connection-"]').filter({ hasText: channelName })
        await expect(row).toBeVisible()
        await expect(row.getByText(messages.channel_shared_badge, { exact: true })).toHaveCount(0)

        // Keyboard: open the channel menu and choose the sharing action.
        const trigger = page.getByRole('button', {
            name: fill(messages.channel_manage, { channel: channelName }),
        })
        await trigger.focus()
        await page.keyboard.press('Enter')
        await page.getByRole('menuitem', { name: messages.channel_share_action }).click()

        const dialog = page.locator('[data-slot="dialog-content"]')
        await expect(
            dialog.getByRole('heading', {
                name: fill(messages.channel_share_title, { channel: channelName }),
            })
        ).toBeVisible()
        // The disclosure is stated before anything is shared.
        await expect(dialog.getByText(messages.channel_share_description)).toBeVisible()
        await expect(dialog.getByText(targetName, { exact: true })).toBeVisible()

        await dialog
            .getByRole('button', {
                name: fill(messages.channel_share_add, { project: targetName }),
            })
            .click()
        await expect(
            page.getByRole('heading', {
                name: fill(messages.channel_share_added, {
                    project: targetName,
                    channel: channelName,
                }),
            })
        ).toBeVisible()
        await expect(
            dialog.getByRole('button', {
                name: fill(messages.channel_share_withdraw, { project: targetName }),
            })
        ).toBeVisible()
        await dialog.getByRole('button', { name: messages.channel_share_done, exact: true }).click()
        await expect(row.getByText(messages.channel_shared_badge, { exact: true })).toBeVisible()

        // The other project now lists the same channel as shared.
        await page.goto(`/dashboard/projects/${target}/channels`)
        const targetRow = page
            .locator('[id^="publisher-connection-"]')
            .filter({ hasText: channelName })
        await expect(targetRow).toBeVisible()
        await expect(
            targetRow.getByText(messages.channel_shared_badge, { exact: true })
        ).toBeVisible()

        // The source withdraws the target; the last remaining project needs an archive choice.
        await page.goto(`/dashboard/projects/${source}/channels`)
        await page
            .getByRole('button', { name: fill(messages.channel_manage, { channel: channelName }) })
            .click()
        await page.getByRole('menuitem', { name: messages.channel_share_action }).click()
        await dialog
            .getByRole('button', {
                name: fill(messages.channel_share_withdraw, { project: targetName }),
            })
            .click()
        await expect(
            page.getByRole('heading', {
                name: fill(messages.channel_share_withdrawn, {
                    project: targetName,
                    channel: channelName,
                }),
            })
        ).toBeVisible()
        await dialog
            .getByRole('button', {
                name: fill(messages.channel_share_withdraw, { project: sourceName }),
            })
            .click()
        await expect(
            dialog.getByText(fill(messages.channel_share_withdraw_last, { project: sourceName }))
        ).toBeVisible()
        await dialog
            .getByRole('button', { name: messages.channel_share_withdraw_archive, exact: true })
            .click()
        await expect(
            page.getByRole('heading', {
                name: fill(messages.channel_share_withdrawn, {
                    project: sourceName,
                    channel: channelName,
                }),
            })
        ).toBeVisible()
        await dialog.getByRole('button', { name: messages.channel_share_done, exact: true }).click()

        // Withdrawn projects no longer list the channel.
        await page.reload()
        await expect(
            page.locator('[id^="publisher-connection-"]').filter({ hasText: channelName })
        ).toHaveCount(0)
    })
}

test('keeps the sharing dialog within a narrow viewport', async ({ page }) => {
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Narrow sharing operator',
            email: `sharing-narrow-${randomUUID()}@example.test`,
            password: 'sharing-browser-password-123',
        },
    })
    expect(signup.status()).toBe(200)
    const suffix = randomUUID().slice(0, 6)
    const projectIds: string[] = []
    for (const name of [`Narrow source ${suffix}`, `Narrow target with a long name ${suffix}`]) {
        const response = await page.request.post('/api/projects', { data: { name } })
        projectIds.push(((await response.json()) as { project: { id: string } }).project.id)
    }
    const channelName = `Narrow channel ${suffix}`
    await page.request.post(`/api/projects/${projectIds[0]}/channels`, {
        data: { name: channelName },
    })
    await page.setViewportSize({ width: 390, height: 780 })
    await page.goto(`/dashboard/projects/${projectIds[0]}/channels`)
    await page
        .getByRole('button', { name: fill(en.channel_manage, { channel: channelName }) })
        .click()
    await page.getByRole('menuitem', { name: en.channel_share_action }).click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await expect(
        dialog.getByRole('button', {
            name: fill(en.channel_share_add, {
                project: `Narrow target with a long name ${suffix}`,
            }),
        })
    ).toBeInViewport()
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
})
