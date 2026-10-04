import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import type { PublicationEditorState } from '@herald/client'
import { expect, test, type Page } from '@playwright/test'

test('rebases a stale sibling draft without replacing destination text or attachments', async ({
    page,
    browser,
}, info) => {
    test.setTimeout(90_000)
    const pair = await createDraftPair(page)
    const otherContext = await browser.newContext({
        storageState: await page.context().storageState(),
    })
    const other = await otherContext.newPage()
    try {
        await page.goto(pair.pageUrl(pair.first))
        await other.goto(pair.pageUrl(pair.second))
        const before = await pair.read(other, pair.second)
        await openCustomization(other)
        await expect(
            other.locator('[data-target-field="text"] [contenteditable="true"]')
        ).toHaveText('Second destination')
        await page.locator('#source-body').fill('New common source')
        await expect
            .poll(async () => (await pair.read(page, pair.first)).post.sourceRevision)
            .toBe(2)
        await expect(page.locator('[data-publication-conflict="true"]')).toHaveCount(0)
        const conflict = other.locator('[data-publication-conflict="true"]')
        await expect(conflict).toBeVisible({ timeout: 10_000 })
        await expect(conflict).toContainText('Initial common source')
        await expect(conflict).toContainText('New common source')
        await expect(
            other.getByRole('button', { name: 'Apply to channel', exact: true })
        ).toBeDisabled()
        await conflict.scrollIntoViewIfNeeded()
        await other.screenshot({
            path: info.outputPath('source-conflict-before.png'),
            fullPage: true,
        })
        const stale = await pair.read(other, pair.second)
        expect(stale.draft.content).toEqual(before.draft.content)
        expect(stale.draft.sourceRevision).toBe(1)
        expect(stale.post.sourceRevision).toBe(2)
        const rebased = other.waitForResponse(
            response =>
                response.url().endsWith('/draft/rebase') && response.request().method() === 'POST'
        )
        await conflict
            .getByRole('button', { name: 'Rebase draft to current source', exact: true })
            .click()
        expect((await rebased).ok()).toBe(true)
        await expect(conflict).toHaveCount(0)
        await expect(other.locator('#source-body')).toHaveText('New common source')
        await expect(other.locator('[data-publication-recovery-decision]')).toHaveCount(0)
        const after = await pair.read(other, pair.second)
        expect(after.draft.content).toEqual(before.draft.content)
        expect(after.draft.sourceRevision).toBe(2)
        expect(after.draft.baseSourceContent).toEqual(after.post.sourceContent)
        expect(after.selectedTarget).toEqual(before.selectedTarget)
        expect(after.publication).toMatchObject({
            state: before.publication.state,
            scheduledAt: before.publication.scheduledAt,
            deliveryMode: before.publication.deliveryMode,
        })
        await other.reload()
        await openCustomization(other)
        await expect(
            other.locator('[data-target-field="text"] [contenteditable="true"]')
        ).toHaveText('Second destination')
        await expect(
            other.locator('[data-target-field="media"] [data-media-selection-preview]')
        ).toHaveCount(1)
        await other.setViewportSize({ width: 390, height: 900 })
        await other.locator('[data-target-field="media"]').scrollIntoViewIfNeeded()
        expect((await new AxeBuilder({ page: other }).analyze()).violations).toEqual([])
        await other.screenshot({
            path: info.outputPath('rebased-destination-mobile.png'),
            fullPage: true,
        })
    } finally {
        await otherContext.close()
    }
})

