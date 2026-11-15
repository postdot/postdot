import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem('PARAGLIDE_LOCALE', 'en')
        localStorage.setItem('postdot-theme', 'dark')
    })
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Delivery operator',
                    email: `delivery-${randomUUID()}@postdot.local`,
                    password: 'delivery-analytics-password',
                },
            })
        ).status()
    ).toBe(200)
    const { project } = await (
        await page.request.post('/api/projects', {
            data: { name: 'Delivery analytics', timeZone: 'Europe/Paris' },
        })
    ).json()
    const base = `/api/projects/${project.id}`
    const channels: { id: string; name: string }[] = []
    for (const name of ['Manual desk', 'Other desk']) {
        const response = await page.request.post(`${base}/channels`, { data: { name } })
        expect(response.status()).toBe(201)
        channels.push((await response.json()).channel)
    }
    return { base, project, channels }
}

async function publishManually(page: Page, base: string, channelId: string) {
    const made = await page.request.post(`${base}/posts`, {
        data: {
            title: 'Recorded delivery',
            sourceContent: {
                body: { text: 'Delivered manually', format: 'plain_text' },
                media: [],
            },
            publications: [{ channelId, deliveryMode: 'manual' }],
        },
    })
    expect(made.status()).toBe(201)
    const publicationId = (await made.json()).publications[0].id
    const path = `${base}/publications/${publicationId}`
    const editor = (await (await page.request.get(`${path}/editor`)).json()).editor
    expect(
        (
            await page.request.post(`${path}/draft/promote`, {
                data: { expectedRevision: editor.draft.revision, scheduledAt: Date.now() + 1000 },
            })
        ).status()
    ).toBe(200)
    await expect
        .poll(async () =>
            (await (await page.request.get(`${base}/publications/due`)).json()).publications.some(
                (publication: { id: string }) => publication.id === publicationId
            )
        )
        .toBe(true)
    expect(
        (
            await page.request.post(`${path}/publish`, {
                data: { externalUrl: 'https://example.com/delivery' },
            })
        ).status()
    ).toBe(200)
}

