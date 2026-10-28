import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test('creates manual channels with defaults and explains provider setup before connection', async ({
    page,
}, info) => {
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: en.channel_add, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0)
    await expect(
        dialog.getByRole('button', { name: en.channel_create_button, exact: true })
    ).toBeDisabled()
    await dialog.getByRole('radio', { name: en.channel_manual_profile, exact: true }).click()
    await expect(dialog).toContainText(en.channel_manual_creation_help)
    await expect(dialog.getByRole('group', { name: 'Body', exact: true })).toHaveCount(0)
    await dialog.getByLabel(en.channel_name).fill('Manual announcements')
    await page.screenshot({ path: info.outputPath('manual-defaults.png') })
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const channels = (await (await page.request.get(`/api/projects/${projectId}/channels`)).json())
        .channels
    const manual = channels.find(
        (channel: { name: string }) => channel.name === 'Manual announcements'
    )
    expect(manual.execution).toEqual({ kind: 'manual' })
    await page.getByRole('button', { name: en.channel_add, exact: true }).click()
    await dialog.getByRole('radio', { name: en.channel_x_profile, exact: true }).click()
    await expect(dialog).toContainText(en.channel_provider_application_help)
    await dialog.getByLabel(en.channel_name).fill('X setup test')
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    const row = page.getByRole('article').filter({ hasText: 'X setup test' })
    await row.getByRole('button', { name: en.publisher_setup_required, exact: true }).click()
    await expect(dialog).toContainText(en.channel_provider_setup_explanation)
    const settings = dialog.getByRole('link', { name: en.provider_apps_title, exact: true })
    await expect(settings).toHaveAttribute('href', /settings\/provider-applications/)
    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
            false
        )
        await page.screenshot({ path: info.outputPath(`provider-setup-${width}.png`) })
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await settings.click()
    await expect(page).toHaveURL(/settings\/provider-applications/)
    await page.evaluate(() => localStorage.setItem('PARAGLIDE_LOCALE', 'fr'))
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page
        .getByRole('article')
        .filter({ hasText: 'X setup test' })
        .getByRole('button', { name: fr.publisher_setup_required, exact: true })
        .click()
    await expect(dialog).toContainText(fr.channel_provider_setup_explanation)
    await expect(
        dialog.getByRole('link', { name: fr.provider_apps_title, exact: true })
    ).toBeVisible()
    await page.screenshot({ path: info.outputPath('provider-setup-fr-390.png') })
})

test('explains missing provider setup to a project owner without installation administration', async ({
    page,
}) => {
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    // The E2E signup seam grants administration. Exercise the non-admin
    // presentation with the same server payload, changing only that capability.
    await page.route('**/api/access', async route => {
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...(await response.json()), isAdmin: false } })
    })
    expect(
        (
            await page.request.post(`/api/projects/${projectId}/channels`, {
                data: { name: 'Needs administrator', profile: 'x' },
            })
        ).status()
    ).toBe(201)
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page
        .getByRole('article')
        .filter({ hasText: 'Needs administrator' })
        .getByRole('button', { name: en.publisher_setup_required, exact: true })
        .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(en.publisher_oauth_contact_admin)
    await expect(
        dialog.getByRole('link', { name: en.provider_apps_title, exact: true })
    ).toHaveCount(0)
})

