import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

test('offers provider profiles as custom channel starters with read-only provider rules', async ({
    page,
}) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const channelName = `E2E-142 preset channel ${suffix}`
    await createAccountAndProject(page, suffix)
    const projectId = new URL(page.url()).pathname.split('/')[3]!

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Channel name').fill(channelName)

    await page.getByRole('radio', { name: 'Custom runtime profile', exact: true }).click()
    await page.getByRole('button', { name: 'Configure content', exact: true }).click()

    const starter = page.getByRole('combobox', { name: 'Starter template', exact: true })
    await starter.click()
    await expect(page.getByRole('option', { name: 'Bluesky post', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'Bluesky post', exact: true }).click()

    await expect(
        page.getByText('A copy of the provider profile. Edit it to fit this custom channel.', {
            exact: true,
        })
    ).toBeVisible()
    // A provider copy keeps the provider's own limits: the starter is not editable.
    const body = bodyGroup(page)
    await expect(bodyMaximum(page)).toBeDisabled()
    await expect(body).toContainText(
        'These limits belong to the publishing integration and cannot be changed here.'
    )

    const created = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            response.url().endsWith(`/api/projects/${projectId}/channels`)
    )
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    expect((await created).status()).toBe(201)
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    const state = await channelProfileState(page, projectId, channelName)
    const profile = state.active.profile
    expect(profile.id).toBe('custom-bluesky')
    expect(profile.origin).toBe('custom')
    expect(profile.execution).toMatchObject({ kind: 'built_in', contractId: 'bluesky' })
    expect(profile.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(profile.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)
})

test('makes profile impact inspectable without activating or rewriting publications', async ({
    page,
}, info) => {
    test.setTimeout(60_000)
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click()
    const projectId = new URL(page.url()).pathname.split('/')[3]!
    const channelName = `Impact channel ${suffix}`
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: channelName },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    const profileUrl = `/api/projects/${projectId}/channels/${channel.id}/profile`
    const originalProfile = (await (await page.request.get(profileUrl)).json()).active
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: `Manage ${channelName}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(bodyMaximum(dialog)).toHaveValue('1000000')
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    const impact = dialog.locator('[data-profile-impact]')
    await expect(impact).toContainText(
        'No editable drafts or pending publications use this channel.'
    )
    await expect(
        dialog.getByRole('button', { name: 'Review activation', exact: true })
    ).toBeEnabled()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()

    const publications = []
    for (const [title, body] of [
        ['Short publication', 'OK'],
        ['Long publication', 'This publication has a longer body.'],
    ]) {
        const response = await page.request.post(`/api/projects/${projectId}/posts`, {
            data: {
                title,
                sourceContent: { body: { text: body, format: 'plain_text' }, media: [] },
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'manual',
                        scheduledAt: Date.now() + 86_400_000,
                        targetContent: { body, media: [] },
                    },
                ],
            },
        })
        expect(response.status(), await response.text()).toBe(201)
        publications.push((await response.json()).publications[0])
    }
    const baseline = await Promise.all(
        publications.map(
            async publication =>
                (
                    await (
                        await page.request.get(
                            `/api/projects/${projectId}/publications/${publication.id}/editor`
                        )
                    ).json()
                ).editor
        )
    )
    const namesRoute = `**/api/projects/${projectId}/publications?*`
    await page.route(namesRoute, async route => {
        if (new URL(route.request().url()).searchParams.get('limit') === '100') {
            await route.fulfill({
                status: 503,
                json: { error: { code: 'test_unavailable', message: 'Names unavailable' } },
            })
        } else await route.continue()
    })
    await page.reload()
    await page.getByRole('button', { name: `Manage ${channelName}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    await expect(bodyMaximum(dialog)).toHaveValue('1000000')
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    await expect(impact).toContainText('Publication names could not be loaded.')
    await expect(impact.locator('[data-profile-impact-publication]')).toHaveCount(2)
    await expect(
        impact.getByRole('link', { name: 'Inspect publication', exact: true })
    ).toHaveCount(2)
    await page.unroute(namesRoute)
    await impact.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(impact.getByText('Short publication', { exact: true })).toBeVisible()
    await expect(impact.locator('[data-profile-impact-publication]')).toHaveCount(2)
    await expect(impact).not.toContainText('Needs review')
    await expect(
        dialog.getByRole('button', { name: 'Review activation', exact: true })
    ).toBeEnabled()

    await bodyMaximum(dialog).fill('12')
    await expect(impact).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeDisabled()
    await expect(
        dialog.getByRole('button', { name: 'Review activation', exact: true })
    ).toBeDisabled()
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    const longRow = impact.locator(`[data-profile-impact-publication="${publications[1].id}"]`)
    await expect(longRow).toContainText('Long publication')
    await expect(longRow).toContainText('Working draft')
    await expect(longRow).toContainText('Selected target awaiting delivery')
    await expect(longRow.getByText('Needs review', { exact: true })).toHaveCount(2)
    await expect(longRow).toContainText('/body')
    await expect(impact.locator('[data-profile-impact-publication]').first()).toHaveAttribute(
        'data-profile-impact-publication',
        publications[1].id
    )
    await expect(
        dialog.getByRole('button', { name: 'Review activation', exact: true })
    ).toBeEnabled()
    await expect(
        longRow.getByRole('link', { name: 'Inspect publication', exact: true })
    ).toHaveAttribute('href', `/dashboard/projects/${projectId}/publications/${publications[1].id}`)

    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(longRow.getByRole('link')).toBeVisible()
        const dimensions = await dialog.evaluate(element => ({
            client: element.clientWidth,
            scroll: element.scrollWidth,
        }))
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
        await page.screenshot({ path: info.outputPath(`profile-impact-${width}.png`) })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click()
    await page.getByRole('button', { name: `Manage ${channelName}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    await expect(bodyMaximum(dialog)).toHaveValue('12')
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    await expect(longRow).toContainText('Long publication')
    await page.screenshot({ path: info.outputPath('profile-impact-dark.png') })
    expect((await (await page.request.get(profileUrl)).json()).active).toEqual(originalProfile)
    for (const [index, publication] of publications.entries()) {
        expect(
            (
                await (
                    await page.request.get(
                        `/api/projects/${projectId}/publications/${publication.id}/editor`
                    )
                ).json()
            ).editor
        ).toEqual(baseline[index])
    }
    await longRow.getByRole('link', { name: 'Inspect publication', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/publications/${publications[1].id}$`))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('#source-body')).toContainText('This publication has a longer body.')
})