test('recovers unsaved destination changes after another session saves a newer draft', async ({
    page,
    browser,
}, info) => {
    test.setTimeout(90_000)
    const pair = await createDraftPair(page)
    const otherContext = await browser.newContext({
        storageState: await page.context().storageState(),
    })
    const other = await otherContext.newPage()
    try {
        await page.goto(pair.pageUrl(pair.first))
        await other.goto(pair.pageUrl(pair.first))
        await openCustomization(page)
        await openCustomization(other)
        const draftUrl = `**/api/projects/${pair.id}/publications/${pair.first}/draft`
        await other.route(draftUrl, route => route.abort('failed'))
        const local = other.locator('[data-target-field="text"] [contenteditable="true"]')
        await local.fill('Local destination adaptation')
        await other
            .locator('[data-target-field="media"]')
            .getByRole('button', { name: 'Remove second.png', exact: true })
            .click()
        const key = `herald:publication-editor:v3:${pair.id}:${pair.first}`
        await expect
            .poll(async () =>
                other.evaluate(
                    key => JSON.parse(localStorage.getItem(key) ?? 'null')?.targetText,
                    key
                )
            )
            .toContain('Local destination adaptation')
        const remote = page.locator('[data-target-field="text"] [contenteditable="true"]')
        await remote.fill('Newer saved destination')
        await expect
            .poll(async () => (await pair.read(page, pair.first)).draft.content.text)
            .toBe('Newer saved destination')
        const conflict = other.locator('[data-publication-conflict="true"]')
        await expect(conflict).toBeVisible()
        await expect(local).toHaveText('Local destination adaptation')
        await expect(
            other.getByRole('button', { name: 'Apply to channel', exact: true })
        ).toBeDisabled()
        await other.unroute(draftUrl)
        await conflict.getByRole('button', { name: 'Load server version', exact: true }).click()
        const decision = other.locator('[data-publication-recovery-decision]')
        await expect(decision).toBeVisible()
        await expect(decision).toContainText('Local destination adaptation')
        await other.screenshot({
            path: info.outputPath('local-recovery-before.png'),
            fullPage: true,
        })
        await other.keyboard.press('Escape')
        await expect(decision).toBeVisible()
        expect((await pair.read(page, pair.first)).draft.content.text).toBe(
            'Newer saved destination'
        )
        for (const width of [1280, 820, 390]) {
            await other.setViewportSize({ width, height: 900 })
            expect((await new AxeBuilder({ page: other }).analyze()).violations).toEqual([])
            await other.screenshot({
                path: info.outputPath(`local-copy-decision-${width}.png`),
                fullPage: true,
            })
        }
        await decision.getByRole('button', { name: 'Restore local copy', exact: true }).click()
        await expect(decision).toHaveCount(0)
        await expect(local).toHaveText('Local destination adaptation')
        await expect
            .poll(async () => (await pair.read(other, pair.first)).draft.content.text)
            .toBe('Local destination adaptation')
        const recovered = await pair.read(other, pair.first)
        expect(recovered.post.sourceRevision).toBe(1)
        expect(recovered.post.sourceContent).toEqual(pair.source)
        expect(recovered.draft.content.media).toEqual([pair.source.media[0]])
        expect((await pair.read(page, pair.second)).draft.content.text).toBe('Second destination')
        await other.reload()
        await openCustomization(other)
        await expect(local).toHaveText('Local destination adaptation')
        await expect(
            other.locator('[data-target-field="media"] [data-media-selection-preview]')
        ).toHaveCount(1)
    } finally {
        await otherContext.close()
    }
})

test('exposes reconciliation when a server refresh overtakes an in-flight autosave', async ({
    page,
    browser,
}) => {
    test.setTimeout(90_000)
    const pair = await createDraftPair(page)
    const otherContext = await browser.newContext({
        storageState: await page.context().storageState(),
    })
    const other = await otherContext.newPage()
    let releaseSave: (() => void) | undefined
    const heldSave = new Promise<void>(resolve => {
        releaseSave = resolve
    })
    let saveStarted: (() => void) | undefined
    const startedSave = new Promise<void>(resolve => {
        saveStarted = resolve
    })
    try {
        await other.goto(pair.pageUrl(pair.first))
        await openCustomization(other)
        await other.route(
            `**/api/projects/${pair.id}/publications/${pair.first}/draft`,
            async route => {
                saveStarted?.()
                await heldSave
                await route.continue()
            }
        )
        const local = other.locator('[data-target-field="text"] [contenteditable="true"]')
        await local.fill('In-flight local destination')
        await startedSave
        const before = await pair.read(page, pair.first)
        const incoming = other.waitForResponse(async response => {
            if (!response.url().endsWith(`/publications/${pair.first}/editor`)) return false
            return (await response.json()).editor.draft.revision > before.draft.revision
        })
        const remoteSave = await page.request.patch(
            `/api/projects/${pair.id}/publications/${pair.first}/draft`,
            {
                data: {
                    expectedRevision: before.draft.revision,
                    sourceContent: {
                        ...pair.source,
                        body: { format: 'plain_text', text: 'Concurrent source' },
                    },
                    targetContent: {
                        ...before.draft.content,
                        text: 'Concurrent saved destination',
                    },
                },
            }
        )
        expect(remoteSave.ok()).toBe(true)
        await incoming
        releaseSave?.()
        await expect(other.locator('[data-publication-conflict="true"]')).toBeVisible()
        await expect(local).toHaveText('In-flight local destination')
        await expect(
            other.getByRole('button', { name: 'Apply to channel', exact: true })
        ).toBeDisabled()
        expect((await pair.read(page, pair.first)).draft.content.text).toBe(
            'Concurrent saved destination'
        )
        const key = `herald:publication-editor:v3:${pair.id}:${pair.first}`
        await expect
            .poll(async () =>
                other.evaluate(
                    key => JSON.parse(localStorage.getItem(key) ?? 'null')?.targetText,
                    key
                )
            )
            .toContain('In-flight local destination')
    } finally {
        releaseSave?.()
        await otherContext.close()
    }
})

