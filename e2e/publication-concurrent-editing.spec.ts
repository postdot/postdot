import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import type { PublicationEditorState } from '@postdot/client'

import {
    composerText,
    openAllChannels,
    openContentOptions,
    saveButton,
} from './support/post-editor'

// Seeded local copies are written in UTC; the project must share that time zone.
test.use({ timezoneId: 'UTC' })

test('shows one calm notice for a stale sibling and keeps its text and attachments', async ({
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
        await expect(composerText(other)).toHaveText('Second destination')
        // A change made elsewhere (here the API) leaves a channel with its own text behind.
        // Changes made in the post editor carry every channel along (SPEC-013).
        const changedElsewhere = await page.request.patch(
            `/api/projects/${pair.id}/posts/${before.post.id}`,
            {
                data: {
                    expectedSourceRevision: 1,
                    sourceContent: {
                        ...pair.source,
                        body: { format: 'plain_text', text: 'New common source' },
                    },
                },
            }
        )
        expect(changedElsewhere.ok()).toBe(true)
        await expect
            .poll(async () => (await pair.read(page, pair.first)).post.sourceRevision)
            .toBe(2)
        // The first channel keeps its own version, so only the second one stays behind.
        const first = await pair.read(page, pair.first)
        const kept = await page.request.post(
            `/api/projects/${pair.id}/publications/${pair.first}/draft/rebase`,
            {
                data: {
                    expectedRevision: first.draft.revision,
                    expectedSourceRevision: 2,
                    replaceContent: false,
                },
            }
        )
        expect(kept.ok()).toBe(true)
        await expect(page.locator('[data-publication-conflict="true"]')).toHaveCount(0)
        const notice = other.getByText(
            'The post changed. 1 channel still uses the previous version.',
            { exact: true }
        )
        await expect(notice).toBeVisible({ timeout: 10_000 })
        // A quiet "changed elsewhere" line may appear; nothing asks for attention.
        await expect(
            other.locator('[data-publication-editor-message]:not([data-passive-update])')
        ).toHaveCount(0)
        await expect(other.locator('[data-publication-conflict]')).toHaveCount(0)
        await expect(other.getByRole('status', { name: 'Conflict', exact: true })).toHaveCount(0)
        await expect(
            other.getByRole('button', { name: 'Review the changes', exact: true })
        ).toHaveCount(0)
        await expect(other.locator('[data-post-save]')).toBeDisabled()
        for (const width of [1440, 390]) {
            await other.setViewportSize({ width, height: 900 })
            await notice.scrollIntoViewIfNeeded()
            expect((await new AxeBuilder({ page: other }).analyze()).violations).toEqual([])
            await other.screenshot({
                path: info.outputPath(`stale-notice-${width}.png`),
                fullPage: true,
            })
        }
        const stale = await pair.read(other, pair.second)
        expect(stale.draft.content).toEqual(before.draft.content)
        expect(stale.draft.sourceRevision).toBe(1)
        expect(stale.post.sourceRevision).toBe(2)
        const rebased = other.waitForResponse(
            response =>
                response.url().endsWith('/draft/rebase') && response.request().method() === 'POST'
        )
        await other.getByRole('button', { name: 'Review and update', exact: true }).click()
        const review = other.getByRole('dialog', { name: 'Update channel versions', exact: true })
        await review
            .getByRole('region', { name: 'Second channel', exact: true })
            .getByRole('checkbox')
            .uncheck()
        await review
            .getByRole('region', { name: 'Second channel', exact: true })
            .getByRole('button', { name: 'Keep this version', exact: true })
            .click()
        const acknowledgement = await rebased
        expect(acknowledgement.ok()).toBe(true)
        expect(acknowledgement.request().postDataJSON()).toMatchObject({
            expectedSourceRevision: 2,
            replaceContent: false,
        })
        await expect(review).toContainText('Second channel already up to date.')
        await review.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(notice).toHaveCount(0)
        await expect(await postText(other)).toHaveText('New common source')
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
        await expect(
            other.getByRole('button', { name: 'Review and update', exact: true })
        ).toHaveCount(0)
        await openCustomization(other)
        await expect(composerText(other)).toHaveText('Second destination')
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
        const draftUrl = `**/api/projects/${pair.id}/posts/*/composition`
        await other.route(draftUrl, route => route.abort('failed'))
        const local = composerText(other)
        await local.fill('Local destination adaptation')
        await other
            .locator('[data-target-field="media"]')
            .getByRole('button', { name: 'Remove second.png', exact: true })
            .click()
        const key = `postdot:publication-editor:v3:${pair.id}:${pair.first}`
        // The post editor keeps one local copy per post (SPEC-013).
        await expect.poll(async () => localCopy(other)).toContain('Local destination adaptation')
        const remote = composerText(page)
        await remote.fill('Newer saved destination')
        await expect
            .poll(async () => (await pair.read(page, pair.first)).draft.content.text)
            .toBe('Newer saved destination')
        const conflict = other.locator('[data-publication-conflict="true"]')
        await expect(conflict).toBeVisible()
        await expect(other.locator('[data-publication-editor-message]')).toHaveAttribute(
            'role',
            'alert'
        )
        await expect(other.getByRole('status', { name: 'Conflict', exact: true })).toBeVisible()
        await expect(
            other.getByRole('button', { name: 'Review the changes', exact: true })
        ).toBeVisible()
        await expect(local).toHaveText('Local destination adaptation')
        await expect(other.locator('[data-post-save]')).toBeDisabled()
        await other.unroute(draftUrl)
        await conflict.getByRole('button', { name: 'Load the saved version', exact: true }).click()
        const decision = other.locator('[data-publication-recovery-decision]')
        await expect(decision).toBeVisible()
        await expect(decision).toContainText('Local destination adaptation')
        await expect(decision.locator('[data-recovery-version="saved"]')).toContainText(
            'Newer saved destination'
        )
        await expect(decision.locator('[data-recovery-version="local"]')).toContainText(
            'Local destination adaptation'
        )
        await expect(decision.locator('[data-recovery-version="saved"] img')).toHaveCount(2)
        await expect(decision.locator('[data-recovery-version="local"] img')).toHaveCount(1)
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
        const saved = await pair.read(other, pair.first)
        await other.evaluate(
            ({ key, buffer }) => {
                localStorage.setItem(key, JSON.stringify(buffer))
                localStorage.setItem('postdot-theme', 'light')
            },
            {
                key,
                buffer: {
                    version: 3,
                    baseRevision: saved.draft.revision - 1,
                    sourceContent: saved.post.sourceContent,
                    targetText: JSON.stringify({ ...saved.draft.content, media: [] }),
                    scheduleValue: '',
                    timeZone: 'UTC',
                },
            }
        )
        await other.reload()
        await expect(decision).toBeVisible()
        await expect(decision.locator('[data-recovery-version="saved"] img')).toHaveCount(1)
        await expect(decision.locator('[data-recovery-version="local"] img')).toHaveCount(0)
        await expect(decision.locator('[data-recovery-version="local"]')).toContainText(
            'Local destination adaptation'
        )
        expect((await new AxeBuilder({ page: other }).analyze()).violations).toEqual([])
        await other.screenshot({
            path: info.outputPath('media-only-local-copy-light-mobile.png'),
            fullPage: true,
        })
        await decision.getByRole('button', { name: 'Discard local copy', exact: true }).click()
        await expect(decision).toHaveCount(0)
        expect((await pair.read(other, pair.first)).draft.content).toEqual(saved.draft.content)
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
        await other.route(`**/api/projects/${pair.id}/posts/*/composition`, async route => {
            saveStarted?.()
            await heldSave
            await route.continue()
        })
        const local = composerText(other)
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
        await expect(other.locator('[data-publication-editor-message]')).toHaveAttribute(
            'role',
            'alert'
        )
        await expect(other.getByRole('status', { name: 'Conflict', exact: true })).toBeVisible()
        await expect(
            other.getByRole('button', { name: 'Review the changes', exact: true })
        ).toBeVisible()
        await expect(local).toHaveText('In-flight local destination')
        await expect(other.locator('[data-post-save]')).toBeDisabled()
        expect((await pair.read(page, pair.first)).draft.content.text).toBe(
            'Concurrent saved destination'
        )
        await expect.poll(async () => localCopy(other)).toContain('In-flight local destination')
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
    const reads = observeProjectReads(other, editorUrl)
    try {
        await other.goto(pair.pageUrl(pair.first))
        await expect.poll(() => reads.count).toBeGreaterThanOrEqual(1)
        const text = await postText(other)
        await expect(text).toHaveText('Initial common source')
        // The project stream replays journal events on connect and every replayed event
        // fans out project reads, so wait for that fan-out to become observably idle
        // before hiding. A fixed sleep no longer covers the replay retries.
        await reads.waitForQuiescence()
        reads.reset()
        await other.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'hidden',
            })
            document.dispatchEvent(new Event('visibilitychange'))
        })
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
        expect(reads.count).toBe(0)
        await other.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'visible',
            })
            document.dispatchEvent(new Event('visibilitychange'))
        })
        await expect(text).toHaveText('Changed while hidden')
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
        await expect(text).toHaveText('Changed while disconnected', {
            timeout: 15_000,
        })
        await expect(other.locator('[data-publication-conflict="true"]')).toHaveCount(0)
    } finally {
        reads.dispose()
        await context.close()
    }
})

