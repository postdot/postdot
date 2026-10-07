import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }
import { frenchTranslation } from './locale'

test('keeps failed and ambiguous publications legible across queue and overview', async ({
    page,
}) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const scheduledAt = currentMonthNoon()
    const failedTitle = `E2E-124 failed ${suffix}`
    const ambiguousTitle = `E2E-124 ambiguous ${suffix}`
    const publications = [
        publicationFixture({
            channelName: 'Failed destination',
            errorMessage: 'The provider rejected this publication',
            id: `e2e-124-failed-${suffix}`,
            postTitle: failedTitle,
            projectId,
            scheduledAt,
            state: 'failed',
        }),
        publicationFixture({
            channelName: 'Review destination',
            errorMessage: 'The provider outcome is unknown',
            id: `e2e-124-ambiguous-${suffix}`,
            postTitle: ambiguousTitle,
            projectId,
            scheduledAt,
            state: 'ambiguous',
        }),
    ]
    let showUnsupportedPerformance = false
    await createTestChannel(page, projectId, `E2E-124 outcome channel ${suffix}`)

    await page.route(
        new RegExp(`/api/projects/${projectId}/publications(?:\\?.*)?$`),
        async route => {
            const requestUrl = new URL(route.request().url())
            if (
                route.request().method() !== 'GET' ||
                requestUrl.pathname !== `/api/projects/${projectId}/publications`
            ) {
                await route.continue()
                return
            }

            const response = await route.fetch()
            await response.body()
            await route.fulfill({
                status: response.status(),
                contentType: 'application/json',
                body: JSON.stringify({
                    publications: showUnsupportedPerformance
                        ? [
                              {
                                  ...publications[0],
                                  id: `e2e-124-published-${suffix}`,
                                  publishedAt: scheduledAt,
                                  state: 'published',
                              },
                          ]
                        : publications,
                    nextCursor: null,
                    summary: showUnsupportedPerformance
                        ? { total: 1, manual: 1, automatic: 0, scheduled: 0 }
                        : { total: 2, manual: 0, automatic: 2, scheduled: 2 },
                }),
            })
        }
    )

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible()

    const failedPublication = page.getByRole('link').filter({ hasText: failedTitle })
    const ambiguousPublication = page.getByRole('link').filter({ hasText: ambiguousTitle })
    const ambiguousCard = page
        .locator('[data-publication-selection-card="true"]')
        .filter({ hasText: ambiguousTitle })
    await expect(failedPublication).toContainText('Failed')
    await expect(ambiguousPublication).toContainText('Needs review')
    await expect(
        ambiguousCard.getByRole('button', { name: 'Review outcome', exact: true })
    ).toBeVisible()

    await page.getByRole('tab', { name: 'Needs attention (2)', exact: true }).click()
    await expect(page.getByRole('link').filter({ hasText: failedTitle })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: ambiguousTitle })).toBeVisible()

    for (const viewport of [
        { height: 720, width: 1280 },
        { height: 900, width: 768 },
        { height: 844, width: 390 },
    ]) {
        await page.setViewportSize(viewport)
        const layout = await page.locator('[data-dashboard-scroll]').evaluate(scrollRegion => ({
            clientWidth: (scrollRegion as unknown as { clientWidth: number }).clientWidth,
            scrollWidth: (scrollRegion as unknown as { scrollWidth: number }).scrollWidth,
        }))
        expect(
            layout.scrollWidth,
            `horizontal overflow at ${viewport.width}px`
        ).toBeLessThanOrEqual(layout.clientWidth)
        await expect(page.getByRole('link').filter({ hasText: failedTitle })).toBeVisible()
        await expect(page.getByRole('link').filter({ hasText: ambiguousTitle })).toBeVisible()
    }

    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(page.getByRole('link').filter({ hasText: failedTitle })).toContainText(
        frenchTranslation('publication_state_failed')
    )
    await expect(page.getByRole('link').filter({ hasText: ambiguousTitle })).toContainText(
        frenchTranslation('publication_state_needs_review')
    )

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('link', { name: 'Vue d’ensemble', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible()
    const overviewCalendar = page.locator('[data-calendar="reui"]')
    await expect(overviewCalendar).toBeVisible()
    await expect(
        overviewCalendar.getByRole('button', { name: new RegExp(failedTitle) })
    ).toBeVisible()
    await expect(
        overviewCalendar.getByRole('button', { name: new RegExp(ambiguousTitle) })
    ).toBeVisible()

    showUnsupportedPerformance = true
    await page.goto(`/dashboard/projects/${projectId}/performance`)
    await expect(page.getByRole('heading', { name: 'Performances', exact: true })).toBeVisible()
    await expect(
        page.getByText(frenchTranslation('performance_empty_title'), { exact: true })
    ).toBeVisible()
    await expect(page.locator('[data-performance-publication]')).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(
        page.getByText(frenchTranslation('performance_empty_title'), { exact: true })
    ).toBeVisible()
    const performanceWidth = await page.locator('[data-dashboard-scroll]').evaluate(region => ({
        client: region.clientWidth,
        scroll: region.scrollWidth,
    }))
    expect(performanceWidth.scroll).toBeLessThanOrEqual(performanceWidth.client)
})

