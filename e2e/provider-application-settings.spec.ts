import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test('keeps publisher application configuration in a focused and recoverable form', async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/')
    await page.getByRole('button', { name: en.auth_setup_herald, exact: true }).click()
    await page.getByLabel('Name').fill(`OAuth settings ${suffix}`)
    await page.getByLabel('Email').fill(`oauth-settings-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('oauth-settings-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/settings/provider-applications?projectId=none')
    await expect(
        page.getByRole('heading', { name: en.provider_apps_title, exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: en.provider_apps_new, exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('combobox', { name: en.provider_apps_provider, exact: true }).click()
    await page.getByRole('option', { name: en.provider_apps_provider_x, exact: true }).click()
    await expect(
        dialog.getByLabel(en.provider_apps_x_callback_uri, { exact: true })
    ).toHaveAttribute('readonly', '')
    await dialog.getByRole('combobox', { name: en.provider_apps_provider, exact: true }).click()
    await page.getByRole('option', { name: en.provider_apps_provider_bluesky, exact: true }).click()
    await expect(dialog.getByLabel(en.provider_apps_client_secret, { exact: true })).toHaveCount(0)
    await dialog.getByRole('combobox', { name: en.provider_apps_provider, exact: true }).click()
    await page
        .getByRole('option', { name: en.provider_apps_provider_linkedin, exact: true })
        .click()
    await dialog.getByLabel(en.provider_apps_name, { exact: true }).fill('Publishing application')
    await dialog.getByLabel(en.provider_apps_client_id, { exact: true }).fill('synthetic-client')
    await dialog
        .getByLabel(en.provider_apps_client_secret, { exact: true })
        .fill('synthetic-secret')
    const endpoint = '/api/settings/provider-applications'
    await page.route(endpoint, async route => {
        if (route.request().method() === 'POST')
            await route.fulfill({ status: 503, json: { error: 'internal_error' } })
        else await route.continue()
    })
    await dialog.getByRole('button', { name: en.provider_apps_create, exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByLabel(en.provider_apps_name, { exact: true })).toHaveValue(
        'Publishing application'
    )
    await expect(dialog.getByLabel(en.provider_apps_client_secret, { exact: true })).toHaveValue(
        'synthetic-secret'
    )
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.unroute(endpoint)
    await dialog.getByRole('button', { name: en.provider_apps_create, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const row = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByRole('heading', { name: 'Publishing application', exact: true }) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: en.provider_apps_edit_action, exact: true }).click()
    await expect(dialog.getByLabel(en.provider_apps_client_secret, { exact: true })).toHaveValue('')
    await expect(
        dialog.getByRole('combobox', { name: en.provider_apps_provider, exact: true })
    ).toBeDisabled()
    await dialog.getByLabel(en.provider_apps_name, { exact: true }).fill('Renamed application')
    await dialog.getByRole('button', { name: en.provider_apps_save, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const response = await page.request.get(endpoint)
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.applications).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ name: 'Renamed application', hasClientSecret: true }),
        ])
    )
    expect(JSON.stringify(body)).not.toContain('synthetic-secret')
    for (const theme of ['light', 'dark'] as const) {
        if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
            await page
                .getByRole('button', {
                    name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                    exact: true,
                })
                .click()
        }
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 844 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
            ).toBe(false)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: testInfo.outputPath(`oauth-list-${theme}-${width}.png`) })
            await page.getByRole('button', { name: en.provider_apps_new, exact: true }).click()
            await expect(
                dialog.getByLabel(en.provider_apps_client_secret, { exact: true })
            ).toHaveValue('')
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: testInfo.outputPath(`oauth-form-${theme}-${width}.png`) })
            await page.keyboard.press('Escape')
            await expect(dialog).toHaveCount(0)
            await expect(
                page.getByRole('button', { name: en.provider_apps_new, exact: true })
            ).toBeFocused()
        }
    }
    await page.route(endpoint, route =>
        route.fulfill({ status: 503, json: { error: 'internal_error' } })
    )
    await page.reload()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.unroute(endpoint)
    await page.getByRole('button', { name: en.common_retry, exact: true }).click()
    await expect(
        page.getByRole('heading', { name: 'Renamed application', exact: true })
    ).toBeVisible()
    await page.locator('[data-dashboard-header] [data-slot="language-switcher-trigger"]').click()
    await page.getByRole('menuitem', { name: en.language_french, exact: true }).click()
    await page.getByRole('button', { name: fr.provider_apps_new, exact: true }).click()
    await expect(dialog.getByLabel(fr.provider_apps_client_secret, { exact: true })).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('oauth-form-fr-mobile.png') })
})