// SPEC-013: a channel tab edits the channel text in its editor and keeps media and other
// channel fields in Content options.
async function openCustomization(page: Page) {
    await expect(composerText(page)).toBeVisible()
    await openContentOptions(page)
}

/** The post text, on the "All channels" tab. */
async function postText(page: Page) {
    return openAllChannels(page)
}

/** Reads the post editor's local copy of this post, whatever its key. */
async function localCopy(page: Page): Promise<string> {
    return page.evaluate(() => {
        const key = Object.keys(localStorage).find(item =>
            item.startsWith('postdot:post-composition:')
        )
        return key === undefined ? '' : (localStorage.getItem(key) ?? '')
    })
}

/**
 * Counts publication editor reads and observes the project read fan-out that the
 * realtime bridge replays when the project stream connects. Only finite project
 * reads are tracked; the long-lived project event stream is excluded because it
 * never settles.
 */
function observeProjectReads(page: Page, editorUrlSuffix: string) {
    let count = 0
    let lastActivityAt = Date.now()
    let streamSeen = false
    const pending = new Set<Request>()
    const pathOf = (request: Request) => new URL(request.url()).pathname
    const isProjectRead = (request: Request) => {
        if (request.method() !== 'GET') return false
        const path = pathOf(request)
        return path.startsWith('/api/projects/') && !path.endsWith('/events')
    }
    const isProjectStream = (request: Request) => {
        if (request.method() !== 'GET') return false
        const path = pathOf(request)
        return path.startsWith('/api/projects/') && path.endsWith('/events')
    }
    const onRequest = (request: Request) => {
        if (request.url().endsWith(editorUrlSuffix)) count += 1
        if (isProjectRead(request)) pending.add(request)
        // Include stream startup in the observed activity before measuring idle time.
        else if (isProjectStream(request)) {
            streamSeen = true
            lastActivityAt = Date.now()
        }
    }
    const onFinished = (request: Request) => {
        if (!pending.delete(request)) return
        lastActivityAt = Date.now()
    }
    page.on('request', onRequest)
    page.on('requestfinished', onFinished)
    // cspell:disable-next-line
    page.on('requestfailed', onFinished)
    return {
        get count() {
            return count
        },
        reset() {
            count = 0
        },
        async waitForQuiescence() {
            // The quiet window has to outlast the longest refresh retry leg (800ms).
            const quietMs = 1500
            const timeoutMs = 20_000
            const deadline = Date.now() + timeoutMs
            while (Date.now() < deadline) {
                if (streamSeen && pending.size === 0 && Date.now() - lastActivityAt >= quietMs)
                    return
                await new Promise(resolve => setTimeout(resolve, 50))
            }
            throw new Error(
                `Project reads did not settle within ${timeoutMs}ms (stream connected: ${streamSeen}, in flight: ${pending.size})`
            )
        },
        dispose() {
            page.off('request', onRequest)
            page.off('requestfinished', onFinished)
            // cspell:disable-next-line
            page.off('requestfailed', onFinished)
        },
    }
}

