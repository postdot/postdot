import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import { frenchTranslation } from './locale'

interface EditableProfile {
    contentSchema: { properties: { body: { maxLength: number } } }
    fieldBindings: { id: string }[]
    capabilities: {
        revision: string
        textFields: { bindingId: string; maxLength: number }[]
        mediaFields: unknown[]
        relations: unknown[]
    }
    execution: { kind: string }
}

test('refuses malformed profile definitions without changing the saved profile', async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    const projectId = new URL(page.url()).pathname.split('/')[3]!
    const creation = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Validation channel' },
    })
    expect(creation.status()).toBe(201)
    const { channel } = await creation.json()
    const channelUrl = `/api/projects/${projectId}/channels/${channel.id}`
    const url = `${channelUrl}/profile`
    const original = await (await page.request.get(url)).json()
    const definition = editableDefinition(original.active.profile)

    const semantic = await page.request.post(`${channelUrl}/profile-drafts`, {
        data: { profile: withUnknownBinding(definition) },
    })
    expect(semantic.status()).toBe(400)
    const semanticRefusal = await semantic.json()
    expect(semanticRefusal.error.code).toBe('invalid_content')
    expect(semanticRefusal.error.issues).toContainEqual({
        path: '/capabilities/textFields/0/bindingId',
        code: 'capability.binding_missing',
    })
    expect(JSON.stringify(semanticRefusal)).not.toContain('FAKE_SENTINEL')
    expect(await (await page.request.get(url)).json()).toEqual(original)

    const structural = await page.request.post(`${channelUrl}/profile-drafts`, {
        data: { profile: { ...definition, capabilities: null } },
    })
    expect(structural.status()).toBe(400)
    const structuralRefusal = await structural.json()
    expect(structuralRefusal.error.code).toBe('invalid_content')
    expect(structuralRefusal.error.issues).toContainEqual({
        path: '/capabilities',
        code: 'profile.object_required',
    })
    expect(JSON.stringify(structuralRefusal)).not.toContain('FAKE_SENTINEL')
    expect(await (await page.request.get(url)).json()).toEqual(original)

    const identity = await page.request.post(`${channelUrl}/profile-drafts`, {
        data: { profile: { ...original.active.profile, id: 'unwanted-identity' } },
    })
    expect(identity.status()).toBe(400)
    expect((await identity.json()).error.code).toBe('invalid_input')
    expect(await (await page.request.get(url)).json()).toEqual(original)

    const valid = await page.request.post(`${channelUrl}/profile-drafts`, {
        data: { profile: definition },
    })
    expect(valid.status(), await valid.text()).toBe(200)
    const saved = await (await page.request.get(url)).json()
    expect(saved.active).toEqual(original.active)
    expect(saved.draft.revision).toBe(1)
    expect(saved.draft.profile.id).toBe(original.active.profile.id)
    expect(saved.draft.profile.origin).toBe(original.active.profile.origin)
    expect(saved.draft.profile.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(saved.draft.profile.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)
})

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

    const refusal = {
        path: '/capabilities/textFields/0/bindingId',
        code: 'capability.binding_missing',
    }
    let refuse = true
    // The structured form keeps definitions valid, so a server refusal is staged.
    await page.route(
        url => url.pathname.endsWith('/profile-drafts'),
        async route => {
            if (!refuse || route.request().method() !== 'POST') {
                await route.continue()
                return
            }
            await route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: {
                        code: 'invalid_content',
                        message: 'FAKE_SENTINEL raw diagnostic',
                        issues: [refusal],
                        issueCount: 1,
                    },
                }),
            })
        }
    )

    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Manage Validation channel', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(bodyMaximum(dialog)).toHaveValue('1000000')

    await bodyMaximum(dialog).fill('900')
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    const alert = dialog.getByRole('alert')
    await expect(alert).toContainText('Correct the profile definition')
    await expect(alert).toContainText('/capabilities/textFields/0/bindingId')
    await expect(alert).toContainText('Reference an ID declared in fieldBindings.')
    await expect(alert).not.toContainText('FAKE_SENTINEL')
    await expect(alert).not.toContainText('The request could not be completed.')
    // The refusal keeps the operator's work and stays a single, field-level signal.
    await expect(bodyMaximum(dialog)).toHaveValue('900')
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeDisabled()
    await expect(page.getByText(en.channels_action_failed, { exact: true })).toHaveCount(0)
    expect(await (await page.request.get(url)).json()).toEqual(original)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(alert).toBeVisible()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('profile-validation-mobile.png') })
    await page.setViewportSize({ width: 1280, height: 900 })

    // Editing the definition clears the stale diagnostic.
    await bodyMaximum(dialog).fill('800')
    await expect(dialog.getByRole('alert')).toHaveCount(0)

    refuse = false
    const valid = page.waitForResponse(
        response =>
            response.url().endsWith('/profile-drafts') && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    expect((await valid).status()).toBe(200)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    await expect(bodyMaximum(dialog)).toHaveValue('800')
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
    const frenchDialog = page.getByRole('dialog')
    await expect(
        frenchDialog
            .getByRole('group', { name: frenchTranslation('editor_source_body'), exact: true })
            .getByLabel(frenchTranslation('builder_max_length'), { exact: true })
    ).toHaveValue('800')
    refusal.path = '/execution'
    refusal.code = 'profile.object_required'
    refuse = true
    await page
        .getByRole('button', { name: frenchTranslation('profile_save_draft'), exact: true })
        .click()
    const frenchAlert = frenchDialog.getByRole('alert')
    await expect(frenchAlert).toContainText(frenchTranslation('profile_definition_invalid'))
    await expect(frenchAlert).toContainText('/execution')
    await expect(frenchAlert).toContainText(frenchTranslation('profile_issue_object'))
    await expect(frenchAlert).not.toContainText('FAKE_SENTINEL')
    refusal.path = ''
    refusal.code = 'FAKE_SENTINEL'
    await page
        .getByRole('button', { name: frenchTranslation('profile_save_draft'), exact: true })
        .click()
    await expect(frenchAlert).toContainText(frenchTranslation('profile_issue_general'))
    await expect(frenchAlert).not.toContainText('FAKE_SENTINEL')
    // The refused French saves changed nothing: active and draft stay exactly as saved.
    expect(await (await page.request.get(url)).json()).toEqual(saved)
})

function editableDefinition(profile: Record<string, unknown>): EditableProfile {
    return {
        contentSchema: profile.contentSchema as EditableProfile['contentSchema'],
        fieldBindings: profile.fieldBindings as EditableProfile['fieldBindings'],
        capabilities: profile.capabilities as EditableProfile['capabilities'],
        execution: profile.execution as EditableProfile['execution'],
    }
}

function withUnknownBinding(definition: EditableProfile): EditableProfile {
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

function bodyGroup(scope: Locator): Locator {
    return scope.getByRole('group', { name: 'Body', exact: true })
}

function bodyMaximum(scope: Locator): Locator {
    return bodyGroup(scope).getByLabel('Maximum characters', { exact: true })
}

async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-142 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-142-${suffix}@postdot.local`)
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
