import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

for (const [locale, messages] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`installation release identification and recovery in ${locale}`, async ({ page }) => {
        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Release acceptance',
                email: `release-${randomUUID()}@example.test`,
                password: 'release-acceptance-password-123',
            },
        })
        expect(signup.status()).toBe(200)
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        let unavailable = false
        let unversioned = false
        await page.route('**/api/version', async route => {
            if (unavailable) await route.fulfill({ status: 503, json: { error: 'Unavailable' } })
            else
                await route.fulfill({
                    json: unversioned
                        ? { version: null, revision: null }
                        : { version: '0.1.0-alpha.3', revision: 'a'.repeat(40) },
                })
        })
        await page.goto('/dashboard/settings')
        const section = page.getByRole('region', { name: messages.release_title })
        await expect(section.getByText('0.1.0-alpha.3', { exact: true })).toBeVisible()
        await expect(section.getByText('a'.repeat(40), { exact: true })).toBeVisible()
        await page.setViewportSize({ width: 390, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
            false
        )
        unavailable = true
        await page.reload()
        await expect(section.getByRole('alert')).toHaveText(messages.release_load_failed, {
            timeout: 15_000,
        })
        unavailable = false
        unversioned = true
        await section.getByRole('button', { name: messages.common_retry, exact: true }).click()
        await expect(section.getByText(messages.release_unversioned, { exact: true })).toBeVisible()
        await expect(
            section.getByText(messages.release_unknown_revision, { exact: true })
        ).toBeVisible()
    })
}