test('reports real manual outcomes, filters periods and destinations, and preserves the saved report after a failed reload', async ({
    page,
}, info) => {
    const { base, project, channels } = await setup(page)
    for (const channel of channels) await publishManually(page, base, channel.id)
    let collectCalls = 0
    page.on('request', request => {
        if (request.url().includes('/collect')) collectCalls++
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/dashboard/projects/${project.id}/performance`)
    await page.getByRole('tab', { name: 'Publishing', exact: true }).click()
    const dashboard = page.locator('[data-delivery-dashboard]')
    await expect(dashboard.locator('[data-delivery-counter="published"]')).toHaveText('2')
    await expect(dashboard.locator('[data-delivery-counter="failed"]')).toHaveCount(0)
    await expect(dashboard.locator('[data-delivery-counter="ambiguous"]')).toHaveCount(0)
    await expect(dashboard.locator('[data-delivery-counter="retries"]')).toHaveCount(0)
    await expect(dashboard.getByText('+2 vs previous period', { exact: true })).toBeVisible()
    await expect(dashboard.locator('[data-delivery-destinations]')).toContainText('Manual desk')
    await dashboard.locator('[data-delivery-day]').last().focus()
    await page.keyboard.press('Home')
    await expect(dashboard.locator('[data-delivery-day]').first()).toBeFocused()
    await page.keyboard.press('End')
    await expect(dashboard.locator('[data-delivery-day]').last()).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await dashboard.locator('[data-delivery-period="true"]').click()
    await page.getByRole('menuitemradio', { name: 'Last 7 days', exact: true }).click()
    await expect(page).toHaveURL(/days=7/)
    await expect(dashboard.locator('[data-delivery-counter="published"]')).toHaveText('2')
    await dashboard.locator('[data-filter-menu="true"]').click()
    await page.getByRole('menuitemradio', { name: 'Manual desk', exact: true }).click()
    await expect(dashboard.locator('[data-delivery-counter="published"]')).toHaveText('1')
    await expect(page).toHaveURL(new RegExp(`deliveryChannel=${channels[0]!.id}`))
    await page.reload()
    await page.getByRole('tab', { name: 'Publishing', exact: true }).click()
    await expect(dashboard.locator('[data-delivery-counter="published"]')).toHaveText('1')
    await expect(dashboard.locator('[data-delivery-period="true"]')).toContainText('Last 7 days')
    await page.screenshot({ path: info.outputPath('delivery-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath('delivery-mobile.png'), fullPage: true })
    await dashboard.locator('[data-delivery-destinations]').scrollIntoViewIfNeeded()
    await page.screenshot({
        path: info.outputPath('delivery-mobile-destinations.png'),
        fullPage: true,
    })
    await dashboard.locator('[data-delivery-period="true"]').click()
    await page.getByRole('menuitemradio', { name: 'Last 90 days', exact: true }).click()
    await expect(page).toHaveURL(/days=90/)
    await expect.poll(() => dashboard.locator('[data-delivery-day]').count()).toBeGreaterThan(80)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await dashboard.locator('[data-delivery-day]').last().scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('delivery-mobile-90-days.png'), fullPage: true })
    await page.route(`**${base}/analytics?*`, route =>
        route.fulfill({
            status: 503,
            json: { error: { code: 'unavailable', message: 'Unavailable' } },
        })
    )
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(dashboard.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(dashboard.locator('[data-delivery-counter="published"]')).toHaveText('1')
    expect(collectCalls).toBe(0)
})

test('shows an empty delivery period and keeps comparison failures separate from a successful report', async ({
    page,
}) => {
    const { base, project } = await setup(page)
    await page.route(`**${base}/analytics?*`, async route => {
        if (new URL(route.request().url()).searchParams.has('from'))
            return route.fulfill({
                status: 503,
                json: { error: { code: 'unavailable', message: 'Unavailable' } },
            })
        return route.continue()
    })
    await page.goto(`/dashboard/projects/${project.id}/performance`)
    await page.getByRole('tab', { name: 'Publishing', exact: true }).click()
    const dashboard = page.locator('[data-delivery-dashboard]')
    await expect(
        dashboard.getByText('Nothing was published in this period', { exact: true })
    ).toBeVisible()
    await expect(dashboard.locator('[data-delivery-period="true"]')).toHaveCount(0)
    await expect(dashboard.locator('[data-filter-menu="true"]')).toHaveCount(0)
    await expect(dashboard.locator('[data-delivery-counters]')).toHaveCount(0)
    await expect(dashboard.getByText('Comparison unavailable', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(0)
})

test('warns about incomplete history and suppresses misleading period changes', async ({
    page,
}) => {
    // Incompleteness is reported once something was published; an empty
    // project only learns when results will appear (DESIGN.md pattern 4).
    const { base, project, channels } = await setup(page)
    await publishManually(page, base, channels[0]!.id)
    await page.route(`**${base}/analytics?*`, async route => {
        const response = await route.fetch()
        const report = await response.json()
        report.coverage.skippedFactCount = 1
        await route.fulfill({ response, json: report })
    })
    await page.goto(`/dashboard/projects/${project.id}/performance`)
    await page.getByRole('tab', { name: 'Publishing', exact: true }).click()
    const dashboard = page.locator('[data-delivery-dashboard]')
    await expect(
        dashboard.getByText(
            'Some recorded events could not be interpreted. Totals may be incomplete; comparisons are unavailable.',
            { exact: true }
        )
    ).toBeVisible()
    await expect(dashboard.getByText('Comparison unavailable', { exact: true })).toHaveCount(0)
})

test('keeps publishing filters available when a channel has no results', async ({ page }) => {
    const { base, project, channels } = await setup(page)
    await publishManually(page, base, channels[0]!.id)
    await page.goto(
        `/dashboard/projects/${project.id}/performance?deliveryChannel=${channels[1]!.id}`
    )
    await page.getByRole('tab', { name: 'Publishing', exact: true }).click()
    const dashboard = page.locator('[data-delivery-dashboard]')
    await expect(
        dashboard.getByText('Nothing was published in this period', { exact: true })
    ).toBeVisible()
    await expect(dashboard.locator('[data-delivery-period="true"]')).toBeVisible()
    await expect(dashboard.locator('[data-filter-menu="true"]')).toBeVisible()
    await expect(dashboard.locator('[data-delivery-counters]')).toHaveCount(0)
})

test('hides destination filter for a single channel, adapts non-zero counters, and omits empty daily panels', async ({
    page,
}) => {
    await page.addInitScript(() => {
        localStorage.setItem('PARAGLIDE_LOCALE', 'en')
        localStorage.setItem('postdot-theme', 'dark')
    })
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Single channel operator',
                    email: `single-channel-${randomUUID()}@postdot.local`,
                    password: 'delivery-analytics-password',
                },
            })
        ).status()
    ).toBe(200)
    const { project } = await (
        await page.request.post('/api/projects', {
            data: { name: 'Single channel delivery', timeZone: 'UTC' },
        })
    ).json()
    const base = `/api/projects/${project.id}`
    const channelResponse = await page.request.post(`${base}/channels`, {
        data: { name: 'Solo desk' },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    await publishManually(page, base, channel.id)

    await page.route(`**${base}/analytics?*`, async route => {
        if (new URL(route.request().url()).searchParams.has('from')) return route.continue()
        const response = await route.fetch()
        const report = await response.json()
        report.historical.publications.published = 0
        report.historical.publications.failed = 2
        report.historical.retries.scheduled = 1
        report.historical.buckets = []
        await route.fulfill({ response, json: report })
    })

    await page.goto(`/dashboard/projects/${project.id}/performance`)
    await page.getByRole('tab', { name: 'Publishing', exact: true }).click()
    const dashboard = page.locator('[data-delivery-dashboard]')
    await expect(dashboard.locator('[data-delivery-period="true"]')).toBeVisible()
    await expect(dashboard.locator('[data-filter-menu="true"]')).toHaveCount(0)
    await expect(dashboard.locator('[data-delivery-counter="published"]')).toHaveText('0')
    await expect(dashboard.locator('[data-delivery-counter="failed"]')).toHaveText('2')
    await expect(dashboard.locator('[data-delivery-counter="retries"]')).toHaveText('1')
    await expect(dashboard.locator('[data-delivery-counter="ambiguous"]')).toHaveCount(0)
    await expect(
        dashboard.getByRole('heading', { name: 'Published per day', exact: true })
    ).toHaveCount(0)
    await expect(
        dashboard.getByText('Nothing was published in this period', { exact: true })
    ).toHaveCount(0)
})