for (const scheduled of [false, true]) {
    test(`applies a ${scheduled ? 'scheduled' : 'draft'} version once while protecting in-flight editing`, async ({
        page,
    }, info) => {
        const pair = await createDraftPair(page)
        const scheduledAt = scheduled ? Date.now() + 86_400_000 : null
        if (scheduled) {
            const before = await pair.read(page, pair.first)
            const seeded = await page.request.post(
                `/api/projects/${pair.id}/publications/${pair.first}/draft/promote`,
                { data: { expectedRevision: before.draft.revision, scheduledAt } }
            )
            expect(seeded.ok()).toBe(true)
        }
        await page.goto(pair.pageUrl(pair.first))
        await openCustomization(page)
        await composerText(page).fill('Version to apply')
        await expect
            .poll(async () => (await pair.read(page, pair.first)).draft.content.text)
            .toBe('Version to apply')
        const before = await pair.read(page, pair.first)
        let release: (() => void) | undefined
        const held = new Promise<void>(resolve => {
            release = resolve
        })
        let requests = 0
        const routeUrl = `**/api/projects/${pair.id}/publications/${pair.first}/draft/promote`
        await page.route(routeUrl, async route => {
            requests += 1
            await held
            await route.continue()
        })
        try {
            const action = saveButton(page)
            await expect(action).toBeEnabled()
            await expect(action).toHaveText('Save')
            await action.dblclick()
            await expect(action).toBeDisabled()
            await expect(action).toHaveAttribute('aria-busy', 'true')
            await expect(action).toHaveText('Saving…')
            // One write at a time: the text stays visible but cannot change while it applies.
            await expect(composerText(page)).toHaveAttribute('contenteditable', 'false')
            expect(requests).toBe(1)
            await page.screenshot({
                path: info.outputPath(`promotion-pending-${scheduled ? 'scheduled' : 'draft'}.png`),
                fullPage: true,
            })
            release?.()
            await expect(action).toHaveAttribute('aria-busy', 'false')
            await expect(composerText(page)).toHaveAttribute('contenteditable', 'true')
            const after = await pair.read(page, pair.first)
            expect(after.selectedTarget?.content.text).toBe('Version to apply')
            expect(after.selectedTarget?.sequence).toBe((before.selectedTarget?.sequence ?? 0) + 1)
            expect(after.publication.state).toBe(scheduled ? 'scheduled' : 'draft')
            expect(after.publication.scheduledAt).toBe(before.publication.scheduledAt)
            expect(after.post.sourceContent).toEqual(before.post.sourceContent)
            // Save applies every channel with pending changes (SPEC-013); the second
            // channel's never-applied version is applied unchanged.
            const second = await pair.read(page, pair.second)
            expect(second.selectedTarget?.content).toEqual(second.draft.content)
            expect(requests).toBe(1)
            await page.unroute(routeUrl)
            if (scheduled) {
                await page
                    .getByRole('button', { name: 'First channel: When and how', exact: true })
                    .click()
                await page.locator(`#deliver-at-${pair.first}`).click()
                await page.getByRole('button', { name: 'Clear', exact: true }).click()
                await page.keyboard.press('Escape')
                await expect(action).toBeEnabled()
                await page.screenshot({
                    path: info.outputPath('return-to-draft-before-confirming.png'),
                    fullPage: true,
                })
                await action.click()
                await expect
                    .poll(async () => (await pair.read(page, pair.first)).publication.state)
                    .toBe('draft')
                const unscheduled = await pair.read(page, pair.first)
                expect(unscheduled.publication.scheduledAt).toBeNull()
                expect(unscheduled.selectedTarget?.content).toEqual(after.selectedTarget?.content)
                await expect(action).toBeDisabled()
            }
        } finally {
            release?.()
            await page.unroute(routeUrl)
        }
    })
}