test('distinguishes repeated platforms and creates a channel without leaving the composition', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    for (const [name, profile] of [
        ['Community announcements', 'manual-message'],
        ['X.com', 'x'],
        ['X.com', 'x'],
        ['LinkedIn', 'linkedin'],
        ['Discord', 'discord'],
        ['Mastodon', 'mastodon'],
    ]) {
        expect(
            (
                await page.request.post(`/api/projects/${projectId}/channels`, {
                    data: { name, profile },
                })
            ).status()
        ).toBe(201)
    }
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await expect(page.getByRole('heading', { name: en.nav_channels, exact: true })).toBeVisible()
    for (const theme of ['light', 'dark'] as const) {
        if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
            await page
                .getByRole('button', {
                    name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                    exact: true,
                })
                .click()
        }
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({ path: testInfo.outputPath(`channels-surfaces-${theme}.png`) })
    }
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    await expect(page.locator('[data-new-publication-form]')).toHaveAttribute('aria-busy', 'false')
    for (const theme of ['light', 'dark'] as const) {
        await page
            .getByRole('button', {
                name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                exact: true,
            })
            .click()
        await page.screenshot({ path: testInfo.outputPath(`compose-surfaces-${theme}.png`) })
    }

    const content = page.getByRole('textbox', {
        name: en.publication_new_source_content,
        exact: true,
    })
    const body = 'Keep this composition while choosing another destination.'
    await content.fill(body)
    const sidebar = page.locator('[data-slot="sidebar-inner"]')
    await expect(sidebar.getByRole('link', { name: en.nav_channels, exact: true })).toHaveCount(1)
    await expect(sidebar.locator('[data-channel-avatar]')).toHaveCount(0)
    const rail = page.locator('[data-publication-channel-selection]')
    const xA = en.publication_new_add_channel_named.replace('{channel}', 'X.com · A')
    const xB = en.publication_new_add_channel_named.replace('{channel}', 'X.com · B')
    await rail.getByRole('button', { name: xA, exact: true }).click()
    await rail.getByRole('button', { name: xB, exact: true }).click()
    await expect(rail.getByRole('button', { name: 'X.com · A', exact: true })).toBeVisible()
    await expect(rail.getByRole('button', { name: 'X.com · B', exact: true })).toBeVisible()
    await rail.getByRole('button', { name: 'X.com · B', exact: true }).click()
    await expect(rail.getByRole('button', { name: 'X.com · B', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await rail.getByRole('button', { name: en.channel_add, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: en.channel_x_profile, exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: en.channel_name, exact: true })).toHaveValue(
        'X.com C'
    )
    const order = await dialog.evaluate(element => {
        const choices = element.querySelector('[role="radiogroup"]')!
        const name = element.querySelector('#new-channel-name')!
        return choices.getBoundingClientRect().bottom <= name.getBoundingClientRect().top
    })
    expect(order).toBe(true)
    await dialog.getByRole('textbox', { name: en.channel_name, exact: true }).fill('X.com')
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    await expect(dialog).toContainText(en.channel_name_exists)
    await dialog.getByRole('textbox', { name: en.channel_name, exact: true }).fill('X.com C')
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    await expect(content).toHaveText(body)
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/publications/new$`))
    await expect(
        rail.getByRole('button', {
            name: en.publication_new_add_channel_named.replace('{channel}', 'X.com C · C'),
            exact: true,
        })
    ).toBeVisible()
    const createControl = await rail
        .getByRole('button', { name: en.channel_add, exact: true })
        .boundingBox()
    const availableControl = await rail.locator('[data-channel-available]').first().boundingBox()
    expect(createControl).not.toBeNull()
    expect(availableControl).not.toBeNull()
    expect(Math.abs(createControl!.y - availableControl!.y)).toBeLessThanOrEqual(1)
    expect(createControl!.height).toBe(availableControl!.height)
    for (const name of ['LinkedIn', 'Discord', 'Mastodon', 'X.com C · C']) {
        await rail
            .getByRole('button', {
                name: en.publication_new_add_channel_named.replace('{channel}', name),
                exact: true,
            })
            .click()
    }
    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        expect(
            await page
                .locator('[data-dashboard-scroll]')
                .evaluate(element => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({ path: testInfo.outputPath(`channel-rail-${width}.png`) })
    }
    await rail.getByRole('button', { name: 'X.com · A', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(rail.getByRole('button', { name: 'X.com · A', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    // The X destination declares no headline, so its scope renders no title field.
    await expect(page.locator('#new-post-title')).toHaveCount(0)
    await expect(page.getByText(en.composer_constraints_loading, { exact: true })).toHaveCount(0)
    const editorTop = await page
        .locator('#new-post-content')
        .evaluate(element => element.getBoundingClientRect().top)
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    // The common scope resolves to the first destination, whose profile declares an
    // optional title, so the scopes legitimately differ in the fields they render.
    await expect(page.locator('#new-post-title')).toHaveCount(1)
    await expect(page.getByLabel(en.builder_title_optional, { exact: true })).toBeVisible()
    await expect(content).toHaveText(body)
    await rail.getByRole('button', { name: 'X.com · A', exact: true }).click()
    // Returning to the same destination restores the same composition geometry.
    await expect(page.locator('#new-post-title')).toHaveCount(0)
    expect(
        await page
            .locator('#new-post-content')
            .evaluate(element => element.getBoundingClientRect().top)
    ).toBe(editorTop)
    await expect(
        rail.getByRole('button', {
            name: en.publication_new_remove_channel.replace('{channel}', 'X.com · B'),
            exact: true,
        })
    ).toHaveCount(0)
    const channelCopy = page.getByRole('textbox', {
        name: en.publication_new_channel_copy,
        exact: true,
    })
    await channelCopy.fill(`${body} A destination-only sentence.`)
    const removeA = rail.getByRole('button', {
        name: en.publication_new_remove_channel.replace('{channel}', 'X.com · A'),
        exact: true,
    })
    await removeA.click()
    const removal = page.getByRole('dialog')
    await expect(removal).toContainText(en.publication_remove_customized_description)
    await removal
        .getByRole('button', { name: en.publication_remove_customized_cancel, exact: true })
        .click()
    await expect(channelCopy).toHaveText(`${body} A destination-only sentence.`)
    await removeA.click()
    await removal
        .getByRole('button', { name: en.publication_remove_customized_confirm, exact: true })
        .click()
    await expect(rail.getByRole('button', { name: 'X.com · A', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    await expect(content).toHaveText(body)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-124 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-124-${suffix}@postdot.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-124-password')
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
        .fill(`E2E-124 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}

test('keeps Bluesky connection failures inside the dialog and preserves the handle', async ({
    page,
}) => {
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    expect(
        (
            await page.request.post(`/api/projects/${projectId}/channels`, {
                data: { name: 'Bluesky test', profile: 'bluesky' },
            })
        ).status()
    ).toBe(201)
    await page.route('**/publisher/bluesky/connect', route =>
        route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
                error: { code: 'provider_unavailable', message: 'Unavailable' },
            }),
        })
    )
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await expect(page.getByText(en.publisher_oauth_setup_required, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect Bluesky', exact: true })).toHaveCount(0)
    await page.route('**/publishers', async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({
            response,
            json: { ...body, oauthReadiness: { ...body.oauthReadiness, bluesky: 'ready' } },
        })
    })
    await page.reload()
    await page.getByRole('button', { name: 'Connect Bluesky', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const handle = dialog.getByLabel(en.provider_handle, { exact: true })
    await handle.fill('test.bsky.social')
    await dialog.getByRole('button', { name: en.provider_continue, exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(en.api_provider_unavailable)
    await expect(handle).toHaveValue('test.bsky.social')
    await expect(page.getByText(en.api_provider_unavailable, { exact: true })).toHaveCount(1)
    await handle.fill('other.bsky.social')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
})

test('keeps connection errors and retries in each form without losing entered details', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const providers = [
        {
            profile: 'mastodon',
            name: 'Mastodon',
            fields: [[en.provider_instance, 'https://mastodon.example']],
            submit: en.provider_continue_mastodon,
        },
        {
            profile: 'discord',
            name: 'Discord',
            fields: [
                [en.provider_discord_channel_id, '123456789012345678'],
                [en.provider_bot_token, 'fake-test-token-with-at-least-32-characters'],
            ],
            submit: en.provider_connect_discord,
        },
        {
            profile: 'devto',
            name: 'DEV.to',
            fields: [[en.provider_devto_api_key, 'fake-api-key']],
            submit: en.provider_connect_devto,
        },
        {
            profile: {
                id: 'connection-test-http',
                version: 1,
                origin: 'custom',
                contentSchema: {
                    $schema: 'https://json-schema.org/draft/2020-12/schema',
                    type: 'object',
                    properties: { body: { type: 'string', maxLength: 1000 } },
                    required: ['body'],
                    additionalProperties: false,
                },
                fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
                capabilities: {
                    revision: 'v1',
                    textFields: [
                        {
                            bindingId: 'body',
                            acceptedSourceFormats: ['plain_text'],
                            maxLength: 1000,
                        },
                    ],
                    mediaFields: [],
                    relations: [],
                },
                execution: {
                    kind: 'declarative_http',
                    contractId: 'custom-webhook',
                    revision: 'v1',
                    mode: 'postdot_webhook',
                },
            },
            name: 'HTTP',
            fields: [
                [en.provider_endpoint_url, 'https://publisher.example'],
                [en.provider_connection_secret, 'fake-test-secret-with-at-least-32-characters'],
            ],
            submit: en.provider_connect_endpoint,
        },
    ] as const
    for (const provider of providers) {
        const created = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: { name: provider.name, profile: provider.profile },
        })
        expect(created.status(), await created.text()).toBe(201)
    }
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    const requests: Record<string, number> = {}
    let release: (() => void) | undefined
    await page.route('**/publisher/*/connect', async route => {
        const path = route.request().url()
        requests[path] = (requests[path] ?? 0) + 1
        await new Promise<void>(resolve => {
            release = resolve
        })
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            json: {
                error: {
                    code: 'provider_unavailable',
                    message: 'The provider is temporarily unavailable.',
                },
            },
        })
    })
    for (const provider of providers) {
        const label = en.provider_connect_title.replace('{provider}', provider.name)
        await page.getByRole('button', { name: label, exact: true }).click()
        const dialog = page.getByRole('dialog')
        for (const [field, value] of provider.fields)
            await dialog.getByLabel(field, { exact: true }).fill(value)
        const sent = page.waitForRequest(
            request => request.url().includes('/publisher/') && request.url().endsWith('/connect')
        )
        await dialog
            .getByLabel(provider.fields[provider.fields.length - 1]![0], { exact: true })
            .press('Enter')
        const request = await sent
        await expect(
            dialog.getByRole('button', { name: provider.submit, exact: true })
        ).toBeDisabled()
        await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
        release!()
        await expect(dialog.getByRole('alert')).toContainText(
            'The provider is temporarily unavailable.'
        )
        expect(requests[request.url()]).toBe(1)
        for (const [field, value] of provider.fields)
            await expect(dialog.getByLabel(field, { exact: true })).toHaveValue(value)
        await expect(page.getByRole('alert')).toHaveCount(1)
        const first = dialog.getByLabel(provider.fields[0][0], { exact: true })
        await first.fill(provider.fields[0][1] + '1')
        await expect(dialog.getByRole('alert')).toHaveCount(0)
        await first.fill(provider.fields[0][1])
        const retry = page.waitForRequest(next => next.url() === request.url())
        await dialog.getByRole('button', { name: provider.submit, exact: true }).click()
        await retry
        release!()
        await expect(dialog.getByRole('alert')).toBeVisible()
        expect(requests[request.url()]).toBe(2)
        await page.setViewportSize({ width: 390, height: 844 })
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
            true
        )
        await page.screenshot({
            path: testInfo.outputPath(`connection-${provider.name}-narrow.png`),
        })
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await page.getByRole('button', { name: label, exact: true }).click()
        for (const [field] of provider.fields)
            await expect(page.getByRole('dialog').getByLabel(field, { exact: true })).toHaveValue(
                ''
            )
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await page.setViewportSize({ width: 1280, height: 720 })
    }
    const linkedin = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'LinkedIn', profile: 'linkedin' },
    })
    expect(linkedin.status()).toBe(201)
    await page.route(`**/api/projects/${projectId}/publishers`, async route => {
        const response = await route.fetch()
        const data = await response.json()
        data.oauthReadiness.linkedin = 'ready'
        await route.fulfill({ response, json: data })
    })
    await page.reload()
    await page.getByRole('button', { name: 'Connect LinkedIn', exact: true }).click()
    const linkedinDialog = page.getByRole('dialog')
    await expect(
        linkedinDialog.getByRole('combobox', { name: en.publisher_destination })
    ).toContainText(en.publisher_personal_account)
    await linkedinDialog.getByRole('combobox', { name: en.publisher_destination }).click()
    await page.getByRole('option', { name: en.publisher_company_page, exact: true }).click()
    await linkedinDialog.getByLabel(en.publisher_organization_id, { exact: true }).fill('123456')
    const sentLinkedIn = page.waitForRequest(request =>
        request.url().endsWith('/publisher/linkedin/connect')
    )
    await linkedinDialog.getByRole('button', { name: 'Continue to LinkedIn', exact: true }).click()
    const request = await sentLinkedIn
    expect(request.postDataJSON()).toMatchObject({
        destination: { type: 'organization', id: '123456' },
    })
    release!()
    await expect(linkedinDialog.getByRole('alert')).toBeVisible()
    await expect(
        linkedinDialog.getByLabel(en.publisher_organization_id, { exact: true })
    ).toHaveValue('123456')
    await page.screenshot({ path: testInfo.outputPath('connection-linkedin-wide.png') })
})

