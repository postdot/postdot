import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { frenchTranslation } from './locale'

test('groups loaded destinations by source and distinguishes zero, missing, and failed reads', async ({
    page,
}, testInfo) => {
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Performance operator',
            email: `performance-${randomUUID()}@postdot.local`,
            password: 'performance-fixture-password',
        },
    })
    expect(signup.status()).toBe(200)
    const createdProject = await page.request.post('/api/projects', {
        data: { name: 'Release results', timeZone: 'UTC' },
    })
    const { project } = await createdProject.json()
    const channelIds: string[] = []
    for (const [name, profile] of [
        ['Bluesky primary', 'bluesky'],
        ['Bluesky secondary', 'bluesky'],
        ['Article', 'devto'],
        ['Mastodon status', 'mastodon'],
    ]) {
        const response = await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name, profile },
        })
        expect(response.status()).toBe(201)
        channelIds.push((await response.json()).channel.id)
    }
    const postResponse = await page.request.post(`/api/projects/${project.id}/posts`, {
        data: {
            title: 'Shared release',
            sourceContent: {
                headline: 'Release news',
                body: { format: 'plain_text', text: 'One source for multiple destinations.' },
                media: [],
            },
            publications: channelIds.map(channelId => ({ channelId, deliveryMode: 'automatic' })),
        },
    })
    expect(postResponse.status()).toBe(201)
    const { publications } = await postResponse.json()
    // Only the read fixture is published; no worker or provider publication occurs.
    await page.route(`**/api/projects/${project.id}/publications?*`, async route => {
        const response = await route.fetch()
        const body = await response.json()
        body.publications = body.publications.map((publication: Record<string, unknown>) => ({
            ...publication,
            state: 'published',
            publishedAt: 1_800_000_000_000,
        }))
        await route.fulfill({ response, json: body })
    })
    let releaseReads = () => {}
    const held = new Promise<void>(resolve => {
        releaseReads = resolve
    })
    let failReads = false
    let mastodonRefreshed = false
    const requested: string[][] = []
    await page.route(`**/api/projects/${project.id}/analytics/provider/*/latest?*`, async route => {
        await held
        if (failReads)
            return route.fulfill({
                status: 503,
                json: { error: { code: 'unavailable', message: 'Unavailable' } },
            })
        const url = new URL(route.request().url())
        const ids = url.searchParams.getAll('publicationIds')
        requested.push(ids)
        const provider = url.pathname.includes('/bluesky/')
            ? 'bluesky'
            : url.pathname.includes('/mastodon/')
              ? 'mastodon'
              : 'devto'
        const id = publications.find(
            (publication: { channelId: string }) =>
                publication.channelId ===
                channelIds[provider === 'bluesky' ? 0 : provider === 'mastodon' ? 3 : 2]
        ).id
        await route.fulfill({
            json: {
                contractVersion: 1,
                projectId: project.id,
                provider,
                limit: 500,
                hasMore: false,
                observations: [
                    {
                        id: 'observation-' + id,
                        postdotEntityId: id,
                        postdotEntityType: 'publication',
                        metricName:
                            provider === 'bluesky'
                                ? 'likeCount'
                                : provider === 'mastodon'
                                  ? 'favourites_count'
                                  : 'page_views',
                        availability: 'measured',
                        value:
                            provider === 'bluesky'
                                ? 0
                                : provider === 'mastodon'
                                  ? mastodonRefreshed
                                      ? 8
                                      : 0
                                  : 120,
                        fetchedAt: 1_800_000_000_000,
                    },
                ],
            },
        })
    })
    let collectCalls = 0
    await page.route(
        `**/api/projects/${project.id}/analytics/provider/mastodon/collect`,
        async route => {
            collectCalls++
            const publication = publications.find(
                (item: { channelId: string }) => item.channelId === channelIds[3]
            )
            expect(route.request().method()).toBe('POST')
            expect(route.request().postDataJSON()).toEqual({
                channelId: channelIds[3],
                publicationId: publication.id,
            })
            mastodonRefreshed = true
            await route.fulfill({
                json: {
                    contractVersion: 1,
                    projectId: project.id,
                    provider: 'mastodon',
                    fetchedAt: 1_800_000_000_001,
                    inserted: 3,
                    duplicates: 0,
                    observations: [],
                },
            })
        }
    )
    await page.goto(`/dashboard/projects/${project.id}/performance`)
    await expect(page.locator('[data-performance-post]')).toHaveCount(1)
    await expect(page.getByText('Not collected', { exact: true })).toHaveCount(0)
    releaseReads()
    await expect(page.locator('[data-performance-publication]')).toHaveCount(4)
    await expect(page.getByRole('heading', { name: 'Shared release', exact: true })).toHaveCount(1)
    const first = page
        .locator('[data-performance-publication]')
        .filter({ has: page.getByRole('link', { name: 'Bluesky primary', exact: true }) })
    await expect(first.getByText('0', { exact: true })).toBeVisible()
    await expect(page.getByText('Not collected', { exact: true })).toHaveCount(1)
    expect(requested.map(ids => ids.length).sort()).toEqual([1, 1, 2])
    const mastodon = page
        .locator('[data-performance-publication]')
        .filter({ has: page.getByRole('link', { name: 'Mastodon status', exact: true }) })
    await expect(mastodon.getByText('0', { exact: true })).toBeVisible()
    await expect(mastodon).toContainText('Favourites')
    await expect(mastodon).toContainText('Boosts')
    await mastodon.getByRole('button', { name: 'Refresh: Mastodon status', exact: true }).click()
    await expect(mastodon.getByText('8', { exact: true })).toBeVisible()
    expect(collectCalls).toBe(1)
    await page.screenshot({
        path: testInfo.outputPath('grouped-performance-en.png'),
        animations: 'disabled',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(
        page.getByText(frenchTranslation('performance_grouped_description'), { exact: true })
    ).toBeVisible()
    const dimensions = await page
        .locator('[data-dashboard-scroll]')
        .evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }))
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
    await page.screenshot({
        path: testInfo.outputPath('grouped-performance-fr.png'),
        animations: 'disabled',
    })
    failReads = true
    await page.reload()
    await expect(
        page.getByText(frenchTranslation('performance_read_failed'), { exact: true })
    ).toHaveCount(4)
    await expect(
        page.getByText(frenchTranslation('performance_not_collected'), { exact: true })
    ).toHaveCount(0)
})