for (const outcome of ['rejected', 'lost_response'] as const) {
    test(`checks server state after ${outcome} application without repeating it or losing local work`, async ({
        page,
    }, info) => {
        // Recovery checks plus three viewport accessibility/screenshot passes share this budget.
        test.setTimeout(60_000)
        const pair = await createDraftPair(page)
        await page.goto(pair.pageUrl(pair.first))
        await openCustomization(page)
        const content = composerText(page)
        await content.fill('Saved version awaiting application')
        await expect
            .poll(async () => (await pair.read(page, pair.first)).draft.content.text)
            .toBe('Saved version awaiting application')
        const saved = await pair.read(page, pair.first)
        const scheduledAt = Date.now() + 86_400_000
        const seeded = await page.request.post(
            `/api/projects/${pair.id}/publications/${pair.first}/draft/promote`,
            { data: { expectedRevision: saved.draft.revision, scheduledAt } }
        )
        expect(seeded.ok()).toBe(true)
        await page.reload()
        await openCustomization(page)
        await page.locator('#deliver-at').click()
        await page.getByRole('button', { name: 'Clear', exact: true }).click()
        const before = await pair.read(page, pair.first)
        const promotionUrl = `**/api/projects/${pair.id}/publications/${pair.first}/draft/promote`
        let applications = 0
        await page.route(promotionUrl, async route => {
            applications += 1
            if (outcome === 'rejected') {
                await route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Application unavailable', code: 'unavailable' }),
                })
            } else {
                const response = await route.fetch()
                expect(response.ok()).toBe(true)
                // Deliver the authoritative refresh while the promotion response is
                // still held, then lose that response after React presents the read.
                const refresh = page.waitForResponse(
                    response =>
                        new URL(response.url()).pathname ===
                            `/api/projects/${pair.id}/publications/${pair.first}/editor` &&
                        response.request().method() === 'GET'
                )
                await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
                await (await refresh).finished()
                await page.evaluate(
                    () =>
                        new Promise<void>(resolve =>
                            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                        )
                )
                await route.abort('failed')
            }
        })
        const action = page.locator('[data-publication-promotion-action]')
        await expect(action).toBeEnabled()
        await action.click()
        const check = page.getByRole('button', { name: 'Check server status', exact: true })
        await expect(check).toBeVisible()
        await expect(action).toBeDisabled()
        await expect(page.getByRole('status', { name: /^(Saved|Changes pending)$/ })).toBeVisible()
        await expect(content).toHaveText('Saved version awaiting application')
        const after = await pair.read(page, pair.first)
        if (outcome === 'rejected') expect(after.selectedTarget).toEqual(before.selectedTarget)
        else {
            expect(after.selectedTarget?.content.text).toBe('Saved version awaiting application')
            expect(after.selectedTarget?.sequence).toBe((before.selectedTarget?.sequence ?? 0) + 1)
        }
        expect(applications).toBe(1)
        // Continuing to edit may autosave the working draft, but must not unlock application.
        await content.fill('Later local adaptation')
        await expect
            .poll(async () => (await pair.read(page, pair.first)).draft.content.text)
            .toBe('Later local adaptation')
        await expect(action).toBeDisabled()
        await expect(check).toBeVisible()
        // A failed read must leave the check available and the editor content intact.
        // Scheduling is blocked until the unknown application result has been read.
        await expect(page.locator('#deliver-at')).toBeDisabled()
        const editorUrl = `**/api/projects/${pair.id}/publications/${pair.first}/editor`
        await page.route(editorUrl, route => route.abort('failed'))
        await check.click()
        await expect(check).toBeEnabled()
        await expect(check).toBeVisible()
        await expect(action).toBeDisabled()
        await expect(content).toHaveText('Later local adaptation')
        await page.unroute(editorUrl)
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await check.scrollIntoViewIfNeeded()
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= window.innerWidth + 1
                )
            ).toBe(true)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({
                path: info.outputPath(`application-${outcome}-${width}.png`),
                fullPage: true,
            })
        }
        // Keep an unsaved edit in recovery while reading the authoritative selected version.
        const draftUrl = `**/api/projects/${pair.id}/posts/*/composition`
        await page.route(draftUrl, route => route.abort('failed'))
        await content.fill('Unsaved local work to recover')
        await expect(page.getByRole('status', { name: 'Save failed', exact: true })).toBeVisible()
        await check.click()
        const recovery = page.locator('[data-publication-recovery-decision]')
        await expect(recovery).toBeVisible()
        await expect(recovery).toContainText('Unsaved local work to recover')
        expect(applications).toBe(1)
        await page.unroute(draftUrl)
        await recovery.getByRole('button', { name: 'Restore local copy', exact: true }).click()
        await expect(recovery).toHaveCount(0)
        await expect(content).toHaveText('Unsaved local work to recover')
        await expect
            .poll(async () => (await pair.read(page, pair.first)).draft.content.text)
            .toBe('Unsaved local work to recover')
        await expect(action).toBeEnabled()
        expect(applications).toBe(1)
        const final = await pair.read(page, pair.first)
        expect(final.selectedTarget).toEqual(after.selectedTarget)
        expect(final.publication.state).toBe(after.publication.state)
        expect(final.publication.scheduledAt).toBe(after.publication.scheduledAt)
        await expect(page.locator('#deliver-at')).toContainText('Choose a date')
        await expect(action.locator('span').first()).toHaveText(
            outcome === 'rejected' ? 'Unschedule' : 'Save changes'
        )
        expect((await pair.read(page, pair.second)).selectedTarget).toBeNull()
    })
}

// Assert the original content independently of the screen-reader change labels.
async function comparisonText(region: Locator): Promise<string> {
    return region.evaluate(element => {
        const copy = element.cloneNode(true) as HTMLElement
        for (const label of copy.querySelectorAll('.sr-only')) label.remove()
        return copy.textContent ?? ''
    })
}

