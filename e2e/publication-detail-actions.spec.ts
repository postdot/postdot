import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps publication detail actions aligned with the scheduled lifecycle', async ({
    page,
}, testInfo) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E detail destination ${suffix}`

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await expect(page.locator('[data-new-publication-form="true"]')).toHaveAttribute(
        'aria-busy',
        'false'
    )
    await page.getByLabel('Content', { exact: true }).fill('E2E detail lifecycle content')
    const scheduleButton = page.locator('button[name="publication-action"][value="schedule"]')
    await Promise.all([
        page.waitForResponse(
            response =>
                response.url().endsWith(`/api/projects/${projectId}/posts`) &&
                response.request().method() === 'POST' &&
                response.ok()
        ),
        scheduleButton.click(),
    ])
    await expect(scheduleButton).toBeEnabled()

    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    const publicationLink = page.locator('a[data-publication-edit-link="true"]').first()
    await expect(publicationLink).toBeVisible()
    await publicationLink.click()

    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/publications/[^/]+$`))
    await expect(page.getByRole('link', { name: 'Queue', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).not.toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(page.locator('[data-publication-action="cancel"]')).toBeVisible()
    const delivery = page.locator('[data-publication-delivery-disclosure="true"]')
    await expect(delivery).not.toHaveAttribute('open', '')
    await expect(page.locator('#deliver-at')).not.toBeVisible()
    await expect(
        page.getByRole('button', { name: 'Update scheduled publication', exact: true })
    ).toBeVisible()
    await expect(
        page.locator('[data-composer-settings]').locator('[data-publication-delivery-disclosure]')
    ).toBeVisible()
    await expect(
        page
            .locator('[data-composer-actions]')
            .getByRole('button', { name: 'Update scheduled publication', exact: true })
    ).toBeVisible()
    await expect(
        page.locator('[data-composer-editor]').locator('[data-publication-delivery-disclosure]')
    ).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toHaveCount(0)
    await expect(page.locator('#source-body')).toBeVisible()
    await expect(page.locator('#source-body')).toHaveAccessibleName('Body')
    const customization = page.locator('[data-publication-customization]')
    await expect(customization.locator(':scope > summary')).not.toContainText('Compatible')
    await customization.locator(':scope > summary').focus()
    await page.keyboard.press('Enter')
    await expect(customization.locator('[data-target-editor]')).toBeVisible()
    const advancedSummary = customization.locator('[data-target-advanced] > summary')
    await advancedSummary.focus()
    await page.keyboard.press('Enter')
    await expect(customization.locator('#target-json')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(customization.locator('#target-json')).not.toBeVisible()
    await customization.locator(':scope > summary').focus()
    await page.keyboard.press('Enter')
    await expect(customization.locator('[data-target-editor]')).not.toBeVisible()

    await delivery.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#deliver-at')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('#deliver-at')).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark published', exact: true })).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('link', { name: 'Back to queue' })).toBeVisible()
    const detailWidth = await page.locator('[data-dashboard-scroll]').evaluate(region => ({
        client: region.clientWidth,
        scroll: region.scrollWidth,
    }))
    expect(detailWidth.scroll).toBeLessThanOrEqual(detailWidth.client)
    await page.setViewportSize({ width: 1280, height: 720 })

    await page.locator('[data-publication-action="cancel"]').click()
    await expect(
        page.getByRole('heading', { name: 'Cancel publication?', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('button', { name: 'Cancel publication', exact: true })
    ).toBeVisible()
    await expect(page.locator('[data-publication-cancel-confirm="true"]')).toBeVisible()

    await page.locator('[data-publication-cancel-confirm="true"]').click()
    await expect(page.getByText('Publication cancelled.', { exact: true })).toBeVisible()
    await expect(page.locator('[data-publication-action="cancel"]')).toHaveCount(0)
    await expect(page.locator('[data-publication-lifecycle="true"]')).toContainText('Cancelled')
    await expect(page.locator('#source-body')).toHaveCount(0)
    await expect(page.locator('[data-publication-draft-preview="true"]')).toBeVisible()

    const publicationId = page.url().split('/').pop()
    expect(publicationId).toBeTruthy()
    let lifecycleState: 'due' | 'failed' = 'due'
    let sourceConflict = false
    let olderRecovery = false
    const baselineResponse = await page.request.get(
        `/api/projects/${projectId}/publications/${publicationId}/editor`
    )
    expect(baselineResponse.status()).toBe(200)
    const baselineEditor = await baselineResponse.json()
    await page.route(
        `**/api/projects/${projectId}/publications/${publicationId}/editor`,
        async route => {
            const payload = structuredClone(baselineEditor) as {
                editor: {
                    publication: Record<string, unknown>
                    draft: { sourceRevision: number; revision: number }
                    post: { sourceRevision: number }
                }
            }
            payload.editor.publication = {
                ...payload.editor.publication,
                deliveryMode: lifecycleState === 'due' ? 'manual' : 'automatic',
                errorMessage:
                    lifecycleState === 'failed'
                        ? 'The destination rejected the publication. Review the account connection.'
                        : null,
                scheduledAt: Date.now() - 60_000,
                state: lifecycleState === 'due' ? 'scheduled' : 'failed',
            }
            if (olderRecovery) payload.editor.draft.revision = 2
            if (sourceConflict) {
                payload.editor.post.sourceRevision = payload.editor.draft.sourceRevision + 1
            }
            await route.fulfill({ status: 200, json: payload })
        }
    )

    await page.reload()
    await expect(page.locator('[data-publication-action="record-published"]')).toBeVisible()
    const editorNotice = page.locator('[data-publication-editor-message]')
    await expect(editorNotice).toHaveAttribute('role', 'status')
    await expect(editorNotice).toContainText('The publication changed in the background.')
    await expect(editorNotice).not.toContainText('Editor status')
    await expect(page.locator('[data-publication-lifecycle="true"]')).toContainText(
        'To publish manually'
    )

    await page.screenshot({
        path: testInfo.outputPath('manual-detail-desktop.png'),
        fullPage: true,
    })
    lifecycleState = 'failed'
    await page.reload()
    await expect(page.locator('[data-publication-action="retry"]')).toBeVisible()
    await expect(page.locator('[data-publication-error="true"]')).toContainText(
        'The destination rejected the publication.'
    )
    await page.screenshot({
        path: testInfo.outputPath('failed-detail-desktop.png'),
        fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    const failedDetailWidth = await page.locator('[data-dashboard-scroll]').evaluate(region => ({
        client: region.clientWidth,
        scroll: region.scrollWidth,
    }))
    expect(failedDetailWidth.scroll).toBeLessThanOrEqual(failedDetailWidth.client)
    await page.screenshot({ path: testInfo.outputPath('failed-detail-mobile.png'), fullPage: true })
    sourceConflict = true
    await page.reload()
    const conflict = page.locator('[data-publication-conflict]')
    await expect(editorNotice).toHaveAttribute('role', 'alert')
    await expect(editorNotice).not.toHaveAttribute('data-passive-update', 'true')
    expect(
        await editorNotice.evaluate(notice => {
            const composer = document.querySelector('[data-publication-composer="true"]')
            return (
                composer !== null &&
                Boolean(notice.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING)
            )
        })
    ).toBe(true)
    await expect(editorNotice).toContainText('Rebase it before saving or promoting.')
    await expect(editorNotice).not.toContainText('The latest server state is shown.')
    await editorNotice.getByRole('button').click()
    await expect(
        page.locator('details').filter({ has: conflict }).locator(':scope > summary')
    ).toBeFocused()
    await expect(conflict).toBeVisible()
    await expect(conflict).toHaveAttribute('role', 'alert')
    await expect(conflict.locator('button')).toHaveCount(2)
    expect(
        await conflict.evaluate(element => element === element.parentElement?.firstElementChild)
    ).toBe(true)
    await page.screenshot({
        path: testInfo.outputPath('source-conflict-mobile.png'),
        fullPage: true,
    })
    sourceConflict = false
    olderRecovery = true
    const recoveryKey = `herald:publication-editor:v3:${projectId}:${publicationId}`
    const localCopy = {
        version: 3,
        baseRevision: 1,
        sourceContent: { body: { format: 'plain_text', text: 'Unsent local draft' }, media: [] },
        targetText: JSON.stringify({ body: 'Unsent local draft' }),
        scheduleValue: '',
        timeZone: 'UTC',
    }
    await page.evaluate(({ key, copy }) => localStorage.setItem(key, JSON.stringify(copy)), {
        key: recoveryKey,
        copy: localCopy,
    })
    await page.reload()
    const recoveryDecision = page.locator('[data-publication-recovery-decision]')
    await expect(recoveryDecision).toBeVisible()
    await expect(recoveryDecision).toHaveAccessibleName('Local copy')
    await page.keyboard.press('Escape')
    await expect(recoveryDecision).toBeVisible()
    expect(
        await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), recoveryKey)
    ).toEqual(localCopy)
    await page.screenshot({
        path: testInfo.outputPath('local-recovery-mobile.png'),
        fullPage: true,
    })
    await recoveryDecision.getByRole('button', { name: 'Restore local copy', exact: true }).click()
    await expect(recoveryDecision).toHaveCount(0)
    await expect(page.locator('#source-body')).toHaveText('Unsent local draft')
    await page.addInitScript(({ key, copy }) => localStorage.setItem(key, JSON.stringify(copy)), {
        key: recoveryKey,
        copy: localCopy,
    })
    await page.reload()
    await expect(recoveryDecision).toBeVisible()
    await recoveryDecision.getByRole('button', { name: 'Discard local copy', exact: true }).click()
    await expect(recoveryDecision).toHaveCount(0)
    await expect(page.locator('#source-body')).toHaveText('E2E detail lifecycle content')
})

test('shows the active-profile refusal when promotion rejects a superseded draft', async ({
    page,
}) => {
    test.setTimeout(90_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: `E2E active profile destination ${suffix}`, profile: 'manual-message' },
    })
    expect(channelResponse.status()).toBe(201)
    const channel = (await channelResponse.json()) as { channel: { id: string } }
    const initialBody = 'Active profile body one'
    const postResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: {
                body: { format: 'plain_text', text: `E2E active profile source ${suffix}` },
                media: [],
            },
            publications: [
                {
                    channelId: channel.channel.id,
                    deliveryMode: 'manual',
                    targetContent: { body: initialBody, media: [] },
                },
            ],
        },
    })
    expect(postResponse.status()).toBe(201)
    const created = (await postResponse.json()) as { publications: { id: string }[] }
    const publication = created.publications[0]
    if (publication === undefined) throw new Error('The active-profile publication is missing')
    const editorUrl = `/dashboard/projects/${projectId}/publications/${publication.id}`
    await page.goto(editorUrl)

    const action = page.getByRole('button', { name: 'Use this version', exact: true })
    await expect(action).toBeEnabled()
    const bodyField = page.locator('[data-target-field="body"] textarea')
    await expect(bodyField).toHaveValue(initialBody)

    const profileResponse = await page.request.get(
        `/api/projects/${projectId}/channels/${channel.channel.id}/profile`
    )
    expect(profileResponse.status()).toBe(200)
    const profileState = (await profileResponse.json()) as { active: { profile: unknown } }
    const profile = structuredClone(profileState.active.profile) as {
        contentSchema: { properties: { body: { maxLength: number } } }
        capabilities: { revision: string; textFields: Array<{ maxLength: number }> }
        profileHash: string
        schemaHash: string
    }
    profile.contentSchema.properties.body.maxLength = 10
    const textField = profile.capabilities.textFields[0]
    if (textField === undefined) throw new Error('The manual profile has no text field')
    textField.maxLength = 10
    profile.capabilities.revision = 'manual-message-v2'
    profile.profileHash = 'sha256:herald-manual-message-e2e-v2'
    profile.schemaHash = 'sha256:herald-manual-message-schema-e2e-v2'
    const draftResponse = await page.request.post(
        `/api/projects/${projectId}/channels/${channel.channel.id}/profile-drafts`,
        { data: { profile } }
    )
    expect(draftResponse.status()).toBe(200)
    const profileDraft = (await draftResponse.json()) as { profile: { id: string } }
    const activationResponse = await page.request.post(
        `/api/projects/${projectId}/channels/${channel.channel.id}/profile-drafts/${profileDraft.profile.id}/activate`,
        { data: { expectedRevision: 1 } }
    )
    expect(activationResponse.status()).toBe(200)

    await page.reload()
    await expect(action).toBeDisabled()
    const replacementBody = 'Active profile body two'
    await bodyField.fill(replacementBody)
    await expect(page.getByRole('status', { name: 'Saved', exact: true })).toBeVisible()
    await expect(action).toBeEnabled()
    await action.click()

    await expect(
        page.getByText(
            'The active channel profile changed after this draft was saved. The draft still uses the previous profile, so normal promotion cannot apply it. The saved content and selected target are unchanged.',
            { exact: true }
        )
    ).toBeVisible()
    await expect(
        page.getByRole('button', { name: 'Check server status', exact: true })
    ).toHaveCount(0)
    await expect(page.locator('[data-publication-recovery-decision]')).toHaveCount(0)
    await expect(bodyField).toHaveValue(replacementBody)
    const finalEditorResponse = await page.request.get(
        `/api/projects/${projectId}/publications/${publication.id}/editor`
    )
    expect(finalEditorResponse.status()).toBe(200)
    const finalEditor = (await finalEditorResponse.json()) as {
        editor: {
            publication: { state: string }
            draft: { revision: number; content: { body: string } }
            selectedTarget: unknown
        }
    }
    expect(finalEditor.editor.publication.state).toBe('draft')
    expect(finalEditor.editor.draft.content.body).toBe(replacementBody)
    expect(finalEditor.editor.selectedTarget).toBeNull()
    const approvalResponse = await page.request.post(
        `/api/projects/${projectId}/publications/${publication.id}/approval-request`,
        {
            data: {
                expectedDraftRevision: finalEditor.editor.draft.revision,
                proposedScheduledAt: Date.now() + 60_000,
            },
        }
    )
    expect(approvalResponse.status()).toBe(400)
    expect(await approvalResponse.json()).toMatchObject({
        error: {
            code: 'invalid_content',
            message: expect.stringContaining('incompatible with the active channel profile'),
        },
    })
    const requestsResponse = await page.request.get(
        `/api/projects/${projectId}/publications/approval-requests`
    )
    expect(requestsResponse.status()).toBe(200)
    expect(await requestsResponse.json()).toEqual({ requests: [] })
    const unchangedResponse = await page.request.get(
        `/api/projects/${projectId}/publications/${publication.id}/editor`
    )
    expect(unchangedResponse.status()).toBe(200)
    expect(await unchangedResponse.json()).toEqual(finalEditor)
    await expect(bodyField).toHaveValue(replacementBody)
})

