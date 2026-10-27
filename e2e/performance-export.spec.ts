import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'
import type { PublicationSummary } from '@postdot/client'

import { frenchTranslation } from './locale'

test('exports all filtered stored results and handles cancellation or incomplete reads without partial downloads', async ({
    page,
}, info) => {
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'CSV operator',
                    email: `csv-${randomUUID()}@postdot.local`,
                    password: 'csv-fixture-password',
                },
            })
        ).ok()
    ).toBe(true)
    const { project } = await (
        await page.request.post('/api/projects', { data: { name: 'CSV report', timeZone: 'UTC' } })
    ).json()
    const base = `/api/projects/${project.id}`
    const { channel } = await (
        await page.request.post(`${base}/channels`, {
            data: { name: 'Mastodon results', profile: 'mastodon' },
        })
    ).json()
    const { tag } = await (
        await page.request.post(`${base}/tags`, { data: { name: 'Release' } })
    ).json()
    const summaries: PublicationSummary[] = []
    for (const title of ['=Report, "first"', 'Second page result']) {
        const made = await page.request.post(`${base}/posts`, {
            data: {
                title,
                sourceContent: { body: { format: 'plain_text', text: title }, media: [] },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            },
        })
        expect(made.status()).toBe(201)
    }
    const { publications } = await (await page.request.get(`${base}/publications?limit=100`)).json()
    const first = publications.find((item: { postTitle: string }) => item.postTitle.startsWith('='))
    const second = publications.find((item: { postTitle: string }) =>
        item.postTitle.startsWith('Second')
    )
    for (const publication of [first, second])
        summaries.push({
            ...publication,
            state: 'published',
            publishedAt: 1_800_000_000_000,
            externalId: publication.id,
            externalUrl: `https://social.example/@owner/${publication.id}`,
            tagIds: [tag.id],
        })
    let mode: 'normal' | 'held' | 'partial' = 'normal'
    let releasePage = () => {}
    let heldPage = Promise.resolve()
    let laterPages = 0
    let collections = 0
    let downloads = 0
    page.on('download', () => {
        downloads++
    })
    page.on('request', request => {
        if (request.url().includes('/analytics/provider/') && request.url().includes('/collect'))
            collections++
    })
    await page.route(`**${base}/publications?*`, async route => {
        const url = new URL(route.request().url())
        expect(url.searchParams.getAll('tagIds')).toEqual([tag.id])
        const later = url.searchParams.has('cursor')
        if (later) {
            laterPages++
            if (mode === 'held') await heldPage
        }
        await route.fulfill({
            json: {
                publications: [summaries[later ? 1 : 0]],
                nextCursor: later ? null : 'export-next-page',
            },
        })
    })
    await page.route(`**${base}/analytics/provider/mastodon/latest?*`, async route => {
        const ids = new URL(route.request().url()).searchParams.getAll('publicationIds')
        await route.fulfill({
            json: {
                contractVersion: 1,
                projectId: project.id,
                provider: 'mastodon',
                limit: 500,
                hasMore: mode === 'partial',
                observations: ids.map(id => ({
                    id: `metric-${id}`,
                    projectId: project.id,
                    provider: 'mastodon',
                    subjectType: 'content',
                    providerSubjectId: id,
                    providerSubjectLabel: null,
                    providerContentRevisionId: null,
                    postdotEntityId: id,
                    postdotEntityType: 'publication',
                    metricName: 'favourites_count',
                    availability: 'measured',
                    value: 0,
                    unit: 'count',
                    aggregation: 'cumulative',
                    freshness: 'fresh',
                    observedAt: 1_800_000_000_000,
                    fetchedAt: 1_800_000_001_000,
                    reportingPeriodStart: null,
                    reportingPeriodEnd: null,
                    provenance: 'fixture',
                })),
            },
        })
    })
    await page.goto(`/dashboard/projects/${project.id}/performance?tagIds=${tag.id}`)
    await expect(page.locator('[data-performance-publication]')).toHaveCount(1)
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
    const download = await downloaded
    expect(download.suggestedFilename()).toMatch(/^postdot-performance-.*\.csv$/)
    const path = await download.path()
    expect(path).not.toBeNull()
    const csv = await readFile(path!, 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain(`"${first.id}"`)
    expect(csv).toContain(`"${second.id}"`)
    expect(csv).toContain('"\'=Report, ""first"""')
    expect(csv).toContain('"favourites_count","0","count","cumulative","measured","fresh"')
    expect(csv).toContain('"reblogs_count","","","","not_collected"')
    expect(csv).toContain(new Date(1_800_000_001_000).toISOString())
    expect(csv.trim().split('\r\n')).toHaveLength(7)
    expect(laterPages).toBe(1)
    await expect(page.locator('[data-performance-publication]')).toHaveCount(1)
    await page.screenshot({
        path: info.outputPath('performance-export-desktop.png'),
        fullPage: true,
    })
    mode = 'held'
    heldPage = new Promise<void>(resolve => {
        releasePage = resolve
    })
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
    await expect.poll(() => laterPages).toBe(2)
    await page.getByRole('button', { name: 'Cancel export', exact: true }).click()
    releasePage()
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled()
    mode = 'partial'
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
    await expect(
        page.getByRole('alert').filter({ hasText: 'The CSV could not be exported.' })
    ).toBeVisible()
    expect(downloads).toBe(1)
    expect(collections).toBe(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(
        page.getByRole('button', { name: frenchTranslation('performance_export_csv'), exact: true })
    ).toBeVisible()
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({
        path: info.outputPath('performance-export-mobile-fr.png'),
        fullPage: true,
    })
})
