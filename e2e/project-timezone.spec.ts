import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test.use({ timezoneId: 'Europe/Berlin' })

test('sets project scheduling timezone on creation and updates it in project access settings', async ({
    page,
}) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const email = `e2e-tz-${suffix}@postdot.local`

    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E TZ owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill('e2e-tz-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])

    await page.goto('/dashboard?projectId=none')
    await expect(page).toHaveURL(/\/dashboard\?projectId=none$/)

    // 1. Project creation dialog defaults to browser timezone (Europe/Berlin).
    await page.getByRole('button', { name: en.nav_create_project, exact: true }).first().click()
    const onboardingDialog = page.getByRole('dialog')
    await expect(onboardingDialog).toBeVisible()
    const onboardingTimeZoneTrigger = onboardingDialog.getByRole('combobox', {
        name: en.project_timezone_label,
        exact: true,
    })
    await expect(onboardingTimeZoneTrigger).toContainText('Europe/Berlin')

    // Override the timezone during creation to America/New_York.
    await onboardingTimeZoneTrigger.click()
    const searchInput = page.getByRole('combobox', {
        name: en.project_timezone_search,
        exact: true,
    })
    await searchInput.fill('America/New_York')
    await page.getByRole('option', { name: 'America/New_York', exact: true }).click()
    await expect(onboardingTimeZoneTrigger).toContainText('America/New_York')

    await onboardingDialog
        .getByRole('textbox', { name: en.nav_new_project, exact: true })
        .fill(`E2E TZ project ${suffix}`)
    await onboardingDialog.getByRole('button', { name: en.nav_add_project, exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    const projectId = match[1]

    // 2. Check Project configuration -> Access displays America/New_York and allows updating.
    await page.goto(`/dashboard/projects/${projectId}/access`)
    await expect(
        page.getByRole('heading', { name: en.project_timezone_title, exact: true })
    ).toBeVisible()

    const settingsTimeZoneTrigger = page.getByRole('combobox', {
        name: en.project_timezone_label,
        exact: true,
    })
    await expect(settingsTimeZoneTrigger).toContainText('America/New_York')

    const saveButton = page.getByRole('button', { name: en.project_timezone_save, exact: true })
    await expect(saveButton).toBeDisabled()

    await settingsTimeZoneTrigger.click()
    await page
        .getByRole('combobox', { name: en.project_timezone_search, exact: true })
        .fill('Europe/Paris')
    await page.getByRole('option', { name: 'Europe/Paris', exact: true }).click()
    await expect(settingsTimeZoneTrigger).toContainText('Europe/Paris')
    await expect(saveButton).toBeEnabled()

    await Promise.all([
        page.waitForResponse(
            response =>
                response.url().includes(`/api/projects/${projectId}`) &&
                response.request().method() === 'PATCH' &&
                response.ok()
        ),
        saveButton.click(),
    ])

    await expect(page.locator('[data-slot="toast"]')).toContainText(en.project_timezone_saved)
    await expect(saveButton).toBeDisabled()

    // 3. Reload confirms persisted timezone.
    await page.reload()
    await expect(settingsTimeZoneTrigger).toContainText('Europe/Paris')
    await expect(saveButton).toBeDisabled()
})
