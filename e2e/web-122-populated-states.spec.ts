import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('uses the calendar as the project overview and keeps Queue distinct', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const scheduledAt = currentMonthNoon()
    const publications = Array.from({ length: 8 }, (_, index) =>
        publicationFixture({
            channelName: index % 2 === 0 ? 'Editorial channel' : 'Community channel',
            deliveryMode: index % 2 === 0 ? 'automatic' : 'manual',
            id: `e2e-122-publication-${index + 1}-${suffix}`,
            postTitle: `E2E-122 publication ${index + 1} ${suffix}`,
            projectId,
            scheduledAt: index < 4 ? scheduledAt + index * 3_600_000 : null,
            state: index === 0 ? 'ready' : index < 4 ? 'scheduled' : 'draft',
        })
    )
    const duePublication = {
        ...publications[0],
        deliveryMode: 'manual' as const,
        state: 'ready' as const,
        targetContent: { body: 'A publication waiting for a human confirmation.' },
    }

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

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    publications,
                    nextCursor: null,
                    summary: { total: 8, manual: 4, automatic: 4, scheduled: 4 },
                }),
            })
        }
    )
    await page.route(`**/api/projects/${projectId}/publications/due`, async route => {
        const requestUrl = new URL(route.request().url())
        if (
            route.request().method() !== 'GET' ||
            requestUrl.pathname !== `/api/projects/${projectId}/publications/due`
        ) {
            await route.continue()
            return
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ publications: [duePublication] }),
        })
    })

    await page.goto(`/dashboard/projects/${projectId}/overview?calendar=legacy`)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const overviewSummary = page.getByLabel('Overview summary', { exact: true })
    await expect(overviewSummary).toContainText('4 scheduled')
    await expect(overviewSummary).toContainText('4 unscheduled')
    await expect(overviewSummary).toContainText('1 needs attention')
    const overviewCalendar = page.locator('[data-calendar-view="month"]')
    await expect(overviewCalendar).toBeVisible()
    await expect(overviewCalendar.locator('a[href*="/publications/"]')).toHaveCount(3)
    await expect(overviewCalendar.getByText('+1', { exact: true })).toBeVisible()
    await expect(
        overviewCalendar.getByText(`E2E-122 publication 7 ${suffix}`, { exact: true })
    ).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('[data-calendar-view="agenda"]')).toBeVisible()

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'All (8)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Needs attention (1)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Scheduled (4)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Manual (4)', exact: true })).toBeVisible()
    await expect(page.locator('a[href*="/publications/"]')).toHaveCount(8)

    const queueAttentionBox = await page
        .getByRole('heading', { name: 'Needs attention', exact: true })
        .boundingBox()
    const queuePublicationsBox = await page
        .getByRole('heading', { name: 'Publications', exact: true })
        .boundingBox()
    expect(queueAttentionBox?.y).toBeLessThan(queuePublicationsBox?.y ?? Number.POSITIVE_INFINITY)

    await page.getByRole('tab', { name: 'Needs attention (1)', exact: true }).click()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 1' })).toHaveCount(1)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 2' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Scheduled (4)', exact: true }).click()
    await expect(page.locator('a[href*="/publications/"]')).toHaveCount(4)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 1' })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 4' })).toBeVisible()

    await page.getByRole('tab', { name: 'Manual (4)', exact: true }).click()
    await expect(page.locator('a[href*="/publications/"]')).toHaveCount(4)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 2' })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 8' })).toBeVisible()
})

