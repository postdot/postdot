import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../../apps/web/messages/en.json' with { type: 'json' }
import fr from '../../apps/web/messages/fr.json' with { type: 'json' }

for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    test(`keeps archive navigation and restoration clear in ${locale}`, async ({ page }, info) => {
        test.setTimeout(90_000)
        const missingQueryContexts: string[] = []
        page.on('console', message => {
            if (message.type() === 'error' && message.text().includes('No QueryClient set'))
                missingQueryContexts.push(message.text())
        })
        await page.addInitScript(
            ({ locale, theme }) => {
                localStorage.setItem('PARAGLIDE_LOCALE', locale)
                localStorage.setItem('postdot-theme', theme)
            },
            { locale, theme }
        )
        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Archive reviewer',
                email: `archives-${randomUUID()}@example.test`,
                password: 'archive-review-password',
            },
        })
        expect(signup.status()).toBe(200)
        const projects: { id: string; name: string; workspaceId: string }[] = []
        for (const name of ['Current editorial desk', 'Retained community desk']) {
            const response = await page.request.post('/api/projects', { data: { name } })
            expect(response.status()).toBe(201)
            projects.push((await response.json()).project)
        }
        const current = projects[0]!
        const archived = projects[1]!
        await page.goto(
            `/dashboard/settings/archives?projectId=${current.id}&workspaceId=${current.workspaceId}`
        )
        await expect(
            page.getByRole('heading', { name: copy.lifecycle_archives, exact: true })
        ).toBeVisible()
        await page.screenshot({ path: info.outputPath('archives-empty.png') })
        await expect(
            page.locator('[data-slot="sidebar-menu-button"][aria-current="page"]')
        ).toHaveText(copy.lifecycle_archives)
        await expect(page.locator('[data-page-column="management"]')).toBeVisible()
        await page.getByRole('button', { name: copy.search_open, exact: true }).click()
        await page
            .getByRole('combobox', { name: copy.search_open, exact: true })
            .fill(copy.lifecycle_archives)
        await page.getByRole('option', { name: copy.lifecycle_archives, exact: true }).click()
        await expect(page.getByRole('dialog', { name: copy.search_open, exact: true })).toHaveCount(
            0
        )

        const impact = await page.request.get(`/api/projects/${archived.id}/lifecycle`)
        const { fingerprint } = await impact.json()
        expect(
            (
                await page.request.post(`/api/projects/${archived.id}/lifecycle/archive`, {
                    data: { fingerprint },
                })
            ).status()
        ).toBe(200)
        await page.goto(`/dashboard/projects/${current.id}/access`)
        await page.getByRole('link', { name: copy.lifecycle_archives, exact: true }).click()
        await expect(page).toHaveURL(/\/dashboard\/settings\/archives\?/)
        await expect(
            page.getByRole('combobox', { name: copy.nav_select_project, exact: true })
        ).toHaveCount(1)
        await expect(
            page.getByRole('combobox', { name: copy.nav_select_project, exact: true })
        ).toContainText(current.name)
        const resource = page
            .getByRole('region', { name: copy.lifecycle_title, exact: true })
            .filter({ hasText: archived.name })
        await expect(resource).toBeVisible()
        for (const width of [1440, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            ).toBe(false)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: info.outputPath(`archives-${width}.png`) })
        }
        const impactEndpoint = `**/api/projects/${archived.id}/lifecycle`
        await page.route(impactEndpoint, route =>
            route.fulfill({
                status: 503,
                json: { error: { code: 'unavailable', message: 'Temporary failure' } },
            })
        )
        await resource.getByRole('button', { name: copy.lifecycle_restore, exact: true }).click()
        const dialog = page.locator('[data-slot="dialog-content"]')
        await expect(
            dialog.getByRole('button', { name: copy.common_retry, exact: true })
        ).toBeVisible()
        await expect(
            dialog.getByRole('button', { name: copy.lifecycle_restore, exact: true })
        ).toBeDisabled()
        await page.unroute(impactEndpoint)
        await dialog.getByRole('button', { name: copy.common_retry, exact: true }).click()
        await expect(
            dialog.getByRole('button', { name: copy.lifecycle_restore, exact: true })
        ).toBeEnabled()
        await expect(
            dialog.getByText(copy.lifecycle_archive_explanation, { exact: true })
        ).toHaveCount(0)
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({ path: info.outputPath('restore-confirmation.png') })
        await dialog.getByRole('button', { name: copy.lifecycle_restore, exact: true }).click()
        await expect(resource).toHaveCount(0)
        await expect(page.getByText(copy.lifecycle_empty, { exact: true })).toBeVisible()
        await page.route('**/api/resource-removals', route =>
            route.fulfill({
                status: 503,
                json: { error: { code: 'unavailable', message: 'Temporary failure' } },
            })
        )
        await page.reload()
        await expect(
            page.getByRole('button', { name: copy.common_retry, exact: true })
        ).toBeVisible()
        await page.screenshot({ path: info.outputPath('archives-error.png') })
        await page.unroute('**/api/resource-removals')
        await page.getByRole('button', { name: copy.common_retry, exact: true }).click()
        await expect(page.getByText(copy.lifecycle_empty, { exact: true })).toBeVisible()
        await page.getByRole('button', { name: copy.nav_back_to_project, exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${current.id}/overview$`))
        await expect(
            page.getByRole('heading', { name: copy.nav_overview, exact: true })
        ).toBeVisible()
        expect(missingQueryContexts).toEqual([])
    })
}

test('restores a workspace separately from its projects and keeps cancelled work cancelled', async ({
    page,
}, info) => {
    test.setTimeout(90_000)
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Workspace lifecycle reviewer',
                    email: `workspace-archive-${randomUUID()}@example.test`,
                    password: 'archive-review-password',
                },
            })
        ).status()
    ).toBe(200)
    const workspaceResponse = await page.request.post('/api/workspaces', {
        data: { name: 'Retained workspace' },
    })
    expect(workspaceResponse.status()).toBe(201)
    const { workspace } = await workspaceResponse.json()
    const projectResponse = await page.request.post('/api/projects', {
        data: { name: 'Retained workspace project', workspaceId: workspace.id },
    })
    expect(projectResponse.status()).toBe(201)
    const { project } = await projectResponse.json()
    const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'Manual review desk' },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    const postResponse = await page.request.post(`/api/projects/${project.id}/posts`, {
        data: {
            sourceContent: {
                body: { format: 'plain_text', text: 'Scheduled work retained after restoration.' },
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
    expect(postResponse.status()).toBe(201)
    const { publications } = await postResponse.json()
    await page.goto(
        `/dashboard/settings/workspace?workspaceId=${workspace.id}&projectId=${project.id}`
    )
    const section = page.getByRole('region', { name: en.lifecycle_title, exact: true })
    await section.getByRole('button', { name: en.lifecycle_archive, exact: true }).click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(
        dialog.getByRole('button', { name: en.lifecycle_archive, exact: true })
    ).toBeDisabled()
    await dialog.getByRole('checkbox', { name: en.lifecycle_cancel_pending, exact: true }).check()
    await dialog.getByRole('button', { name: en.lifecycle_archive, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.goto('/dashboard/settings/archives?projectId=none')
    const projectSection = page
        .getByRole('region', { name: en.lifecycle_title, exact: true })
        .filter({ has: page.getByRole('heading', { name: project.name, exact: true }) })
    const workspaceSection = page
        .getByRole('region', { name: en.lifecycle_title, exact: true })
        .filter({ has: page.getByRole('heading', { name: workspace.name, exact: true }) })
    await projectSection.getByRole('button', { name: en.lifecycle_restore, exact: true }).click()
    await dialog.getByRole('button', { name: en.lifecycle_restore, exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(en.lifecycle_error_workspace)
    await dialog.getByRole('button', { name: en.common_cancel, exact: true }).click()
    await workspaceSection.getByRole('button', { name: en.lifecycle_restore, exact: true }).click()
    await expect(
        dialog.getByText(en.lifecycle_restore_workspace_explanation, { exact: true })
    ).toBeVisible()
    await page.screenshot({ path: info.outputPath('workspace-restoration.png') })
    await dialog.getByRole('button', { name: en.lifecycle_restore, exact: true }).click()
    await expect(workspaceSection).toHaveCount(0)
    await expect(projectSection).toBeVisible()
    await projectSection.getByRole('button', { name: en.lifecycle_restore, exact: true }).click()
    await expect(dialog.getByText(en.lifecycle_restore_explanation, { exact: true })).toBeVisible()
    const endpoint = `**/api/projects/${project.id}/lifecycle/restore`
    await page.route(endpoint, route =>
        route.fulfill({
            status: 503,
            json: { error: { code: 'temporary_failure', message: 'Temporary failure' } },
        })
    )
    await dialog.getByRole('button', { name: en.lifecycle_restore, exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(
        dialog.getByRole('button', { name: en.lifecycle_restore, exact: true })
    ).toBeEnabled()
    await page.unroute(endpoint)
    await dialog.getByRole('button', { name: en.lifecycle_restore, exact: true }).click()
    await expect(projectSection).toHaveCount(0)
    const retained = await page.request.get(
        `/api/projects/${project.id}/publications/${publications[0].id}/editor`
    )
    expect(retained.status()).toBe(200)
    expect((await retained.json()).editor.publication.state).toBe('cancelled')
})
