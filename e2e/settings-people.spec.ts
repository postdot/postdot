import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import de from '../apps/web/messages/de.json' with { type: 'json' }
import en from '../apps/web/messages/en.json' with { type: 'json' }
import es from '../apps/web/messages/es.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

for (const [locale, copy] of [
    ['en', en],
    ['fr', fr],
    ['es', es],
    ['de', de],
] as const) {
    test(`keeps People and Settings separate with aligned invitations in ${locale}`, async ({
        page,
    }) => {
        const suffix = randomUUID().slice(0, 8)
        const ownerName = `Camille ${suffix}`
        const ownerEmail = `people-${suffix}@example.test`
        expect(
            (
                await page.request.post('/api/auth/sign-up/email', {
                    data: {
                        name: ownerName,
                        email: ownerEmail,
                        password: 'people-browser-password-123',
                    },
                })
            ).status()
        ).toBe(200)
        const { workspace } = await (
            await page.request.post('/api/workspaces', { data: { name: 'Editorial desk' } })
        ).json()
        const { project } = await (
            await page.request.post('/api/projects', {
                data: { name: 'Announcements', workspaceId: workspace.id },
            })
        ).json()
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto(`/dashboard/projects/${project.id}/invitations`)
        await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/access$`))
        await expect(
            page.getByRole('heading', { name: copy.access_title, exact: true, level: 1 })
        ).toBeVisible()
        await expect(page.locator('main').getByText(ownerEmail, { exact: true })).toHaveCount(1)
        await expect(
            page.getByRole('region', { name: copy.lifecycle_title, exact: true })
        ).toHaveCount(0)
        await expect(page.locator('[data-page-header] button')).toHaveCount(1)
        await page
            .getByRole('button', { name: copy.access_project_invite_button, exact: true })
            .click()
        const dialog = page.getByRole('dialog')
        const email = dialog.getByLabel(copy.access_project_invite_email, { exact: true })
        const role = dialog.getByLabel(copy.access_project_invite_role, { exact: true })
        const labels = dialog.locator('label')
        const emailLabel = await labels
            .filter({ hasText: copy.access_project_invite_email })
            .boundingBox()
        const roleLabel = await labels
            .filter({ hasText: copy.access_project_invite_role })
            .boundingBox()
        expect(Math.abs(emailLabel!.y - roleLabel!.y)).toBeLessThan(1)
        expect(
            Math.abs((await email.boundingBox())!.y - (await role.boundingBox())!.y)
        ).toBeLessThan(1)
        const endpoint = `**/api/projects/${project.id}/invitations`
        await page.route(endpoint, route =>
            route.request().method() === 'POST'
                ? route.fulfill({
                      status: 503,
                      json: { error: { code: 'unavailable', message: 'Temporarily unavailable' } },
                  })
                : route.continue()
        )
        await email.fill(`invited-${suffix}@example.test`)
        await dialog
            .getByRole('button', { name: copy.access_project_invite_button, exact: true })
            .click()
        await expect(dialog.getByRole('alert')).toBeVisible()
        await expect(email).toHaveValue(`invited-${suffix}@example.test`)
        await page.unroute(endpoint)
        await dialog
            .getByRole('button', { name: copy.access_project_invite_button, exact: true })
            .click()
        await expect(dialog).toHaveCount(0)
        await expect(
            page.locator('main').getByText(copy.people_invited, { exact: true })
        ).toBeVisible()
        await page.goto(`/dashboard/projects/${project.id}/settings`)
        await expect(page.locator('[data-page-column="reading"]')).toBeVisible()
        await expect(
            page.getByRole('combobox', { name: copy.project_timezone_label, exact: true })
        ).toBeVisible()
        const danger = page.getByRole('region', { name: copy.lifecycle_title, exact: true })
        const archive = danger.getByRole('button', {
            name: copy.lifecycle_archive_project,
            exact: true,
        })
        const remove = danger.getByRole('button', { name: copy.lifecycle_delete, exact: true })
        await expect(archive).toBeVisible()
        expect((await remove.boundingBox())!.y).toBeGreaterThan(
            (await archive.boundingBox())!.y + (await archive.boundingBox())!.height
        )
        await page.goto(
            `/dashboard/settings/workspace?workspaceId=${workspace.id}&projectId=${project.id}`
        )
        await expect(page).toHaveURL(/\/settings\/workspace\/people\?/)
        await expect(
            page.getByRole('heading', { name: copy.access_workspace_title, exact: true, level: 1 })
        ).toBeVisible()
        await expect(page.locator('main').getByText(ownerEmail, { exact: true })).toHaveCount(1)
        await expect(
            page.getByRole('region', { name: copy.lifecycle_title, exact: true })
        ).toHaveCount(0)
        await page
            .locator('[data-page-header]')
            .getByRole('button', { name: copy.access_project_invite_button, exact: true })
            .click()
        const wsDialog = page.getByRole('dialog')
        const wsEmail = wsDialog.getByLabel(copy.access_workspace_invite_email, { exact: true })
        const wsGroup = wsDialog.getByLabel(copy.access_workspace_invite_group, { exact: true })
        const wsLabels = wsDialog.locator('label')
        const wsEmailLabel = await wsLabels
            .filter({ hasText: copy.access_workspace_invite_email })
            .boundingBox()
        const wsGroupLabel = await wsLabels
            .filter({ hasText: copy.access_workspace_invite_group })
            .boundingBox()
        expect(Math.abs(wsEmailLabel!.y - wsGroupLabel!.y)).toBeLessThan(1)
        expect(
            Math.abs((await wsEmail.boundingBox())!.y - (await wsGroup.boundingBox())!.y)
        ).toBeLessThan(1)
        await page.keyboard.press('Escape')
        await expect(wsDialog).toHaveCount(0)
        await page.getByRole('link', { name: copy.nav_workspace_settings, exact: true }).click()
        await expect(
            page.getByRole('heading', { name: copy.nav_workspace_settings, exact: true })
        ).toBeVisible()
        const wsDanger = page.getByRole('region', { name: copy.lifecycle_title, exact: true })
        const wsArchive = wsDanger.getByRole('button', {
            name: copy.lifecycle_archive_workspace,
            exact: true,
        })
        const wsRemove = wsDanger.getByRole('button', {
            name: copy.lifecycle_delete,
            exact: true,
        })
        await expect(wsArchive).toBeVisible()
        expect((await wsRemove.boundingBox())!.y).toBeGreaterThan(
            (await wsArchive.boundingBox())!.y + (await wsArchive.boundingBox())!.height
        )
        expect(new URL(page.url()).searchParams.get('projectId')).toBe(project.id)
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
            ).toBe(true)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        }
    })
}