test('reviews mixed operational work across responsive locale and theme combinations', async ({
    page,
}, testInfo) => {
    test.setTimeout(180_000)
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const channels = [] as { id: string; name: string }[]
    for (const [name, profile] of [
        ['Editorial team — community announcements and customer updates', 'manual-message'],
        ['LinkedIn — product and partnership announcements', 'linkedin'],
    ]) {
        const response = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: { name, profile },
        })
        expect(response.status()).toBe(201)
        channels.push((await response.json()).channel)
    }
    const postResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            title: 'Autumn release — a shared announcement across destinations',
            sourceContent: {
                body: {
                    text: 'A clearer publishing workflow for our community. Discover the autumn release and the improvements prepared with our editorial team.',
                    format: 'plain_text',
                },
                media: [],
            },
            publications: channels.map(channel => ({
                channelId: channel.id,
                deliveryMode: 'manual',
            })),
        },
    })
    expect(postResponse.status()).toBe(201)
    const basePublications = (await postResponse.json()).publications as { id: string }[]
    const editors = new Map<string, Record<string, unknown>>()
    for (const publication of basePublications) {
        const response = await page.request.get(
            `/api/projects/${projectId}/publications/${publication.id}/editor`
        )
        expect(response.ok()).toBe(true)
        const editor = (await response.json()).editor as Record<string, unknown>
        editors.set((editor.channel as { id: string }).id, editor)
    }
    const scheduledAt = currentMonthNoon()
    const scenarios = [
        {
            state: 'scheduled',
            channel: 0,
            scheduledAt: Date.now() - 60_000,
            title: 'Publish the community announcement manually',
        },
        {
            state: 'failed',
            channel: 1,
            scheduledAt,
            title: 'Partner announcement — delivery was rejected',
        },
        {
            state: 'ambiguous',
            channel: 1,
            scheduledAt,
            title: 'Autumn release — verify the publication before retrying',
        },
        {
            state: 'scheduled',
            channel: 1,
            scheduledAt: scheduledAt + 3_600_000,
            title: 'Product update — discover the improvements prepared with the editorial team and our community',
        },
        {
            state: 'draft',
            channel: 0,
            scheduledAt: null,
            title: 'Workshop invitation — continue preparing the shared announcement',
        },
        {
            state: 'published',
            channel: 0,
            scheduledAt,
            title: 'September highlights — the announcement is now published',
        },
        {
            state: 'cancelled',
            channel: 1,
            scheduledAt,
            title: 'Previous campaign — cancelled after the editorial review',
        },
    ]
    const publications = scenarios.map((scenario, index) => ({
        ...publicationFixture({
            channelName: channels[scenario.channel]!.name,
            errorMessage:
                scenario.state === 'failed'
                    ? 'The destination rejected the publication. Review the account connection before retrying.'
                    : '',
            id: `review-${index}`,
            postTitle: scenario.title,
            projectId,
            scheduledAt,
            state: 'failed',
        }),
        state: scenario.state,
        channelId: channels[scenario.channel]!.id,
        deliveryMode: scenario.channel === 0 ? 'manual' : 'automatic',
        scheduledAt: scenario.scheduledAt,
        publishedAt: scenario.state === 'published' ? scheduledAt : null,
    }))
    await page.route(
        new RegExp(`/api/projects/${projectId}/publications(?:\\?.*)?$`),
        async route => {
            const state = new URL(route.request().url()).searchParams.get('state')
            await route.fulfill({
                json: {
                    publications: state
                        ? publications.filter(item => item.state === state)
                        : publications,
                    nextCursor: null,
                    summary: { total: 7, manual: 3, automatic: 4, scheduled: 2, draft: 1 },
                },
            })
        }
    )
    await page.route(`**/api/projects/${projectId}/publications/due`, async route => {
        await route.fulfill({ json: { publications: [publications[0]] } })
    })
    await page.route(`**/api/projects/${projectId}/publications/review-*/tags`, async route => {
        await route.fulfill({ json: { tags: [] } })
    })
    await page.route(`**/api/projects/${projectId}/publications/review-*/editor`, async route => {
        const id = new URL(route.request().url()).pathname.split('/').at(-2)
        const index = publications.findIndex(item => item.id === id)
        if (index < 0) throw new Error('Unknown review publication')
        const base = editors.get(channels[scenarios[index]!.channel]!.id)!
        const publication = base.publication as Record<string, unknown>
        const post = base.post as Record<string, unknown>
        await route.fulfill({
            json: {
                editor: {
                    ...base,
                    publication: { ...publication, ...publications[index] },
                    post: {
                        ...post,
                        id: publications[index]!.postId,
                        title: scenarios[index]!.title,
                    },
                },
            },
        })
    })

    const matrix = [
        { locale: 'en', theme: 'dark', width: 1280 },
        { locale: 'en', theme: 'light', width: 820 },
        { locale: 'en', theme: 'light', width: 390 },
        { locale: 'fr', theme: 'light', width: 1280 },
        { locale: 'fr', theme: 'dark', width: 820 },
        { locale: 'fr', theme: 'dark', width: 390 },
    ] as const
    for (const variant of matrix) {
        const copy = variant.locale === 'fr' ? fr : en
        await page.goto(`/dashboard/projects/${projectId}/queue`)
        await expect(page.locator('[data-publication-selection-card]')).toHaveCount(7)
        await expect(page.locator('html')).toHaveClass(/\b(?:light|dark)\b/)
        if (variant.locale === 'fr' && (await page.locator('html').getAttribute('lang')) !== 'fr') {
            await page.locator('[data-slot="language-switcher-trigger"]').click()
            await page.getByRole('menuitem', { name: en.language_french, exact: true }).click()
            await expect(page.getByRole('menu')).toHaveCount(0)
        }
        if (
            await page
                .locator('html')
                .getAttribute('class')
                .then(value => !value?.split(' ').includes(variant.theme))
        ) {
            await page
                .getByRole('button', {
                    name: copy.theme_switch_to.replace('{theme}', copy[`theme_${variant.theme}`]),
                    exact: true,
                })
                .click()
        }
        await page.setViewportSize({ width: variant.width, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await expect(page.locator('html')).toHaveAttribute('lang', variant.locale)
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${variant.theme}\\b`))
        const cards = page.locator('[data-publication-selection-card]')
        await expect(cards).toHaveCount(7)
        await expect(cards.first()).toContainText(scenarios[0]!.title)
        await expect(cards.locator('[data-publication-action="record-published"]')).toHaveCount(1)
        await expect(cards.locator('[data-publication-action="retry"]')).toHaveCount(1)
        await expect(cards.locator('[data-publication-action="review-outcome"]')).toHaveCount(1)
        if (variant.width >= 1024) {
            const alignment = await page.locator('[data-publication-list]').evaluate(list => {
                const header = list.querySelector('[data-publication-table-header]')!
                const headingColumns = header.querySelector(':scope > div')!
                const destination = headingColumns.children[1]!.getBoundingClientRect()
                const action = headingColumns.children[2]!.getBoundingClientRect()
                return [...list.querySelectorAll('[data-publication-edit-link]')].map(link => ({
                    destinationOffset: Math.abs(
                        link.children[1]!.getBoundingClientRect().left - destination.left
                    ),
                    actionOffset: Math.abs(
                        link.nextElementSibling!.getBoundingClientRect().right - action.right
                    ),
                }))
            })
            expect(alignment).toHaveLength(7)
            for (const row of alignment) {
                expect(row.destinationOffset).toBeLessThanOrEqual(1)
                expect(row.actionOffset).toBeLessThanOrEqual(1)
            }
        }
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await assertNoOverflow(page)
        const attention = page.getByRole('tab', {
            name: `${copy.queue_attention} (3)`,
            exact: true,
        })
        await attention.focus()
        await page.keyboard.press('Enter')
        await expect(cards).toHaveCount(3)
        await page.reload()
        await expect(cards).toHaveCount(3)
        await page.screenshot({
            path: testInfo.outputPath(
                `queue-${variant.locale}-${variant.theme}-${variant.width}.png`
            ),
        })
        for (const [index, action] of [
            [0, 'record-published'],
            [1, 'retry'],
        ] as const) {
            await page.goto(`/dashboard/projects/${projectId}/publications/review-${index}`)
            await expect(page.locator(`[data-publication-action="${action}"]`)).toBeVisible()
            await expect(page.locator('[data-publication-draft-preview]')).toBeVisible()
            const header = await page
                .locator('main header')
                .first()
                .evaluate(element => {
                    const title = element.querySelector('h1')!.getBoundingClientRect()
                    const back = element.querySelector('a')!.getBoundingClientRect()
                    const bounds = element.getBoundingClientRect()
                    return {
                        center: Math.abs(
                            (title.left + title.right - bounds.left - bounds.right) / 2
                        ),
                        titleBelow: title.top >= back.bottom,
                    }
                })
            expect(header.center).toBeLessThanOrEqual(1)
            if (variant.width < 1024) expect(header.titleBelow).toBe(true)
            await assertNoOverflow(page)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({
                path: testInfo.outputPath(
                    `detail-${index}-${variant.locale}-${variant.theme}-${variant.width}.png`
                ),
            })
            const back = page.getByRole('link', { name: copy.editor_back_to_queue, exact: true })
            await back.focus()
            await page.keyboard.press('Enter')
            await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/queue`))
        }
        await page.goto(`/dashboard/projects/${projectId}/overview`)
        await expect(page.locator('[data-calendar-view]')).toBeVisible()
        if (variant.width === 390)
            await expect(page.locator('[data-calendar-view="agenda"]')).toBeVisible()
        await assertNoOverflow(page)
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({
            path: testInfo.outputPath(
                `overview-${variant.locale}-${variant.theme}-${variant.width}.png`
            ),
        })
    }
    await page.unrouteAll({ behavior: 'wait' })
})