test('adapts a draft explicitly without changing its source or selecting a publication target', async ({
    page,
}, testInfo) => {
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Adoption channel', profile: 'manual-message' },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    const createdResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: {
                body: { text: 'Source stays unchanged', format: 'plain_text' },
                media: [],
            },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'manual',
                    targetContent: { body: 'Previous destination', media: [] },
                },
            ],
        },
    })
    expect(createdResponse.status()).toBe(201)
    const publicationId = (await createdResponse.json()).publications[0].id
    const apiUrl = `/api/projects/${projectId}/publications/${publicationId}`
    const state = await (
        await page.request.get(`/api/projects/${projectId}/channels/${channel.id}/profile`)
    ).json()
    const profile = structuredClone(state.active.profile)
    const bodySchema = profile.contentSchema.properties.body
    delete profile.contentSchema.properties.body
    profile.contentSchema.properties.article = {
        type: 'object',
        properties: { body: bodySchema },
        required: ['body'],
        additionalProperties: false,
    }
    profile.contentSchema.required = profile.contentSchema.required.map((name: string) =>
        name === 'body' ? 'article' : name
    )
    profile.fieldBindings.find((binding: { id: string }) => binding.id === 'body').path =
        '/article/body'
    profile.profileHash = 'adoption-browser-profile'
    profile.schemaHash = 'adoption-browser-schema'
    const draftResponse = await page.request.post(
        `/api/projects/${projectId}/channels/${channel.id}/profile-drafts`,
        { data: { profile } }
    )
    expect(draftResponse.status()).toBe(200)
    const version = (await draftResponse.json()).profile
    expect(
        (
            await page.request.post(
                `/api/projects/${projectId}/channels/${channel.id}/profile-drafts/${version.id}/activate`,
                { data: { expectedRevision: version.revision } }
            )
        ).status()
    ).toBe(200)
    let before = (await (await page.request.get(`${apiUrl}/editor`)).json()).editor
    await page.goto(`/dashboard/projects/${projectId}/publications/${publicationId}`)
    await page.getByRole('button', { name: 'Adapt to current profile', exact: true }).click()
    const adaptation = page.getByRole('region', { name: 'Adapt to current profile', exact: true })
    await expect(
        adaptation.getByRole('button', { name: 'Save adapted draft', exact: true })
    ).toBeDisabled()
    await adaptation.getByRole('button', { name: 'Validate adaptation', exact: true }).click()
    await expect(adaptation.getByRole('alert')).toBeVisible()
    await adaptation.getByRole('button', { name: 'Reuse previous Body', exact: true }).click()
    await adaptation.getByRole('button', { name: 'Reuse previous Media', exact: true }).click()
    await expect(adaptation.locator('[data-target-field="body"] textarea')).toHaveValue(
        'Previous destination'
    )
    await page.screenshot({ path: testInfo.outputPath('adoption-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(
        adaptation.getByRole('button', { name: 'Validate adaptation', exact: true })
    ).toBeVisible()
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('adoption-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click()
    await page.screenshot({
        path: testInfo.outputPath('adoption-mobile-light.png'),
        fullPage: true,
    })
    await adaptation.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await (await page.request.get(`${apiUrl}/editor`)).json()).editor).toEqual(before)
    await page.getByRole('button', { name: 'Adapt to current profile', exact: true }).click()
    await adaptation.getByRole('button', { name: 'Reuse previous Body', exact: true }).click()
    await adaptation.getByRole('button', { name: 'Reuse previous Media', exact: true }).click()
    await adaptation.getByRole('button', { name: 'Validate adaptation', exact: true }).click()
    await expect(
        adaptation.getByRole('button', { name: 'Save adapted draft', exact: true })
    ).toBeEnabled()
    expect(
        (
            await page.request.patch(`${apiUrl}/draft`, {
                data: {
                    expectedRevision: before.draft.revision,
                    targetContent: { body: 'Concurrent destination', media: [] },
                },
            })
        ).status()
    ).toBe(200)
    before = (await (await page.request.get(`${apiUrl}/editor`)).json()).editor
    await adaptation.getByRole('button', { name: 'Save adapted draft', exact: true }).click()
    await expect(adaptation.getByRole('alert')).toBeVisible()
    await expect(adaptation.locator('[data-target-field="body"] textarea')).toHaveValue(
        'Previous destination'
    )
    await adaptation
        .getByRole('button', { name: 'Review latest draft and profile', exact: true })
        .click()
    await expect(adaptation.getByRole('alert')).toHaveCount(0)
    await expect(
        adaptation.getByRole('button', { name: 'Save adapted draft', exact: true })
    ).toBeDisabled()
    await adaptation.getByRole('button', { name: 'Validate adaptation', exact: true }).click()
    await expect(
        adaptation.getByRole('button', { name: 'Save adapted draft', exact: true })
    ).toBeEnabled()
    await adaptation.getByRole('button', { name: 'Save adapted draft', exact: true }).click()
    await expect(adaptation).toHaveCount(0)
    const after = (await (await page.request.get(`${apiUrl}/editor`)).json()).editor
    expect(after.post).toEqual(before.post)
    expect(after.publication).toEqual(before.publication)
    expect(after.selectedTarget).toEqual(before.selectedTarget)
    expect(after.draft.profileVersionId).toBe(version.id)
    expect(after.draft.content).toEqual({ article: { body: 'Previous destination' }, media: [] })
    await page.reload()
    await page.getByText('Previous drafts kept during adaptation', { exact: true }).click()
    await expect(page.locator('pre').filter({ hasText: 'Concurrent destination' })).toBeVisible()
    expect(
        (await (await page.request.get(`${apiUrl}/draft/adoptions`)).json()).adoptions[0].draft
    ).toEqual(before.draft)
    await page.evaluate(({ key, buffer }) => localStorage.setItem(key, JSON.stringify(buffer)), {
        key: `herald:publication-editor:v3:${encodeURIComponent(projectId)}:${encodeURIComponent(publicationId)}`,
        buffer: {
            version: 3,
            baseRevision: after.draft.revision + 1,
            sourceContent: before.post.sourceContent,
            targetText: JSON.stringify({ body: 'Legacy local text' }),
            scheduleValue: '',
            timeZone: 'UTC',
        },
    })
    await page.reload()
    const recovery = page.locator('[data-publication-recovery-decision]')
    await expect(recovery).toBeVisible()
    await expect(
        recovery.getByRole('button', { name: 'Restore local copy', exact: true })
    ).toBeDisabled()
    await expect(recovery.locator('pre')).toContainText('Legacy local text')
    expect((await (await page.request.get(`${apiUrl}/editor`)).json()).editor).toEqual(after)
})

async function createAccountAndProject(page: Page, suffix: string) {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E detail ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-detail-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-detail-password')
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
        .fill(`E2E detail project ${suffix}`)
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
