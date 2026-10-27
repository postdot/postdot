import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test('makes a revoked publisher connection actionable', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E recovery channel ${suffix}`

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('radio', { name: 'DEV.to article', exact: true }).click()

    const channelResponse = page.waitForResponse(
        response =>
            response.url().endsWith(`/api/projects/${projectId}/channels`) &&
            response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    const channelResult = (await (await channelResponse).json()) as {
        channel: { id: string }
    }
    const channelId = channelResult.channel.id
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    const now = Date.now()
    const revokedConnection = {
        authentication: null,
        channelId,
        connectedByActorId: 'e2e-recovery-actor',
        createdAt: now - 60_000,
        credentialId: `e2e-recovery-credential-${suffix}`,
        destination: {
            id: 'e2e-devto-account',
            name: 'E2E DEV.to account',
            type: 'account',
        },
        endpointUrl: null,
        externalAccountId: 'e2e-devto-account',
        externalAccountName: 'E2E DEV.to account',
        id: `e2e-recovery-connection-${suffix}`,
        kind: 'devto',
        projectId,
        providerId: 'devto',
        publisherId: `e2e-recovery-publisher-${suffix}`,
        scopes: [],
        state: 'revoked',
        updatedAt: now,
    }

    await page.route(`**/api/projects/${projectId}/publishers`, async route => {
        if (route.request().method() !== 'GET') {
            await route.continue()
            return
        }

        const response = await route.fetch()
        await response.body()
        await route.fulfill({
            status: response.status(),
            contentType: 'application/json',
            body: JSON.stringify({ connections: [revokedConnection] }),
        })
    })

    await page.reload()
    const connection = page.locator(`#publisher-connection-${channelId}`)
    await expect(page.locator('#channels').getByText(channelName, { exact: true })).toHaveCount(1)
    await expect(connection).toContainText('Access revoked')
    await expect(connection).toContainText('Reconnect to resume automatic publishing.')
    const accessibility = await new AxeBuilder({ page }).analyze()
    expect(accessibility.violations).toEqual([])
    await connection.getByRole('button', { name: `Manage ${channelName}` }).click()
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await page.keyboard.press('Escape')

    await connection.getByRole('button', { name: 'Reconnect DEV.to', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
        dialog.getByRole('heading', { name: `Reconnect ${channelName}`, exact: true })
    ).toBeVisible()
    await expect(dialog.getByLabel('DEV.to API key', { exact: true })).toBeVisible()
    await expect(
        dialog.getByRole('button', { name: 'Reconnect DEV.to', exact: true })
    ).toBeVisible()
})