test('expands a dense ReUI calendar day in place', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const scheduledAt = currentMonthNoon()
    const channelName = 'Calendar review destination channel with a deliberately long name'
    const publications = Array.from({ length: 6 }, (_, index) =>
        publicationFixture({
            channelName,
            deliveryMode: 'automatic',
            id: `e2e-122-reui-publication-${index + 1}-${suffix}`,
            postTitle: `E2E-122 ReUI publication ${index + 1} ${suffix}`,
            projectId,
            scheduledAt,
            state: 'scheduled',
        })
    )

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

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    publications,
                    nextCursor: null,
                    summary: { total: 6, manual: 0, automatic: 6, scheduled: 6 },
                }),
            })
        }
    )
    await page.route(`**/api/projects/${projectId}/publications/due`, async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ publications: [] }),
        })
    })

    await page.goto(`/dashboard/projects/${projectId}/overview?calendar=reui`)
    const calendar = page.locator('[data-calendar-experiment="reui"]')
    await expect(calendar).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(calendar.locator('[data-calendar-view="agenda"]')).toBeVisible()
    await expect(calendar.locator('[data-slot="event-calendar-month-view"]')).toHaveCount(0)
    const narrowAgendaLayout = await calendar
        .locator('[data-calendar-view="agenda"]')
        .evaluate(element => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            rows: Array.from(element.querySelectorAll('button')).map(button => {
                const channel = button.children[2]
                const channelStyle = channel === undefined ? null : getComputedStyle(channel)
                return {
                    buttonClientWidth: button.clientWidth,
                    buttonScrollWidth: button.scrollWidth,
                    channelOverflow: channelStyle?.overflow,
                    channelTextOverflow: channelStyle?.textOverflow,
                }
            }),
        }))
    expect(narrowAgendaLayout.scrollWidth).toBeLessThanOrEqual(narrowAgendaLayout.clientWidth)
    expect(
        narrowAgendaLayout.rows.every(
            row =>
                row.buttonScrollWidth <= row.buttonClientWidth &&
                row.channelOverflow === 'hidden' &&
                row.channelTextOverflow === 'ellipsis'
        )
    ).toBe(true)

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(calendar.locator('[data-slot="event-calendar-month-view"]')).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(calendar.locator('[data-calendar-view="agenda"]')).toBeVisible()
    await calendar.getByRole('button', { name: 'Month', exact: true }).click()
    const narrowMonth = calendar.locator('[data-calendar-view="month"]')
    await expect(narrowMonth).toBeVisible()
    const monthScroll = await narrowMonth.evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
    }))
    expect(monthScroll.scrollWidth).toBeGreaterThan(monthScroll.clientWidth)

    await page.setViewportSize({ width: 768, height: 900 })
    await expect(calendar.locator('[data-calendar-view="month"]')).toBeVisible()
    await expect(calendar.locator('[data-calendar-view="agenda"]')).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(calendar.locator('[data-slot="event-calendar-month-view"]')).toBeVisible()
    await expect(calendar.locator('[data-slot="event-calendar-month-header"]').first()).toHaveCSS(
        'column-gap',
        '2px'
    )
    await expect(calendar.locator('[data-slot="event-calendar-month-row"]').first()).toHaveCSS(
        'column-gap',
        '2px'
    )
    await expect(calendar.locator('[data-slot="event-calendar-month-cell"]').first()).toHaveCSS(
        'border-right-width',
        '0px'
    )

    await calendar.getByRole('button', { name: 'Week', exact: true }).click()
    const weekView = calendar.locator('[data-calendar-view="week"]')
    await expect(weekView).toBeVisible()
    await expect(weekView.locator('[data-slot="event-calendar-time-grid"]')).toBeVisible()
    await expect(weekView.locator('[data-slot="event-calendar-event"]')).toHaveCount(6)
    const weekScrollTop = await page
        .locator('[data-dashboard-scroll]')
        .evaluate(element => element.scrollTop)
    expect(weekScrollTop).toBeGreaterThan(0)
    await expect(weekView.locator('[data-slot="event-calendar-event"]').first()).toBeInViewport()
    await expect(
        weekView.locator('[data-slot="event-calendar-time-grid-column-resize"]')
    ).toHaveCount(6)
    const dayColumnWidths = await weekView
        .locator('[data-slot="event-calendar-time-grid-day-header"]')
        .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))
    expect(dayColumnWidths.every(width => width >= 152)).toBe(true)
    const columnResizeHandle = weekView
        .locator('[data-slot="event-calendar-time-grid-column-resize"]')
        .first()
    await columnResizeHandle.focus()
    await columnResizeHandle.press('ArrowRight')
    const keyboardResizedWidths = await weekView
        .locator('[data-slot="event-calendar-time-grid-day-header"]')
        .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))
    expect(keyboardResizedWidths[0]).toBeGreaterThan(dayColumnWidths[0] ?? 0)
    await columnResizeHandle.press('Home')
    const handleBox = await columnResizeHandle.boundingBox()
    if (handleBox === null) throw new Error('Column resize handle has no layout box')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(
        handleBox.x + handleBox.width / 2 + 24,
        handleBox.y + handleBox.height / 2
    )
    await page.mouse.up()
    const pointerResizedWidths = await weekView
        .locator('[data-slot="event-calendar-time-grid-day-header"]')
        .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))
    expect(pointerResizedWidths[0]).toBeGreaterThan(dayColumnWidths[0] ?? 0)
    const resizedFirstColumnWidth = pointerResizedWidths[0] ?? 0
    await calendar.getByRole('button', { name: 'Month', exact: true }).click()
    await expect(calendar.locator('[data-calendar-view="month"]')).toBeVisible()
    await calendar.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(calendar.locator('[data-calendar-view="week"]')).toBeVisible()
    const restoredColumnWidths = await weekView
        .locator('[data-slot="event-calendar-time-grid-day-header"]')
        .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))
    expect(restoredColumnWidths[0]).toBe(resizedFirstColumnWidth)
    await columnResizeHandle.focus()
    await columnResizeHandle.press('Home')
    for (const index of Array.from({ length: 6 }, (_, item) => item + 1)) {
        await expect(
            weekView.getByText(`E2E-122 ReUI publication ${index} ${suffix}`, { exact: true })
        ).toBeVisible()
    }
    const emptyTimeSlot = weekView
        .locator('[data-slot="event-calendar-time-slot"][data-empty]')
        .first()
    const denseTimeSlot = weekView
        .locator('[data-slot="event-calendar-time-slot"]')
        .filter({ hasText: `E2E-122 ReUI publication 1 ${suffix}` })
        .first()
    const emptyTimeSlotBox = await emptyTimeSlot.boundingBox()
    const denseTimeSlotBox = await denseTimeSlot.boundingBox()
    expect(denseTimeSlotBox?.height).toBeGreaterThan(emptyTimeSlotBox?.height ?? 0)

    const createSlot = weekView.locator('[data-slot="event-calendar-time-slot-add"]').first()
    await createSlot.click()
    const composeUrl = new URL(page.url())
    expect(composeUrl.pathname).toBe(`/dashboard/projects/${projectId}/compose`)
    expect(composeUrl.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(composeUrl.searchParams.get('time')).toBe('00:00')
    await expect(page.getByRole('heading', { name: 'Compose', exact: true })).toBeVisible()
    await expect(page.locator('input[type="datetime-local"]').first()).toHaveValue(
        `${composeUrl.searchParams.get('date')}T00:00`
    )

    await page.goto(`/dashboard/projects/${projectId}/overview?calendar=reui`)
    await expect(calendar.locator('[data-calendar-view="month"]')).toBeVisible()
    await calendar.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(calendar.locator('[data-calendar-view="week"]')).toBeVisible()
    const weekViewAfterCreate = calendar.locator('[data-calendar-view="week"]')
    await expect(weekViewAfterCreate.locator('[data-slot="event-calendar-event"]')).toHaveCount(6)
    await weekViewAfterCreate.getByRole('button', { name: /E2E-122 ReUI publication 1/ }).click()
    await expect(
        page.getByRole('heading', { name: `E2E-122 ReUI publication 1 ${suffix}`, exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await calendar.getByRole('button', { name: 'Day', exact: true }).click()
    const dayView = calendar.locator('[data-calendar-view="day"]')
    await expect(dayView).toBeVisible()
    await expect(dayView.locator('[data-slot="event-calendar-time-grid"]')).toBeVisible()
    await expect(dayView.locator('[data-slot="event-calendar-event"]')).toHaveCount(6)

    await page.setViewportSize({ width: 390, height: 844 })
    await calendar.getByRole('button', { name: 'Week', exact: true }).click()
    const narrowWeek = calendar.locator('[data-calendar-view="week"]')
    await expect(narrowWeek).toBeVisible()
    const weekScroll = await narrowWeek
        .locator('[data-slot="event-calendar-time-grid"] > div')
        .evaluate(element => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
        }))
    expect(weekScroll.scrollWidth).toBeGreaterThan(weekScroll.clientWidth)

    await calendar.getByRole('button', { name: 'Day', exact: true }).click()
    const narrowDay = calendar.locator('[data-calendar-view="day"]')
    await expect(narrowDay).toBeVisible()
    await expect(narrowDay.locator('[data-slot="event-calendar-event"]')).toHaveCount(6)

    await page.setViewportSize({ width: 1280, height: 900 })
    await calendar.getByRole('button', { name: 'Month', exact: true }).click()
    await expect(calendar.locator('[data-slot="event-calendar-month-view"]')).toBeVisible()

    const denseCell = calendar
        .locator('[data-slot="event-calendar-month-cell"]')
        .filter({ hasText: `E2E-122 ReUI publication 1 ${suffix}` })
        .first()
    await expect(denseCell).toBeVisible()
    await expect(denseCell.locator('[data-slot="event-calendar-event"]')).toHaveCount(5)
    await expect(denseCell.getByText('+1 more', { exact: true })).toBeVisible()

    const collapsedBox = await denseCell.boundingBox()
    await denseCell.locator('[data-slot="event-calendar-month-day-number"]').click()
    await expect(denseCell).toHaveAttribute('data-expanded', 'true')
    await expect(denseCell.locator('[data-slot="event-calendar-event"]')).toHaveCount(6)
    await expect(denseCell.locator('[data-slot="event-calendar-more"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="publication-calendar-day-details"]')).toHaveCount(0)
    const expandedBox = await denseCell.boundingBox()
    expect(expandedBox?.height).toBeGreaterThan(collapsedBox?.height ?? 0)

    await denseCell.locator('[data-slot="event-calendar-month-day-number"]').click()
    await expect(denseCell).not.toHaveAttribute('data-expanded', 'true')
    await expect(denseCell.getByText('+1 more', { exact: true })).toBeVisible()

    await denseCell.getByText('+1 more', { exact: true }).click()
    await expect(denseCell).toHaveAttribute('data-expanded', 'true')
    await expect(denseCell.locator('[data-slot="event-calendar-event"]')).toHaveCount(6)
    await expect(calendar.locator('[data-slot="event-calendar-more-popover"]')).toHaveCount(0)

    await denseCell.getByRole('button', { name: /E2E-122 ReUI publication 1/ }).click()
    await expect(
        page.getByRole('heading', { name: `E2E-122 ReUI publication 1 ${suffix}`, exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(denseCell).toHaveAttribute('data-expanded', 'true')
})

function publicationFixture(input: {
    readonly channelName: string
    readonly deliveryMode: 'automatic' | 'manual'
    readonly id: string
    readonly postTitle: string
    readonly projectId: string
    readonly scheduledAt: number | null
    readonly state: 'draft' | 'ready' | 'scheduled'
}) {
    return {
        channelId: `${input.id}-channel`,
        channelName: input.channelName,
        createdAt: input.scheduledAt ?? 1,
        createdByActorId: 'e2e-122-actor',
        deliveryMode: input.deliveryMode,
        draftDiffersFromTarget: false,
        draftReviewState: 'compatible' as const,
        draftRevision: 1,
        errorMessage: null,
        externalId: null,
        externalUrl: null,
        id: input.id,
        lastAssessedProfileVersionId: 'e2e-122-profile',
        postId: `${input.id}-post`,
        postTitle: input.postTitle,
        profileAssessmentIssues: [],
        publishedAt: null,
        publishedByActorId: null,
        projectId: input.projectId,
        reviewState: 'compatible' as const,
        scheduledAt: input.scheduledAt,
        scheduledByActorId: 'e2e-122-actor',
        state: input.state,
        stateChangedByActorId: 'e2e-122-actor',
        targetRevisionId: `${input.id}-target`,
        updatedAt: input.scheduledAt ?? 1,
    }
}

function currentMonthNoon() {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate(), 28), 12)
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-122 populated ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-122-populated-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-122-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByText('Create project', { exact: true }).click()
    await page.locator('#new-project').fill(`E2E-122 populated project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
