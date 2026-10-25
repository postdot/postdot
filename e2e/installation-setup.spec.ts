import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test('first-administrator setup explains access consequences in both languages', async ({
    page,
}) => {
    for (const [locale, messages] of [
        ['en', en],
        ['fr', fr],
    ] as const) {
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto('/setup')
        await expect(page.getByText(messages.auth_setup_administrator_description)).toBeVisible()
        await expect(
            page.getByRole('button', { name: messages.auth_create_account_button })
        ).toBeVisible()
        await page.setViewportSize({ width: 390, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
            false
        )
    }
})