test('targets connection repair from automatic publication detail without changing content or execution', async ({
    page,
}, info) => {
    test.setTimeout(90_000)
    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Article destination', profile: 'devto' },
    })
    expect(channelResponse.ok()).toBe(true)
    const { channel } = await channelResponse.json()
    const postResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: {
                headline: 'Connection readiness article',
                body: { format: 'plain_text', text: 'A saved article to review.' },
                media: [],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(postResponse.ok()).toBe(true)
    const { publications } = await postResponse.json()
    const publicationId = publications[0].id
    const detailUrl = `/dashboard/projects/${projectId}/publications/${publicationId}`
    const editorUrl = `/api/projects/${projectId}/publications/${publicationId}/editor`
    const before = await (await page.request.get(editorUrl)).json()
    // Persisted manual data provides real content; browser-only fixtures model readiness.
    // No automatic job or external provider call is created by this review.
    let state: 'missing' | 'revoked' | 'reconnect_required' | 'active' = 'missing'
    let deliveryMode = 'automatic'
    let publicationState = 'draft'
    let viewer = false
    const mutations: string[] = []
    page.on('request', request => {
        if (request.url().includes(`/api/projects/${projectId}/`) && request.method() !== 'GET')
            mutations.push(request.url())
    })
    await page.route(`**${editorUrl}`, async route => {
        const response = await route.fetch()
        const data = await response.json()
        data.editor.publication.deliveryMode = deliveryMode
        data.editor.publication.state = publicationState
        data.editor.publication.errorMessage =
            publicationState === 'failed' ? 'The destination rejected the previous attempt.' : null
        await route.fulfill({ response, json: data })
    })
    await page.route(`**/api/projects/${projectId}/membership`, async route => {
        const response = await route.fetch()
        const data = await response.json()
        if (viewer) data.membership.role = 'viewer'
        await route.fulfill({ response, json: data })
    })
    await page.route(`**/api/projects/${projectId}/publishers`, async route => {
        const response = await route.fetch()
        const now = Date.now()
        const connection = {
            authentication: null,
            channelId: channel.id,
            connectedByActorId: 'readiness-fixture',
            createdAt: now,
            credentialId: 'readiness-credential',
            destination: { id: 'sample-account', name: 'Sample account', type: 'account' },
            endpointUrl: null,
            externalAccountId: 'sample-account',
            externalAccountName: 'Sample account',
            id: 'readiness-connection',
            kind: 'devto',
            projectId,
            providerId: 'devto',
            publisherId: 'readiness-publisher',
            scopes: [],
            state,
            updatedAt: now,
        }
        await route.fulfill({
            response,
            json: {
                ...(await response.json()),
                connections: state === 'missing' ? [] : [connection],
            },
        })
    })
    const lifecycle = page.locator('[data-publication-lifecycle]')
    const repair = page.locator('[data-publication-connection-repair]')
    for (const connectionState of ['missing', 'revoked', 'reconnect_required'] as const) {
        state = connectionState
        publicationState = connectionState === 'missing' ? 'draft' : 'failed'
        await page.goto(detailUrl)
        await page.reload()
        await expect(lifecycle.locator('[data-publication-connection-issue]')).toContainText(
            connectionState === 'missing'
                ? 'requires a connection'
                : connectionState === 'revoked'
                  ? 'Access revoked'
                  : 'requires reconnection'
        )
        await expect(repair).toHaveText(
            connectionState === 'missing' ? 'Connect channel' : 'Reconnect channel'
        )
        await expect(repair).toHaveAttribute(
            'href',
            `/dashboard/projects/${projectId}/channels#publisher-connection-${channel.id}`
        )
        for (const theme of ['dark', 'light'] as const) {
            if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
                await page
                    .getByRole('button', { name: `Switch to ${theme} theme`, exact: true })
                    .click()
            }
            for (const width of [1280, 820, 390]) {
                await page.setViewportSize({ width, height: 900 })
                await lifecycle.scrollIntoViewIfNeeded()
                expect(
                    await page.evaluate(
                        () => document.documentElement.scrollWidth <= window.innerWidth + 1
                    )
                ).toBe(true)
                expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                await page.screenshot({
                    path: info.outputPath(`connection-${connectionState}-${theme}-${width}.png`),
                    fullPage: true,
                })
            }
        }
        await repair.click()
        await expect(page).toHaveURL(new RegExp(`channels#publisher-connection-${channel.id}$`))
        const row = page.locator(`#publisher-connection-${channel.id}`)
        await expect(row).toBeInViewport()
        await row
            .getByRole('button', {
                name: connectionState === 'missing' ? 'Connect DEV.to' : 'Reconnect DEV.to',
                exact: true,
            })
            .click()
        await expect(
            page.getByRole('dialog').getByLabel('DEV.to API key', { exact: true })
        ).toBeVisible()
        await page.keyboard.press('Escape')
    }
    state = 'active'
    await page.goto(detailUrl)
    await page.reload()
    await expect(repair).toHaveCount(0)
    state = 'revoked'
    deliveryMode = 'manual'
    await page.reload()
    await expect(repair).toHaveCount(0)
    deliveryMode = 'automatic'
    publicationState = 'published'
    await page.reload()
    await expect(repair).toHaveCount(0)
    publicationState = 'failed'
    viewer = true
    await page.reload()
    await expect(repair).toHaveText('Channels')
    await repair.click()
    await expect(page.locator(`#publisher-connection-${channel.id}`)).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Reconnect DEV.to', exact: true })).toHaveCount(0)
    expect(mutations).toEqual([])
    const after = await (await page.request.get(editorUrl)).json()
    expect(after.editor.post.sourceContent).toEqual(before.editor.post.sourceContent)
    expect(after.editor.draft).toEqual(before.editor.draft)
    expect(after.editor.publication).toEqual(before.editor.publication)
    expect(after.editor.selectedTarget).toEqual(before.editor.selectedTarget)
})

