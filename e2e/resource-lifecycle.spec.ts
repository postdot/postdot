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
        await page.goto(`/dashboard/projects/${project.id}/settings`)
        const section = page.getByRole('region', { name: messages.lifecycle_title })
        await section
            .getByRole('button', { name: messages.lifecycle_archive_project, exact: true })
            .click()
        const dialog = page.locator('[data-slot="dialog-content"]')
        await expect(dialog.locator('[data-lifecycle-consequences] > p')).toHaveCount(3)
        await expect(
            dialog.getByText(messages.lifecycle_no_scheduled, { exact: true })
        ).toBeVisible()
        await dialog
            .getByRole('button', { name: messages.lifecycle_archive_project, exact: true })
            .click()
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
        // A locked publication shows its content once, in the channel preview.
        await expect(page.locator('[data-composer-editor="true"]')).toContainText(
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
        await page.goto(`/dashboard/projects/${project.id}/settings`)
        await section.getByRole('button', { name: messages.lifecycle_delete, exact: true }).click()
        await expect(
            dialog.getByRole('heading', { name: messages.lifecycle_delete, exact: true })
        ).toBeVisible()
        await expect(dialog.getByText(name, { exact: true })).toBeVisible()
        await expect(dialog.locator('[data-lifecycle-consequences] > p')).toHaveCount(3)
        await expect(
            dialog.getByText(messages.lifecycle_no_scheduled, { exact: true })
        ).toBeVisible()
        await expect(dialog.locator('dl')).toHaveCount(0)
        await expect(dialog).not.toContainText(/audit|grant|pending work|the resource/i)
        await expect(
            dialog.getByRole('button', { name: messages.lifecycle_delete, exact: true })
        ).toBeDisabled()
        await dialog
            .getByLabel(messages.lifecycle_confirm_name.replace('{name}', name), { exact: true })
            .fill(name)
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

for (const [locale, copy] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`deletes a workspace with publication consequences and a typed name in ${locale}`, async ({
        page,
    }) => {
        const suffix = randomUUID().slice(0, 8)
        expect(
            (
                await page.request.post('/api/auth/sign-up/email', {
                    data: {
                        name: 'Workspace owner',
                        email: `workspace-delete-${suffix}@example.test`,
                        password: 'lifecycle-browser-password-123',
                    },
                })
            ).status()
        ).toBe(200)
        const name = `Disposable workspace ${suffix}`
        const { workspace } = await (
            await page.request.post('/api/workspaces', { data: { name } })
        ).json()
        const { project } = await (
            await page.request.post('/api/projects', {
                data: { name: 'Editorial', workspaceId: workspace.id },
            })
        ).json()
        const { channel } = await (
            await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name: 'Daily news' },
            })
        ).json()
        expect(
            (
                await page.request.post(`/api/projects/${project.id}/posts`, {
                    data: {
                        sourceContent: {
                            body: { format: 'plain_text', text: 'Scheduled news' },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channel.id,
                                deliveryMode: 'manual',
                                scheduledAt: Date.now() + 86_400_000,
                            },
                        ],
                    },
                })
            ).status()
        ).toBe(201)
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto(
            `/dashboard/settings/workspace/settings?workspaceId=${workspace.id}&projectId=${project.id}`
        )
        await page.getByRole('button', { name: copy.lifecycle_delete, exact: true }).click()
        const dialog = page.locator('[data-slot="dialog-content"]')
        const consequences = dialog.locator('[data-lifecycle-consequences] > p')
        await expect(consequences).toHaveCount(3)
        await expect(consequences.first()).toHaveText(
            copy.lifecycle_scheduled_cancelled[0]!.match['countPlural=one']!.replace('{total}', '1')
        )
        await expect(consequences.nth(1)).toHaveText(
            copy.lifecycle_workspace_channels_deleted[0]!.match['countPlural=one']!.replace(
                '{total}',
                '1'
            )
        )
        await expect(dialog).not.toContainText(/audit|grant|pending work|the resource/i)
        const confirm = dialog.getByRole('button', { name: copy.lifecycle_delete, exact: true })
        await expect(confirm).toBeDisabled()
        await dialog
            .getByLabel(copy.lifecycle_confirm_name.replace('{name}', name), { exact: true })
            .fill(name)
        await expect(confirm).toBeDisabled()
        await dialog
            .getByRole('checkbox', { name: copy.lifecycle_cancel_pending, exact: true })
            .check()
        await expect(confirm).toBeEnabled()
        await confirm.click()
        await expect(dialog).toHaveCount(0)
        await expect(page).toHaveURL(/\/dashboard\/settings\/archives\?/)
        await expect
            .poll(async () =>
                (await (await page.request.get('/api/workspaces')).json()).workspaces.some(
                    (item: { id: string }) => item.id === workspace.id
                )
            )
            .toBe(false)
    })
}
