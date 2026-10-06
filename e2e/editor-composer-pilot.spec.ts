import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

test('recovers composition text, target formatting and media through the existing draft contract', async ({
    page,
}, info) => {
    test.setTimeout(90_000)
    const id = await createProject(page)
    const channels = [
        { name: 'Pilot Discord', profile: 'discord' },
        { name: 'Pilot article', profile: 'devto' },
        { name: 'Pilot X', profile: 'x' },
    ]
    let articleChannelId: string | undefined
    for (const channel of channels) {
        const response = await page.request.post(`/api/projects/${id}/channels`, { data: channel })
        expect(response.ok()).toBe(true)
        if (channel.profile === 'devto') articleChannelId = (await response.json()).channel.id
    }
    const url = `/dashboard/projects/${id}/publications/new`
    await page.goto(url)
    const common = page.getByRole('textbox', { name: 'Content', exact: true })
    const target = page.getByRole('textbox', { name: 'Channel content', exact: true })
    await expect(common).toHaveAttribute('contenteditable', 'true')
    await expect(page.locator('[data-new-publication-form="true"]')).not.toHaveAttribute(
        'inert',
        ''
    )
    await common.fill('Shared 👋')
    await common.press('End')
    await common.pressSequentially(' draft')
    await expect(common).toHaveText('Shared 👋 draft')
    await page.getByRole('button', { name: 'Pilot Discord', exact: true }).click()
    await expect(target).toHaveText('Shared 👋 draft')
    await target.press('Control+a')
    await page.getByRole('button', { name: 'Underline', exact: true }).click()
    await page.getByRole('button', { name: 'Common', exact: true }).click()
    await expect(common).toHaveText('Shared 👋 draft')
    await page.getByRole('button', { name: 'Pilot Discord', exact: true }).click()
    await expect(target.locator('u')).toHaveText('Shared 👋 draft')
    await target.press('Control+z')
    await expect(target.locator('u')).toHaveCount(0)
    await target.press('Control+a')
    await page.getByRole('button', { name: 'Underline', exact: true }).click()

    const attachments = page
        .locator('[data-editor-toolbar="true"]')
        .getByRole('button', { name: 'Add media', exact: true })
    await expect(attachments).toHaveCount(1)
    await expect(attachments).not.toHaveAttribute('title')
    await expect(
        page.locator('[data-publication-channel-selection="true"] button[title]')
    ).toHaveCount(0)
    await attachments.click()
    const library = page.locator('[data-media-library="true"]')
    await library.getByRole('button', { name: 'Import', exact: true }).first().click()
    await page.locator('[data-media-source="device"]').click()
    await page.locator('input[type="file"]').setInputFiles({
        name: 'pilot-image.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
        ),
    })
    await expect(
        library.locator('article').filter({ hasText: 'pilot-image.png' }).first()
    ).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('[data-media-selection-preview="true"]')).toHaveCount(1)

    await expect
        .poll(async () => {
            const response = await page.request.get(
                `/api/projects/${id}/publication-composer-draft`
            )
            const { draft } = await response.json()
            return {
                common: draft?.content.postContent,
                target: draft?.content.publicationTargets.find((item: { content: string }) =>
                    item.content.includes('__')
                )?.content,
                media: draft?.content.sourceMedia.length,
            }
        })
        .toEqual({ common: 'Shared 👋 draft', target: '__Shared 👋 draft__', media: 1 })

    await page.reload()
    const recovery = page.locator('[data-new-publication-recovery="true"]')
    await expect(recovery).toBeVisible()
    await recovery.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(target.locator('u')).toHaveText('Shared 👋 draft')
    await expect(page.locator('[data-media-selection-preview="true"]')).toHaveCount(1)
    await page
        .getByRole('button', { name: 'Use common content for Pilot Discord', exact: true })
        .click()
    await expect(target.locator('u')).toHaveCount(0)
    await expect(target).toHaveText('Shared 👋 draft')

    await page.getByRole('button', { name: 'Add Pilot article', exact: true }).click()
    await page.getByRole('button', { name: 'Pilot article', exact: true }).click()
    await target.press('Control+a')
    await page.getByRole('button', { name: 'Heading', exact: true }).click()
    await expect(target.locator('h2')).toHaveText('Shared 👋 draft')
    await page.getByRole('button', { name: 'Add Pilot X', exact: true }).click()
    await page.getByRole('button', { name: 'Pilot X', exact: true }).click()
    await target.fill('日'.repeat(141))
    await expect(target).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('[data-weighted-count="true"]')).toHaveText(
        '282 / 280 weighted characters'
    )
    await page.getByRole('button', { name: 'Common', exact: true }).click()
    await expect(common).toHaveText('Shared 👋 draft')
    await common.press('End')
    await page.getByRole('button', { name: 'Insert emoji', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Search emojis', exact: true }).fill('grinning face')
    await page.locator('[frimousse-emoji]').filter({ hasText: '😀' }).first().click()
    await expect(common).toHaveText('Shared 👋 draft😀')
    await expect(common).toBeFocused()
    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({ path: info.outputPath(`composer-pilot-${width}.png`) })
    }
    await page.getByRole('button', { name: 'Pilot X', exact: true }).click()
    await target.fill('X copy')
    await expect(target).not.toHaveAttribute('aria-invalid', 'true')
    await page.getByRole('button', { name: 'Common', exact: true }).click()
    const createdResponse = page.waitForResponse(
        response => response.url().endsWith('/posts') && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    const response = await createdResponse
    expect(response.status()).toBe(201)
    const created = await response.json()
    expect(created.post.sourceContent.body).toEqual({
        text: 'Shared 👋 draft😀',
        format: 'plain_text',
    })
    expect(created.post.sourceContent.media).toHaveLength(1)
    expect(created.publications).toHaveLength(3)
    expect(created.publications.every((item: { state: string }) => item.state === 'draft')).toBe(
        true
    )
    const article = created.publications.find(
        (item: { channelId: string }) => item.channelId === articleChannelId
    )
    expect(article).toBeDefined()
    const editorResponse = await page.request.get(
        `/api/projects/${id}/publications/${article.id}/editor`
    )
    expect(editorResponse.ok()).toBe(true)
    const { editor } = await editorResponse.json()
    expect(editor.draft.content.body_markdown).toBe('## Shared 👋 draft')
    expect(editor.draft.content.media).toEqual(created.post.sourceContent.media)

    await page.goto(`/dashboard/projects/${id}/publications/${article.id}?editor=tiptap`)
    const headline = page.locator('[data-target-field="title"]')
    await openCustomization(page, headline)
    await expect(headline.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
    await expect(headline).toContainText('Enter Headline.')
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({
            path: info.outputPath(`article-validation-${width}.png`),
            fullPage: true,
        })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    const diagnostics = page.locator('[data-validation-diagnostics="true"]')
    await expect(diagnostics).not.toHaveAttribute('open', '')
    await diagnostics.locator('summary').click()
    await expect(diagnostics).toContainText('schema.minLength')
    const titleSaved = page.waitForResponse(
        response =>
            response.url().endsWith(`/publications/${article.id}/draft`) &&
            response.request().method() === 'PATCH' &&
            response.ok()
    )
    await headline.getByRole('textbox').fill('An article headline')
    await titleSaved
    await expect(headline.getByRole('textbox')).not.toHaveAttribute('aria-invalid', 'true')
    const sourceBody = page.locator('#source-body')
    await expect(sourceBody).toHaveAttribute('contenteditable', 'true')
    await expect(
        sourceBody
            .locator('xpath=ancestor::section[1]')
            .getByRole('button', { name: 'Source', exact: true })
    ).toHaveCount(0)
    const sourceSaved = page.waitForResponse(
        response =>
            response.url().endsWith(`/publications/${article.id}/draft`) &&
            response.request().method() === 'PATCH' &&
            response.ok()
    )
    await sourceBody.fill('Updated common copy')
    await sourceSaved
    const articleField = page.locator('[data-target-field="body_markdown"]')
    const articleBody = articleField.locator('[contenteditable="true"]')
    await openCustomization(page, articleField)
    await expect(articleBody.locator('h2')).toHaveText('Shared 👋 draft')
    const targetSaved = page.waitForResponse(
        response =>
            response.url().endsWith(`/publications/${article.id}/draft`) &&
            response.request().method() === 'PATCH' &&
            response.ok()
    )
    await articleBody.fill('Updated article')
    await articleBody.press('Control+a')
    await articleField.getByRole('button', { name: 'Strikethrough', exact: true }).click()
    await expect(
        articleField.getByRole('button', { name: 'Strikethrough', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await targetSaved
    const externalImage = 'https://images.example.com/article.png'
    await page.route(externalImage, route =>
        route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#6699cc"/></svg>',
        })
    )
    await articleBody.press('Control+End')
    await articleBody.press('Enter')
    await articleField.getByRole('button', { name: 'External image', exact: true }).click()
    await page.getByRole('textbox', { name: 'Image URL', exact: true }).fill(externalImage)
    await page
        .getByRole('textbox', { name: 'Alternative text', exact: true })
        .fill('Article landscape')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(articleBody.locator('img')).toHaveAttribute('src', externalImage)
    await expect(page.locator('[data-publication-preview-content="true"] img')).toHaveAttribute(
        'src',
        externalImage
    )
    await expect
        .poll(async () => {
            const response = await page.request.get(
                `/api/projects/${id}/publications/${article.id}/editor`
            )
            const { editor } = await response.json()
            return {
                source: editor.post.sourceContent.body.text,
                target: editor.draft.content.body_markdown,
                media: editor.draft.content.media.length,
            }
        })
        .toEqual({
            source: 'Updated common copy',
            target: '## ~~Updated article~~\n\n![Article landscape](<https://images.example.com/article.png>)',
            media: 1,
        })
    await page.reload()
    await expect(sourceBody).toHaveText('Updated common copy')
    await openCustomization(page, articleField)
    await expect(articleBody.locator('s')).toHaveText('Updated article')
    await expect(articleBody.locator('img')).toHaveAttribute('src', externalImage)
    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({
            path: info.outputPath(`existing-pilot-${width}.png`),
            fullPage: true,
        })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/dashboard/projects/${id}/publications/${article.id}?editor=legacy`)
    await expect(sourceBody).toHaveValue('Updated common copy')
    await openCustomization(page, articleField)
    await expect(articleField.locator('textarea')).toHaveValue(
        '## ~~Updated article~~\n\n![Article landscape](<https://images.example.com/article.png>)'
    )

    // Identify the Discord contract, rather than relying on selected destination ordering.
    let discordId: string | undefined
    for (const publication of created.publications) {
        const response = await page.request.get(
            `/api/projects/${id}/publications/${publication.id}/editor`
        )
        if ((await response.json()).editor.profile.profile.id === 'discord')
            discordId = publication.id
    }
    expect(discordId).toBeDefined()
    await page.goto(`/dashboard/projects/${id}/publications/${discordId}?editor=tiptap`)
    await expect(
        page.getByRole('button', { name: 'Reconcile before continuing', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Rebase draft to current source', exact: true }).click()
    const discordField = page.locator('[data-target-field="text"]')
    await openCustomization(page, discordField)
    await discordField.getByRole('button', { name: 'Source', exact: true }).click()
    await discordField
        .getByRole('textbox', { name: 'Source text', exact: true })
        .fill('x'.repeat(2000))
    await discordField.getByRole('button', { name: 'Source', exact: true }).click()
    const discordBody = discordField.locator('[contenteditable="true"]')
    await discordBody.press('Control+End')
    await discordBody.pressSequentially('a')
    await expect(discordBody).toHaveText('x'.repeat(2000))
    await discordBody.press('Control+a')
    await discordField.getByRole('button', { name: 'Bold', exact: true }).click()
    await expect(discordBody.locator('strong')).toHaveCount(0)
})

test('keeps a native editor draft byte-for-byte when restored into the configured editor and back', async ({
    page,
}) => {
    const id = await createProject(page)
    expect(
        (
            await page.request.post(`/api/projects/${id}/channels`, {
                data: { name: 'Legacy Discord', profile: 'discord' },
            })
        ).ok()
    ).toBe(true)
    const base = `/dashboard/projects/${id}/publications/new`
    await page.goto(`${base}?editor=legacy`)
    const text = '  Original 👋\n\n**literal**\n'
    const saved = page.waitForResponse(
        response =>
            response.url().includes('/publication-composer-draft') &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill(text)
    await saved
    await page.goto(`${base}?editor=tiptap`)
    await page
        .locator('[data-new-publication-recovery="true"]')
        .getByRole('button', { name: 'Restore', exact: true })
        .click()
    await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveAttribute(
        'contenteditable',
        'true'
    )
    const draft = await page.request.get(`/api/projects/${id}/publication-composer-draft`)
    expect((await draft.json()).draft.content.postContent).toBe(text)
    await page.reload()
    await page
        .locator('[data-new-publication-recovery="true"]')
        .getByRole('button', { name: 'Restore', exact: true })
        .click()
    await page.goto(`${base}?editor=legacy`)
    await page
        .locator('[data-new-publication-recovery="true"]')
        .getByRole('button', { name: 'Restore', exact: true })
        .click()
    await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue(text)
})

test('preserves a title-only article across autosave and recovery', async ({ page }) => {
    const id = await createProject(page)
    const response = await page.request.post(`/api/projects/${id}/channels`, {
        data: { name: 'Title article', profile: 'devto' },
    })
    expect(response.ok()).toBe(true)
    await page.goto(`/dashboard/projects/${id}/publications/new`)
    await page.getByRole('button', { name: 'Title article', exact: true }).click()
    const title = page.locator('#new-post-title')
    await expect(title).toHaveAttribute('placeholder', 'Article title')
    await title.fill('A title worth preserving')
    await expect
        .poll(async () => {
            const draftResponse = await page.request.get(
                `/api/projects/${id}/publication-composer-draft`
            )
            return (await draftResponse.json()).draft?.content.postTitle
        })
        .toBe('A title worth preserving')
    await page.reload()
    const recovery = page.locator('[data-new-publication-recovery="true"]')
    await expect(recovery).toBeVisible()
    await recovery.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(title).toHaveValue('A title worth preserving')
    await expect(page.getByRole('textbox', { name: 'Channel content', exact: true })).toHaveText('')
})

test('corrects destination attachments without changing shared media or another publication', async ({
    page,
}, info) => {
    test.setTimeout(90_000)
    const id = await createProject(page)
    const channelIds: string[] = []
    for (const profile of ['linkedin', 'discord']) {
        const response = await page.request.post(`/api/projects/${id}/channels`, {
            data: { name: `Media ${profile}`, profile },
        })
        expect(response.ok()).toBe(true)
        channelIds.push((await response.json()).channel.id)
    }
    await page.goto(`/dashboard/projects/${id}/publications/new`)
    await page.getByRole('button', { name: 'Add Media discord', exact: true }).click()
    await page.getByRole('button', { name: 'Common', exact: true }).click()
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Shared images')
    await page.getByRole('button', { name: 'Add media', exact: true }).click()
    const library = page.locator('[data-media-library="true"]')
    await library.getByRole('button', { name: 'Import', exact: true }).first().click()
    await page.locator('[data-media-source="device"]').click()
    await page.locator('input[type="file"]').setInputFiles(
        ['first.png', 'second.png'].map(name => ({
            name,
            mimeType: 'image/png',
            buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                'base64'
            ),
        }))
    )
    await expect(library.locator('article').filter({ hasText: 'first.png' }).first()).toBeVisible()
    await expect(library.locator('article').filter({ hasText: 'second.png' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('[data-media-selection-preview="true"]')).toHaveCount(2)
    const createdResponse = page.waitForResponse(
        response => response.url().endsWith('/posts') && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    const created = await (await createdResponse).json()
    const publication = created.publications.find(
        (item: { channelId: string }) => item.channelId === channelIds[0]
    )
    const sibling = created.publications.find(
        (item: { channelId: string }) => item.channelId === channelIds[1]
    )
    const editorUrl = `/api/projects/${id}/publications/${publication.id}/editor`
    const siblingUrl = `/api/projects/${id}/publications/${sibling.id}/editor`
    const before = (await (await page.request.get(siblingUrl)).json()).editor.draft.content
    await page.goto(`/dashboard/projects/${id}/publications/${publication.id}`)
    const mediaField = page.locator('[data-target-field="media"]')
    await openCustomization(page, mediaField)
    await expect(mediaField).toContainText('Select at most 1 item.')
    await expect(mediaField.locator('[data-media-selection-preview="true"]')).toHaveCount(2)
    await mediaField.getByRole('button', { name: 'Remove second.png', exact: true }).click()
    await expect
        .poll(async () => {
            const { editor } = await (await page.request.get(editorUrl)).json()
            return {
                source: editor.post.sourceContent.media.length,
                target: editor.draft.content.media.length,
                review: editor.draft.reviewState,
            }
        })
        .toEqual({ source: 2, target: 1, review: 'compatible' })
    await expect(mediaField).not.toContainText('Select at most 1 item.')
    expect((await (await page.request.get(siblingUrl)).json()).editor.draft.content).toEqual(before)
    await page.reload()
    await openCustomization(page, mediaField)
    await expect(mediaField.locator('[data-media-selection-preview="true"]')).toHaveCount(1)
    for (const theme of ['light', 'dark']) {
        const toggle = page.getByRole('button', { name: `Switch to ${theme} theme`, exact: true })
        if (await toggle.isVisible()) await toggle.click()
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await expect(
                mediaField.getByRole('button', { name: 'Add media', exact: true })
            ).toBeVisible()
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await mediaField.scrollIntoViewIfNeeded()
            await page.screenshot({
                path: info.outputPath(`destination-media-${theme}-${width}.png`),
                fullPage: true,
            })
        }
    }
    await mediaField.getByRole('button', { name: 'Add media', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(library).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    const applied = page.waitForResponse(
        response =>
            response.url().endsWith(`/publications/${publication.id}/draft/promote`) &&
            response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Use this version', exact: true }).click()
    const appliedResponse = await applied
    expect(appliedResponse.ok()).toBe(true)
    const { editor: appliedEditor } = await appliedResponse.json()
    expect(appliedEditor.post.sourceContent.media).toEqual(created.post.sourceContent.media)
    expect(appliedEditor.draft.content.media).toHaveLength(1)
    expect((await (await page.request.get(siblingUrl)).json()).editor.draft.content).toEqual(before)
})

test('previews the article destination headline through adaptation and locked inspection', async ({
    page,
}, info) => {
    test.setTimeout(60_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const id = await createProject(page)
    const channelResponse = await page.request.post(`/api/projects/${id}/channels`, {
        data: { name: 'Article title destination', profile: 'devto' },
    })
    expect(channelResponse.ok()).toBe(true)
    const { channel } = await channelResponse.json()
    // Two real assets, so the selected target and the later draft can carry
    // genuinely different media instead of an absent list.
    const selectedAssetId = await createMediaAsset(page, id, 'selected-article.png')
    const laterDraftAssetId = await createMediaAsset(page, id, 'later-draft-article.png')
    const createdResponse = await page.request.post(`/api/projects/${id}/posts`, {
        data: {
            title: 'Internal post label',
            sourceContent: {
                headline: 'Shared article headline',
                body: { format: 'plain_text', text: 'Article body content.' },
                media: [{ assetId: selectedAssetId, accessibilityText: 'Selected asset' }],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(createdResponse.status()).toBe(201)
    const created = await createdResponse.json()
    const publication = created.publications[0]
    const apiUrl = `/api/projects/${id}/publications/${publication.id}`
    const detailUrl = `/dashboard/projects/${id}/publications/${publication.id}`
    const read = async () => (await (await page.request.get(`${apiUrl}/editor`)).json()).editor
    const original = await read()
    expect(original.draft.content.title).toBe('Shared article headline')
    await page.goto(detailUrl)
    const preview = page.locator('[data-publication-draft-preview="true"]')
    const previewBody = preview.locator('[data-publication-preview-content="true"]')
    const previewMedia = preview.locator('[data-publication-preview-media="true"]')
    await expect(preview.getByRole('heading', { level: 2 })).toHaveText('Shared article headline')
    await expect(previewBody).toHaveText('Article body content.')
    await expect(previewMedia).toHaveCount(1)
    const field = page.locator('[data-target-field="title"]')
    await openCustomization(page, field)
    await field.getByRole('textbox').fill('Customized destination headline')
    await expect(preview.getByRole('heading', { level: 2 })).toHaveText(
        'Customized destination headline'
    )
    await expect
        .poll(async () => (await read()).draft.content.title)
        .toBe('Customized destination headline')
    const adapted = await read()
    expect(adapted.post.sourceContent).toEqual(original.post.sourceContent)
    expect(adapted.post.title).toBe('Internal post label')
    expect(adapted.selectedTarget).toEqual(original.selectedTarget)
    await field.getByRole('textbox').fill('')
    await expect(preview.getByRole('heading', { level: 2 })).toHaveCount(0)
    await expect.poll(async () => (await read()).draft.content.title).toBe('')
    await field.getByRole('textbox').fill('Customized destination headline')
    await expect
        .poll(async () => (await read()).draft.content.title)
        .toBe('Customized destination headline')
    await page.reload()
    await expect(preview.getByRole('heading', { level: 2 })).toHaveText(
        'Customized destination headline'
    )
    const saved = await read()
    const scheduledAt = Date.now() + 2_000
    const promoted = await page.request.post(`${apiUrl}/draft/promote`, {
        data: { expectedRevision: saved.draft.revision, scheduledAt },
    })
    expect(promoted.ok()).toBe(true)
    const selected = await read()
    const unpublishedHeadline = 'Unapplied later draft headline'
    const unpublishedBody = 'Unapplied later draft body.'
    const laterDraft = await page.request.patch(`${apiUrl}/draft`, {
        data: {
            expectedRevision: selected.draft.revision,
            targetContent: {
                ...selected.draft.content,
                title: unpublishedHeadline,
                body_markdown: unpublishedBody,
                media: [{ assetId: laterDraftAssetId, accessibilityText: 'Later draft asset' }],
            },
        },
    })
    expect(laterDraft.ok()).toBe(true)
    const withLaterDraft = await read()
    expect(withLaterDraft.draft.content.body_markdown).toBe(unpublishedBody)
    expect(withLaterDraft.draft.content.media).toEqual([
        { assetId: laterDraftAssetId, accessibilityText: 'Later draft asset' },
    ])
    expect(withLaterDraft.selectedTarget).toEqual(selected.selectedTarget)

    // While editable, the preview follows the working draft on all three inputs.
    await page.reload()
    await expect(preview.getByRole('heading', { level: 2 })).toHaveText(unpublishedHeadline)
    await expect(previewBody).toHaveText(unpublishedBody)
    await expect(previewMedia.getByAltText('Later draft asset')).toBeVisible()
    await expect(previewMedia.getByAltText('Selected asset')).toHaveCount(0)
    await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(scheduledAt)
    const published = await page.request.post(`${apiUrl}/publish`, { data: {} })
    expect(published.ok()).toBe(true)
    const locked = await read()
    expect(locked.publication.state).toBe('published')
    expect(locked.draft.content.title).toBe(unpublishedHeadline)
    expect(locked.draft.content.body_markdown).toBe(unpublishedBody)
    expect(locked.selectedTarget.content.title).toBe('Customized destination headline')
    expect(locked.selectedTarget.content.body_markdown).not.toBe(unpublishedBody)
    expect(locked.selectedTarget.content.media).toEqual([
        { assetId: selectedAssetId, accessibilityText: 'Selected asset' },
    ])
    await page.reload()
    // Locked inspection describes the selected execution revision on all three
    // inputs, not the newer draft that has not been applied.
    await expect(preview.getByRole('heading', { level: 2 })).toHaveText(
        locked.selectedTarget.content.title
    )
    await expect(previewBody).toHaveText(locked.selectedTarget.content.body_markdown)
    await expect(previewBody).not.toHaveText(unpublishedBody)
    await expect(previewMedia.getByAltText('Selected asset')).toBeVisible()
    await expect(previewMedia.getByAltText('Later draft asset')).toHaveCount(0)
    for (const theme of ['light', 'dark']) {
        const toggle = page.getByRole('button', { name: `Switch to ${theme} theme`, exact: true })
        if (await toggle.isVisible()) await toggle.click()
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await expect(preview.getByRole('heading', { level: 2 })).toBeVisible()
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            expect(
                await page
                    .locator('[data-dashboard-scroll]')
                    .evaluate(element => element.scrollWidth <= element.clientWidth + 1)
            ).toBe(true)
            await page.screenshot({
                path: info.outputPath(`article-title-${theme}-${width}.png`),
                fullPage: true,
            })
        }
    }
    const after = await read()
    expect(after.post.sourceContent).toEqual(original.post.sourceContent)
    expect(after.draft).toEqual(locked.draft)
    expect(after.selectedTarget).toEqual(locked.selectedTarget)
})

/** A 1x1 PNG, matching the fixture already used by the media journey. */
const previewPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
)

/** Creates one media asset through the existing reserve, upload, finalize API. */
async function createMediaAsset(page: Page, projectId: string, filename: string): Promise<string> {
    const reserved = await page.request.post(`/api/projects/${projectId}/media/uploads`, {
        data: {
            originalFilename: filename,
            contentType: 'image/png',
            expectedSize: previewPng.byteLength,
            defaultAccessibilityText: `Alt text for ${filename}`,
        },
    })
    expect(reserved.status()).toBe(201)
    const intent = (await reserved.json()) as { upload: { intentId: string } }

    const uploaded = await page.request.put(
        `/api/projects/${projectId}/media/uploads/${intent.upload.intentId}`,
        { data: previewPng }
    )
    expect(uploaded.status()).toBe(200)

    const finalized = await page.request.post(
        `/api/projects/${projectId}/media/uploads/${intent.upload.intentId}/finalize`
    )
    expect(finalized.status()).toBe(200)
    const finalized_ = (await finalized.json()) as {
        status: 'ready' | 'failed'
        media: { asset: { id: string } }
    }
    expect(finalized_.status).toBe('ready')
    return finalized_.media.asset.id
}

async function createProject(page: Page) {
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/')
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Editor pilot owner')
    await page.getByLabel('Email', { exact: true }).fill(`pilot-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('editor-pilot-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    await page.goto('/dashboard?projectId=none')
    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    const dialog = page.getByRole('dialog')
    await dialog
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill('Editor pilot project')
    await dialog.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    const id = new URL(page.url()).pathname.split('/')[3]
    if (!id) throw new Error('Missing pilot project')
    return id
}

async function openCustomization(page: Page, field: ReturnType<Page['locator']>) {
    await expect(field).toBeAttached()
    const details = page.locator('[data-publication-customization="true"]')
    if ((await details.getAttribute('open')) === null)
        await details.locator(':scope > summary').click()
    await expect(field).toBeVisible()
}
