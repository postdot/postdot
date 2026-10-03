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

    await page.getByRole('button', { name: 'Add media', exact: true }).click()
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
        .toEqual({ source: 'Updated common copy', target: '## ~~Updated article~~', media: 1 })
    await page.reload()
    await expect(sourceBody).toHaveText('Updated common copy')
    await openCustomization(page, articleField)
    await expect(articleBody.locator('s')).toHaveText('Updated article')
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
    await expect(articleField.locator('textarea')).toHaveValue('## ~~Updated article~~')

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
