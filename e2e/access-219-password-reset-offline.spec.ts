import { expect, test } from '@playwright/test'

test('explains when email password recovery is not configured', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByLabel('Email', { exact: true }).fill('operator@postbot.local')
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click()

    await expect(page.getByRole('alert')).toHaveText(
        'Password recovery is unavailable because email delivery is not configured.'
    )
})
