import { readFileSync } from 'node:fs'

import { expect, type Page } from '@playwright/test'

const frenchMessages = JSON.parse(
    readFileSync(new URL('../apps/web/messages/fr.json', import.meta.url), 'utf8')
) as Record<string, string>

export function frenchTranslation(key: string): string {
    const message = frenchMessages[key]
    if (message === undefined) throw new Error(`Missing French translation: ${key}`)
    return message
}

/** Language and theme live in the account menu (ADR-103 §4); this opens the language list. */
export async function openLanguageMenu(page: Page) {
    await page.locator('[data-slot="account-menu-trigger"]').click()
    await page.locator('[data-slot="account-menu-language"]').click()
}

export async function switchTheme(page: Page, theme: 'light' | 'dark') {
    await page.locator('[data-slot="account-menu-trigger"]').click()
    await page.locator('[data-slot="account-menu-theme"]').click()
    await page.locator(`[data-theme-option="${theme}"]`).click()
    await closedAccountMenu(page)
}

export async function signOut(page: Page) {
    await page.locator('[data-slot="account-menu-trigger"]').click()
    await page.locator('[data-slot="account-menu-sign-out"]').click()
}

/** Wait until the account menu and its focus guards are gone, so accessibility scans see the page. */
async function closedAccountMenu(page: Page) {
    if ((await page.getByRole('menu').count()) > 0) await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.locator('[data-base-ui-focus-guard]')).toHaveCount(0)
}