test('creates the first destination while preserving the first publication', async ({
    page,
}, info) => {
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    // An empty project's Overview leads to channel creation (SPEC-010 JRN-01); composition stays
    // reachable by writing first, from Queue or its address.
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/publications/new$`))
    await expect(page.locator('[data-new-publication-form]')).toHaveAttribute('aria-busy', 'false')
    const content = page.getByRole('textbox', {
        name: en.publication_new_source_content,
        exact: true,
    })
    const body = 'Our first publication stays here while its destination is created.'
    await content.fill(body)
    await expect(page.locator('[data-publication-schedule-disclosure]')).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: info.outputPath('first-publication-empty.png') })
    await page.getByRole('button', { name: en.channel_add, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(content).toHaveText(body)
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/publications/new$`))
    await page.getByRole('button', { name: en.channel_add, exact: true }).click()
    await dialog.getByRole('radio', { name: en.channel_manual_profile, exact: true }).click()
    await dialog
        .getByRole('textbox', { name: en.channel_name, exact: true })
        .fill('First destination')
    await dialog.getByRole('button', { name: en.builder_configure_channel, exact: true }).click()
    await dialog.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(content).toHaveText(body)
    await expect(page.locator('[data-channel-selected-button]')).toContainText('First destination')
    await expect(page.locator('[data-publication-schedule-disclosure]')).toBeVisible()
    await page.screenshot({ path: info.outputPath('first-publication-ready.png') })
    const submit = page.locator('button[name="publication-action"][value="schedule"]')
    const created = page.waitForResponse(
        response =>
            response.url().endsWith(`/api/projects/${projectId}/posts`) &&
            response.request().method() === 'POST'
    )
    await submit.click()
    expect((await created).status()).toBe(201)
    const result = await page.request.get(`/api/projects/${projectId}/publications`)
    const publications = (await result.json()).publications
    expect(publications).toHaveLength(1)
    expect(publications[0].deliveryMode).toBe('manual')
    await page.goto(`/dashboard/projects/${projectId}/queue`)
    await expect(page.locator('a[data-publication-edit-link]').first()).toBeVisible()
    await page.locator('a[data-publication-edit-link]').first().click()
    await expect(page.locator('#source-body')).toHaveText(body)
})