test('catches up missed draft signals on visibility return and SSE reconnect', async ({
    page,
    browser,
}) => {
    test.setTimeout(90_000)
    const pair = await createDraftPair(page)
    const context = await browser.newContext({ storageState: await page.context().storageState() })
    const other = await context.newPage()
    const editorUrl = `/publications/${pair.first}/editor`
    try {
        let reads = 0
        other.on('request', request => {
            if (request.url().endsWith(editorUrl)) reads += 1
        })
        await other.goto(pair.pageUrl(pair.first))
        await expect.poll(() => reads).toBeGreaterThanOrEqual(1)
        await expect(other.locator('#source-body')).toHaveText('Initial common source')
        // Let the existing journal replay refresh retries settle before measuring hidden draft reads.
        await other.waitForTimeout(1500)
        reads = 0
        await other.evaluate(() =>
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'hidden',
            })
        )
        const before = await pair.read(page, pair.first)
        const saved = await page.request.patch(
            `/api/projects/${pair.id}/publications/${pair.first}/draft`,
            {
                data: {
                    expectedRevision: before.draft.revision,
                    sourceContent: {
                        ...pair.source,
                        body: { format: 'plain_text', text: 'Changed while hidden' },
                    },
                    targetContent: before.draft.content,
                },
            }
        )
        expect(saved.ok()).toBe(true)
        await other.waitForTimeout(700)
        expect(reads).toBe(0)
        await other.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'visible',
            })
            document.dispatchEvent(new Event('visibilitychange'))
        })
        await expect(other.locator('#source-body')).toHaveText('Changed while hidden')
        await context.setOffline(true)
        await other.waitForTimeout(700)
        const newer = await pair.read(page, pair.first)
        const offlineSave = await page.request.patch(
            `/api/projects/${pair.id}/publications/${pair.first}/draft`,
            {
                data: {
                    expectedRevision: newer.draft.revision,
                    sourceContent: {
                        ...pair.source,
                        body: { format: 'plain_text', text: 'Changed while disconnected' },
                    },
                    targetContent: newer.draft.content,
                },
            }
        )
        expect(offlineSave.ok()).toBe(true)
        await context.setOffline(false)
        await expect(other.locator('#source-body')).toHaveText('Changed while disconnected', {
            timeout: 15_000,
        })
        await expect(other.locator('[data-publication-conflict="true"]')).toHaveCount(0)
    } finally {
        await context.close()
    }
})

async function openCustomization(page: Page) {
    const details = page.locator('[data-publication-customization="true"]')
    if ((await details.getAttribute('open')) === null)
        await details.locator(':scope > summary').click()
    await expect(details.locator('[data-target-field="text"]')).toBeVisible()
}

async function createDraftPair(page: Page) {
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/')
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Concurrent editor owner')
    await page.getByLabel('Email', { exact: true }).fill(`concurrent-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('concurrent-editor-password')
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
        .fill('Concurrent project')
    await dialog.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    const id = new URL(page.url()).pathname.split('/')[3]!
    const channels: string[] = []
    for (const name of ['First channel', 'Second channel']) {
        const response = await page.request.post(`/api/projects/${id}/channels`, {
            data: { name, profile: 'discord' },
        })
        expect(response.ok()).toBe(true)
        channels.push((await response.json()).channel.id)
    }
    await page.goto(`/dashboard/projects/${id}/publications/new`)
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
    const assets = (await (await page.request.get(`/api/projects/${id}/media`)).json()).media as {
        asset: { id: string; originalFilename: string }
    }[]
    const media = ['first.png', 'second.png'].map(filename => ({
        assetId: assets.find(item => item.asset.originalFilename === filename)!.asset.id,
        accessibilityText: filename,
    }))
    const source = { body: { format: 'plain_text' as const, text: 'Initial common source' }, media }
    const response = await page.request.post(`/api/projects/${id}/posts`, {
        data: {
            sourceContent: source,
            publications: channels.map((channelId, index) => ({
                channelId,
                deliveryMode: 'manual',
                targetContent: {
                    text: index === 0 ? 'First destination' : 'Second destination',
                    media: index === 0 ? media : [media[1]],
                },
            })),
        },
    })
    expect(response.ok()).toBe(true)
    const { publications } = await response.json()
    return {
        id,
        source,
        first: publications[0].id as string,
        second: publications[1].id as string,
        pageUrl: (publicationId: string) =>
            `/dashboard/projects/${id}/publications/${publicationId}`,
        read: async (page: Page, publicationId: string): Promise<PublicationEditorState> => {
            const response = await page.request.get(
                `/api/projects/${id}/publications/${publicationId}/editor`
            )
            expect(response.ok()).toBe(true)
            return (await response.json()).editor
        },
    }
}
