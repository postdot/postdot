import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

for (const [locale, messages] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`manages workspace channels and explicitly transfers management in ${locale}`, async ({
        page,
    }) => {
        test.setTimeout(90000)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const suffix = randomUUID().slice(0, 7)
        expect(
            (
                await page.request.post('/api/auth/sign-up/email', {
                    data: {
                        name: 'Workspace channel operator',
                        email: `workspace-channels-${suffix}@example.test`,
                        password: 'workspace-browser-password-123',
                    },
                })
            ).status()
        ).toBe(200)
        const workspaceResponse = await page.request.post('/api/workspaces', {
            data: { name: `Channels ${suffix}` },
        })
        expect(workspaceResponse.status()).toBe(201)
        const ownWorkspace = ((await workspaceResponse.json()) as { workspace: { id: string } })
            .workspace.id
        const createProject = async (name: string) => {
            const response = await page.request.post('/api/projects', {
                data: { name, workspaceId: ownWorkspace },
            })
            expect(response.status()).toBe(201)
            return ((await response.json()) as { project: { id: string; workspaceId: string } })
                .project
        }
        const source = await createProject(`Source ${suffix}`)
        const target = await createProject(`Target ${suffix}`)
        const third = await createProject(`Third ${suffix}`)
        const workspaceId = source.workspaceId
        const base = `/api/workspaces/${workspaceId}/channels`
        const created = await page.request.post(`/api/projects/${source.id}/channels`, {
            data: { name: `Newsroom ${suffix}` },
        })
        expect(created.status()).toBe(201)
        const { channel } = (await created.json()) as { channel: { id: string; name: string } }
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto(`/dashboard/projects/${source.id}/channels`)
        await page
            .getByRole('link', { name: messages.workspace_channels_title, exact: true })
            .click()
        await expect(page).toHaveURL(/\/dashboard\/workspace\/channels/)
        const row = page.locator(`[data-workspace-channel="${channel.id}"]`)
        await expect(row).toBeVisible()
        await row.locator('summary').focus()
        await page.keyboard.press('Enter')
        await row.getByRole('button', { name: messages.channel_share_action, exact: true }).click()
        await row
            .getByRole('button', {
                name: messages.channel_share_add.replace('{project}', `Target ${suffix}`),
                exact: true,
            })
            .click()
        await row.getByRole('combobox', { name: messages.channel_transfer_project }).click()
        await page.getByRole('option', { name: `Target ${suffix}`, exact: true }).click()
        // A concurrent attachment changes the channel revision after the selection.
        expect(
            (
                await page.request.post(`${base}/${channel.id}/attachments`, {
                    data: { projectId: third.id, expectedRevision: 2 },
                })
            ).status()
        ).toBe(200)
        await row
            .getByRole('button', { name: messages.channel_transfer_confirm, exact: true })
            .click()
        await expect(row.getByRole('alert')).toBeVisible()
        await row
            .getByRole('button', { name: messages.channel_transfer_confirm, exact: true })
            .click()
        await expect(row).toContainText(
            messages.channel_share_manager_project.replace('{project}', `Target ${suffix}`)
        )
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 1000 })
            expect(
                await page
                    .locator('[data-dashboard-scroll]')
                    .evaluate(el => el.scrollWidth <= el.clientWidth + 1)
            ).toBe(true)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            if (locale === 'en' && width !== 820)
                await page.screenshot({ path: `/tmp/postdot-workspace-channels-${width}.png` })
        }
        await row.getByRole('button', { name: messages.cadence_action, exact: true }).click()
        const cadence = page.locator('[data-slot="dialog-content"]')
        await cadence.getByLabel(messages.cadence_daily, { exact: true }).fill('3')
        await cadence.getByRole('button', { name: messages.cadence_save, exact: true }).click()
        await expect(cadence).toHaveCount(0)
        const rules = await page.request.get(`${base}/${channel.id}/cadence`)
        expect(await rules.json()).toMatchObject({ rules: { dailyMax: 3 } })
        // The contextual project dialog exposes the same explicit transfer.
        await page.goto(`/dashboard/projects/${target.id}/channels`)
        await page
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.channel_share_action }).click()
        const sharing = page.locator('[data-slot="dialog-content"]')
        await sharing.getByRole('combobox', { name: messages.channel_transfer_project }).click()
        await page.getByRole('option', { name: `Source ${suffix}`, exact: true }).click()
        await sharing
            .getByRole('button', { name: messages.channel_transfer_confirm, exact: true })
            .click()
        await expect(sharing).toContainText(
            messages.channel_share_manager_project.replace('{project}', `Source ${suffix}`)
        )
        await sharing
            .getByRole('button', { name: messages.channel_share_done, exact: true })
            .click()
        // Archive through explicit last-attachment retirement, then inspect retained history.
        for (const project of [source, target, third]) {
            const view = (await (await page.request.get(base)).json()) as {
                channels: { id: string; revision: number }[]
            }
            const revision = view.channels.find(c => c.id === channel.id)!.revision
            expect(
                (
                    await page.request.post(`${base}/${channel.id}/withdraw`, {
                        data: {
                            projectId: project.id,
                            expectedRevision: revision,
                            ...(project.id === third.id ? { lastAttachment: 'archive' } : {}),
                        },
                    })
                ).status()
            ).toBe(200)
        }
        await page.goto(`/dashboard/workspace/channels?workspaceId=${workspaceId}&projectId=none`)
        await expect(
            page.getByText(messages.workspace_channels_empty, { exact: true })
        ).toBeVisible()
        await page.getByRole('switch', { name: messages.workspace_channels_archived }).click()
        await expect(row).toContainText(messages.channel_archived)
        await row.locator('summary').click()
        await expect(
            row.getByText(messages.workspace_channel_detached, { exact: true })
        ).toHaveCount(3)
        // Workspace creation explicitly chooses its first managing project.
        await page.getByRole('button', { name: messages.channel_add, exact: true }).click()
        await page
            .getByRole('combobox', { name: messages.workspace_channel_initial_project })
            .click()
        await page.getByRole('option', { name: `Source ${suffix}`, exact: true }).click()
        await page.getByRole('button', { name: messages.channel_add, exact: true }).click()
        const creation = page.locator('[data-slot="dialog-content"]')
        await creation
            .getByRole('radio', { name: messages.channel_manual_profile, exact: true })
            .click()
        await creation
            .getByLabel(messages.channel_name, { exact: true })
            .fill(`Created here ${suffix}`)
        await creation
            .getByRole('button', { name: messages.channel_create_button, exact: true })
            .click()
        await expect(creation).toHaveCount(0)
        await expect(page.getByText(`Created here ${suffix}`, { exact: true })).toBeVisible()
        if (locale === 'en') {
            const listPath = new RegExp('/api/workspaces/' + workspaceId + '/channels(?:\\?.*)?$')
            await page.route(listPath, route =>
                route.fulfill({
                    status: 503,
                    json: { error: { code: 'unavailable', message: 'Temporarily unavailable' } },
                })
            )
            await page.reload()
            await expect(
                page.getByText(messages.workspace_channels_loading, { exact: true })
            ).toBeVisible()
            const alert = page.getByRole('alert')
            await expect(alert).toBeVisible({ timeout: 15000 })
            await expect(
                page.getByText(messages.workspace_channels_empty, { exact: true })
            ).toHaveCount(0)
            await page.unroute(listPath)
            await alert.getByRole('button', { name: messages.common_retry, exact: true }).click()
            await expect(page.getByText(`Created here ${suffix}`, { exact: true })).toBeVisible()
        }
    })
}