test('resumes composition from channel setup and after an OAuth callback reload', async ({
    page,
}, info) => {
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    expect(
        (
            await page.request.post(`/api/projects/${projectId}/channels`, {
                data: { name: 'Unused destination', profile: 'manual-message' },
            })
        ).status()
    ).toBe(201)
    const response = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Connection destination', profile: 'bluesky' },
    })
    expect(response.status()).toBe(201)
    const channelId = (await response.json()).channel.id
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await expect(
        page.getByRole('link', { name: en.nav_back_to_overview, exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('link', { name: en.publication_resume_composition, exact: true })
    ).toHaveCount(0)
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    await expect(page.locator('[data-new-publication-form]')).toHaveAttribute('aria-busy', 'false')
    const content = page.getByRole('textbox', {
        name: en.publication_new_source_content,
        exact: true,
    })
    await page.getByRole('button', { name: 'Remove Unused destination', exact: true }).click()
    await page.getByRole('button', { name: 'Add Connection destination', exact: true }).click()
    const body = 'Keep this text and destination through connection setup.'
    await content.fill(body)
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await page.getByRole('link', { name: en.publication_resume_composition, exact: true }).click()
    await expect(content).toHaveText(body)
    for (const result of ['authorization_denied', 'connected'] as const) {
        // A full navigation models the existing callback landing URL, not a provider exchange.
        await page.goto(
            `/dashboard/projects/${projectId}/channels?publisher=${result}&publisher_channel=${channelId}`
        )
        await expect(
            page.getByText(en[`publisher_callback_${result}_title`], { exact: true })
        ).toBeVisible()
        await page.setViewportSize({ width: 390, height: 844 })
        const resume = page.getByRole('link', {
            name: en.publication_resume_composition,
            exact: true,
        })
        await expect(resume).toBeVisible()
        await expect(
            page.getByRole('button', {
                name: en.publisher_callback_create_publication,
                exact: true,
            })
        ).toHaveCount(0)
        await page.screenshot({ path: info.outputPath(`resume-${result}.png`) })
        await resume.click()
        const recovery = page.getByRole('dialog', {
            name: en.publication_new_recovery_title,
            exact: true,
        })
        await expect(recovery).toContainText(body)
        await recovery
            .getByRole('button', { name: en.publication_new_recovery_restore, exact: true })
            .click()
        await expect(content).toHaveText(body)
        await expect(page.locator('[data-channel-selected-button]')).toHaveCount(1)
        await expect(page.locator('[data-channel-selected-button]')).toContainText(
            'Connection destination'
        )
    }
})
