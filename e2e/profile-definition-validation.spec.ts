import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { frenchTranslation } from './locale'

test('explains profile errors by field and preserves work until a valid draft is saved', async ({
    page,
}, info) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    const projectId = new URL(page.url()).pathname.split('/')[3]!
    const creation = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Validation channel' },
    })
    expect(creation.status()).toBe(201)
    const { channel } = await creation.json()
    const url = `/api/projects/${projectId}/channels/${channel.id}/profile`
    const original = await (await page.request.get(url)).json()
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Manage Validation channel', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const json = dialog.getByLabel('Profile JSON', { exact: true })
    await expect(json).toHaveValue(/contentSchema/)
    const initial = await json.inputValue()
    const definition = JSON.parse(initial)
    definition.capabilities.textFields[0].bindingId = 'FAKE_SENTINEL'
    const changed = JSON.stringify(definition, null, 2)
    await json.fill(changed)
    const semantic = page.waitForResponse(
        response =>
            response.url().endsWith('/profile-drafts') && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    expect((await semantic).status()).toBe(400)
    const alert = dialog.getByRole('alert')
    await expect(alert).toContainText('Correct the profile definition')
    await expect(alert).toContainText('/capabilities/textFields/0/bindingId')
    await expect(alert).toContainText('Reference an ID declared in fieldBindings.')
    await expect(alert).not.toContainText('FAKE_SENTINEL')
    await expect(alert).not.toContainText('The request could not be completed.')
    await expect(json).toHaveValue(changed)
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeDisabled()
    expect(await (await page.request.get(url)).json()).toEqual(original)
    delete definition.capabilities
    await json.fill(JSON.stringify(definition, null, 2))
    await expect(alert).toHaveCount(0)
    const malformed = page.waitForResponse(
        response =>
            response.url().endsWith('/profile-drafts') && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    expect((await malformed).status()).toBe(400)
    await expect(alert).toContainText('/capabilities')
    await expect(alert).toContainText('Use a JSON object for this field.')
    expect(await (await page.request.get(url)).json()).toEqual(original)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(alert).toBeVisible()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('profile-validation-mobile.png') })
    await json.fill(initial)
    const valid = page.waitForResponse(
        response =>
            response.url().endsWith('/profile-drafts') && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    expect((await valid).status()).toBe(200)
    await expect(alert).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    const saved = await (await page.request.get(url)).json()
    expect(saved.active).toEqual(original.active)
    expect(saved.draft.revision).toBe(1)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.locator('[data-slot="language-switcher-trigger"]').click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await page
        .getByRole('button', {
            name: frenchTranslation('channel_manage').replace('{channel}', 'Validation channel'),
            exact: true,
        })
        .click()
    await page
        .getByRole('menuitem', { name: frenchTranslation('channel_edit_profile'), exact: true })
        .click()
    const frenchJson = page
        .getByRole('dialog')
        .getByLabel(frenchTranslation('profile_json'), { exact: true })
    await expect(frenchJson).toHaveValue(/contentSchema/)
    const invalid = JSON.parse(await frenchJson.inputValue())
    delete invalid.execution
    await frenchJson.fill(JSON.stringify(invalid, null, 2))
    await page
        .getByRole('button', { name: frenchTranslation('profile_save_draft'), exact: true })
        .click()
    const frenchAlert = page.getByRole('dialog').getByRole('alert')
    await expect(frenchAlert).toContainText(frenchTranslation('profile_definition_invalid'))
    await expect(frenchAlert).toContainText('/execution')
    await expect(frenchAlert).toContainText(frenchTranslation('profile_issue_object'))
    await page.route(
        '**/profile-drafts',
        route =>
            route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: {
                        code: 'invalid_content',
                        message: 'FAKE_SENTINEL',
                        issues: [{ code: 'FAKE_SENTINEL', path: '' }],
                        issueCount: 1,
                    },
                }),
            }),
        { times: 1 }
    )
    await page
        .getByRole('button', { name: frenchTranslation('profile_save_draft'), exact: true })
        .click()
    await expect(frenchAlert).toContainText(frenchTranslation('profile_issue_general'))
    await expect(frenchAlert).not.toContainText('FAKE_SENTINEL')
    expect(await (await page.request.get(url)).json()).toEqual(saved)
})
async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-142 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-142-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-142-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    await page.goto('/dashboard?projectId=none')
    await expect(page).toHaveURL(/\/dashboard\?projectId=none$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    await page
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E-142 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
}
