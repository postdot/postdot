import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../../apps/web/messages/en.json' with { type: 'json' }
import fr from '../../apps/web/messages/fr.json' with { type: 'json' }
import { experienceRoutes } from './route-registry'

type CreatedPost = { post: { id: string }; publications: { id: string }[] }

async function setup(page: Page) {
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Detail reviewer',
            email: `detail-${randomUUID()}@example.test`,
            password: 'detail-review-password',
        },
    })
    expect(signup.status()).toBe(200)
    const made = await page.request.post('/api/projects', {
        data: { name: 'Publication desk', timeZone: 'Europe/Paris' },
    })
    expect(made.status()).toBe(201)
    const { project } = (await made.json()) as { project: { id: string; workspaceId: string } }
    const channels: { id: string; name: string }[] = []
    for (const name of ['Newsroom', 'Community']) {
        const response = await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name, profile: 'manual-message' },
        })
        expect(response.status()).toBe(201)
        channels.push((await response.json()).channel)
    }
    async function create(title: string, scheduledAt?: number, all = true): Promise<CreatedPost> {
        const response = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                title,
                sourceContent: {
                    body: {
                        format: 'plain_text',
                        text: 'A shared announcement prepared for the newsroom and community.',
                    },
                    media: [],
                },
                publications: (all ? channels : channels.slice(0, 1)).map(channel => ({
                    channelId: channel.id,
                    deliveryMode: 'manual',
                    ...(scheduledAt === undefined ? {} : { scheduledAt }),
                })),
            },
        })
        expect(response.status()).toBe(201)
        return response.json() as Promise<CreatedPost>
    }
    return { project, channels, create }
}