test('confirms profile activation, preserves affected work, and exposes explicit adaptation', async ({
    page,
}, info) => {
    test.setTimeout(60_000)
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    const projectId = new URL(page.url()).pathname.split('/')[3]!
    const channelName = `Activation channel ${suffix}`
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: channelName },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    const channelUrl = `/api/projects/${projectId}/channels/${channel.id}`
    const original = (await (await page.request.get(`${channelUrl}/profile`)).json()).active
    async function createPublication(title: string, body: string) {
        const response = await page.request.post(`/api/projects/${projectId}/posts`, {
            data: {
                title,
                sourceContent: { body: { text: body, format: 'plain_text' }, media: [] },
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'manual',
                        scheduledAt: Date.now() + 1000,
                        targetContent: { body, media: [] },
                    },
                ],
            },
        })
        expect(response.status(), await response.text()).toBe(201)
        return (await response.json()).publications[0]
    }
    async function readEditor(id: string) {
        return (
            await (
                await page.request.get(`/api/projects/${projectId}/publications/${id}/editor`)
            ).json()
        ).editor
    }
    const short = await createPublication('Compatible publication', 'OK')
    const long = await createPublication(
        'Publication needing adaptation',
        'Keep this previous destination text intact.'
    )
    const before = await readEditor(long.id)
    await expect
        .poll(async () =>
            (
                await (await page.request.get(`/api/projects/${projectId}/publications/due`)).json()
            ).publications.map((p: { id: string }) => p.id)
        )
        .toContain(long.id)
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: `Manage ${channelName}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(bodyMaximum(dialog)).toHaveValue('1000000')
    await bodyMaximum(dialog).fill('12')
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    await expect(dialog.locator(`[data-profile-impact-publication="${long.id}"]`)).toContainText(
        'Needs review'
    )
    await dialog.getByRole('button', { name: 'Review activation', exact: true }).click()
    await expect(
        dialog.getByRole('heading', { name: `Activate ${channelName} profile?`, exact: true })
    ).toBeFocused()
    await expect(dialog).toContainText('nothing is adapted automatically')
    await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Back to profile', exact: true }).click()
    expect((await (await page.request.get(`${channelUrl}/profile`)).json()).active).toEqual(
        original
    )
    expect(await readEditor(long.id)).toEqual(before)

    await dialog.getByRole('button', { name: 'Review activation', exact: true }).click()
    await expect(
        dialog.getByRole('button', { name: 'Confirm activation', exact: true })
    ).toBeEnabled()
    const saved = (await (await page.request.get(`${channelUrl}/profile`)).json()).draft
    const replacement = structuredClone(saved.profile)
    replacement.profileHash = `sha256:replacement-profile-${suffix}`
    replacement.schemaHash = `sha256:replacement-schema-${suffix}`
    replacement.contentSchema.properties.body.maxLength = 10
    replacement.capabilities.textFields.find(
        (field: { bindingId: string }) => field.bindingId === 'body'
    ).maxLength = 10
    const changed = await page.request.post(`${channelUrl}/profile-drafts`, {
        data: { profile: replacement, expectedRevision: saved.revision },
    })
    expect(changed.status()).toBe(200)
    const refused = page.waitForResponse(
        response => response.url().endsWith('/activate') && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Confirm activation', exact: true }).click()
    expect((await refused).ok()).toBe(false)
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(
        dialog.getByRole('button', { name: 'Review activation', exact: true })
    ).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeDisabled()
    expect((await (await page.request.get(`${channelUrl}/profile`)).json()).active).toEqual(
        original
    )
    await dialog.getByRole('button', { name: 'Reload saved profile', exact: true }).click()
    await expect(bodyMaximum(dialog)).toHaveValue('10')
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    await expect(
        dialog.getByRole('button', { name: 'Review activation', exact: true })
    ).toBeEnabled()
    const late = await createPublication(
        'Created after preview',
        'Also needs review under the smaller limit.'
    )
    await dialog.getByRole('button', { name: 'Review activation', exact: true }).click()
    await expect(dialog.locator(`[data-profile-impact-publication="${late.id}"]`)).toBeVisible()
    await page.setViewportSize({ width: 390, height: 900 })
    await page.screenshot({ path: info.outputPath('activation-confirm-mobile.png') })
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const finalLate = await createPublication(
        'Created during confirmation',
        'The server evaluates current work at activation.'
    )
    const activated = page.waitForResponse(
        response => response.url().endsWith('/activate') && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Confirm activation', exact: true }).click()
    const activationResponse = await activated
    expect(activationResponse.status()).toBe(200)
    const result = await activationResponse.json()
    await expect(
        dialog.getByRole('heading', { name: `${channelName} profile activated`, exact: true })
    ).toBeFocused()
    await expect(
        dialog.locator(`[data-profile-impact-publication="${finalLate.id}"]`)
    ).toContainText('Needs review')
    await expect(
        dialog.getByRole('button', { name: 'Confirm activation', exact: true })
    ).toHaveCount(0)
    await expect(
        dialog.getByRole('button', { name: 'Review activation', exact: true })
    ).toHaveCount(0)
    const after = await readEditor(long.id)
    expect(after.post).toEqual(before.post)
    expect(after.selectedTarget).toEqual(before.selectedTarget)
    expect(after.draft.content).toEqual(before.draft.content)
    expect(after.draft.profileVersionId).toBe(before.draft.profileVersionId)
    expect(after.draft.reviewState).toBe('review_required')
    expect(after.publication.reviewState).toBe('review_required')
    expect(after.publication.scheduledAt).toBe(before.publication.scheduledAt)
    expect(after.publication.state).toBe(before.publication.state)
    expect((await (await page.request.get(`${channelUrl}/profile`)).json()).active.id).toBe(
        result.profile.id
    )
    const due = (
        await (await page.request.get(`/api/projects/${projectId}/publications/due`)).json()
    ).publications.map((p: { id: string }) => p.id)
    expect(due).toContain(short.id)
    expect(due).not.toContain(long.id)
    expect(due).not.toContain(late.id)
    expect(due).not.toContain(finalLate.id)
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect
        .poll(() => dialog.evaluate(element => element.getBoundingClientRect().width))
        .toBeGreaterThan(600)
    await page.screenshot({ path: info.outputPath('activation-result-desktop.png') })
    await dialog
        .locator(`[data-profile-impact-publication="${long.id}"]`)
        .getByRole('link', { name: 'Inspect publication', exact: true })
        .click()
    await expect(page).toHaveURL(new RegExp(`/publications/${long.id}$`))
    await page.getByRole('button', { name: 'Adapt to current profile', exact: true }).click()
    const adaptation = page.getByRole('region', { name: 'Adapt to current profile', exact: true })
    await adaptation.getByRole('button', { name: 'Reuse previous Body', exact: true }).click()
    await adaptation.getByRole('button', { name: 'Reuse previous Media', exact: true }).click()
    await adaptation.locator('[data-target-field="body"] textarea').fill('Fixed')
    await adaptation.getByRole('button', { name: 'Validate adaptation', exact: true }).click()
    await expect(
        adaptation.getByRole('button', { name: 'Save adapted draft', exact: true })
    ).toBeEnabled()
    await adaptation.getByRole('button', { name: 'Save adapted draft', exact: true }).click()
    await expect(adaptation).toHaveCount(0)
    const repaired = await readEditor(long.id)
    expect(repaired.draft.profileVersionId).toBe(result.profile.id)
    expect(repaired.draft.content.body).toBe('Fixed')
    expect(repaired.selectedTarget).toEqual(before.selectedTarget)
    expect(repaired.post).toEqual(before.post)
    expect(repaired.publication.reviewState).toBe('review_required')
    expect(
        (
            await (await page.request.get(`/api/projects/${projectId}/publications/due`)).json()
        ).publications.map((p: { id: string }) => p.id)
    ).not.toContain(long.id)
})

test('edits profile constraints repeatedly while Postbot owns technical metadata', async ({
    page,
}, info) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)
    const projectId = new URL(page.url()).pathname.split('/')[3]!
    const response = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: `Fingerprints ${suffix}` },
    })
    expect(response.status()).toBe(201)
    const { channel } = await response.json()
    const url = `/api/projects/${projectId}/channels/${channel.id}`
    const original = (await (await page.request.get(`${url}/profile`)).json()).active
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: `Manage Fingerprints ${suffix}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const metadata = dialog.locator('[data-profile-metadata]')
    await metadata.getByText('Profile metadata', { exact: true }).click()
    await expect(metadata).toContainText(original.profile.id)
    await expect(metadata).toContainText(original.profile.origin)
    await expect(metadata.getByText('version', { exact: true })).toBeVisible()
    // Identity and fingerprints are shown, never authored by the operator.
    await expect(metadata.getByRole('textbox')).toHaveCount(0)
    await expect(bodyMaximum(dialog)).toHaveValue('1000000')
    let saved = original
    for (const maxLength of [900, 800]) {
        await bodyMaximum(dialog).fill(String(maxLength))
        const done = page.waitForResponse(
            r => r.url().endsWith('/profile-drafts') && r.request().method() === 'POST'
        )
        await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
        const result = await done
        expect(result.status()).toBe(200)
        const next = (await result.json()).profile
        expect(next.version).toBe(original.version + 1)
        expect(next.profile.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(next.profile.schemaHash).not.toBe(saved.profile.schemaHash)
        expect(next.profile.profileHash).not.toBe(saved.profile.profileHash)
        saved = next
        await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled()
    }
    await expect(metadata).toContainText(saved.profile.schemaHash)
    await expect(metadata).toContainText(saved.profile.profileHash)
    const identity = await page.request.post(`${url}/profile-drafts`, {
        data: {
            profile: { ...saved.profile, id: 'unwanted-identity' },
            expectedRevision: saved.revision,
        },
    })
    expect(identity.status()).toBe(400)
    expect((await identity.json()).error.code).toBe('invalid_input')
    expect((await (await page.request.get(`${url}/profile`)).json()).draft).toEqual(saved)
    const done = page.waitForResponse(
        r => r.url().endsWith('/profile-drafts') && r.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    const result = await done
    expect(result.status()).toBe(200)
    const unchanged = (await result.json()).profile
    expect(unchanged.profile).toEqual(saved.profile)
    expect(unchanged.revision).toBe(saved.revision + 1)
    expect((await (await page.request.get(`${url}/profile`)).json()).active).toEqual(original)
    await page.setViewportSize({ width: 390, height: 900 })
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('profile-metadata-mobile.png') })
})

/** The structured form exposes the body rules as a named group. */
function bodyGroup(scope: Page | Locator): Locator {
    return scope.getByRole('group', { name: 'Body', exact: true })
}

function bodyMaximum(scope: Page | Locator): Locator {
    return bodyGroup(scope).getByLabel('Maximum characters', { exact: true })
}

async function channelProfileState(page: Page, projectId: string, channelName: string) {
    const channels = (
        (await (await page.request.get(`/api/projects/${projectId}/channels`)).json()) as {
            channels: { id: string; name: string }[]
        }
    ).channels
    const channel = channels.find(item => item.name === channelName)
    if (channel === undefined) throw new Error(`Channel not found: ${channelName}`)
    return (await (
        await page.request.get(`/api/projects/${projectId}/channels/${channel.id}/profile`)
    ).json()) as { active: { profile: Record<string, unknown> } }
}

async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postbot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-142 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-142-${suffix}@postbot.local`)
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
