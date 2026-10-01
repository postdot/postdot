import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test('edits personal identity and safely changes the password across settings layouts', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/')
    await page.getByRole('button', { name: en.auth_setup_herald, exact: true }).click()
    await page.getByLabel('Name').fill(`Account ${suffix}`)
    await page.getByLabel('Email').fill(`account-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('original-account-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto('/dashboard/preferences/account?projectId=none')
    await expect(
        page.getByRole('heading', { name: en.nav_preferences_account, exact: true })
    ).toBeVisible()
    await page.getByLabel(en.account_name, { exact: true }).fill(`Updated ${suffix}`)
    await page.getByRole('button', { name: en.account_save, exact: true }).click()
    await expect(page.getByRole('status')).toHaveText(en.account_saved)
    await expect(
        page.getByRole('button', { name: en.nav_account_menu, exact: true })
    ).toContainText(`Updated ${suffix}`)
    const input = page.locator('input[type=file]')
    await input.setInputFiles({
        name: 'invalid.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg></svg>'),
    })
    await expect(page.getByRole('alert')).toHaveText(en.account_photo_format)
    const unsavedName = `Unsaved ${suffix}`
    await page.getByLabel(en.account_name, { exact: true }).fill(unsavedName)
    await page.route('**/api/account/avatar', route =>
        route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
                error: { code: 'avatar_unavailable', message: 'Storage unavailable' },
            }),
        })
    )
    await input.setInputFiles({
        name: 'unavailable.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fixture'),
    })
    await expect(page.getByRole('alert')).toHaveText(en.api_request_failed)
    await expect(page.getByLabel(en.account_name, { exact: true })).toHaveValue(unsavedName)
    await page.unroute('**/api/account/avatar')
    await input.setInputFiles({
        name: 'portrait.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
            'base64'
        ),
    })
    await expect(page.getByRole('status')).toHaveText(en.account_photo_saved)
    await expect(page.getByLabel(en.account_name, { exact: true })).toHaveValue(unsavedName)
    await page.getByLabel(en.account_name, { exact: true }).fill(`Updated ${suffix}`)
    await expect(page.locator('main img[src^="/api/account/avatars/"]')).toBeVisible()
    await page.getByRole('button', { name: en.account_remove_photo, exact: true }).click()
    await expect(page.getByRole('status')).toHaveText(en.account_photo_removed)
    await page.reload()
    await expect(page.getByLabel(en.account_name, { exact: true })).toHaveValue(`Updated ${suffix}`)

    for (const locale of ['en', 'fr'] as const) {
        const copy = locale === 'en' ? en : fr
        if (locale === 'fr') {
            await page.locator('[data-slot="language-switcher-trigger"]').click()
            await page.getByRole('menuitem', { name: en.language_french, exact: true }).click()
        }
        for (const theme of ['light', 'dark'] as const) {
            if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
                await page
                    .getByRole('button', {
                        name: copy.theme_switch_to.replace('{theme}', copy[`theme_${theme}`]),
                        exact: true,
                    })
                    .click()
            }
            for (const width of [1280, 820, 390]) {
                await page.setViewportSize({ width, height: 844 })
                expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                await page.screenshot({
                    path: testInfo.outputPath(`account-${locale}-${theme}-${width}.png`),
                })
                await page
                    .getByRole('button', { name: copy.account_change_password, exact: true })
                    .click()
                const dialog = page.getByRole('dialog')
                await expect(dialog).toBeVisible()
                await expect(dialog).toHaveAttribute('data-open', '')
                expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                await page.screenshot({
                    path: testInfo.outputPath(`password-${locale}-${theme}-${width}.png`),
                })
                await dialog.getByRole('button', { name: copy.common_close, exact: true }).click()
                await expect(dialog).toHaveCount(0)
            }
        }
    }
    await page.getByRole('button', { name: fr.account_change_password, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(fr.account_current_password, { exact: true }).fill('wrong-password')
    await dialog.getByLabel(fr.account_new_password, { exact: true }).fill('replacement-password')
    await dialog
        .getByLabel(fr.account_confirm_password, { exact: true })
        .fill('replacement-password')
    await dialog.getByRole('button', { name: fr.account_change_password, exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(fr.account_password_invalid)
    await dialog
        .getByLabel(fr.account_current_password, { exact: true })
        .fill('original-account-password')
    await dialog.getByRole('button', { name: fr.account_change_password, exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('status')).toHaveText(fr.account_password_changed)
    await page.reload()
    await expect(page.getByLabel(fr.account_name, { exact: true })).toHaveValue(`Updated ${suffix}`)
})
