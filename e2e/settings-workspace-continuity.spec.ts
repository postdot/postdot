import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test('keeps personal and installation settings open when changing workspace context', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/')
    await page.getByRole('button', { name: en.auth_setup_postdot, exact: true }).click()
    await page.getByLabel('Name').fill(`Settings ${suffix}`)
    await page.getByLabel('Email').fill(`settings-${suffix}@postdot.local`)
    await page.getByLabel('Password', { exact: true }).fill('settings-context-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    const workspaces: { id: string; name: string; projectId: string }[] = []
    for (const name of [`Workspace A ${suffix}`, `Workspace B ${suffix}`]) {
        const workspaceResponse = await page.request.post('/api/workspaces', { data: { name } })
        expect(workspaceResponse.ok()).toBe(true)
        const { workspace } = (await workspaceResponse.json()) as {
            workspace: { id: string; name: string }
        }
        const projectResponse = await page.request.post('/api/projects', {
            data: { name: `Project ${name}`, workspaceId: workspace.id },
        })
        expect(projectResponse.status()).toBe(201)
        const { project } = (await projectResponse.json()) as { project: { id: string } }
        workspaces.push({ ...workspace, projectId: project.id })
    }
    const [first, second] = workspaces
    for (const path of [
        '/dashboard/preferences/account',
        '/dashboard/preferences/api-keys',
        '/dashboard/settings/provider-applications',
        '/dashboard/settings/access',
        '/dashboard/settings',
        '/dashboard/settings/workspace',
        '/dashboard/workspace/channels',
    ]) {
        await page.goto(`${path}?workspaceId=${first!.id}&projectId=${first!.projectId}`)
        const workspaceSelector = page.getByRole('combobox', {
            name: en.nav_select_workspace,
            exact: true,
        })
        await expect(workspaceSelector).toContainText(first!.name)
        await workspaceSelector.click()
        await page.getByRole('option', { name: new RegExp(second!.name) }).click()
        await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}\\?`))
        await expect(workspaceSelector).toContainText(second!.name)
        expect(new URL(page.url()).searchParams.get('workspaceId')).toBe(second!.id)
        expect(new URL(page.url()).searchParams.get('projectId')).toBe('none')
        await expect(
            page.getByRole('combobox', { name: en.nav_select_project, exact: true })
        ).toContainText(en.nav_no_project_selected)
        await page.reload()
        await expect(workspaceSelector).toContainText(second!.name)
        expect(new URL(page.url()).pathname).toBe(path)
        await expect(
            page.getByRole('button', { name: en.nav_back_to_workspace, exact: true })
        ).toBeVisible()
    }
    await page.goto(
        `/dashboard/preferences/account?workspaceId=${first!.id}&projectId=${first!.projectId}`
    )
    await page.getByLabel(en.account_name, { exact: true }).fill('Unsaved personal name')
    await page.getByRole('combobox', { name: en.nav_select_workspace, exact: true }).click()
    await page.getByRole('option', { name: new RegExp(second!.name) }).click()
    await expect(page.getByLabel(en.account_name, { exact: true })).toHaveValue(
        'Unsaved personal name'
    )

    for (const locale of ['en', 'fr'] as const) {
        const copy = locale === 'en' ? en : fr
        if (locale === 'fr') {
            await page
                .locator('[data-dashboard-header] [data-slot="language-switcher-trigger"]')
                .click()
            await page.getByRole('menuitem', { name: en.language_french, exact: true }).click()
        }
        await page.goto(`/dashboard/preferences?workspaceId=${second!.id}&projectId=none`)
        await expect(
            page.getByRole('heading', { name: copy.nav_preferences_general, exact: true })
        ).toBeVisible()
        for (const theme of ['light', 'dark'] as const) {
            if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
                await page
                    .getByRole('button', {
                        name: copy.theme_switch_to.replace('{theme}', copy[`theme_${theme}`]),
                        exact: true,
                    })
                    .first()
                    .click()
            }
            for (const width of [1280, 820, 390]) {
                await page.setViewportSize({ width, height: 844 })
                expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                await page.screenshot({
                    path: testInfo.outputPath(`settings-${locale}-${theme}-${width}.png`),
                })
            }
        }
    }
    await page.getByRole('button', { name: fr.nav_toggle, exact: true }).click()
    await expect(
        page.getByRole('navigation', { name: fr.nav_personal_settings, exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: fr.nav_instance_navigation, exact: true })
    ).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('settings-fr-dark-mobile-navigation.png') })
    await page.keyboard.press('Escape')
    await expect(
        page.getByRole('navigation', { name: fr.nav_personal_settings, exact: true })
    ).not.toBeVisible()
})