async function assertNoOverflow(page: Page): Promise<void> {
    expect(
        await page
            .locator('[data-dashboard-scroll]')
            .evaluate(region => region.scrollWidth <= region.clientWidth)
    ).toBe(true)
}

function publicationFixture(input: {
    readonly channelName: string
    readonly errorMessage: string
    readonly id: string
    readonly postTitle: string
    readonly projectId: string
    readonly scheduledAt: number
    readonly state: 'ambiguous' | 'failed'
}) {
    return {
        channelId: `${input.id}-channel`,
        channelName: input.channelName,
        createdAt: input.scheduledAt - 60_000,
        createdByActorId: 'e2e-124-actor',
        deliveryMode: 'automatic' as const,
        draftDiffersFromTarget: false,
        draftReviewState: 'compatible' as const,
        draftRevision: 1,
        errorMessage: input.errorMessage,
        externalId: null,
        externalUrl: null,
        id: input.id,
        lastAssessedProfileVersionId: 'e2e-124-profile',
        postId: `${input.id}-post`,
        postTitle: input.postTitle,
        profileAssessmentIssues: [],
        publishedAt: null,
        publishedByActorId: null,
        projectId: input.projectId,
        reviewState: 'compatible' as const,
        scheduledAt: input.scheduledAt,
        scheduledByActorId: 'e2e-124-actor',
        state: input.state,
        stateChangedByActorId: 'e2e-124-actor',
        targetRevisionId: `${input.id}-target`,
    }
}

