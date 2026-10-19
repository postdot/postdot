import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Request } from '@playwright/test'
import type { PublicationEditorState } from '@postbot/client'

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
            other.getByRole('button', { name: 'Use this version', exact: true })
        ).toBeDisabled()
        await conflict.scrollIntoViewIfNeeded()
        await other.screenshot({
            path: info.outputPath('source-conflict-desktop.png'),
            fullPage: true,
        })
        for (const width of [820, 390]) {
            await other.setViewportSize({ width, height: 900 })
            await conflict.scrollIntoViewIfNeeded()
            expect((await new AxeBuilder({ page: other }).analyze()).violations).toEqual([])
            await other.screenshot({
                path: info.outputPath(`source-conflict-${width}.png`),
                fullPage: true,
            })
        }
        await other.getByRole('button', { name: 'Switch to light theme', exact: true }).click()
        await other.setViewportSize({ width: 820, height: 900 })
        await conflict.scrollIntoViewIfNeeded()
        expect((await new AxeBuilder({ page: other }).analyze()).violations).toEqual([])
        await other.screenshot({
            path: info.outputPath('source-conflict-light-820.png'),
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
        const key = `postbot:publication-editor:v3:${pair.id}:${pair.first}`
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
            other.getByRole('button', { name: 'Use this version', exact: true })
        ).toBeDisabled()
        await other.unroute(draftUrl)
        await conflict.getByRole('button', { name: 'Load server version', exact: true }).click()
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
                localStorage.setItem('postbot-theme', 'light')
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
            other.getByRole('button', { name: 'Use this version', exact: true })
        ).toBeDisabled()
        expect((await pair.read(page, pair.first)).draft.content.text).toBe(
            'Concurrent saved destination'
        )
        const key = `postbot:publication-editor:v3:${pair.id}:${pair.first}`
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
    const reads = observeProjectReads(other, editorUrl)
    try {
        await other.goto(pair.pageUrl(pair.first))
        await expect.poll(() => reads.count).toBeGreaterThanOrEqual(1)
        await expect(other.locator('#source-body')).toHaveText('Initial common source')
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
        reads.dispose()
        await context.close()
    }
})

async function openCustomization(page: Page) {
    const details = page.locator('[data-publication-customization="true"]')
    if ((await details.getAttribute('open')) === null)
        await details.locator(':scope > summary').click()
    await expect(details.locator('[data-target-field="text"]')).toBeVisible()
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
        await page
            .locator('[data-target-field="text"] [contenteditable="true"]')
            .fill('Version to apply')
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
            const action = page.locator('[data-publication-promotion-action]')
            await expect(action).toBeEnabled()
            await expect(action).toHaveText(
                scheduled ? 'Update scheduled publication' : 'Use this version'
            )
            await action.dblclick()
            await expect(action).toBeDisabled()
            await expect(action).toHaveAttribute('aria-busy', 'true')
            await expect(action).toHaveText('Applying…')
            await expect(
                page.locator('[data-target-field="text"] [contenteditable]')
            ).toHaveAttribute('contenteditable', 'false')
            expect(requests).toBe(1)
            await page.screenshot({
                path: info.outputPath(`promotion-pending-${scheduled ? 'scheduled' : 'draft'}.png`),
                fullPage: true,
            })
            release?.()
            await expect(action).toHaveAttribute('aria-busy', 'false')
            await expect(action).toBeEnabled()
            const after = await pair.read(page, pair.first)
            expect(after.selectedTarget?.content.text).toBe('Version to apply')
            expect(after.selectedTarget?.sequence).toBe((before.selectedTarget?.sequence ?? 0) + 1)
            expect(after.publication.state).toBe(scheduled ? 'scheduled' : 'draft')
            expect(after.publication.scheduledAt).toBe(before.publication.scheduledAt)
            expect(after.post.sourceContent).toEqual(before.post.sourceContent)
            expect((await pair.read(page, pair.second)).selectedTarget).toBeNull()
            expect(requests).toBe(1)
            await page.unroute(routeUrl)
            if (scheduled) {
                await page.locator('[data-publication-delivery-disclosure] > summary').click()
                await page.locator('#deliver-at').click()
                await page.getByRole('button', { name: 'Clear', exact: true }).click()
                await expect(action).toHaveText('Return to draft')
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
                await expect(action).toHaveText('Use this version')
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
        const pair = await createDraftPair(page)
        await page.goto(pair.pageUrl(pair.first))
        await openCustomization(page)
        const content = page.locator('[data-target-field="text"] [contenteditable="true"]')
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
        await page.locator('[data-publication-delivery-disclosure] > summary').click()
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
                await route.abort('failed')
            }
        })
        const action = page.locator('[data-publication-promotion-action]')
        await expect(action).toBeEnabled()
        await action.click()
        const check = page.getByRole('button', { name: 'Check server status', exact: true })
        await expect(check).toBeVisible()
        await expect(action).toBeDisabled()
        await expect(page.getByRole('status', { name: 'Saved', exact: true })).toBeVisible()
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
        const draftUrl = `**/api/projects/${pair.id}/publications/${pair.first}/draft`
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
        await expect(action).toHaveText(
            outcome === 'rejected' ? 'Return to draft' : 'Use this version'
        )
        expect((await pair.read(page, pair.second)).selectedTarget).toBeNull()
    })
}

