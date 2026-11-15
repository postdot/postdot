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
        const queryClientErrors: string[] = []
        const uncaughtErrors: string[] = []
        page.on('console', message => {
            if (message.type() === 'error' && message.text().includes('No QueryClient set'))
                queryClientErrors.push(message.text())
        })
        page.on('pageerror', error => uncaughtErrors.push(error.message))
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
            .getByRole('tab', { name: messages.channels_scope_workspace, exact: true })
            .click()
        await expect(page).toHaveURL(
            new RegExp(`/projects/${source.id}/channels\\?scope=workspace`)
        )
        await page.reload()
        await expect(
            page.getByRole('tab', { name: messages.channels_scope_workspace })
        ).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('tab', { name: messages.channels_scope_project }).click()
        await expect(page).not.toHaveURL(/scope=workspace/)
        // Old bookmarks resolve to Channels while retaining the selected project.
        await page.goto(
            `/dashboard/workspace/channels?workspaceId=${workspaceId}&projectId=${source.id}`
        )
        await expect(page).toHaveURL(new RegExp(`/projects/${source.id}/channels\\?`))
        expect(new URL(page.url()).searchParams.get('scope')).toBe('workspace')
        await expect(
            page.getByRole('heading', { name: messages.channels_title, exact: true })
        ).toBeVisible()
        await expect(
            page.locator('[data-navigation-destination="workspace-channels"]')
        ).toHaveCount(0)
        await expect(
            page.getByRole('combobox', { name: messages.nav_select_project }).first()
        ).toContainText(`Source ${suffix}`)
        await expect(
            page.getByRole('link', { name: messages.nav_overview, exact: true })
        ).toBeVisible()
        await expect(
            page.getByRole('button', { name: messages.nav_back_to_project, exact: true })
        ).toHaveCount(0)
        const row = page.locator(`[data-channel-row="${channel.id}"]`)
        await expect(row).toBeVisible()
        await row
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.nav_projects, exact: true }).click()
        const workspaceSharing = page.getByRole('dialog')
        await workspaceSharing
            .getByRole('button', { name: messages.channel_share_available, exact: true })
            .click()
        await page.getByRole('menuitem', { name: `Target ${suffix}`, exact: true }).click()
        await workspaceSharing.locator('[data-channel-transfer] > summary').click()
        await workspaceSharing
            .getByRole('combobox', { name: messages.channel_transfer_project })
            .click()
        await page.getByRole('option', { name: `Target ${suffix}`, exact: true }).click()
        // A concurrent attachment changes the channel revision after the selection.
        expect(
            (
                await page.request.post(`${base}/${channel.id}/attachments`, {
                    data: { projectId: third.id, expectedRevision: 2 },
                })
            ).status()
        ).toBe(200)
        await workspaceSharing
            .getByRole('button', { name: messages.channel_transfer_confirm, exact: true })
            .click()
        await expect(workspaceSharing.getByRole('alert')).toBeVisible()
        await workspaceSharing
            .getByRole('button', { name: messages.channel_transfer_confirm, exact: true })
            .click()
        await expect(row).toContainText(
            messages.channel_share_manager_project.replace('{project}', `Target ${suffix}`)
        )
        await workspaceSharing
            .getByRole('button', { name: messages.channel_share_done, exact: true })
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
        await row
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.cadence_action, exact: true }).click()
        const cadence = page.locator('[data-slot="dialog-content"]')
        await cadence.getByLabel(messages.cadence_daily, { exact: true }).fill('3')
        await cadence.getByRole('button', { name: messages.cadence_save, exact: true }).click()
        await expect(cadence).toHaveCount(0)
        const rules = await page.request.get(`${base}/${channel.id}/cadence`)
        expect(await rules.json()).toMatchObject({ rules: { dailyMax: 3 } })
        // GitHub #13: follow the usage link without replacing the browser document.
        // Hold the project loader so the previous outlet must keep its QueryClient.
        let releaseMembership!: () => void
        const membershipGate = new Promise<void>(resolve => {
            releaseMembership = resolve
        })
        let membershipRequested!: () => void
        const membershipStarted = new Promise<void>(resolve => {
            membershipRequested = resolve
        })
        const membershipUrl = `**/api/projects/${target.id}/membership`
        await page.route(membershipUrl, async route => {
            membershipRequested()
            await membershipGate
            await route.continue()
        })
        try {
            await row
                .getByRole('button', {
                    name: messages.channel_manage.replace('{channel}', channel.name),
                })
                .click()
            await page.getByRole('menuitem', { name: messages.nav_projects, exact: true }).click()
            const navigation = page
                .getByRole('dialog')
                .getByRole('link', { name: `Target ${suffix}`, exact: true })
                .click()
            await membershipStarted
            await expect(row).toBeVisible()
            expect(queryClientErrors).toEqual([])
            expect(uncaughtErrors).toEqual([])
            releaseMembership()
            await navigation
            await expect(page).toHaveURL(new RegExp(`/projects/${target.id}/channels$`))
            await expect(page.locator(`[id="publisher-connection-${channel.id}"]`)).toBeVisible()
        } finally {
            releaseMembership()
            await page.unrouteAll({ behavior: 'wait' })
        }
        // Repeat through history to cover an already loaded destination as well.
        await page.goBack()
        await expect(row).toBeVisible()
        await row
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.nav_projects, exact: true }).click()
        await page
            .getByRole('dialog')
            .getByRole('link', { name: `Target ${suffix}`, exact: true })
            .click()
        await expect(page).toHaveURL(new RegExp(`/projects/${target.id}/channels$`))
        await expect(page.locator(`[id="publisher-connection-${channel.id}"]`)).toBeVisible()
        expect(queryClientErrors).toEqual([])
        expect(uncaughtErrors).toEqual([])

        // The contextual project dialog exposes the same explicit transfer.
        await page
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.channel_share_action }).click()
        const sharing = page.locator('[data-slot="dialog-content"]')
        await sharing.locator('[data-channel-transfer] > summary').click()
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
        // Withdraw projects through the shared dialog, explicitly archiving the last use.
        await page
            .getByRole('tab', { name: messages.channels_scope_workspace, exact: true })
            .click()
        await row
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.nav_projects, exact: true }).click()
        const retirement = page.getByRole('dialog')
        for (const name of [`Source ${suffix}`, `Target ${suffix}`, `Third ${suffix}`]) {
            await retirement
                .getByRole('button', {
                    name: messages.channel_share_withdraw.replace('{project}', name),
                    exact: true,
                })
                .click()
            if (name === `Third ${suffix}`) {
                await expect(retirement.getByRole('alert')).toBeVisible()
                await retirement
                    .getByRole('button', {
                        name: messages.channel_share_withdraw_archive,
                        exact: true,
                    })
                    .click()
            }
            await expect(
                retirement.getByRole('button', {
                    name: messages.channel_share_withdraw.replace('{project}', name),
                    exact: true,
                })
            ).toHaveCount(0)
        }
        await expect(
            retirement.getByText(messages.workspace_channel_detached, { exact: true })
        ).toHaveCount(3)
        await retirement
            .getByRole('button', { name: messages.channel_share_done, exact: true })
            .click()
        await page.goto(`/dashboard/workspace/channels?workspaceId=${workspaceId}&projectId=none`)
        await expect(
            page.getByText(messages.workspace_channels_empty, { exact: true })
        ).toBeVisible()
        await page
            .getByRole('button', {
                name: messages.workspace_channels_show_archived.replace('{count}', '1'),
            })
            .click()
        await expect(row).toContainText(messages.channel_archived)
        await expect(page).toHaveURL(/\/dashboard\/channels\?/)
        expect(new URL(page.url()).searchParams.get('projectId')).toBe('none')
        await expect(
            page.getByRole('tab', { name: messages.channels_scope_project })
        ).toBeDisabled()
        await row
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.nav_projects, exact: true }).click()
        await expect(
            page.getByRole('dialog').getByText(messages.workspace_channel_detached, { exact: true })
        ).toHaveCount(3)
        await page
            .getByRole('dialog')
            .getByRole('button', { name: messages.channel_share_done, exact: true })
            .click()
        // Workspace creation explicitly chooses its first managing project.
        await page.getByRole('button', { name: messages.channel_add, exact: true }).click()
        await expect(
            page.getByRole('combobox', { name: messages.workspace_channel_initial_project })
        ).toHaveAccessibleDescription(messages.channel_transfer_description)
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

