import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const [provider, metrics] of [
    ['bluesky', ['likeCount', 'replyCount', 'repostCount']],
    ['devto', ['page_views', 'reactions', 'comments']],
    ['mastodon', ['favourites_count', 'reblogs_count', 'replies_count']],
] as const) {
    test(`browses ${provider} saved history with gaps, changes and cursor pagination without collecting`, async ({
        page,
    }, info) => {
        await page.addInitScript(() => {
            localStorage.setItem('PARAGLIDE_LOCALE', 'en')
            localStorage.setItem('postdot-theme', 'dark')
        })
        expect(
            (
                await page.request.post('/api/auth/sign-up/email', {
                    data: {
                        name: 'History reader',
                        email: `history-${randomUUID()}@postdot.local`,
                        password: 'history-reader-password',
                    },
                })
            ).status()
        ).toBe(200)
        const { project } = await (
            await page.request.post('/api/projects', {
                data: { name: 'Saved history', timeZone: 'UTC' },
            })
        ).json()
        const base = `/api/projects/${project.id}`
        const { channel } = await (
            await page.request.post(`${base}/channels`, {
                data: { name: `${provider} history`, profile: provider },
            })
        ).json()
        const made = await page.request.post(`${base}/posts`, {
            data: {
                title: 'History example',
                sourceContent: {
                    headline: 'History example',
                    body: { text: 'Saved observations', format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            },
        })
        expect(made.status()).toBe(201)
        const publicationId = (await made.json()).publications[0].id
        // Deterministic published read fixture; no external publication or collection is performed.
        await page.route(`**${base}/publications?*`, async route => {
            const response = await route.fetch()
            const body = await response.json()
            body.publications = body.publications.map((item: object) => ({
                ...item,
                state: 'published',
                publishedAt: Date.UTC(2026, 10, 1),
            }))
            await route.fulfill({ response, json: body })
        })
        const at = Date.UTC(2026, 10, 10)
        const snapshot = (
            id: string,
            metricName: string,
            offset: number,
            value: number | null,
            revision = 'same-revision'
        ) => ({
            id,
            projectId: project.id,
            provider,
            subjectType: 'content',
            providerSubjectId: 'published-post',
            providerSubjectLabel: null,
            providerContentRevisionId: revision,
            postdotEntityType: 'publication',
            postdotEntityId: publicationId,
            metricName,
            value,
            unit: value === null ? '' : 'count',
            aggregation: value === null ? '' : 'cumulative_snapshot',
            reportingPeriodStart: null,
            reportingPeriodEnd: null,
            observedAt: null,
            fetchedAt: at + offset * 86400000,
            availability: value === null ? 'not_reported' : 'measured',
            freshness: 'unknown',
            provenance: 'fixture',
        })
        const cursor = Buffer.from(JSON.stringify([at, 'oldest'])).toString('base64url')
        let historyReads = 0
        let collections = 0
        let failHistory = false
        page.on('request', request => {
            if (request.url().includes('/collect')) collections++
        })
        await page.route(`**${base}/analytics/provider/${provider}/latest?*`, route =>
            route.fulfill({
                json: {
                    contractVersion: 1,
                    projectId: project.id,
                    provider,
                    limit: 500,
                    hasMore: false,
                    observations: [snapshot('latest', metrics[0], 3, 12)],
                },
            })
        )
        await page.route(`**${base}/analytics/provider/${provider}?*`, async route => {
            historyReads++
            const query = new URL(route.request().url()).searchParams
            expect(query.get('postdotEntityId')).toBe(publicationId)
            expect(query.get('postdotEntityType')).toBe('publication')
            expect(query.get('subjectType')).toBe('content')
            expect(query.get('limit')).toBe('100')
            if (failHistory)
                return route.fulfill({
                    status: 503,
                    json: { error: { code: 'unavailable', message: 'Unavailable' } },
                })
            const metric = query.get('metricName')!
            let observations
            let hasMore = false
            if (metric === metrics[0]) {
                if (query.has('cursor')) {
                    expect(query.get('cursor')).toBe(cursor)
                    observations = [snapshot('older', metric, -1, 0)]
                } else {
                    observations = [
                        snapshot('newest', metric, 3, 12),
                        snapshot('gap', metric, 2, null),
                        snapshot('oldest', metric, 0, 0),
                    ]
                    hasMore = true
                }
            } else if (metric === metrics[1])
                observations = [
                    snapshot('newer-count', metric, 3, 5),
                    snapshot('older-count', metric, 1, 9),
                ]
            else
                observations = [
                    snapshot('new-revision', metric, 3, 10, 'changed-revision'),
                    snapshot('old-revision', metric, 0, 4),
                ]
            await route.fulfill({
                json: {
                    contractVersion: 1,
                    projectId: project.id,
                    provider,
                    observations,
                    limit: 100,
                    hasMore,
                    nextCursor: hasMore ? cursor : null,
                },
            })
        })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.goto(`/dashboard/projects/${project.id}/performance`)
        const publication = page.locator(`[data-performance-publication="${publicationId}"]`)
        await expect(publication).toBeVisible()
        expect(historyReads).toBe(0)
        await publication.getByRole('button', { name: 'History', exact: true }).focus()
        await page.keyboard.press('Enter')
        const history = publication.locator('[data-engagement-history]')
        await expect(history.locator('[data-history-value]')).toHaveText(['12', '—', '0'])
        await expect(history.locator('[data-history-point]')).toHaveCount(2)
        await expect(history.locator('[data-history-segment]')).toHaveCount(2)
        await expect(history.locator('[data-history-difference]')).toHaveCount(0)
        await history.getByRole('button', { name: 'Older snapshots', exact: true }).click()
        await expect(history.locator('[data-history-value]')).toHaveText(['0'])
        await expect(
            history.getByText(
                'One snapshot is saved. Another comparable snapshot is needed to show a change.',
                { exact: true }
            )
        ).toBeVisible()
        await history.getByRole('button', { name: 'Newer snapshots', exact: true }).click()
        await expect(history.locator('[data-history-value]')).toHaveText(['12', '—', '0'])
        await history.getByRole('combobox', { name: 'Engagement metric', exact: true }).click()
        await page.getByRole('option').nth(1).click()
        await expect(history.locator('[data-history-difference]')).toContainText('-4')
        await expect(history.locator('[data-history-segment]')).toHaveCount(1)
        await history.scrollIntoViewIfNeeded()
        await page.screenshot({
            path: info.outputPath(`${provider}-history-desktop.png`),
            fullPage: true,
        })
        await page.setViewportSize({ width: 390, height: 844 })
        await history.scrollIntoViewIfNeeded()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        )
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({
            path: info.outputPath(`${provider}-history-mobile.png`),
            fullPage: true,
        })
        await history.getByRole('combobox', { name: 'Engagement metric', exact: true }).click()
        await page.getByRole('option').nth(2).click()
        await expect(
            history.getByText(
                'The content revision or measurement format changed. Compare the snapshots in the table; a continuous trend would be misleading.',
                { exact: true }
            )
        ).toBeVisible()
        await expect(history.locator('[data-history-chart]')).toHaveCount(0)
        failHistory = true
        await history.getByRole('button', { name: 'Reload saved data', exact: true }).click()
        await expect(history.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
        await expect(history.locator('[data-history-value]')).toHaveText(['10', '4'])
        failHistory = false
        await history.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(history.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
        await publication.getByRole('button', { name: 'History', exact: true }).click()
        await expect(history).toHaveCount(0)
        expect(collections).toBe(0)
    })
}