async function createTestChannel(page: Page, projectId: string, name: string): Promise<void> {
    const response = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name, profile: 'manual-message' },
    })
    expect(response.status()).toBe(201)
}

function currentMonthNoon() {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate(), 28), 12)
}

test('keeps draft content truthful in destination-specific preview compositions', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const profiles = ['x', 'bluesky', 'mastodon', 'devto', 'discord']
    for (const profileId of profiles) {
        const response = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: { name: `Destination ${profileId}`, profile: profileId },
        })
        expect(response.status()).toBe(201)
    }
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    const body = 'A thoughtful update for our community.'
    await page
        .getByRole('textbox', { name: en.publication_new_source_content, exact: true })
        .fill(body)
    for (const profileId of profiles) {
        const name = `Destination ${profileId}`
        const selected = page.getByRole('button', { name, exact: true })
        if ((await selected.count()) === 0) {
            await page
                .getByRole('button', {
                    name: en.publication_new_add_channel_named.replace('{channel}', name),
                    exact: true,
                })
                .click()
        }
        await selected.click()
        const preview = page.locator(`[data-preview-platform="${profileId}"]`)
        await expect(preview).toContainText(en.publication_preview_sample_author)
        await expect(preview.locator('[data-publication-preview-content]')).toHaveText(body)
        if (profileId === 'devto') {
            await page
                .getByLabel(en.publication_new_post_title, { exact: true })
                .fill('A community update')
            await expect(preview.getByRole('heading', { name: 'A community update' })).toBeVisible()
        }
        if (profileId === 'discord' || profileId === 'devto') {
            const backgrounds: string[] = []
            for (const theme of ['light', 'dark'] as const) {
                if (
                    !(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)
                ) {
                    await page
                        .getByRole('button', {
                            name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                            exact: true,
                        })
                        .click()
                }
                await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
                backgrounds.push(
                    await preview.evaluate(element => getComputedStyle(element).backgroundColor)
                )
                await preview.screenshot({
                    path: testInfo.outputPath(`preview-${profileId}-${theme}.png`),
                })
            }
            expect(backgrounds[0]).not.toBe(backgrounds[1])
        }
        await expect(preview.getByRole('button')).toHaveCount(0)
        for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await assertNoOverflow(page)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await preview.screenshot({
                path: testInfo.outputPath(`preview-${profileId}-${width}.png`),
            })
        }
        await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
        await expect(
            page.getByRole('textbox', { name: en.publication_new_source_content, exact: true })
        ).toHaveText(body, { useInnerText: true })
    }
    await page
        .getByRole('textbox', { name: en.publication_new_source_content, exact: true })
        .fill(
            '## Update\n\n__Underlined__ **Bold** __*Both*__ ~~Outdated~~\nNext line\n\n- First\n- Second\n\n```\n__literal__\n```'
        )
    await page.getByRole('button', { name: 'Destination discord', exact: true }).click()
    const messagePreview = page.locator('[data-preview-platform="discord"]')
    await expect(messagePreview.locator('u').first()).toHaveText('Underlined')
    await expect(messagePreview.locator('strong')).toHaveText('Bold')
    await expect(messagePreview.locator('u em')).toHaveText('Both')
    await expect(messagePreview.locator('del')).toHaveText('Outdated')
    await expect(messagePreview.locator('pre code')).toContainText('__literal__')
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await assertNoOverflow(page)
        await messagePreview.screenshot({
            path: testInfo.outputPath(`preview-discord-rich-${width}.png`),
        })
    }
    await page
        .getByRole('button', {
            name: en.theme_switch_to.replace('{theme}', en.theme_light),
            exact: true,
        })
        .click()
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    expect(
        await messagePreview
            .locator('del')
            .evaluate(element => getComputedStyle(element).textDecorationLine)
    ).toBe('line-through')
    await messagePreview.screenshot({
        path: testInfo.outputPath('preview-discord-rich-light-390.png'),
    })
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    const source = page.getByRole('textbox', {
        name: en.publication_new_source_content,
        exact: true,
    })
    await source.fill('Before ||**Secret**|| and ||Second|| after `||literal||`')
    await page.getByRole('button', { name: 'Destination discord', exact: true }).click()
    const spoilers = messagePreview.locator('[data-discord-spoiler]')
    await expect(spoilers).toHaveCount(2)
    await expect(spoilers.first()).toHaveAttribute('aria-expanded', 'false')
    await expect(spoilers.first().locator('span')).toBeHidden()
    await spoilers.first().focus()
    await spoilers.first().press('Enter')
    await expect(spoilers.first()).toHaveAttribute('aria-expanded', 'true')
    await expect(spoilers.first().locator('strong')).toBeVisible()
    await expect(spoilers.nth(1)).toHaveAttribute('aria-expanded', 'false')
    await spoilers.first().press('Space')
    await expect(spoilers.first()).toHaveAttribute('aria-expanded', 'false')
    await expect(spoilers.first().locator('span')).toBeHidden()
    await spoilers.nth(1).click()
    await expect(spoilers.nth(1)).toHaveAttribute('aria-expanded', 'true')
    await expect(spoilers.nth(1).locator('span')).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await messagePreview.screenshot({
        path: testInfo.outputPath('preview-discord-spoilers-390.png'),
    })
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    await expect(source).toHaveText('Before ||**Secret**|| and ||Second|| after `||literal||`')
    await source.fill('Before ||**Secret**|| and ||Second|| after `||literal||` updated')
    await page.getByRole('button', { name: 'Destination discord', exact: true }).click()
    await expect(spoilers.nth(1)).toHaveAttribute('aria-expanded', 'false')

    const mosaicBody = 'Mosaic order check'
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    await source.fill(mosaicBody)
    for (const [index, color] of ['#cd5268', '#63a06b', '#488fc4'].entries()) {
        const png = await page.evaluate(
            ([fill, digit]) => {
                const canvas = document.createElement('canvas')
                canvas.width = 600
                canvas.height = 400
                const context = canvas.getContext('2d')!
                context.fillStyle = fill
                context.fillRect(0, 0, 600, 400)
                context.fillStyle = 'white'
                context.font = 'bold 120px sans-serif'
                context.fillText(digit, 240, 240)
                return canvas.toDataURL().split(',')[1]!
            },
            [color, String(index + 1)] as const
        )
        await page.locator('input[type=file]').setInputFiles({
            name: `mosaic-${index}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from(png, 'base64'),
        })
    }
    await page.getByRole('button', { name: 'Destination bluesky', exact: true }).click()
    const mosaic = page.locator('[data-preview-platform="bluesky"]')
    const mosaicGrid = mosaic.locator('[data-publication-preview-media]')
    await expect(mosaicGrid.locator(':scope > div img')).toHaveCount(3)
    const renderedOrder = await mosaicGrid.locator(':scope > div img').evaluateAll(images =>
        images.map(element => {
            const image = element as HTMLImageElement
            const canvas = document.createElement('canvas')
            canvas.width = 1
            canvas.height = 1
            const context = canvas.getContext('2d')!
            context.drawImage(image, 0, 0, 1, 1)
            const [red, green, blue] = Array.from(context.getImageData(0, 0, 1, 1).data)
            if (red! >= green! && red! >= blue!) return 'red'
            if (green! >= red! && green! >= blue!) return 'green'
            return 'blue'
        })
    )
    expect(renderedOrder).toEqual(['red', 'green', 'blue'])
    const cells = await mosaicGrid.locator(':scope > div').evaluateAll(elements =>
        elements.map(element => {
            const bounds = element.getBoundingClientRect()
            return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        })
    )
    expect(cells).toHaveLength(3)
    expect(cells[0]!.height).toBeGreaterThan(cells[1]!.height * 1.7)
    expect(cells[0]!.x).toBeLessThan(cells[1]!.x)
    expect(Math.abs(cells[1]!.x - cells[2]!.x)).toBeLessThanOrEqual(2)
    expect(cells[2]!.y).toBeGreaterThan(cells[1]!.y)
    const gridBounds = (await mosaicGrid.boundingBox())!
    expect(gridBounds.width / gridBounds.height).toBeGreaterThan(1.8)
    expect(gridBounds.width / gridBounds.height).toBeLessThan(2.2)
    await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
    await expect(
        page.getByRole('textbox', { name: en.publication_new_source_content, exact: true })
    ).toHaveText(mosaicBody)
    await page.getByRole('button', { name: 'Destination bluesky', exact: true }).click()
    await expect(mosaicGrid.locator(':scope > div img')).toHaveCount(3)
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await assertNoOverflow(page)
        await mosaic.screenshot({
            path: testInfo.outputPath(`preview-bluesky-mosaic-${width}.png`),
        })
    }
    const socialBackgrounds: string[] = []
    for (const theme of ['light', 'dark'] as const) {
        if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
            await page
                .getByRole('button', {
                    name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                    exact: true,
                })
                .click()
        }
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
        socialBackgrounds.push(
            await mosaic.evaluate(element => getComputedStyle(element).backgroundColor)
        )
        await mosaic.screenshot({
            path: testInfo.outputPath(`preview-bluesky-mosaic-${theme}.png`),
        })
    }
    expect(socialBackgrounds[0]).not.toBe(socialBackgrounds[1])
    for (const profileId of ['x', 'mastodon']) {
        await page.getByRole('button', { name: en.publication_new_common_tab, exact: true }).click()
        await page.getByRole('button', { name: `Destination ${profileId}`, exact: true }).click()
        const preview = page.locator(`[data-preview-platform="${profileId}"]`)
        await expect(preview).toBeVisible()
        const themeBackgrounds: string[] = []
        for (const theme of ['light', 'dark'] as const) {
            if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
                await page
                    .getByRole('button', {
                        name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                        exact: true,
                    })
                    .click()
            }
            await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
            themeBackgrounds.push(
                await preview.evaluate(element => getComputedStyle(element).backgroundColor)
            )
        }
        expect(themeBackgrounds[0]).not.toBe(themeBackgrounds[1])
        console.log(`${profileId}: themed surfaces differ light/dark`)
    }
})

test('keeps performance refresh failures local and cached metrics truthful', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const channels: { id: string; name: string }[] = []
    for (const profile of ['devto', 'bluesky', 'manual-message']) {
        const response = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: { name: `Performance ${profile}`, profile },
        })
        expect(response.ok()).toBe(true)
        channels.push((await response.json()).channel)
    }
    const now = Date.now()
    const publications = channels.map((channel, index) => ({
        ...publicationFixture({
            channelName: channel.name,
            errorMessage: '',
            id: `performance-${index}`,
            postTitle: `Provider publication ${index}`,
            projectId,
            scheduledAt: now,
            state: 'failed',
        }),
        channelId: channel.id,
        state: 'published',
        publishedAt: now,
        errorMessage: null,
    }))
    await page.route(`**/api/projects/${projectId}/publications?*`, route =>
        route.fulfill({ json: { publications, nextCursor: null } })
    )
    let availability: 'measured' | 'not_configured' | 'empty' = 'empty'
    await page.route(`**/api/projects/${projectId}/analytics/provider/*?*`, route => {
        const devto = route.request().url().includes('/devto?')
        return route.fulfill({
            json: {
                observations:
                    availability === 'empty'
                        ? []
                        : [
                              {
                                  id: devto ? 'devto-views' : 'bluesky-likes',
                                  projectId,
                                  provider: devto ? 'devto' : 'bluesky',
                                  subjectType: 'content',
                                  providerSubjectId: 'provider-content',
                                  providerSubjectLabel: null,
                                  providerContentRevisionId: null,
                                  heraldEntityType: 'publication',
                                  heraldEntityId: publications[devto ? 0 : 1]!.id,
                                  metricName: devto ? 'page_views' : 'likeCount',
                                  value: availability === 'measured' ? (devto ? 123 : 0) : null,
                                  unit: 'count',
                                  aggregation: 'total',
                                  reportingPeriodStart: null,
                                  reportingPeriodEnd: null,
                                  observedAt: now,
                                  fetchedAt: now,
                                  availability,
                                  freshness: 'fresh',
                                  provenance: 'isolated browser fixture',
                              },
                          ],
                nextCursor: null,
            },
        })
    })
    let collectSucceeds = false
    await page.route(`**/api/projects/${projectId}/analytics/provider/*/collect`, route =>
        route.fulfill({
            status: collectSucceeds ? 200 : 503,
            json: collectSucceeds
                ? {}
                : { error: { code: 'provider_unavailable', message: 'Collection failed' } },
        })
    )
    const visit = () => page.goto(`/dashboard/projects/${projectId}/performance`)
    await visit()
    const first = page.locator('[data-performance-publication="performance-0"]')
    const second = page.locator('[data-performance-publication="performance-1"]')
    await expect(first.getByText(en.performance_not_collected, { exact: true })).toBeVisible()
    await expect(first.getByText('—', { exact: true })).toHaveCount(3)
    await expect(page.locator('[data-performance-publication="performance-2"]')).toHaveCount(0)
    availability = 'not_configured'
    await page.reload()
    await expect(
        first.getByText(en.performance_status_not_configured, { exact: true })
    ).toBeVisible()
    await expect(first.getByText('—', { exact: true })).toHaveCount(3)
    availability = 'measured'
    await page.reload()
    await expect(first.getByText('123', { exact: true })).toBeVisible()
    await expect(second.getByText('0', { exact: true })).toBeVisible()
    await expect(second.getByText('—', { exact: true })).toHaveCount(4)
    await first
        .getByRole('button', {
            name: `${en.performance_refresh}: Provider publication 0`,
            exact: true,
        })
        .click()
    await expect(first.getByRole('alert')).toHaveText(en.performance_refresh_failed)
    await expect(second.getByRole('alert')).toHaveCount(0)
    await expect(first.getByText('123', { exact: true })).toBeVisible()
    await second
        .getByRole('button', {
            name: `${en.performance_refresh}: Provider publication 1`,
            exact: true,
        })
        .click()
    await expect(second.getByRole('alert')).toHaveText(en.performance_refresh_failed)
    await expect(first.getByRole('alert')).toBeVisible()
    collectSucceeds = true
    await first
        .getByRole('button', {
            name: `${en.performance_refresh}: Provider publication 0`,
            exact: true,
        })
        .click()
    await expect(first.getByRole('alert')).toHaveCount(0)
    await expect(second.getByRole('alert')).toBeVisible()
    await expect(first.getByText('123', { exact: true })).toBeVisible()
    for (const theme of ['light', 'dark'] as const) {
        if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
            await page
                .getByRole('button', {
                    name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                    exact: true,
                })
                .click()
        }
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 844 })
            if (width === 390) {
                const refresh = second.getByRole('button', {
                    name: `${en.performance_refresh}: Provider publication 1`,
                    exact: true,
                })
                await expect(refresh).toHaveCSS('width', '44px')
                await expect(refresh).toHaveCSS('height', '44px')
            }
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            expect(
                await page
                    .locator('[data-dashboard-scroll]')
                    .evaluate(element => element.scrollWidth <= element.clientWidth)
            ).toBe(true)
            await page.screenshot({
                path: testInfo.outputPath(`performance-${theme}-${width}.png`),
            })
        }
    }
    await page.locator('[data-slot="language-switcher-trigger"]').click()
    await page.getByRole('menuitem', { name: en.language_french, exact: true }).click()
    await expect(second.getByRole('alert')).toHaveText(fr.performance_refresh_failed)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-124 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-124-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-124-password')
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
        .fill(`E2E-124 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}

test('keeps manual channel images compact without internal scrolling', async ({ page }, info) => {
    const id = await createAccountAndProject(page, randomUUID().slice(0, 8))
    await createTestChannel(page, id, 'Manual preview')
    await page.goto(`/dashboard/projects/${id}/publications/new`)
    await page.getByRole('button', { name: 'Manual preview', exact: true }).click()
    for (let index = 0; index < 4; index++) {
        const png = await page.evaluate(index => {
            const canvas = document.createElement('canvas')
            canvas.width = 600
            canvas.height = 400
            const context = canvas.getContext('2d')!
            context.fillStyle = ['#cd5268', '#488fc4', '#63a06b', '#cc983b'][index]!
            context.fillRect(0, 0, 600, 400)
            return canvas.toDataURL().split(',')[1]!
        }, index)
        await page.locator('input[type=file]').setInputFiles({
            name: `manual-${index}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from(png, 'base64'),
        })
        await expect(page.locator('[data-publication-preview-media] img')).toHaveCount(index + 1)
        if (index === 0) {
            expect(
                (await page.locator('[data-publication-preview-media]').boundingBox())!.height
            ).toBeLessThanOrEqual(176)
        }
    }
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const preview = page.locator('[data-composer-preview]')
        const gallery = preview.locator('[data-publication-preview-media]')
        expect(
            await gallery.evaluate(
                element => getComputedStyle(element).gridTemplateColumns.split(' ').length
            )
        ).toBe(2)
        expect((await gallery.boundingBox())!.height).toBeLessThanOrEqual(240)
        expect(
            await preview.evaluate(element => element.scrollHeight <= element.clientHeight)
        ).toBe(true)
        const bounds = await preview.boundingBox()
        const settings = await page.locator('[data-composer-settings]').boundingBox()
        if (width === 1280) expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(settings!.y)
        else expect(settings!.y + settings!.height).toBeLessThanOrEqual(bounds!.y)
        await assertNoOverflow(page)
        await page.screenshot({ path: info.outputPath(`manual-preview-layout-${width}.png`) })
    }
})

test('keeps article images compact and clear of delivery settings', async ({ page }, info) => {
    test.setTimeout(60000)
    const id = await createAccountAndProject(page, randomUUID().slice(0, 8))
    expect(
        (
            await page.request.post(`/api/projects/${id}/channels`, {
                data: { name: 'Article preview', profile: 'devto' },
            })
        ).ok()
    ).toBe(true)
    await page.goto(`/dashboard/projects/${id}/publications/new`)
    await page.getByRole('button', { name: 'Article preview', exact: true }).click()
    const description = 'A landscape at sunset'
    await page.route(`**/api/projects/${id}/media/uploads`, async route => {
        const request = route.request()
        const data = request.postDataJSON()
        await route.continue({
            postData: JSON.stringify({
                ...data,
                ...(data.originalFilename === 'article-0.png'
                    ? { defaultAccessibilityText: description }
                    : {}),
            }),
        })
    })
    for (let index = 0; index < 4; index++) {
        const png = await page.evaluate(index => {
            const canvas = document.createElement('canvas')
            canvas.width = 600
            canvas.height = 400
            const context = canvas.getContext('2d')!
            context.fillStyle = ['#cd5268', '#488fc4', '#63a06b', '#cc983b'][index]!
            context.fillRect(0, 0, 600, 400)
            context.fillStyle = 'white'
            context.font = 'bold 120px sans-serif'
            context.fillText(String(index + 1), 240, 240)
            return canvas.toDataURL().split(',')[1]!
        }, index)
        await page.locator('input[type=file]').setInputFiles({
            name: `article-${index}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from(png, 'base64'),
        })
        await expect(page.locator('[data-publication-preview-media] img')).toHaveCount(index + 1)
    }
    await expect(page.locator('[data-publication-preview-media] img').first()).toHaveAttribute(
        'alt',
        description
    )
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const preview = page.locator('[data-composer-preview]')
        const settings = page.locator('[data-composer-settings]')
        const bounds = await preview.boundingBox()
        const settingsBounds = await settings.boundingBox()
        if (width === 1280) {
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(settingsBounds!.y)
            expect(
                await preview.evaluate(element => element.scrollHeight <= element.clientHeight)
            ).toBe(true)
            const galleryBounds = await preview
                .locator('[data-publication-preview-media]')
                .boundingBox()
            expect(galleryBounds!.height).toBeLessThanOrEqual(240)
            expect(bounds!.height).toBeLessThan(500)
            await settings.scrollIntoViewIfNeeded()
            const scrolledPreview = await preview.boundingBox()
            const scrolledSettings = await settings.boundingBox()
            expect(scrolledPreview!.y + scrolledPreview!.height).toBeLessThanOrEqual(
                scrolledSettings!.y
            )
        }
        await assertNoOverflow(page)
        await page.screenshot({ path: info.outputPath(`article-preview-layout-${width}.png`) })
        await page.getByRole('button', { name: 'View article-0.png', exact: true }).click()
        const viewer = page.locator('[data-media-viewer="true"]')
        const descriptionField = viewer.getByRole('textbox', {
            name: en.media_accessibility_text,
            exact: true,
        })
        await expect(descriptionField).toHaveValue(
            width === 1280 ? description : 'First image at sunset'
        )
        await descriptionField.fill('First image at sunset')
        await descriptionField.press('ArrowRight')
        await expect(
            viewer.getByRole('heading', { name: 'article-0.png', exact: true })
        ).toBeVisible()
        await viewer.locator('[data-media-viewer-next]').click()
        await expect(
            viewer.getByRole('heading', { name: 'article-1.png', exact: true })
        ).toBeVisible()
        await expect(descriptionField).toHaveValue('')
        await viewer.locator('[data-media-viewer-previous]').click()
        await expect(descriptionField).toHaveValue('First image at sunset')
        await expect(viewer.locator('[data-media-viewer-image-stage] img')).toHaveCount(1)
        await expect(viewer.locator('[data-media-viewer-image-stage] img').first()).toHaveAttribute(
            'alt',
            'First image at sunset'
        )
        await assertNoOverflow(page)
        await page.screenshot({ path: info.outputPath(`article-description-editor-${width}.png`) })
        await viewer.locator('[data-media-viewer-close]').click()
        await expect(viewer).toHaveCount(0)
        await expect(page.locator('[data-publication-preview-media] img').first()).toHaveAttribute(
            'alt',
            'First image at sunset'
        )
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByLabel(en.publication_new_post_title, { exact: true }).fill('Media adaptation')
    const created = page.waitForResponse(
        response => response.url().endsWith('/posts') && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: en.publication_new_create_draft, exact: true }).click()
    const result = (await (await created).json()) as { publications: { id: string }[] }
    const publicationId = result.publications[0]!.id
    await expect(page).toHaveURL(new RegExp(`/publications/${publicationId}$`))
    const endpoint = `/api/projects/${id}/publications/${publicationId}`
    const editorResponse = await page.request.get(`${endpoint}/editor`)
    const { editor } = (await editorResponse.json()) as {
        editor: {
            post: { sourceContent: Record<string, unknown> & { media: { assetId: string }[] } }
            draft: {
                revision: number
                content: Record<string, unknown> & { media: { assetId: string }[] }
            }
        }
    }
    const adaptedDescription = 'The destination image description'
    const adapted = await page.request.patch(`${endpoint}/draft`, {
        data: {
            expectedRevision: editor.draft.revision,
            sourceContent: {
                ...editor.post.sourceContent,
                media: [editor.post.sourceContent.media[0]],
            },
            targetContent: {
                ...editor.draft.content,
                media: [
                    {
                        assetId: editor.draft.content.media[1]!.assetId,
                        accessibilityText: adaptedDescription,
                    },
                ],
            },
        },
    })
    expect(adapted.ok()).toBe(true)
    const targetAssetId = editor.draft.content.media[1]!.assetId
    await page.route(new RegExp(`/api/projects/${id}/media(?:\\?.*)?$`), async route => {
        const response = await route.fetch()
        const payload = (await response.json()) as { media: { asset: { id: string } }[] }
        await route.fulfill({
            response,
            json: {
                ...payload,
                media: payload.media.filter(asset => asset.asset.id !== targetAssetId),
            },
        })
    })
    const loadedTarget = page.waitForResponse(
        response =>
            new URL(response.url()).pathname === `/api/projects/${id}/media/${targetAssetId}`
    )
    await page.reload()
    expect((await loadedTarget).ok()).toBe(true)
    await expect(page.locator('[data-publication-preview-media] img')).toHaveCount(1)
    await expect(page.locator('[data-publication-preview-media] img')).toHaveAttribute(
        'alt',
        adaptedDescription
    )
    const adaptedEditor = (await adapted.json()) as {
        editor: { draft: { revision: number; content: Record<string, unknown> } }
    }
    expect(
        (
            await page.request.patch(`${endpoint}/draft`, {
                data: {
                    expectedRevision: adaptedEditor.editor.draft.revision,
                    targetContent: { ...adaptedEditor.editor.draft.content, media: [] },
                },
            })
        ).ok()
    ).toBe(true)
    await page.reload()
    await expect(page.locator('[data-publication-preview-media] img')).toHaveCount(0)
})
