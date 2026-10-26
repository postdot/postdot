import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }
for (const [locale, messages] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`retires and restores a project, then confirms permanent removal in ${locale}`, async ({
        page,
    }, info) => {
        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Lifecycle operator',
                email: `lifecycle-${randomUUID()}@example.test`,
                password: 'lifecycle-browser-password-123',
            },
        })
        expect(signup.status()).toBe(200)
        const name = `Disposable ${randomUUID().slice(0, 8)}`
        const created = await page.request.post('/api/projects', { data: { name } })
        expect(created.status()).toBe(201)
        const { project } = await created.json()
        const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name: 'Retained manual channel' },
        })
        expect(channelResponse.status()).toBe(201)
        const { channel } = await channelResponse.json()
        const postResponse = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                sourceContent: {
                    body: { format: 'plain_text', text: 'Retained publication' },
                    media: [],
                },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            },
        })
        expect(postResponse.status()).toBe(201)
        const { publications } = await postResponse.json()
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto(`/dashboard/projects/${project.id}/access`)
        const section = page.getByRole('region', { name: messages.lifecycle_title })
        await section.getByRole('button', { name: messages.lifecycle_archive, exact: true }).click()
        const dialog = page.locator('[data-slot="dialog-content"]')
        await expect(dialog.getByText(messages.lifecycle_archive_explanation)).toBeVisible()
        await dialog.getByRole('button', { name: messages.lifecycle_archive, exact: true }).click()
        await expect(
            page.getByRole('status').filter({ hasText: messages.lifecycle_archived_notice })
        ).toBeVisible()
        expect(
            (
                await page.request.post(`/api/projects/${project.id}/channels`, {
                    data: { name: 'Blocked' },
                })
            ).status()
        ).toBe(409)
        await page.goto(`/dashboard/projects/${project.id}/publications/${publications[0].id}`)
        await expect(page.locator('[data-publication-source="true"]')).toContainText(
            'Retained publication'
        )
        await expect(page.locator('[contenteditable="true"]')).toHaveCount(0)
        await page.goto(`/dashboard/projects/${project.id}/publications/new`)
        await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${project.id}/queue`))
        await page.getByRole('link', { name: messages.lifecycle_manage, exact: true }).click()
        const archived = page
            .getByRole('region', { name: messages.lifecycle_title })
            .filter({ hasText: name })
        await archived
            .getByRole('button', { name: messages.lifecycle_restore, exact: true })
            .click()
        await dialog.getByRole('button', { name: messages.lifecycle_restore, exact: true }).click()
        await expect(archived).toHaveCount(0)
        await page.goto(`/dashboard/projects/${project.id}/access`)
        await section.getByRole('button', { name: messages.lifecycle_delete, exact: true }).click()
        await expect(dialog.getByText(messages.lifecycle_delete_explanation)).toBeVisible()
        await expect(
            dialog.getByRole('button', { name: messages.lifecycle_delete, exact: true })
        ).toBeDisabled()
        await dialog.getByLabel(messages.lifecycle_confirm_name, { exact: true }).fill(name)
        await page.setViewportSize({ width: 390, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
            false
        )
        await page.screenshot({ path: info.outputPath(`deletion-${locale}-mobile.png`) })
        await dialog.getByRole('button', { name: messages.lifecycle_delete, exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await expect
            .poll(async () =>
                (await page.request.get('/api/projects?includeArchived=true'))
                    .json()
                    .then(body =>
                        body.projects.some((item: { id: string }) => item.id === project.id)
                    )
            )
            .toBe(false)
    })
}