async function createDraftPair(page: Page, manual = false) {
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/')
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Concurrent editor owner')
    await page.getByLabel('Email', { exact: true }).fill(`concurrent-${suffix}@postdot.local`)
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
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Concurrent project')
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    const id = new URL(page.url()).pathname.split('/')[3]!
    const channels: string[] = []
    for (const name of ['First channel', 'Second channel']) {
        const response = await page.request.post(`/api/projects/${id}/channels`, {
            data: { name, profile: manual ? 'manual-message' : 'discord' },
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
    const source = {
        body: { format: 'plain_text' as const, text: 'Initial common source' },
        ...(manual ? { headline: 'The quiet launch' } : {}),
        media: manual ? [] : media,
    }
    const response = await page.request.post(`/api/projects/${id}/posts`, {
        data: {
            sourceContent: source,
            publications: channels.map((channelId, index) => ({
                channelId,
                deliveryMode: 'manual',
                targetContent: {
                    ...(manual
                        ? { body: 'The quiet channel is ready.', headline: 'The quiet launch' }
                        : { text: index === 0 ? 'First destination' : 'Second destination' }),
                    media: manual ? [] : index === 0 ? media : [media[1]],
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

test('updates only checked stale channel versions and removes the notice when current', async ({
    page,
}, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const pair = await createDraftPair(page)
    const firstBefore = await pair.read(page, pair.first)
    const secondBefore = await pair.read(page, pair.second)
    const siblingReads: string[] = []
    page.on('request', request => {
        if (request.url().endsWith(`/publications/${pair.second}/editor`))
            siblingReads.push(request.url())
    })
    await page.goto(pair.pageUrl(pair.first))
    await expect(page.locator('#source-body')).toHaveText('Initial common source')
    await expect(page.getByRole('button', { name: 'Review and update', exact: true })).toHaveCount(
        0
    )
    await expect(
        page.getByRole('button', { name: 'Update channel versions', exact: true })
    ).toHaveCount(0)
    expect(siblingReads).toEqual([])
    const changed = await page.request.patch(
        `/api/projects/${pair.id}/posts/${firstBefore.post.id}`,
        {
            data: {
                expectedSourceRevision: 1,
                sourceContent: {
                    ...pair.source,
                    body: { text: 'Revised source for channel review', format: 'plain_text' },
                    media: [pair.source.media[0]],
                },
            },
        }
    )
    expect(changed.status()).toBe(200)
    await expect(
        page.getByText('The post changed. 2 channels still use the previous version.', {
            exact: true,
        })
    ).toBeVisible()
    expect(siblingReads).toEqual([])
    await page.getByRole('button', { name: 'Review and update', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Update channel versions', exact: true })
    const first = dialog.getByRole('region', { name: 'First channel', exact: true })
    const second = dialog.getByRole('region', { name: 'Second channel', exact: true })
    await expect(first.getByRole('checkbox')).toBeChecked()
    await expect(second.getByRole('checkbox')).toBeChecked()
    await expect(dialog.getByRole('radio')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0)
    await expect(first).toContainText('Text and media differ')
    await first.getByText('Compare', { exact: true }).click()
    await second.getByText('Compare', { exact: true }).click()
    await expect(first).toContainText('Current channel version')
    await expect(first).toContainText('2 media files')
    await expect(first).toContainText('1 media file')
    await expect.poll(() => comparisonText(first)).toContain('First destination')
    await expect.poll(() => comparisonText(second)).toContain('Second destination')
    await expect.poll(() => comparisonText(second)).toContain('Revised source for channel review')
    for (const theme of ['dark', 'light'] as const) {
        // Set the theme under the dialog without closing the review.
        await page.evaluate(theme => {
            document.documentElement.classList.toggle('dark', theme === 'dark')
            localStorage.setItem('postdot-theme', theme)
        }, theme)
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await expect(dialog).toBeVisible()
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            ).toBe(false)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            const footer = dialog.locator('[data-slot="dialog-footer"]')
            const bounds = await footer.boundingBox()
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900)
            await page.screenshot({ path: info.outputPath(`source-review-${theme}-${width}.png`) })
        }
    }
    await first.getByRole('checkbox').uncheck()
    await second.getByRole('checkbox').uncheck()
    await expect(
        dialog.getByRole('button', { name: 'Update 0 channels', exact: true })
    ).toBeDisabled()
    await second.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Update 1 channel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const replaced = await pair.read(page, pair.second)
    expect(replaced.draft.sourceRevision).toBe(2)
    expect(replaced.draft.content.text).toBe('Revised source for channel review')
    expect(replaced.draft.content.media).toEqual([pair.source.media[0]])
    expect(replaced.selectedTarget).toEqual(secondBefore.selectedTarget)
    expect(replaced.publication).toEqual(secondBefore.publication)
    expect((await pair.read(page, pair.first)).draft).toEqual(firstBefore.draft)
    await expect(
        page.getByText('The post changed. 1 channel still uses the previous version.', {
            exact: true,
        })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Review and update', exact: true }).click()
    await expect(dialog.getByRole('region', { name: 'Second channel', exact: true })).toHaveCount(0)
    await expect(dialog).toContainText('Second channel already up to date.')
    await expect(first.getByRole('checkbox')).toBeChecked()
    await dialog.getByRole('button', { name: 'Update 1 channel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Review and update', exact: true })).toHaveCount(
        0
    )
    expect((await pair.read(page, pair.first)).draft.content.text).toBe(
        'Revised source for channel review'
    )
})

test('keeps partial successes and retries only the failed channel', async ({ page }) => {
    const pair = await createDraftPair(page)
    const before = await pair.read(page, pair.first)
    expect(
        (
            await page.request.patch(`/api/projects/${pair.id}/posts/${before.post.id}`, {
                data: {
                    expectedSourceRevision: 1,
                    sourceContent: {
                        ...pair.source,
                        body: { text: 'New post text', format: 'plain_text' },
                    },
                },
            })
        ).ok()
    ).toBe(true)
    await page.goto(pair.pageUrl(pair.first))
    await page.getByRole('button', { name: 'Review and update', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Update channel versions', exact: true })
    await expect(dialog.getByRole('checkbox')).toHaveCount(2)
    let firstAppliedRevision = 0
    await page.route(
        `**/publications/${pair.second}/draft/rebase`,
        async route => {
            firstAppliedRevision = (await pair.read(page, pair.first)).draft.revision
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: { code: 'provider_unavailable', message: 'Temporary failure' },
                }),
            })
        },
        { times: 1 }
    )
    await dialog.getByRole('button', { name: 'Update 2 channels', exact: true }).click()
    const second = dialog.getByRole('region', { name: 'Second channel', exact: true })
    await expect(second.getByRole('alert')).toBeVisible()
    await expect(second.getByRole('checkbox')).toBeChecked()
    await second.getByText('Compare', { exact: true }).click()
    await expect.poll(() => comparisonText(second)).toContain('Second destination')
    await expect(dialog).toContainText('First channel already up to date.')
    await expect(
        dialog.getByRole('button', { name: 'Update 1 channel', exact: true })
    ).toBeEnabled()
    expect((await pair.read(page, pair.first)).draft.revision).toBe(firstAppliedRevision)
    expect((await pair.read(page, pair.second)).draft.content.text).toBe('Second destination')
    await second.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Update 1 channel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect((await pair.read(page, pair.first)).draft.revision).toBe(firstAppliedRevision)
    expect((await pair.read(page, pair.second)).draft.content.text).toBe('New post text')
})

for (const choice of ['update', 'keep'] as const) {
    test(`rejects a stale ${choice} comparison and leaves both channel versions untouched`, async ({
        page,
    }) => {
        const pair = await createDraftPair(page)
        const before = await pair.read(page, pair.first)
        const secondBefore = await pair.read(page, pair.second)
        const postUrl = `/api/projects/${pair.id}/posts/${before.post.id}`
        expect(
            (
                await page.request.patch(postUrl, {
                    data: {
                        expectedSourceRevision: 1,
                        sourceContent: {
                            ...pair.source,
                            body: { text: 'Post to review', format: 'plain_text' },
                        },
                    },
                })
            ).ok()
        ).toBe(true)
        await page.goto(pair.pageUrl(pair.first))
        await page.getByRole('button', { name: 'Review and update', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Update channel versions', exact: true })
        await expect(dialog.getByRole('checkbox')).toHaveCount(2)
        const first = dialog.getByRole('region', { name: 'First channel', exact: true })
        await first.getByRole('button', { name: 'Compare', exact: true }).click()
        await expect.poll(() => comparisonText(first)).toContain('Post to review')
        const refreshed = page.waitForResponse(
            response =>
                response.url().endsWith(`/publications/${pair.first}/editor`) && response.ok()
        )
        expect(
            (
                await page.request.patch(postUrl, {
                    data: {
                        expectedSourceRevision: 2,
                        sourceContent: {
                            ...pair.source,
                            body: { text: 'Concurrent post text', format: 'plain_text' },
                        },
                    },
                })
            ).ok()
        ).toBe(true)
        await (await refreshed).finished()
        // Background refreshes must not silently approve different post content.
        await expect.poll(() => comparisonText(first)).toContain('Post to review')
        await expect.poll(() => comparisonText(first)).not.toContain('Concurrent post text')
        if (choice === 'update') {
            await dialog.getByRole('button', { name: 'Update 2 channels', exact: true }).click()
        } else {
            await first.getByRole('button', { name: 'Keep this version', exact: true }).click()
        }
        await expect(dialog.getByRole('alert')).toContainText(
            'Someone changed this while you were editing'
        )
        await expect(
            dialog.getByRole('button', { name: 'Update 0 channels', exact: true })
        ).toBeDisabled()
        expect((await pair.read(page, pair.first)).draft).toEqual(before.draft)
        expect((await pair.read(page, pair.second)).draft).toEqual(secondBefore.draft)
        await expect.poll(() => comparisonText(first)).toContain('Concurrent post text')
        await expect(first.getByRole('checkbox')).not.toBeChecked()
        await first.getByRole('checkbox').check()
        await dialog.getByRole('button', { name: 'Update 1 channel', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        const updated = await pair.read(page, pair.first)
        expect(updated.draft.sourceRevision).toBe(3)
        expect(updated.draft.content.text).toBe('Concurrent post text')
        expect(updated.publication).toEqual(before.publication)
        expect(updated.selectedTarget).toEqual(before.selectedTarget)
        expect((await pair.read(page, pair.second)).draft).toEqual(secondBefore.draft)
    })
}

test('opens the shared post from queue and keeps every destination reachable', async ({
    page,
}, info) => {
    const pair = await createDraftPair(page)
    const first = await pair.read(page, pair.first)
    await page.goto(`/dashboard/projects/${pair.id}/queue?filter=draft`)
    const cards = page.locator('[data-publication-selection-card="true"]')
    await expect(cards).toHaveCount(2)
    const card = cards.filter({ hasText: 'First channel' })
    // Per post by default: the post link heads its group of channels.
    await page
        .locator('[data-queue-post-group]')
        .filter({ has: card })
        .getByRole('link', { name: 'View post', exact: true })
        .first()
        .click()
    await expect(page).toHaveURL(new RegExp(`/posts/${first.post.id}$`))
    await expect(
        page.getByRole('heading', { level: 1, name: 'Initial common source', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Queue', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(page.getByRole('region', { name: 'Post', exact: true })).toContainText(
        'Initial common source'
    )
    const destinations = page.getByRole('region', { name: 'Channels', exact: true })
    await expect(destinations.getByRole('link', { name: /First channel/ }).first()).toBeVisible()
    await expect(destinations.getByRole('link', { name: /Second channel/ }).first()).toBeVisible()
    await page.reload()
    await expect(destinations).toContainText('Second channel')
    for (const width of [1280, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(destinations).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
            false
        )
        await page.screenshot({ path: info.outputPath(`shared-post-${width}.png`) })
    }
    await expect(page.getByRole('button', { name: 'Review and update', exact: true })).toHaveCount(
        0
    )
    await destinations.locator(`a[href$="/publications/${pair.second}"]`).first().click()
    await expect(page).toHaveURL(pair.pageUrl(pair.second))
    await page.goBack()
    await expect(
        page.getByRole('heading', { level: 1, name: 'Initial common source', exact: true })
    ).toBeVisible()
    await page.getByRole('link', { name: 'Back to queue', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${pair.id}/queue$`))
})

test('saves the post source explicitly and preserves local text on a concurrent source change', async ({
    page,
}, info) => {
    const pair = await createDraftPair(page)
    const first = await pair.read(page, pair.first)
    const second = await pair.read(page, pair.second)
    const postUrl = `/api/projects/${pair.id}/posts/${first.post.id}`
    await page.goto(`/dashboard/projects/${pair.id}/posts/${first.post.id}`)
    await page.getByRole('button', { name: 'Edit text', exact: true }).click()
    await page.locator('#source-body').fill('Independent shared source')
    expect((await pair.read(page, pair.first)).post.sourceRevision).toBe(1)
    await expect(
        page.getByRole('button', { name: 'Update channel versions', exact: true })
    ).toHaveCount(0)
    const saved = page.waitForResponse(
        response => response.url().endsWith(postUrl) && response.request().method() === 'PATCH'
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(page.getByRole('region', { name: 'Post', exact: true })).toContainText(
        'Independent shared source'
    )
    expect((await pair.read(page, pair.first)).draft).toEqual(first.draft)
    expect((await pair.read(page, pair.second)).draft).toEqual(second.draft)
    await page.getByRole('button', { name: 'Edit text', exact: true }).click()
    await page.locator('#source-body').fill('My unsaved source')
    const external = await page.request.patch(postUrl, {
        data: {
            expectedSourceRevision: 2,
            sourceContent: {
                ...first.post.sourceContent,
                body: { text: 'Concurrent shared source', format: 'plain_text' },
            },
        },
    })
    expect(external.status()).toBe(200)
    await expect(
        page.getByRole('alert').filter({ hasText: 'The post changed elsewhere.' })
    ).toBeVisible()
    await expect(page.locator('#source-body')).toHaveText('My unsaved source')
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
            false
        )
        await page.screenshot({ path: info.outputPath(`source-edit-conflict-${width}.png`) })
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
    await page.getByRole('button', { name: 'Edit text', exact: true }).click()
    await expect(page.locator('#source-body')).toHaveText('Concurrent shared source')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Add a channel', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add a channel', exact: true }).click()
    const addition = page.getByRole('dialog')
    await addition.getByRole('combobox', { name: 'Channel', exact: true }).click()
    await page.getByRole('option', { name: 'Second channel', exact: true }).click()
    await addition.getByRole('button', { name: 'Create draft', exact: true }).click()
    await addition.getByRole('button', { name: 'Confirm another draft', exact: true }).click()
    await expect(addition).toHaveCount(0)
    await expect(
        page
            .getByRole('region', { name: 'Channels', exact: true })
            .locator('[data-publication-selection-card="true"]')
    ).toHaveCount(3)
    expect((await pair.read(page, pair.second)).draft).toEqual(second.draft)
})

test('shows review skeletons and retries a failed comparison read', async ({ page }) => {
    const pair = await createDraftPair(page)
    const before = await pair.read(page, pair.first)
    expect(
        (
            await page.request.patch(`/api/projects/${pair.id}/posts/${before.post.id}`, {
                data: {
                    expectedSourceRevision: 1,
                    sourceContent: {
                        ...pair.source,
                        body: { text: 'Changed post', format: 'plain_text' },
                    },
                },
            })
        ).ok()
    ).toBe(true)
    await page.goto(pair.pageUrl(pair.first))
    await page.route(
        `**/publications/${pair.second}/editor`,
        route =>
            route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: { code: 'provider_unavailable', message: 'Temporary failure' },
                }),
            }),
        { times: 1 }
    )
    await page.getByRole('button', { name: 'Review and update', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Update channel versions', exact: true })
    await expect(dialog.getByRole('alert')).toBeVisible()
    let release: (() => void) | undefined
    const held = new Promise<void>(resolve => {
        release = resolve
    })
    await page.route(
        `**/publications/${pair.second}/editor`,
        async route => {
            await held
            await route.continue()
        },
        { times: 1 }
    )
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(dialog.locator('[data-slot="skeleton"]')).toHaveCount(12)
    await expect(
        dialog.getByRole('button', { name: 'Update 0 channels', exact: true })
    ).toBeDisabled()
    release?.()
    await expect(dialog.getByRole('checkbox')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await pair.read(page, pair.first)).draft).toEqual(before.draft)
})

test('keeps a concurrent channel acknowledgement and reports its revision conflict inline', async ({
    page,
}) => {
    const pair = await createDraftPair(page)
    const before = await pair.read(page, pair.first)
    const secondBefore = await pair.read(page, pair.second)
    expect(
        (
            await page.request.patch(`/api/projects/${pair.id}/posts/${before.post.id}`, {
                data: {
                    expectedSourceRevision: 1,
                    sourceContent: {
                        ...pair.source,
                        body: { text: 'Changed post', format: 'plain_text' },
                    },
                },
            })
        ).ok()
    ).toBe(true)
    await page.goto(pair.pageUrl(pair.first))
    await page.getByRole('button', { name: 'Review and update', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Update channel versions', exact: true })
    await expect(dialog.getByRole('checkbox')).toHaveCount(2)
    await page.route(
        `**/publications/${pair.second}/draft/rebase`,
        async route => {
            expect(
                (
                    await page.request.post(
                        `/api/projects/${pair.id}/publications/${pair.second}/draft/rebase`,
                        {
                            data: {
                                expectedRevision: secondBefore.draft.revision,
                                expectedSourceRevision: 2,
                                replaceContent: false,
                            },
                        }
                    )
                ).ok()
            ).toBe(true)
            await route.continue()
        },
        { times: 1 }
    )
    await dialog.getByRole('button', { name: 'Update 2 channels', exact: true }).click()
    const second = dialog.getByRole('region', { name: 'Second channel', exact: true })
    await expect(second.getByRole('alert')).toContainText(
        'Someone changed this while you were editing'
    )
    await expect(second.getByRole('checkbox')).toHaveCount(0)
    await expect(second).toContainText('already up to date')
    await expect(
        dialog.getByRole('button', { name: 'Update 0 channels', exact: true })
    ).toBeDisabled()
    expect((await pair.read(page, pair.second)).draft.content).toEqual(secondBefore.draft.content)
    expect((await pair.read(page, pair.first)).draft.content.text).toBe('Changed post')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Review and update', exact: true })).toHaveCount(
        0
    )
})

test('shows locked channel reasons and hides review when every version is locked', async ({
    page,
}, info) => {
    const pair = await createDraftPair(page)
    const before = await pair.read(page, pair.first)
    const name = 'Community announcements for international partners and regional contributors'
    const channelResponse = await page.request.post(`/api/projects/${pair.id}/channels`, {
        data: { name, profile: 'discord' },
    })
    expect(channelResponse.ok()).toBe(true)
    const channelId = (await channelResponse.json()).channel.id
    const added = await page.request.post(
        `/api/projects/${pair.id}/posts/${before.post.id}/destinations`,
        {
            data: {
                expectedSourceRevision: 1,
                publications: [
                    { channelId, deliveryMode: 'manual', scheduledAt: Date.now() + 86_400_000 },
                ],
            },
        }
    )
    expect(added.ok()).toBe(true)
    const lockedId = (await added.json()).publications[0].id
    for (const publicationId of [lockedId, pair.first, pair.second]) {
        const editor = await pair.read(page, publicationId)
        expect(
            (
                await page.request.post(
                    `/api/projects/${pair.id}/publications/${publicationId}/draft/promote`,
                    {
                        data: {
                            expectedRevision: editor.draft.revision,
                            scheduledAt: Date.now() + 86_400_000,
                        },
                    }
                )
            ).ok()
        ).toBe(true)
    }
    expect(
        (
            await page.request.patch(`/api/projects/${pair.id}/publications/cancel`, {
                data: { publicationIds: [lockedId] },
            })
        ).ok()
    ).toBe(true)
    expect(
        (
            await page.request.patch(`/api/projects/${pair.id}/posts/${before.post.id}`, {
                data: {
                    expectedSourceRevision: 1,
                    sourceContent: {
                        ...pair.source,
                        body: { text: 'Changed post', format: 'plain_text' },
                    },
                },
            })
        ).ok()
    ).toBe(true)
    await page.goto(pair.pageUrl(pair.first))
    await expect(
        page.getByText('The post changed. 2 channels still use the previous version.', {
            exact: true,
        })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Review and update', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Update channel versions', exact: true })
    const locked = dialog.getByRole('region', { name, exact: true })
    await expect(locked).toContainText('Publication cancelled')
    await expect(locked.getByRole('checkbox')).toHaveCount(0)
    await expect(dialog.getByRole('checkbox')).toHaveCount(2)
    await page.setViewportSize({ width: 390, height: 900 })
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath('source-review-locked-long-name-390.png') })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(
        (
            await page.request.patch(`/api/projects/${pair.id}/publications/cancel`, {
                data: { publicationIds: [pair.first, pair.second] },
            })
        ).ok()
    ).toBe(true)
    await expect(page.getByRole('button', { name: 'Review and update', exact: true })).toHaveCount(
        0
    )
    expect((await pair.read(page, lockedId)).draft.sourceRevision).toBe(1)
})

test('compares only changed words in text and titles without empty media counts', async ({
    page,
}, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const pair = await createDraftPair(page, true)
    const before = await pair.read(page, pair.first)
    const changed = await page.request.patch(`/api/projects/${pair.id}/posts/${before.post.id}`, {
        data: {
            expectedSourceRevision: 1,
            sourceContent: {
                body: { text: 'The calm channel is ready.', format: 'plain_text' },
                headline: 'The calm launch',
                media: [],
            },
        },
    })
    expect(changed.ok()).toBe(true)
    await page.goto(pair.pageUrl(pair.first))
    const notice = page.getByText('The post changed. 2 channels still use the previous version.', {
        exact: true,
    })
    for (const load of ['initial', 'reload'] as const) {
        if (load === 'reload') await page.reload()
        await expect(notice).toBeVisible()
        await expect(page.locator('[data-publication-editor-message]')).toHaveCount(0)
        await expect(page.locator('[data-publication-conflict]')).toHaveCount(0)
        await expect(page.getByRole('status', { name: 'Conflict', exact: true })).toHaveCount(0)
    }
    await page.getByRole('button', { name: 'Review and update', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Update channel versions', exact: true })
    const first = dialog.getByRole('region', { name: 'First channel', exact: true })
    await first.getByRole('button', { name: 'Compare', exact: true }).click()
    await expect(first.locator('del')).toHaveText(['Removed: quiet', 'Removed: quiet'])
    await expect(first.locator('ins')).toHaveText(['Added: calm', 'Added: calm'])
    await expect(first).not.toContainText('0 media')
    await expect(first.getByText(/media files?/)).toHaveCount(0)
    for (const theme of ['dark', 'light'] as const) {
        await page.evaluate(
            theme => document.documentElement.classList.toggle('dark', theme === 'dark'),
            theme
        )
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            ).toBe(false)
            await page.screenshot({
                path: info.outputPath(`word-comparison-${theme}-${width}.png`),
            })
        }
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await pair.read(page, pair.first)).draft).toEqual(before.draft)
})