async function createDraftPair(page: Page) {
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/')
    await page.getByRole('button', { name: 'Set up Postbot', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Concurrent editor owner')
    await page.getByLabel('Email', { exact: true }).fill(`concurrent-${suffix}@postbot.local`)
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

test('reviews sibling source changes and explicitly keeps or replaces destination drafts', async ({
    page,
}, info) => {
    const pair = await createDraftPair(page)
    const firstBefore = await pair.read(page, pair.first)
    const secondBefore = await pair.read(page, pair.second)
    const changed = await page.request.patch(
        `/api/projects/${pair.id}/publications/${pair.first}/draft`,
        {
            data: {
                expectedRevision: firstBefore.draft.revision,
                sourceContent: {
                    ...pair.source,
                    body: { text: 'Revised source for destination review', format: 'plain_text' },
                    media: [pair.source.media[0]],
                },
                targetContent: firstBefore.draft.content,
            },
        }
    )
    expect(changed.status()).toBe(200)
    await page.goto(pair.pageUrl(pair.first))
    await page.getByRole('button', { name: 'Review destinations', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Review destinations', exact: true })
    const second = dialog.getByRole('region', { name: 'Second channel', exact: true })
    await expect(second).toContainText('Source changed')
    await second.getByText('Compare and choose', { exact: true }).click()
    await expect(
        second.getByRole('radio', { name: 'Keep my adaptation', exact: true })
    ).toBeChecked()
    await expect(second).toContainText('Second destination')
    await expect(second).toContainText('Revised source for destination review')
    await second.getByRole('button', { name: 'Update this draft', exact: true }).click()
    await expect.poll(async () => (await pair.read(page, pair.second)).draft.sourceRevision).toBe(2)
    const kept = await pair.read(page, pair.second)
    expect(kept.draft.content).toEqual(secondBefore.draft.content)
    expect(kept.selectedTarget).toEqual(secondBefore.selectedTarget)
    expect(kept.publication).toEqual(secondBefore.publication)
    const first = dialog.getByRole('region', { name: 'First channel', exact: true })
    await first.getByText('Compare and choose', { exact: true }).click()
    await first
        .getByRole('radio', { name: 'Use source text, title and media', exact: true })
        .check()
    await expect(first).toContainText('Replaces those fields in this saved draft')
    await page.setViewportSize({ width: 390, height: 900 })
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: info.outputPath('source-review-mobile.png') })
    await first.getByRole('button', { name: 'Update this draft', exact: true }).click()
    await expect
        .poll(async () => (await pair.read(page, pair.first)).draft.content.text)
        .toBe('Revised source for destination review')
    const replaced = await pair.read(page, pair.first)
    expect(replaced.draft.content.media).toEqual([pair.source.media[0]])
    expect(replaced.selectedTarget).toEqual(firstBefore.selectedTarget)
    expect(replaced.publication).toEqual(firstBefore.publication)
    expect((await pair.read(page, pair.second)).draft.content).toEqual(secondBefore.draft.content)
})

test('opens the shared post from queue and keeps every destination reachable', async ({
    page,
}, info) => {
    const pair = await createDraftPair(page)
    const first = await pair.read(page, pair.first)
    await page.goto(`/dashboard/projects/${pair.id}/queue?filter=draft`)
    const cards = page.locator('[data-publication-selection-card="true"]')
    await expect(cards).toHaveCount(2)
    const card = cards.filter({ hasText: 'First channel' })
    await card.getByRole('link', { name: 'View post', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/posts/${first.post.id}$`))
    await expect(page.getByRole('heading', { name: 'Post', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Queue', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(page.getByRole('region', { name: 'Current source', exact: true })).toContainText(
        'Initial common source'
    )
    const destinations = page.getByRole('region', { name: 'Destinations', exact: true })
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
    await page.getByRole('button', { name: 'Review destinations', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Review destinations', exact: true })
    await expect(review.getByRole('region', { name: 'First channel', exact: true })).toBeVisible()
    await expect(review.getByRole('region', { name: 'Second channel', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await destinations.locator(`a[href$="/publications/${pair.second}"]`).first().click()
    await expect(page).toHaveURL(pair.pageUrl(pair.second))
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Post', exact: true })).toBeVisible()
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
    await page.getByRole('button', { name: 'Edit source', exact: true }).click()
    await page.locator('#source-body').fill('Independent shared source')
    expect((await pair.read(page, pair.first)).post.sourceRevision).toBe(1)
    await expect(
        page.getByRole('button', { name: 'Review destinations', exact: true })
    ).toHaveCount(0)
    const saved = page.waitForResponse(
        response => response.url().endsWith(postUrl) && response.request().method() === 'PATCH'
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(page.getByRole('region', { name: 'Current source', exact: true })).toContainText(
        'Independent shared source'
    )
    expect((await pair.read(page, pair.first)).draft).toEqual(first.draft)
    expect((await pair.read(page, pair.second)).draft).toEqual(second.draft)
    await page.getByRole('button', { name: 'Edit source', exact: true }).click()
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
        page.getByRole('alert').filter({ hasText: 'The source changed elsewhere.' })
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
    await page.getByRole('button', { name: 'Edit source', exact: true }).click()
    await expect(page.locator('#source-body')).toHaveText('Concurrent shared source')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Add destination', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add destination', exact: true }).click()
    const addition = page.getByRole('dialog')
    await addition.getByRole('combobox', { name: 'Channel', exact: true }).click()
    await page.getByRole('option', { name: 'Second channel', exact: true }).click()
    await addition.getByRole('button', { name: 'Create draft', exact: true }).click()
    await addition.getByRole('button', { name: 'Confirm another draft', exact: true }).click()
    await expect(addition).toHaveCount(0)
    await expect(
        page
            .getByRole('region', { name: 'Destinations', exact: true })
            .locator('[data-publication-selection-card="true"]')
    ).toHaveCount(3)
    expect((await pair.read(page, pair.second)).draft).toEqual(second.draft)
})
