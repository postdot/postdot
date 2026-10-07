import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import { frenchTranslation } from './locale'

test('creates a custom channel with server fingerprints and field-anchored corrections', async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await expect(page.getByRole('heading', { name: en.nav_channels, exact: true })).toBeVisible()

    const channelsUrl = `/api/projects/${projectId}/channels`
    const count = async () =>
        ((await (await page.request.get(channelsUrl)).json()) as { channels: unknown[] }).channels
            .length
    const before = await count()

    await page.getByRole('button', { name: en.channel_add, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(en.channel_create_title)
    await dialog.getByRole('radio', { name: en.channel_custom_profile, exact: true }).click()
    const json = dialog.getByLabel(en.channel_custom_profile_json, { exact: true })
    await expect(json).toHaveValue(/contentSchema/)
    const starter = await json.inputValue()
    expect(starter).toContain('$schema')
    expect(starter).not.toContain('profileHash')
    expect(starter).not.toContain('schemaHash')

    const definition = JSON.parse(starter)
    definition.capabilities.textFields[0].bindingId = 'FAKE_SENTINEL'
    const invalid = JSON.stringify(definition, null, 2)
    await dialog.getByRole('textbox', { name: en.channel_name, exact: true }).fill('UX332 probe')
    await json.fill(invalid)

    const refused = page.waitForResponse(
        response => response.url().includes(channelsUrl) && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    expect((await refused).status()).toBe(400)
    const refusal = await (await refused).json()
    expect(refusal.error.code).toBe('invalid_content')
    expect(refusal.error.issues).toContainEqual({
        path: '/capabilities/textFields/0/bindingId',
        code: 'capability.binding_missing',
    })
    expect(JSON.stringify(refusal)).not.toContain('FAKE_SENTINEL')

    const alert = dialog.getByRole('alert')
    await expect(alert).toContainText(en.profile_definition_invalid)
    await expect(alert).toContainText('/capabilities/textFields/0/bindingId')
    await expect(alert).toContainText(en.profile_issue_binding)
    await expect(alert).not.toContainText('FAKE_SENTINEL')
    await expect(json).toHaveValue(invalid)
    await expect(page.getByText(en.channels_action_failed, { exact: true })).toHaveCount(0)
    expect(await count()).toBe(before)

    await dialog.getByRole('radio', { name: en.channel_manual_profile, exact: true }).click()
    await expect(alert).toHaveCount(0)
    await dialog.getByRole('radio', { name: en.channel_custom_profile, exact: true }).click()
    await expect(json).toHaveValue(invalid)
    await expect(alert).toHaveCount(0)

    await json.fill(starter)
    await expect(alert).toHaveCount(0)
    const accepted = page.waitForResponse(
        response => response.url().includes(channelsUrl) && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    expect((await accepted).status()).toBe(201)
    await expect(dialog).toHaveCount(0)
    expect(await count()).toBe(before + 1)

    const created = (await (await page.request.get(channelsUrl)).json()) as {
        channels: Array<{ id: string; name: string }>
    }
    const probe = created.channels.find(channel => channel.name === 'UX332 probe')!
    const state = (await (await page.request.get(`${channelsUrl}/${probe.id}/profile`)).json()) as {
        active: { profile: Record<string, unknown> }
    }
    expect(state.active.profile.id).toBe(JSON.parse(starter).id)
    expect(state.active.profile.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(state.active.profile.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-slot="language-switcher-trigger"]').click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await page.getByRole('button', { name: frenchTranslation('channel_add'), exact: true }).click()
    const frenchDialog = page.getByRole('dialog')
    await frenchDialog
        .getByRole('radio', { name: frenchTranslation('channel_custom_profile'), exact: true })
        .click()
    const frenchJson = frenchDialog.getByLabel(frenchTranslation('channel_custom_profile_json'), {
        exact: true,
    })
    await expect(frenchJson).toHaveValue(/contentSchema/)
    const frenchDefinition = JSON.parse(await frenchJson.inputValue())
    frenchDefinition.capabilities = null
    await frenchDialog
        .getByRole('textbox', { name: frenchTranslation('channel_name'), exact: true })
        .fill('UX332 sonde')
    await frenchJson.fill(JSON.stringify(frenchDefinition, null, 2))
    await frenchDialog
        .getByRole('button', { name: frenchTranslation('channel_create_button'), exact: true })
        .click()
    const frenchAlert = frenchDialog.getByRole('alert')
    await expect(frenchAlert).toContainText(frenchTranslation('profile_definition_invalid'))
    await expect(frenchAlert).toContainText('/capabilities')
    await expect(frenchAlert).toContainText(frenchTranslation('profile_issue_object'))
    await expect(frenchJson).toHaveValue(JSON.stringify(frenchDefinition, null, 2))
    expect(await count()).toBe(before + 1)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-332 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-332-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-332-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    await page.goto('/dashboard?projectId=none')
    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    await page
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E-332 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    return new URL(page.url()).pathname.split('/')[3]!
}