test('uses active execution for custom channel readiness and connection actions', async ({
    page,
}, info) => {
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const path = `/api/projects/${projectId}/channels`
    const ids: Record<string, string> = {}
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    const creation = page.getByRole('dialog')
    await creation.getByRole('radio', { name: 'Custom runtime profile', exact: true }).click()
    await creation.getByLabel('Channel name').fill('custom-manual')
    await creation.getByRole('button', { name: 'Configure content', exact: true }).click()
    const created = page.waitForResponse(
        response => response.url().endsWith(path) && response.request().method() === 'POST'
    )
    await creation.getByRole('button', { name: 'Create channel', exact: true }).click()
    const manualResponse = await created
    expect(manualResponse.status()).toBe(201)
    ids['custom-manual'] = (await manualResponse.json()).channel.id
    await expect(creation).toHaveCount(0)
    await expect(
        page
            .locator(`#publisher-connection-${ids['custom-manual']}`)
            .getByText('Manual', { exact: true })
    ).toBeVisible()
    const manualDefinition = await page.request.get(`${path}/${ids['custom-manual']}/profile`)
    expect(manualDefinition.status()).toBe(200)
    const manualProfile = (await manualDefinition.json()).active.profile
    expect(manualProfile.execution).toEqual({ kind: 'manual' })
    const webhookProfile = {
        ...manualProfile,
        id: 'custom-webhook',
        execution: {
            kind: 'declarative_http',
            contractId: 'custom-webhook',
            revision: 'v1',
            mode: 'postdot_webhook',
        },
    }
    const webhookResponse = await page.request.post(path, {
        data: { name: 'custom-webhook', profile: webhookProfile },
    })
    expect(webhookResponse.status()).toBe(201)
    ids['custom-webhook'] = (await webhookResponse.json()).channel.id
    // The identity is deliberately unrelated to the provider contract.
    for (const [name, contractId] of [
        ['custom-native', 'devto'],
        ['custom-future', 'future-provider'],
    ]) {
        const result = await page.request.post(path, {
            data: {
                name,
                profile: {
                    ...manualProfile,
                    id: name,
                    execution: { kind: 'built_in', contractId, revision: 'v1' },
                },
            },
        })
        expect(result.status()).toBe(201)
        ids[name!] = (await result.json()).channel.id
    }
    const listed = await page.request.get(path)
    expect(listed.status()).toBe(200)
    const channels = (await listed.json()).channels
    expect(
        channels.find((channel: { id: string }) => channel.id === ids['custom-manual']).execution
    ).toEqual({ kind: 'manual' })
    expect(
        channels.find((channel: { id: string }) => channel.id === ids['custom-webhook']).execution
    ).toEqual({ kind: 'declarative_http' })
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    const manual = page.locator(`#publisher-connection-${ids['custom-manual']}`)
    const webhook = page.locator(`#publisher-connection-${ids['custom-webhook']}`)
    const native = page.locator(`#publisher-connection-${ids['custom-native']}`)
    const future = page.locator(`#publisher-connection-${ids['custom-future']}`)
    await expect(manual.getByText('Manual', { exact: true })).toBeVisible()
    await expect(manual.getByRole('button', { name: /Connect|Reconnect/ })).toHaveCount(0)
    await expect(manual).not.toContainText('Needs connection')
    await expect(manual).not.toContainText('declarative HTTP')
    await expect(webhook.getByRole('button', { name: 'Connect HTTP', exact: true })).toBeVisible()
    await expect(native.getByRole('button', { name: 'Connect DEV.to', exact: true })).toBeVisible()
    await expect(native.getByRole('button', { name: 'Connect HTTP', exact: true })).toHaveCount(0)
    await expect(future).toContainText('No connection setup is available')
    await expect(future.getByRole('button', { name: /Connect|Reconnect/ })).toHaveCount(0)
    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        )
        await manual.screenshot({ path: info.outputPath(`custom-manual-${width}.png`) })
    }
    await webhook.getByRole('button', { name: 'Connect HTTP', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await native.getByRole('button', { name: 'Connect DEV.to', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    // Rename and archive mutation responses do not contain execution metadata.
    // Their local cache updates must retain the list's active-version summary.
    await manual.getByRole('button', { name: 'Manage custom-manual', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const rename = page.getByRole('dialog', { name: 'Rename channel', exact: true })
    await rename.getByRole('textbox').fill('Renamed manual')
    await rename.getByRole('button', { name: 'Rename channel', exact: true }).click()
    await expect(manual).toContainText('Renamed manual')
    await expect(manual.getByText('Manual', { exact: true })).toBeVisible()
    await manual.getByRole('button', { name: 'Manage Renamed manual', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
    await page
        .getByRole('dialog', { name: 'Archive channel', exact: true })
        .getByRole('button', { name: 'Archive channel', exact: true })
        .click()
    await expect(manual.getByText('Archived', { exact: true })).toBeVisible()
    await expect(manual.getByRole('button', { name: /Connect|Reconnect/ })).toHaveCount(0)
    await manual.getByRole('button', { name: 'Manage Renamed manual', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Restore', exact: true }).click()
    await page
        .getByRole('dialog', { name: 'Restore channel', exact: true })
        .getByRole('button', { name: 'Restore channel', exact: true })
        .click()
    await expect(manual.getByText('Manual', { exact: true })).toBeVisible()

    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    const content = page.getByRole('textbox', {
        name: en.publication_new_source_content,
        exact: true,
    })
    await content.fill('Preserve this composition while checking delivery choices.')
    await page
        .locator(`[data-channel-selected-button][data-channel-id="${ids['custom-manual']}"]`)
        .click()
    const settings = page.locator('[data-composer-settings] details').first()
    if (!(await settings.evaluate(element => (element as HTMLDetailsElement).open))) {
        await settings.locator('summary').first().click()
    }
    await expect(
        settings.getByText(en.publication_new_automatic_connection_required, { exact: true })
    ).toHaveCount(0)
    const defaults = page.locator('#publication-default-delivery')
    await defaults.click()
    await expect(
        page.getByRole('option', { name: en.publication_new_manual_publication, exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('option', { name: en.publication_new_automatic_publication, exact: true })
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    const destinationSettings = page.locator('[data-publication-active-channel-settings]')
    if (!(await destinationSettings.evaluate(element => (element as HTMLDetailsElement).open))) {
        await destinationSettings.locator('summary').click()
    }
    await expect(destinationSettings.getByText(en.channel_manual, { exact: true })).toBeVisible()
    await destinationSettings
        .getByRole('button', { name: en.publication_new_customize_delivery, exact: true })
        .click()
    const delivery = destinationSettings.locator('[id^="publication-target-"][id$="-delivery"]')
    await delivery.click()
    await expect(
        page.getByRole('option', { name: en.publication_new_manual_publication, exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('option', { name: en.publication_new_automatic_publication, exact: true })
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page
        .locator(`[data-channel-available][data-channel-id="${ids['custom-webhook']}"]`)
        .click()
    await page
        .locator(`[data-channel-selected-button][data-channel-id="${ids['custom-webhook']}"]`)
        .click()
    await expect(
        settings.getByText(en.publication_new_automatic_connection_required, { exact: true })
    ).toBeVisible()
    await destinationSettings
        .getByRole('button', { name: en.publication_new_customize_delivery, exact: true })
        .click()
    await delivery.click()
    await expect(
        page.getByRole('option', { name: en.publication_new_automatic_publication, exact: true })
    ).toBeVisible()
    await page
        .getByRole('option', { name: en.publication_new_automatic_publication, exact: true })
        .click()
    // Mixed defaults cannot make the manual destination automatic.
    await defaults.click()
    await expect(
        page.getByRole('option', { name: en.publication_new_automatic_publication, exact: true })
    ).toHaveCount(0)
    await page
        .getByRole('option', { name: en.publication_new_manual_publication, exact: true })
        .click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await page.getByRole('button', { name: 'Common', exact: true }).click()
    await expect(content).toHaveText('Preserve this composition while checking delivery choices.')
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E recovery ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-recovery-${suffix}@postdot.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-recovery-password')
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
        .fill(`E2E recovery project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
