import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test('requires explicit recovery acknowledgement and keeps a refused resumption visible', async ({
    page,
}) => {
    await page.addInitScript(() => localStorage.setItem('postbot-locale', 'en'))
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postbot', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Recovery operator')
    await page.getByLabel('Email', { exact: true }).fill(`recovery-${randomUUID()}@postbot.local`)
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery-staple')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    let held = true
    let requests = 0
    const hold = {
        version: 1,
        token: 'recovery-ui-token',
        createdAt: new Date().toISOString(),
        reason: 'restore',
    }
    await page.route('**/api/recovery/status', route => route.fulfill({ json: { held } }))
    await page.route('**/api/settings/recovery', route =>
        route.fulfill({ json: { held, hold: held ? hold : null } })
    )
    await page.route('**/api/settings/recovery/resume', async route => {
        expect(route.request().postDataJSON()).toEqual({ token: hold.token, confirm: true })
        requests++
        if (requests === 1)
            return route.fulfill({
                status: 409,
                json: { error: { code: 'recovery_changed', message: 'Recovery changed' } },
            })
        held = false
        return route.fulfill({ json: { held: false, hold: null } })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/settings')
    await expect(page.getByRole('status').filter({ hasText: en.recovery_notice })).toBeVisible()
    await expect(page.getByRole('heading', { name: en.recovery_title, exact: true })).toBeVisible()
    const resume = page.getByRole('button', { name: en.recovery_resume, exact: true })
    await expect(resume).toBeDisabled()
    expect(requests).toBe(0)
    await page.getByRole('checkbox', { name: en.recovery_confirmation, exact: true }).check()
    await resume.click()
    await expect(page.getByText(en.recovery_resume_failed, { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: en.recovery_title, exact: true })).toBeVisible()
    await resume.click()
    await expect(page.getByRole('heading', { name: en.recovery_title, exact: true })).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: en.recovery_notice })).toHaveCount(0)
    expect(requests).toBe(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