for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    test(`reviews post and publication detail states in ${locale}`, async ({ page }, info) => {
        test.setTimeout(150_000)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.addInitScript(
            ({ locale, theme }) => {
                localStorage.setItem('PARAGLIDE_LOCALE', locale)
                localStorage.setItem('postdot-theme', theme)
            },
            { locale, theme }
        )
        const { project, create } = await setup(page)
        const draft = await create('Shared source for the editorial destinations')
        const scheduled = await create('Scheduled community announcement', Date.now() + 86_400_000)
        const published = await create('Retained published announcement', Date.now() + 1000, false)
        const base = `/dashboard/projects/${project.id}`
        await page.goto(`${base}/queue?filter=draft`)
        const card = page
            .locator('[data-publication-selection-card]')
            .filter({ hasText: 'Newsroom' })
            .first()
        await card.getByRole('link', { name: copy.post_view, exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/posts/${draft.post.id}$`))
        await expect(
            page.getByRole('region', { name: copy.post_destinations, exact: true })
        ).toContainText('Community')
        await page.getByRole('link', { name: copy.nav_back_to_queue, exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`${base}/queue$`))
        await expect
            .poll(async () => {
                const response = await page.request.get(
                    `/api/projects/${project.id}/publications/due`
                )
                return (await response.json()).publications.some(
                    (item: { id: string }) => item.id === published.publications[0]!.id
                )
            })
            .toBe(true)
        expect(
            (
                await page.request.post(
                    `/api/projects/${project.id}/publications/${published.publications[0]!.id}/publish`,
                    { data: {} }
                )
            ).status()
        ).toBe(200)

        const observations: unknown[] = []
        async function capture(label: string) {
            observations.push(
                await page.evaluate(id => {
                    const main = document.querySelector('main')
                    const scroll = document.querySelector('[data-dashboard-scroll]')
                    return {
                        id,
                        url: location.pathname + location.search,
                        width: innerWidth,
                        headings: [...document.querySelectorAll('h1,h2')].map(
                            node => node.textContent
                        ),
                        activeNavigation: [
                            ...document.querySelectorAll(
                                '[data-slot="sidebar"] [aria-current="page"]'
                            ),
                        ].map(node => node.textContent?.trim()),
                        mainWidth: main?.getBoundingClientRect().width,
                        availableWidth: scroll?.getBoundingClientRect().width,
                        composerWidth: document
                            .querySelector('[data-publication-composer]')
                            ?.getBoundingClientRect().width,
                        overflow:
                            document.documentElement.scrollWidth > innerWidth ||
                            (scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : false),
                        buttons: [...document.querySelectorAll('main a, main button')]
                            .filter(node => node.getClientRects().length > 0)
                            .map(node => ({
                                label: node.getAttribute('aria-label') ?? node.textContent?.trim(),
                                disabled: node.hasAttribute('disabled'),
                            })),
                    }
                }, label)
            )
            await writeFile(
                info.outputPath('observations.json'),
                JSON.stringify(observations, null, 2)
            )
            await page.screenshot({ path: info.outputPath(`${label}.png`), animations: 'disabled' })
        }
        for (const [label, path] of [
            ['post', `${base}/posts/${draft.post.id}`],
            ['draft', `${base}/publications/${draft.publications[0]!.id}`],
            ['scheduled', `${base}/publications/${scheduled.publications[0]!.id}`],
            ['published', `${base}/publications/${published.publications[0]!.id}`],
        ]) {
            await page.setViewportSize({ width: 1920, height: 900 })
            await page.goto(path!)
            await expect(
                page.getByRole('link', { name: copy.nav_queue, exact: true })
            ).toHaveAttribute('aria-current', 'page')
            if (label === 'post')
                await expect(
                    page.getByRole('region', { name: copy.post_destinations, exact: true })
                ).toContainText('Community')
            else await expect(page.locator('[data-publication-lifecycle]')).toBeVisible()
            if (label === 'post') {
                await expect(page.locator('[data-page-column="management"]')).toBeVisible()
                await expect(
                    page.getByRole('link', { name: copy.nav_back_to_queue, exact: true })
                ).toHaveCount(1)
            } else if (label === 'published') {
                await expect(page.locator('#source-body')).toHaveCount(0)
                await expect(
                    page.locator(
                        '[data-publication-action="cancel"], [data-publication-action="record-published"], [data-publication-action="retry"]'
                    )
                ).toHaveCount(0)
            } else {
                await expect(page.locator('#source-body')).toBeVisible()
                if (label === 'scheduled')
                    await expect(page.locator('[data-publication-action="cancel"]')).toBeVisible()
            }
            for (const width of [1920, 820, 390]) {
                await page.setViewportSize({ width, height: 900 })
                await capture(`${label}-${width}`)
                expect(
                    await page.evaluate(() => {
                        const scroll = document.querySelector('[data-dashboard-scroll]')
                        return (
                            document.documentElement.scrollWidth <= innerWidth &&
                            (scroll === null || scroll.scrollWidth <= scroll.clientWidth + 1)
                        )
                    })
                ).toBe(true)
                if (width === 1920 && label === 'draft') {
                    const usedWidth = await page
                        .locator('[data-publication-composer]')
                        .evaluate(node => node.getBoundingClientRect().width)
                    const available = await page
                        .locator('[data-dashboard-scroll]')
                        .evaluate(node => node.getBoundingClientRect().width)
                    expect(usedWidth / available).toBeGreaterThan(0.9)
                }
                if (width !== 820) {
                    const violations = (await new AxeBuilder({ page }).analyze()).violations
                    observations.push({
                        id: `${label}-${width}-accessibility`,
                        violations,
                    })
                    expect(violations).toEqual([])
                }
                if (label === 'scheduled' && width === 390) {
                    const cancel = page.locator('[data-publication-action="cancel"]')
                    await cancel.hover()
                    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                    await cancel.click()
                    const confirmation = page.getByRole('dialog', {
                        name: copy.publication_cancel_title,
                        exact: true,
                    })
                    await expect(
                        confirmation.getByText(copy.publication_cancel_description, { exact: true })
                    ).toBeVisible()
                    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                    await page.screenshot({
                        path: info.outputPath('cancellation-confirmation-390.png'),
                        animations: 'disabled',
                    })
                    await page.keyboard.press('Escape')
                }
            }
        }
        // A failed-provider view is a rendering fixture; it does not contact a provider.
        const editorPath = `/api/projects/${project.id}/publications/${scheduled.publications[0]!.id}/editor`
        const baseline = await (await page.request.get(editorPath)).json()
        await page.route(`**${editorPath}`, route =>
            route.fulfill({
                json: {
                    ...baseline,
                    editor: {
                        ...baseline.editor,
                        publication: {
                            ...baseline.editor.publication,
                            state: 'failed',
                            deliveryMode: 'automatic',
                            errorMessage: 'The destination rejected the publication.',
                        },
                    },
                },
            })
        )
        await page.goto(`${base}/publications/${scheduled.publications[0]!.id}`)
        await expect(page.locator('[data-publication-error]')).toBeVisible()
        await capture('failed-390')
        await page.unroute(`**${editorPath}`)

        for (const [kind, apiPath, path] of [
            [
                'post',
                `/api/projects/${project.id}/posts/${draft.post.id}`,
                `${base}/posts/${draft.post.id}`,
            ],
            [
                'publication',
                editorPath,
                `${base}/publications/${scheduled.publications[0]!.id}?from=calendar&date=2026-10-28&view=week`,
            ],
        ]) {
            for (const status of [404, 503]) {
                await page.route(`**${apiPath}`, route =>
                    route.fulfill({
                        status,
                        json: {
                            error: {
                                code: status === 404 ? 'not_found' : 'temporarily_unavailable',
                                message: 'Detail fixture refusal',
                            },
                        },
                    })
                )
                await page.goto(path!)
                const message =
                    status === 404
                        ? kind === 'post'
                            ? copy.post_unavailable_title
                            : copy.notifications_subject_unavailable
                        : copy.common_error_title
                await expect(page.getByText(message, { exact: true })).toBeVisible()
                if (status === 404)
                    await expect(
                        page.getByRole('button', { name: copy.common_retry, exact: true })
                    ).toHaveCount(0)
                else
                    await expect(
                        page.getByRole('button', { name: copy.common_retry, exact: true })
                    ).toBeVisible()
                await capture(`${kind}-${status}-390`)
                await page.unroute(`**${apiPath}`)
                if (status === 503 && kind === 'publication') {
                    await page.getByRole('button', { name: copy.common_retry, exact: true }).click()
                    await expect(page.locator('[data-publication-lifecycle]')).toBeVisible()
                    await page
                        .getByRole('link', { name: copy.editor_back_to_calendar, exact: true })
                        .click()
                    const returned = new URL(page.url())
                    expect(returned.searchParams.get('date')).toBe('2026-10-28')
                    expect(returned.searchParams.get('view')).toBe('week')
                }
            }
        }
        await writeFile(info.outputPath('observations.json'), JSON.stringify(observations, null, 2))
        const context = {
            projectId: project.id,
            workspaceId: project.workspaceId,
            postId: draft.post.id,
            publicationId: draft.publications[0]!.id,
        }
        for (const id of ['post-detail', 'publication-detail'])
            expect(experienceRoutes.find(route => route.id === id)?.path(context)).toBeTruthy()
    })
}

test('keeps sibling destinations reachable beyond the first publications page', async ({
    page,
}) => {
    test.setTimeout(90_000)
    const { project, create } = await setup(page)
    const original = await create('Older shared source')
    for (let batch = 0; batch < 11; batch += 1)
        await Promise.all(
            Array.from({ length: 10 }, (_, index) =>
                create(`Later source ${batch}-${index}`, undefined, false)
            )
        )
    const first = await (
        await page.request.get(`/api/projects/${project.id}/publications?limit=100`)
    ).json()
    expect(first.nextCursor).toBeTruthy()
    expect(
        first.publications.some((item: { postId: string }) => item.postId === original.post.id)
    ).toBe(false)
    await page.goto(
        `/dashboard/projects/${project.id}/publications/${original.publications[0]!.id}`
    )
    await expect(page.getByRole('button', { name: 'Community', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Community', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/publications/${original.publications[1]!.id}$`))
})

test('returns an unavailable publication to its calendar context', async ({ page }) => {
    const { project, create } = await setup(page)
    const made = await create('Unavailable calendar item', Date.now() + 86_400_000)
    const editorPath = `/api/projects/${project.id}/publications/${made.publications[0]!.id}/editor`
    await page.route(`**${editorPath}`, route =>
        route.fulfill({
            status: 404,
            json: { error: { code: 'not_found', message: 'Removed publication' } },
        })
    )
    await page.goto(
        `/dashboard/projects/${project.id}/publications/${made.publications[0]!.id}?from=calendar&date=2026-10-28&view=week`
    )
    await expect(
        page.getByRole('heading', { name: en.notifications_subject_unavailable, exact: true })
    ).toBeVisible()
    await page.getByRole('link', { name: en.editor_back_to_calendar, exact: true }).click()
    const returned = new URL(page.url())
    expect(returned.pathname).toBe(`/dashboard/projects/${project.id}/overview`)
    expect(returned.searchParams.get('date')).toBe('2026-10-28')
    expect(returned.searchParams.get('view')).toBe('week')
})