test('opens workspace scope from Channels when the workspace has no projects', async ({ page }) => {
    const suffix = randomUUID().slice(0, 7)
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Empty workspace operator',
                    email: `empty-channels-${suffix}@example.test`,
                    password: 'workspace-browser-password-123',
                },
            })
        ).status()
    ).toBe(200)
    const response = await page.request.post('/api/workspaces', {
        data: { name: `Empty ${suffix}` },
    })
    expect(response.status()).toBe(201)
    const { workspace } = (await response.json()) as { workspace: { id: string } }
    await page.goto(`/dashboard?workspaceId=${workspace.id}&projectId=none`)
    await page.getByRole('link', { name: en.nav_channels, exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/channels\?/)
    expect(new URL(page.url()).searchParams.get('scope')).toBe('workspace')
    await expect(page.getByRole('heading', { name: en.channels_title, exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: en.channels_scope_project })).toBeDisabled()
    await expect(page.getByText(en.workspace_channels_empty, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: en.channel_add, exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Show archived/ })).toHaveCount(0)
    await page.reload()
    await expect(page.getByText(en.workspace_channels_empty, { exact: true })).toBeVisible()
    await page.goto(`/dashboard/workspace/channels?workspaceId=${workspace.id}&projectId=none`)
    await expect(page).toHaveURL(/\/dashboard\/channels\?/)
    expect(new URL(page.url()).searchParams.get('workspaceId')).toBe(workspace.id)
    expect(new URL(page.url()).searchParams.get('projectId')).toBe('none')
})
