import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import { frenchTranslation } from './locale'

test('refuses malformed custom channel definitions and derives fingerprints on the server', async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelsUrl = `/api/projects/${projectId}/channels`
    const count = async () =>
        ((await (await page.request.get(channelsUrl)).json()) as { channels: unknown[] }).channels
            .length
    const before = await count()

    const refused = await page.request.post(channelsUrl, {
        data: { name: 'UX332 probe', profile: withUnknownBinding(customDefinition(suffix)) },
    })
    expect(refused.status()).toBe(400)
    const refusal = await refused.json()
    expect(refusal.error.code).toBe('invalid_content')
    expect(refusal.error.issues).toContainEqual({
        path: '/capabilities/textFields/0/bindingId',
        code: 'capability.binding_missing',
    })
    expect(JSON.stringify(refusal)).not.toContain('FAKE_SENTINEL')
    expect(await count()).toBe(before)

    const structural = await page.request.post(channelsUrl, {
        data: { name: 'UX332 probe', profile: withoutCapabilities(customDefinition(suffix)) },
    })
    expect(structural.status()).toBe(400)
    const structuralRefusal = await structural.json()
    expect(structuralRefusal.error.code).toBe('invalid_content')
    expect(structuralRefusal.error.issues).toContainEqual({
        path: '/capabilities',
        code: 'profile.object_required',
    })
    expect(JSON.stringify(structuralRefusal)).not.toContain('FAKE_SENTINEL')
    expect(await count()).toBe(before)

    const accepted = await page.request.post(channelsUrl, {
        data: {
            name: 'UX332 accepted',
            profile: {
                ...customDefinition(suffix),
                profileHash: 'sha256:operator-supplied-profile',
                schemaHash: 'sha256:operator-supplied-schema',
            },
        },
    })
    expect(accepted.status(), await accepted.text()).toBe(201)
    expect(await count()).toBe(before + 1)

    const created = (await (await page.request.get(channelsUrl)).json()) as {
        channels: { id: string; name: string }[]
    }
    const channel = created.channels.find(item => item.name === 'UX332 accepted')!
    const state = (await (
        await page.request.get(`${channelsUrl}/${channel.id}/profile`)
    ).json()) as { active: { profile: Record<string, unknown> } }
    expect(state.active.profile.id).toBe(`e2e-custom-${suffix}`)
    expect(state.active.profile.origin).toBe('custom')
    expect(state.active.profile.version).toBe(1)
    expect(state.active.profile.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(state.active.profile.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(state.active.profile.schemaHash).not.toBe('sha256:operator-supplied-schema')
    expect(state.active.profile.profileHash).not.toBe('sha256:operator-supplied-profile')
})

test('projects custom channel definition errors in the creation dialog', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await expect(page.getByRole('heading', { name: en.nav_channels, exact: true })).toBeVisible()

    const channelsUrl = `/api/projects/${projectId}/channels`
    const count = async () =>
        ((await (await page.request.get(channelsUrl)).json()) as { channels: unknown[] }).channels
            .length
    const before = await count()

    const submitted: { name?: string; profile?: Record<string, unknown> }[] = []
    await page.route(
        url => url.pathname === channelsUrl,
        async route => {
            if (route.request().method() !== 'POST') {
                await route.continue()
                return
            }
            submitted.push(route.request().postDataJSON())
            await route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: {
                        code: 'invalid_content',
                        message: 'FAKE_SENTINEL raw diagnostic',
                        issues: [
                            {
                                path: '/capabilities/textFields/0/bindingId',
                                code: 'capability.binding_missing',
                            },
                        ],
                        issueCount: 1,
                    },
                }),
            })
        }
    )

    await page.getByRole('button', { name: en.channel_add, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(en.channel_create_title)
    await dialog.getByRole('radio', { name: en.channel_custom_profile, exact: true }).click()
    await dialog.getByRole('textbox', { name: en.channel_name, exact: true }).fill('UX332 probe')
    await dialog.getByRole('button', { name: en.builder_configure_channel, exact: true }).click()
    const body = dialog.getByRole('group', { name: 'Body', exact: true })
    const maximum = body.getByLabel('Maximum characters', { exact: true })
    await expect(maximum).toHaveValue('1000000')

    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    const alert = dialog.getByRole('alert')
    await expect(alert).toContainText(en.profile_definition_invalid)
    await expect(alert).toContainText('/capabilities/textFields/0/bindingId')
    await expect(alert).toContainText(en.profile_issue_binding)
    await expect(alert).not.toContainText('FAKE_SENTINEL')
    // Definition errors stay inside the dialog: no second, generic page banner.
    await expect(page.getByText(en.channels_action_failed, { exact: true })).toHaveCount(0)
    expect(await count()).toBe(before)

    // The dialog never authors fingerprints; the server owns them.
    expect(submitted).toHaveLength(1)
    expect(submitted[0]?.name).toBe('UX332 probe')
    expect(submitted[0]?.profile).not.toHaveProperty('profileHash')
    expect(submitted[0]?.profile).not.toHaveProperty('schemaHash')
    expect(submitted[0]?.profile).toMatchObject({ id: 'custom-manual', origin: 'custom' })

    // The refusal survives the wizard step but is cleared by a profile change.
    await dialog.getByRole('button', { name: en.builder_back, exact: true }).click()
    await expect(alert).toHaveCount(1)
    await expect(alert).toBeVisible()
    await dialog.getByRole('radio', { name: en.channel_manual_profile, exact: true }).click()
    await expect(alert).toHaveCount(0)
    await dialog.getByRole('radio', { name: en.channel_custom_profile, exact: true }).click()
    await expect(alert).toHaveCount(0)

    // The same refusal is cleared by editing the definition.
    await dialog.getByRole('button', { name: en.builder_configure_channel, exact: true }).click()
    await expect(maximum).toHaveValue('1000000')
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    await expect(alert).toContainText(en.profile_definition_invalid)
    await maximum.fill('900')
    await expect(alert).toHaveCount(0)
    expect(await count()).toBe(before)

    await page.setViewportSize({ width: 390, height: 844 })
    await dialog.getByRole('button', { name: en.common_cancel, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.locator('[data-slot="language-switcher-trigger"]').click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await page.getByRole('button', { name: frenchTranslation('channel_add'), exact: true }).click()
    const frenchDialog = page.getByRole('dialog')
    await frenchDialog
        .getByRole('radio', { name: frenchTranslation('channel_custom_profile'), exact: true })
        .click()
    await frenchDialog
        .getByRole('textbox', { name: frenchTranslation('channel_name'), exact: true })
        .fill('UX332 sonde')
    await frenchDialog
        .getByRole('button', { name: frenchTranslation('builder_configure_channel'), exact: true })
        .click()
    await frenchDialog
        .getByRole('button', { name: frenchTranslation('channel_create_button'), exact: true })
        .click()
    const frenchAlert = frenchDialog.getByRole('alert')
    await expect(frenchAlert).toContainText(frenchTranslation('profile_definition_invalid'))
    await expect(frenchAlert).toContainText('/capabilities/textFields/0/bindingId')
    await expect(frenchAlert).toContainText(frenchTranslation('profile_issue_binding'))
    await expect(frenchAlert).not.toContainText('FAKE_SENTINEL')
    expect(await count()).toBe(before)
})

function customDefinition(suffix: string) {
    return {
        id: `e2e-custom-${suffix}`,
        version: 1,
        origin: 'custom' as const,
        contentSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { body: { type: 'string', minLength: 1, maxLength: 1000 } },
            required: ['body'],
            additionalProperties: false,
        },
        fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
        capabilities: {
            revision: 'e2e-custom-v1',
            textFields: [
                { bindingId: 'body', acceptedSourceFormats: ['plain_text'], maxLength: 1000 },
            ],
            mediaFields: [],
            relations: [],
        },
        execution: { kind: 'manual' },
    }
}

function withUnknownBinding(definition: ReturnType<typeof customDefinition>) {
    return {
        ...definition,
        capabilities: {
            ...definition.capabilities,
            textFields: definition.capabilities.textFields.map(field =>
                field.bindingId === 'body' ? { ...field, bindingId: 'FAKE_SENTINEL' } : field
            ),
        },
    }
}

function withoutCapabilities(definition: ReturnType<typeof customDefinition>) {
    return { ...definition, capabilities: null }
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postbot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-332 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-332-${suffix}@postbot.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-332-password')
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
        .fill(`E2E-332 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    return new URL(page.url()).pathname.split('/')[3]!
}
