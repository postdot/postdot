import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

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
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${id}/posts/${created.post.id}$`))
    await expect(page.getByRole('heading', { name: 'Post', exact: true })).toBeVisible()
    const destinations = page.getByRole('region', { name: 'Destinations', exact: true })
    await expect(destinations.locator('a[data-publication-edit-link]')).toHaveCount(3)
    for (const publication of created.publications) {
        await expect(
            destinations.locator(`a[href$="/publications/${publication.id}"]`).first()
        ).toBeVisible()
    }
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
    // Two images are valid under the current LinkedIn profile; customization
    // must still isolate destination media from the shared source and sibling.
    await expect(mediaField).not.toContainText('Select at most 1 item.')
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

test('projects custom destination text and ordered media through active nested bindings', async ({
    page,
}) => {
    const projectId = await createProject(page)
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Custom runtime profile', exact: true }).click()
    const starter = JSON.parse(
        await dialog.getByLabel('Custom profile JSON', { exact: true }).inputValue()
    )
    await page.keyboard.press('Escape')
    const channels: { id: string; nested: boolean; customized: boolean }[] = []
    for (const [name, nested, customized, http] of [
        ['Root control', false, true, false],
        ['Nested manual', true, true, false],
        ['Nested HTTP', true, true, true],
        ['Shared nested', true, false, false],
    ] as const) {
        const profile = structuredClone(starter)
        profile.id = name.toLowerCase().replaceAll(' ', '-')
        if (nested) {
            const { $schema, ...inner } = profile.contentSchema
            profile.contentSchema = {
                $schema,
                type: 'object',
                properties: { article: inner },
                required: ['article'],
                additionalProperties: false,
            }
            profile.fieldBindings = profile.fieldBindings.map((binding: { path: string }) => ({
                ...binding,
                path: '/article' + binding.path,
            }))
        }
        if (http)
            profile.execution = {
                kind: 'declarative_http',
                contractId: 'custom-webhook',
                revision: 'v1',
                mode: 'herald_webhook',
            }
        const response = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: { name, profile },
        })
        expect(response.status()).toBe(201)
        channels.push({ id: (await response.json()).channel.id, nested, customized })
    }
    const first = await createMediaAsset(page, projectId, 'first-projection.png')
    const second = await createMediaAsset(page, projectId, 'second-projection.png')
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    const source = page.getByRole('textbox', { name: 'Content', exact: true })
    await source.fill('Shared projection source')
    await page.getByRole('button', { name: 'Add media', exact: true }).click()
    const library = page.locator('[data-media-library="true"]')
    for (const filename of ['second-projection.png', 'first-projection.png']) {
        await library
            .locator('article')
            .filter({ hasText: filename })
            .first()
            .locator('[data-media-preview="true"]')
            .click()
    }
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('[data-media-selection-preview="true"]')).toHaveCount(2)
    for (const channel of channels) {
        const available = page.locator(`[data-channel-available][data-channel-id="${channel.id}"]`)
        if (await available.count()) await available.click()
        if (channel.customized) {
            await page
                .locator(`[data-channel-selected-button][data-channel-id="${channel.id}"]`)
                .click()
            await page
                .getByRole('textbox', { name: 'Channel content', exact: true })
                .fill('Explicit projection text')
        }
    }
    await page.getByRole('button', { name: 'Common', exact: true }).click()
    let blockProfile = true
    await page.route(`**/channels/${channels[2]!.id}/profile`, route =>
        blockProfile
            ? route.fulfill({
                  status: 503,
                  contentType: 'application/json',
                  body: JSON.stringify({ error: 'Profile read unavailable' }),
              })
            : route.continue()
    )
    let posts = 0
    page.on('request', request => {
        if (request.method() === 'POST' && request.url().endsWith('/posts')) posts++
    })
    const refusedProfile = page.waitForResponse(
        response => response.status() === 503 && response.url().endsWith('/profile')
    )
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    await refusedProfile
    await expect(page.locator('[data-new-publication-form]')).toHaveAttribute('aria-busy', 'false')
    expect(posts).toBe(0)
    await expect(source).toHaveText('Shared projection source')
    await expect(page.locator('[data-media-selection-preview="true"]')).toHaveCount(2)
    blockProfile = false
    const createdResponse = page.waitForResponse(
        response => response.url().endsWith('/posts') && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    const response = await createdResponse
    expect(response.status()).toBe(201)
    expect(posts).toBe(1)
    const created = await response.json()
    const submitted = response.request().postDataJSON()
    expect(created.post.sourceContent.body.text).toBe('Shared projection source')
    expect(
        created.post.sourceContent.media.map((item: { assetId: string }) => item.assetId)
    ).toEqual([second, first])
    for (const channel of channels) {
        const publication = created.publications.find(
            (item: { channelId: string }) => item.channelId === channel.id
        )
        const result = await page.request.get(
            `/api/projects/${projectId}/publications/${publication.id}/editor`
        )
        expect(result.status()).toBe(200)
        const { editor } = await result.json()
        expect(editor.draft.reviewState).toBe('compatible')
        expect(editor.draft.validationIssues).toEqual([])
        const content = channel.nested ? editor.draft.content.article : editor.draft.content
        expect(content.body).toBe(
            channel.customized ? 'Explicit projection text' : 'Shared projection source'
        )
        expect(content.media.map((item: { assetId: string }) => item.assetId)).toEqual([
            second,
            first,
        ])
        expect(
            submitted.publications.find(
                (item: { channelId: string }) => item.channelId === channel.id
            ).targetContent === undefined
        ).toBe(!channel.customized)
    }
})

test('shows custom headline and length feedback without blocking invalid drafts', async ({
    page,
}) => {
    const projectId = await createProject(page)
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Custom runtime profile', exact: true }).click()
    const starter = JSON.parse(
        await dialog.getByLabel('Custom profile JSON', { exact: true }).inputValue()
    )
    await page.keyboard.press('Escape')
    const ids: string[] = []
    for (const nested of [false, true]) {
        const profile = structuredClone(starter)
        profile.id = nested ? 'nested-short-title' : 'root-short-title'
        profile.contentSchema.properties.body.maxLength = 8
        profile.contentSchema.required = ['body', 'headline']
        profile.capabilities.textFields.find(
            (field: { bindingId: string }) => field.bindingId === 'body'
        ).maxLength = 8
        if (nested) {
            const { $schema, ...inner } = profile.contentSchema
            profile.contentSchema = {
                $schema,
                type: 'object',
                properties: { article: inner },
                required: ['article'],
                additionalProperties: false,
            }
            profile.fieldBindings = profile.fieldBindings.map((binding: { path: string }) => ({
                ...binding,
                path: '/article' + binding.path,
            }))
        }
        const response = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: { name: profile.id, profile },
        })
        expect(response.status()).toBe(201)
        ids.push((await response.json()).channel.id)
    }
    let unavailable = true
    let reads = 0
    await page.route(`**/channels/${ids[0]}/profile`, route => {
        reads++
        return unavailable
            ? route.fulfill({
                  status: 503,
                  contentType: 'application/json',
                  body: JSON.stringify({ error: 'Profile unavailable' }),
              })
            : route.continue()
    })
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    const source = page.getByRole('textbox', { name: 'Content', exact: true })
    await expect(
        page.getByText('Destination limits could not be checked.', { exact: true })
    ).toBeVisible()
    const initialReads = reads
    expect(initialReads).toBeGreaterThan(0)
    await source.fill('Shared work preserved')
    expect(reads).toBe(initialReads)
    unavailable = false
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('#new-post-title')).toBeVisible()
    await expect(source).toHaveText('Shared work preserved')
    expect(reads).toBe(initialReads + 1)
    await page.locator('#new-post-title').fill('Custom headline')
    for (const id of ids) {
        const available = page.locator(`[data-channel-available][data-channel-id="${id}"]`)
        if (await available.count()) await available.click()
        await page.locator(`[data-channel-selected-button][data-channel-id="${id}"]`).click()
        await expect(page.locator('#new-post-title')).toHaveValue('Custom headline')
        const target = page.getByRole('textbox', { name: 'Channel content', exact: true })
        await target.fill('Long custom body')
        await expect(target).toHaveText('Long custom body')
        await expect(target).toHaveAttribute('aria-invalid', 'true')
        await expect(page.locator('[data-composer-text-count]')).toHaveText('16 / 8 characters')
        await page.setViewportSize({ width: 390, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        )
    }
    expect(reads).toBe(initialReads + 1)
    // Real activation selects a new version key rather than reusing cached limits.
    const state = await page.request.get(`/api/projects/${projectId}/channels/${ids[0]}/profile`)
    const profile = (await state.json()).active.profile
    profile.contentSchema.properties.body.maxLength = 10
    profile.capabilities.textFields.find(
        (field: { bindingId: string }) => field.bindingId === 'body'
    ).maxLength = 10
    const saved = await page.request.post(
        `/api/projects/${projectId}/channels/${ids[0]}/profile-drafts`,
        { data: { profile } }
    )
    expect(saved.status()).toBe(200)
    const draft = (await saved.json()).profile
    const activated = await page.request.post(
        `/api/projects/${projectId}/channels/${ids[0]}/profile-drafts/${draft.id}/activate`,
        { data: { expectedRevision: draft.revision } }
    )
    expect(activated.status()).toBe(200)
    await page.locator(`[data-channel-selected-button][data-channel-id="${ids[0]}"]`).click()
    await expect(page.locator('[data-composer-text-count]')).toHaveText('16 / 10 characters')
    await expect(page.getByRole('textbox', { name: 'Channel content', exact: true })).toHaveText(
        'Long custom body'
    )
    await expect(page.locator('#new-post-title')).toHaveValue('Custom headline')
    await page.screenshot({ path: '/tmp/ux347-narrow.png', fullPage: true })
    const created = page.waitForResponse(
        response => response.url().endsWith('/posts') && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    const response = await created
    expect(response.status()).toBe(201)
    const result = await response.json()
    expect(result.post.sourceContent.headline).toBe('Custom headline')
    expect(result.post.sourceContent.body.text).toBe('Shared work preserved')
    for (const publication of result.publications) {
        const response = await page.request.get(
            `/api/projects/${projectId}/publications/${publication.id}/editor`
        )
        const { editor } = await response.json()
        expect(editor.draft.reviewState).toBe('review_required')
        expect(
            editor.draft.validationIssues.some(
                (issue: { code: string }) => issue.code === 'schema.maxLength'
            )
        ).toBe(true)
        expect(
            editor.draft.validationIssues.some(
                (issue: { code: string }) => issue.code === 'schema.required'
            )
        ).toBe(false)
        const content =
            publication.channelId === ids[1] ? editor.draft.content.article : editor.draft.content
        expect(content.headline).toBe('Custom headline')
        expect(content.body).toBe('Long custom body')
    }
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

test('composer native presentation follows execution rather than profile identity', async ({
    page,
}) => {
    test.setTimeout(90_000)
    const projectId = await createProject(page)
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Custom runtime profile', exact: true }).click()
    const starter = JSON.parse(
        await dialog.getByLabel('Custom profile JSON', { exact: true }).inputValue()
    )
    const aliases = new Map<string, Record<string, unknown>>()
    for (const [platform, label] of [
        ['x', 'X post'],
        ['discord', 'Discord message'],
        ['devto', 'DEV.to article'],
    ]) {
        await dialog.getByRole('combobox', { name: 'Starter template', exact: true }).click()
        await page.getByRole('option', { name: label, exact: true }).click()
        const json = dialog.getByLabel('Custom profile JSON', { exact: true })
        await expect(json).toHaveValue(new RegExp(`"id": "custom-${platform}"`))
        aliases.set(platform!, { ...JSON.parse(await json.inputValue()), id: `alias-${platform}` })
    }
    await page.keyboard.press('Escape')
    const cases: { id: string; platform: string; kind: 'native' | 'alias' | 'manual' }[] = []
    for (const platform of ['x', 'discord', 'devto']) {
        const native = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: { name: `Native ${platform}`, profile: platform },
        })
        expect(native.status()).toBe(201)
        const nativeId = (await native.json()).channel.id
        cases.push({ id: nativeId, platform, kind: 'native' })
        const alias = aliases.get(platform)!
        const manual = structuredClone(starter)
        manual.id = platform
        manual.contentSchema.properties.body.maxLength = 8
        manual.capabilities.textFields.find(
            (field: { bindingId: string }) => field.bindingId === 'body'
        ).maxLength = 8
        for (const [kind, profile] of [
            ['alias', alias],
            ['manual', manual],
        ] as const) {
            const created = await page.request.post(`/api/projects/${projectId}/channels`, {
                data: { name: `${kind} ${platform}`, profile },
            })
            expect(created.status(), await created.text()).toBe(201)
            cases.push({ id: (await created.json()).channel.id, platform, kind })
        }
    }
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('**Bold** text')
    for (const channel of cases) {
        const available = page.locator(`[data-channel-available][data-channel-id="${channel.id}"]`)
        if (await available.count()) await available.click()
        await page
            .locator(`[data-channel-selected-button][data-channel-id="${channel.id}"]`)
            .click()
        await expect(page.getByText('Loading destination limits…', { exact: true })).toHaveCount(0)
        const native = channel.kind !== 'manual'
        const article = native && channel.platform === 'devto'
        const discord = native && channel.platform === 'discord'
        await expect(page.locator('#new-post-title')).toHaveCount(article ? 1 : 0)
        await expect(page.locator('[data-weighted-count]')).toHaveCount(
            native && channel.platform === 'x' ? 1 : 0
        )
        await expect(page.getByRole('button', { name: 'Underline', exact: true })).toHaveCount(
            discord ? 1 : 0
        )
        await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveCount(
            article || discord ? 1 : 0
        )
        const preview = page.locator('[data-preview-platform]')
        await expect(preview).toHaveAttribute(
            'data-preview-platform',
            native ? channel.platform : 'custom'
        )
        await expect(preview.locator('strong')).toHaveCount(article || discord ? 1 : 0)
        if (!native) {
            await expect(
                page.getByRole('textbox', { name: 'Channel content', exact: true })
            ).toHaveAttribute('aria-invalid', 'true')
            await expect(preview).toContainText('**Bold** text')
        }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('[data-preview-platform]')).toContainText('**Bold** text')
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    // Reuse the channel matrix for the existing editor, rather than another setup journey.
    await page.setViewportSize({ width: 1280, height: 900 })
    const sourceText = 'Unchanged shared source'
    const existingCases = cases.filter(channel => channel.platform !== 'x')
    const created = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            title: 'Existing editor controls',
            sourceContent: {
                headline: 'Shared headline',
                body: { format: 'plain_text', text: sourceText },
                media: [],
            },
            publications: existingCases.map(channel => ({
                channelId: channel.id,
                deliveryMode: 'manual',
            })),
        },
    })
    expect(created.status()).toBe(201)
    const publications = (await created.json()).publications
    for (const channel of existingCases) {
        const publication = publications.find(
            (item: { channelId: string }) => item.channelId === channel.id
        )
        const base = `/api/projects/${projectId}/publications/${publication.id}`
        const read = async () => (await (await page.request.get(`${base}/editor`)).json()).editor
        const original = await read()
        const binding = original.profile.profile.fieldBindings.find(
            (item: { semantic: string }) => item.semantic === 'primary_text'
        )
        expect(binding.path).toMatch(/^\/[^/]+$/)
        const property = binding.path.slice(1)
        await page.goto(`/dashboard/projects/${projectId}/publications/${publication.id}`)
        const field = page.locator(`[data-target-field="${binding.id}"]`)
        await openCustomization(page, field)
        const rich = channel.kind !== 'manual'
        await expect(field.getByRole('button', { name: 'Bold', exact: true })).toHaveCount(
            rich ? 1 : 0
        )
        await expect(field.getByRole('button', { name: 'Underline', exact: true })).toHaveCount(
            rich && channel.platform === 'discord' ? 1 : 0
        )
        const text =
            channel.kind === 'manual' ? 'Saved' : `Saved ${channel.kind}-${channel.platform}`
        const saving = page.waitForResponse(
            response =>
                response.url().endsWith(`${publication.id}/draft`) &&
                response.request().method() === 'PATCH' &&
                response.ok()
        )
        await field.getByRole('textbox').fill(text)
        await saving
        const saved = await read()
        expect(saved.draft.content[property]).toBe(text)
        expect(saved.post.sourceContent.body.text).toBe(sourceText)
        if (channel.kind === 'alias' && channel.platform === 'devto') {
            const scheduledAt = Date.now() + 1_000
            const promoted = await page.request.post(`${base}/draft/promote`, {
                data: { expectedRevision: saved.draft.revision, scheduledAt },
            })
            expect(promoted.status()).toBe(200)
            await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(scheduledAt)
            expect((await page.request.post(`${base}/publish`, { data: {} })).status()).toBe(200)
            await page.reload()
            await expect(page.locator('[data-preview-platform="devto"]')).toContainText(text)
            await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveCount(0)
            expect((await read()).selectedTarget.content[property]).toBe(text)
        }
    }
})

test('upgrades LinkedIn explicitly and composes multiple images without changing historical targets', async ({
    page,
}) => {
    test.setTimeout(60_000)
    const projectId = await createProject(page)
    const catalog = await (await page.request.get('/api/channel-profile-presets')).json()
    const latest = catalog.presets.find((item: { id: string }) => item.id === 'linkedin').profile
    expect(latest.capabilities.mediaFields[0].maxItems).toBe(20)
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await page.getByRole('radio', { name: 'Custom runtime profile', exact: true }).click()
    await page.getByRole('combobox', { name: 'Starter template', exact: true }).click()
    await page.getByRole('option', { name: 'LinkedIn post', exact: true }).click()
    const old = JSON.parse(await page.getByLabel('Custom profile JSON').inputValue())
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    old.version = 2
    old.origin = 'custom'
    old.contentSchema.$schema = 'https://json-schema.org/draft/2020-12/schema'
    old.profileHash = 'sha256:herald-linkedin-member-post-v2'
    old.schemaHash = 'sha256:herald-linkedin-member-post-schema-v2'
    old.execution.revision = 'member-post-v2'
    old.capabilities.revision = 'linkedin-member-post-v2'
    old.contentSchema.properties.media.maxItems = 1
    old.capabilities.mediaFields[0].maxItems = 1
    const made = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'LinkedIn images', profile: old },
    })
    expect(made.status(), await made.text()).toBe(201)
    const channelId = (await made.json()).channel.id
    const filenames = ['first-linkedin.png', 'second-linkedin.png', 'third-linkedin.png']
    const assets: string[] = []
    for (const filename of filenames) assets.push(await createMediaAsset(page, projectId, filename))
    const created = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: {
                body: { format: 'plain_text', text: 'Historical single image' },
                media: [{ assetId: assets[0] }],
            },
            publications: [{ channelId, deliveryMode: 'manual' }],
        },
    })
    expect(created.status()).toBe(201)
    const historical = (await created.json()).publications[0]
    const historicalUrl = `/api/projects/${projectId}/publications/${historical.id}`
    const prior = (await (await page.request.get(`${historicalUrl}/editor`)).json()).editor
    const scheduledAt = Date.now() + 1000
    expect(
        (
            await page.request.post(`${historicalUrl}/draft/promote`, {
                data: { expectedRevision: prior.draft.revision, scheduledAt },
            })
        ).status()
    ).toBe(200)
    await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(scheduledAt)
    expect((await page.request.post(`${historicalUrl}/publish`, { data: {} })).status()).toBe(200)
    const selected = (await (await page.request.get(`${historicalUrl}/editor`)).json()).editor
        .selectedTarget

    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Manage LinkedIn images', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Load latest LinkedIn template', exact: true }).click()
    await expect(dialog.getByLabel('Profile JSON', { exact: true })).toHaveValue(/member-post-v4/)
    // Loading the template is a local draft action, never an activation.
    const profileUrl = `/api/projects/${projectId}/channels/${channelId}/profile`
    expect(
        (await (await page.request.get(profileUrl)).json()).active.profile.execution.revision
    ).toBe('member-post-v2')
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    await expect(
        dialog.getByRole('button', { name: 'Review activation', exact: true })
    ).toBeEnabled()
    await dialog.getByRole('button', { name: 'Review activation', exact: true }).click()
    await dialog.getByRole('button', { name: 'Confirm activation', exact: true }).click()
    await expect(
        dialog.getByRole('heading', { name: 'LinkedIn images profile activated', exact: true })
    ).toBeVisible()
    expect(
        (await (await page.request.get(profileUrl)).json()).active.profile.execution.revision
    ).toBe('member-post-v4')
    expect(
        (await (await page.request.get(`${historicalUrl}/editor`)).json()).editor.selectedTarget
    ).toEqual(selected)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Three images in order')
    await page.getByRole('button', { name: 'Add media', exact: true }).click()
    const library = page.locator('[data-media-library="true"]')
    for (const filename of filenames)
        await library
            .locator('article')
            .filter({ hasText: filename })
            .locator('[data-media-selection-toggle]')
            .click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('[data-media-selection-preview="true"]')).toHaveCount(3)
    await expect(page.locator('[data-preview-platform="linkedin"] img')).toHaveCount(4)
    const saving = page.waitForResponse(
        response => response.url().endsWith('/posts') && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    const result = await saving
    expect(result.status()).toBe(201)
    const post = await result.json()
    const publication = post.publications[0]
    const editor = (
        await (
            await page.request.get(
                `/api/projects/${projectId}/publications/${publication.id}/editor`
            )
        ).json()
    ).editor
    expect(editor.draft.content.media.map((item: { assetId: string }) => item.assetId)).toEqual(
        assets
    )
    expect(
        editor.draft.content.media.map(
            (item: { accessibilityText: string }) => item.accessibilityText
        )
    ).toEqual(filenames.map(filename => `Alt text for ${filename}`))
    expect(editor.profile.profile.execution.revision).toBe('member-post-v4')
})

for (const [platform, revision] of [
    ['linkedin', 'member-post-v4'],
    ['mastodon', 'status-v2'],
    ['discord', 'message-v2'],
    ['bluesky', 'post-v2'],
] as const) {
    test(`imports and plays a native ${platform} MP4 and preserves it in the destination draft`, async ({
        page,
    }, info) => {
        const projectId = await createProject(page)
        const channel = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: { name: `${platform} video`, profile: platform },
        })
        expect(channel.status()).toBe(201)
        const bytes = await readFile(
            new URL('../packages/db/src/fixtures/video-h264.mp4', import.meta.url)
        )
        const reservation = await page.request.post(`/api/projects/${projectId}/media/uploads`, {
            data: {
                originalFilename: 'native-video.mp4',
                contentType: 'video/mp4',
                expectedSize: bytes.length,
                ...(platform === 'mastodon' ? { defaultAccessibilityText: 'A moving scene' } : {}),
            },
        })
        expect(reservation.status()).toBe(201)
        const intent = (await reservation.json()).upload.intentId
        expect(
            (
                await page.request.put(`/api/projects/${projectId}/media/uploads/${intent}`, {
                    data: bytes,
                })
            ).status()
        ).toBe(200)
        const finalized = await page.request.post(
            `/api/projects/${projectId}/media/uploads/${intent}/finalize`
        )
        expect(finalized.status()).toBe(200)
        const asset = (await finalized.json()).media
        expect(asset.representations[0]).toMatchObject({
            family: 'video',
            durationMs: 4000,
            detectedContentType: 'video/mp4',
        })
        await page.goto(`/dashboard/projects/${projectId}/publications/new`)
        await page
            .getByRole('textbox', { name: 'Content', exact: true })
            .fill(`A native ${platform} video`)
        await page.getByRole('button', { name: 'Add media', exact: true }).click()
        const card = page
            .locator('[data-media-library="true"] article')
            .filter({ hasText: 'native-video.mp4' })
        await expect(card.locator('video')).toHaveCount(0)
        await expect(card.locator('img, [data-video-placeholder]')).toHaveCount(1)
        await card.locator('[data-media-selection-toggle]').click()
        await page.getByRole('button', { name: 'Done', exact: true }).click()
        if (platform === 'discord' || platform === 'bluesky') {
            await page
                .getByRole('textbox', { name: 'Accessibility text', exact: true })
                .fill('A moving scene')
        }
        const video = page.locator(`[data-preview-platform="${platform}"] video`)
        await expect(video).toHaveAttribute('controls', '')
        await expect
            .poll(() => video.evaluate((element: HTMLVideoElement) => element.duration))
            .toBe(4)
        await video.evaluate(async (element: HTMLVideoElement) => {
            element.muted = true
            await element.play()
        })
        await expect
            .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
            .toBeGreaterThan(0)
        await video.evaluate((element: HTMLVideoElement) => {
            element.pause()
            element.currentTime = 2
        })
        await expect
            .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
            .toBe(2)
        for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await expect(video).toBeVisible()
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
            ).toBe(true)
            await page.screenshot({ path: info.outputPath(`${platform}-video-${width}.png`) })
        }
        const saving = page.waitForResponse(
            response => response.url().endsWith('/posts') && response.request().method() === 'POST'
        )
        await page.getByRole('button', { name: 'Create draft', exact: true }).click()
        const saved = await saving
        expect(saved.status()).toBe(201)
        const publication = (await saved.json()).publications[0]
        const editor = (
            await (
                await page.request.get(
                    `/api/projects/${projectId}/publications/${publication.id}/editor`
                )
            ).json()
        ).editor
        expect(editor.draft.content.media).toEqual([
            {
                assetId: asset.asset.id,
                ...(platform !== 'linkedin' ? { accessibilityText: 'A moving scene' } : {}),
            },
        ])
        expect(editor.profile.profile.execution.revision).toBe(revision)
        if (platform === 'discord' || platform === 'bluesky') {
            await page.goto(`/dashboard/projects/${projectId}/publications/${publication.id}`)
            const targetSection = page
                .locator('details')
                .filter({ has: page.getByText('Customize for this channel', { exact: true }) })
            await page.getByText('Customize for this channel', { exact: true }).click()
            const description = targetSection.getByRole('textbox', {
                name: 'Accessibility text',
                exact: true,
            })
            await expect(description).toHaveValue('A moving scene')
            const savedDescription = page.waitForResponse(
                response =>
                    response.request().method() === 'PATCH' && response.url().includes('/draft')
            )
            await description.fill('Destination video description')
            await savedDescription
            const updated = await (
                await page.request.get(
                    `/api/projects/${projectId}/publications/${publication.id}/editor`
                )
            ).json()
            expect(updated.editor.draft.content.media[0].accessibilityText).toBe(
                'Destination video description'
            )
        }
    })
}

test('adds a destination draft to the existing post with explicit repeated-channel confirmation', async ({
    page,
}, info) => {
    const projectId = await createProject(page)
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Reuse manual' },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    const createdResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: {
                body: { text: 'Source for another destination', format: 'plain_text' },
                media: [],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(createdResponse.status()).toBe(201)
    const created = await createdResponse.json()
    await page.goto(`/dashboard/projects/${projectId}/publications/${created.publications[0].id}`)
    await page.getByRole('button', { name: 'Add destination', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox', { name: 'Channel', exact: true }).click()
    await page.getByRole('option', { name: 'Reuse manual', exact: true }).click()
    await expect(dialog).toContainText('This post already has a publication for this channel.')
    await dialog.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(
        dialog.getByRole('button', { name: 'Confirm another draft', exact: true })
    ).toBeVisible()
    const before = await (
        await page.request.get(`/api/projects/${projectId}/publications?limit=100`)
    ).json()
    expect(before.publications).toHaveLength(1)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('add-destination-narrow.png') })
    const submitted = page.waitForResponse(
        response =>
            response.url().endsWith(`/posts/${created.post.id}/destinations`) &&
            response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Confirm another draft', exact: true }).click()
    expect((await submitted).status()).toBe(201)
    const added = await (await submitted).json()
    await expect(page).toHaveURL(new RegExp(`/publications/${added.publications[0].id}$`))
    expect(added.publications[0]).toMatchObject({
        postId: created.post.id,
        state: 'draft',
        scheduledAt: null,
    })
    const existing = await (
        await page.request.get(
            `/api/projects/${projectId}/publications/${created.publications[0].id}/editor`
        )
    ).json()
    expect(existing.editor.publication.state).toBe('draft')
    expect(existing.editor.post.sourceRevision).toBe(1)
})

test('keeps partial tag-assignment feedback visible after reaching the created post', async ({
    page,
}) => {
    const projectId = await createProject(page)
    expect(
        (
            await page.request.post(`/api/projects/${projectId}/channels`, {
                data: { name: 'Tagged destination' },
            })
        ).status()
    ).toBe(201)
    expect(
        (
            await page.request.post(`/api/projects/${projectId}/tags`, {
                data: { name: 'Campaign' },
            })
        ).status()
    ).toBe(201)
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    await page
        .getByRole('textbox', { name: 'Content', exact: true })
        .fill('A created post with a tag warning')
    await page.getByRole('button', { name: 'No tags', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Campaign', exact: true }).click()
    await page.keyboard.press('Escape')
    let creations = 0
    page.on('request', request => {
        if (request.method() === 'POST' && request.url().endsWith('/posts')) creations++
    })
    await page.route(`**/api/projects/${projectId}/publications/*/tags`, route =>
        route.request().method() === 'PUT'
            ? route.fulfill({
                  status: 503,
                  contentType: 'application/json',
                  body: JSON.stringify({ error: 'Tag service unavailable' }),
              })
            : route.continue()
    )
    const creation = page.waitForResponse(
        response => response.url().endsWith('/posts') && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    const response = await creation
    expect(response.status()).toBe(201)
    const created = await response.json()
    await expect(page).toHaveURL(new RegExp(`/posts/${created.post.id}$`))
    await expect(page.locator('[data-slot="toast"]')).toContainText(
        'Publication created, but its tags could not be saved.'
    )
    await expect(
        page
            .getByRole('region', { name: 'Destinations', exact: true })
            .locator('a[data-publication-edit-link]')
    ).toHaveCount(1)
    expect(creations).toBe(1)
})
