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

    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const overviewSummary = page.getByLabel('Overview summary', { exact: true })
    await expect(overviewSummary).toContainText('4 scheduled')
    await expect(overviewSummary).toContainText('4 unscheduled')
    await expect(overviewSummary).toContainText('1 needs attention')
    const overviewCalendar = page.locator('[data-calendar="reui"]')
    await expect(overviewCalendar).toBeVisible()
    await expect(overviewCalendar.locator('[data-calendar-view="month"]')).toBeVisible()
    await expect(overviewCalendar.locator('[data-slot="event-calendar-event"]')).toHaveCount(4)

    let cancelPayload: { publicationIds: string[] } | null = null
    await page.route(`**/api/projects/${projectId}/publications/cancel`, async route => {
        if (route.request().method() !== 'PATCH') {
            await route.continue()
            return
        }

        const body = route.request().postDataJSON() as { publicationIds: string[] }
        cancelPayload = body
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                publications: publications
                    .filter(publication => body.publicationIds.includes(publication.id))
                    .map(publication => ({ ...publication, state: 'cancelled' })),
            }),
        })
    })

    await overviewCalendar.getByRole('button', { name: 'Select', exact: true }).click()
    const calendarEvents = overviewCalendar.locator('[data-slot="event-calendar-event"]')
    const firstSelectedEvent = calendarEvents.filter({ hasText: 'E2E-122 publication 2' })
    const secondSelectedEvent = calendarEvents.filter({ hasText: 'E2E-122 publication 3' })
    await firstSelectedEvent.click()
    await secondSelectedEvent.click()
    await expect(firstSelectedEvent).toHaveAttribute('aria-pressed', 'true')
    await expect(secondSelectedEvent).toHaveAttribute('aria-pressed', 'true')
    const calendarBulkActionBar = page.locator('[data-bulk-action-bar="true"]')
    await expect(calendarBulkActionBar).toContainText('2 selected')
    await expect(
        calendarBulkActionBar.getByRole('button', { name: 'Reschedule', exact: true })
    ).toBeEnabled()
    await expect(
        calendarBulkActionBar.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeEnabled()
    await calendarBulkActionBar.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
        page.getByRole('heading', { name: 'Cancel 2 publications', exact: true })
    ).toBeVisible()
    await expect.poll(() => cancelPayload).toBeNull()
    await page.locator('[data-bulk-cancel-confirm="true"]').click()
    await expect
        .poll(() => cancelPayload)
        .toEqual({
            publicationIds: [publications[1]!.id, publications[2]!.id],
        })
    await expect(calendarBulkActionBar).toHaveCount(0)
    await overviewCalendar.getByRole('button', { name: 'Done', exact: true }).click()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('[data-calendar-view="agenda"]')).toBeVisible()

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'All (8)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Needs attention (1)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Scheduled (3)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Drafts (4)', exact: true })).toBeVisible()
    const deliveryFilter = page.getByRole('combobox', { name: 'Delivery', exact: true })
    await expect(deliveryFilter).toContainText('All delivery modes')
    await expect(page.locator('a[data-publication-edit-link="true"]')).toHaveCount(8)
    await expect(page.locator('[data-queue-publication-list="true"]')).toHaveCount(1)
    const publicationTable = page.locator('[data-publication-table-header="true"]')
    await expect(publicationTable).toContainText('Publication')
    await expect(publicationTable).toContainText('Destination')
    await expect(publicationTable).toContainText('Action')
    await expect(
        publicationTable.locator('[data-queue-select-all="true"] input[type="checkbox"]')
    ).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Needs attention (1)', exact: true }).click()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 1' })).toHaveCount(1)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 2' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark published', exact: true })).toBeVisible()

    await page.getByRole('tab', { name: 'Scheduled (3)', exact: true }).click()
    await expect(page.locator('a[data-publication-edit-link="true"]')).toHaveCount(3)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 1' })).toHaveCount(0)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 2' })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 4' })).toBeVisible()

    await deliveryFilter.click()
    await page.getByRole('option', { name: 'Manual delivery', exact: true }).click()
    await expect(page).toHaveURL(/\/queue\?filter=manual$/)
    await expect(page.locator('a[data-publication-edit-link="true"]')).toHaveCount(4)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 2' })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 8' })).toBeVisible()
})

test('expands a dense ReUI calendar day in place', async ({ page }) => {
    // This scenario intentionally exercises the full responsive calendar matrix;
    // allow parallel E2E workers enough time without weakening any assertion.
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const scheduledAt = currentMonthAt(23, 30)
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

    await page.goto(`/dashboard/projects/${projectId}/overview`)
    const calendar = page.locator('[data-calendar="reui"]')
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
    const outsideMonthCell = calendar
        .locator('[data-slot="event-calendar-month-cell"][data-outside]')
        .first()
    await expect(outsideMonthCell).toBeVisible()
    await expect
        .poll(() => outsideMonthCell.evaluate(element => getComputedStyle(element).backgroundImage))
        .toContain('repeating-linear-gradient')

    await calendar.getByRole('button', { name: 'Month', exact: true }).focus()
    await page.keyboard.press('W')
    await expect(calendar.locator('[data-calendar-view="week"]')).toBeVisible()
    const keyboardWeekUrl = new URL(page.url())
    expect(keyboardWeekUrl.searchParams.get('view')).toBe('week')
    expect(keyboardWeekUrl.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const keyboardWeekDate = keyboardWeekUrl.searchParams.get('date')
    await page.keyboard.press(']')
    await expect.poll(() => new URL(page.url()).searchParams.get('date')).not.toBe(keyboardWeekDate)
    const keyboardNextDate = new URL(page.url()).searchParams.get('date')
    await page.reload()
    await expect(calendar.locator('[data-calendar-view="week"]')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('view')).toBe('week')
    expect(new URL(page.url()).searchParams.get('date')).toBe(keyboardNextDate)

    await page.goto(`/dashboard/projects/${projectId}/overview`)
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
    const selectedWeekButton = calendar.getByRole('button', { name: 'Week', exact: true })
    await expect(selectedWeekButton).toHaveAttribute('aria-pressed', 'true')
    await expect(selectedWeekButton.locator('[data-slot="kbd"]')).toHaveText('W')
    await expect(selectedWeekButton.locator('[data-slot="kbd"]')).toHaveCSS('height', '16px')
    await expect(selectedWeekButton.locator('[data-slot="kbd"]')).toHaveClass(/bg-current\/10/)
    const kbdBackground = await selectedWeekButton
        .locator('[data-slot="kbd"]')
        .evaluate(element => getComputedStyle(element).backgroundColor)
    expect(kbdBackground).not.toBe('rgba(0, 0, 0, 0)')
    await expect(calendar.locator('[data-slot="kbd"]')).toHaveText(['M', 'W', 'D', 'A'])
    await expect(selectedWeekButton).toHaveClass(/bg-surface-raised/)
    await expect(weekView.locator('[data-slot="event-calendar-time-grid"]')).toBeVisible()
    await expect(weekView.locator('[data-slot="event-calendar-event"]')).toHaveCount(6)
    await expect(
        weekView
            .locator('[data-slot="event-calendar-time-slot"]')
            .filter({ hasText: `E2E-122 ReUI publication 1 ${suffix}` })
            .first()
    ).toHaveAttribute('data-time', '23:00')
    const weekScrollSurface = weekView.locator('[data-slot="event-calendar-time-grid-scroll"]')
    await expect(weekScrollSurface).toHaveAttribute('data-scroll-mode', 'contained')
    const weekScrollTop = await weekScrollSurface.evaluate(element => element.scrollTop)
    expect(weekScrollTop).toBeGreaterThan(0)
    const weekVisibleTimes = await visibleCalendarTimes(weekScrollSurface)
    expect(weekVisibleTimes).not.toContain('00:00')
    expect(weekVisibleTimes).toContain('23:00')
    const firstWeekEventBox = await weekView
        .locator('[data-slot="event-calendar-event"]')
        .first()
        .boundingBox()
    const weekScrollBox = await weekScrollSurface.boundingBox()
    expect(
        (firstWeekEventBox?.y ?? Number.POSITIVE_INFINITY) + (firstWeekEventBox?.height ?? 0)
    ).toBeGreaterThan(weekScrollBox?.y ?? 0)
    expect(firstWeekEventBox?.y).toBeLessThan(
        (weekScrollBox?.y ?? 0) + (weekScrollBox?.height ?? 0)
    )
    await page.reload()
    await expect(calendar.locator('[data-calendar-view="week"]')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('view')).toBe('week')
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
    const denseSlotAdd = denseTimeSlot.locator('[data-slot="event-calendar-time-slot-add"]')
    await expect(denseTimeSlot.locator('[data-slot="event-calendar-time-slot-frame"]')).toHaveCount(
        0
    )
    await expect(denseSlotAdd).toHaveCSS('opacity', '0')
    await expect(denseSlotAdd).toHaveCSS('pointer-events', 'none')
    await expect(denseTimeSlot.locator('[data-slot="event-calendar-event"]')).toHaveCount(6)
    const denseTimeSlotBeforeHoverBox = await denseTimeSlot.boundingBox()
    await denseTimeSlot.hover()
    await expect(denseSlotAdd).toHaveCSS('opacity', '1')
    await expect(denseSlotAdd).toHaveCSS('pointer-events', 'auto')
    const denseSlotAddBox = await denseSlotAdd.boundingBox()
    const firstDenseEventBox = await denseTimeSlot
        .locator('[data-slot="event-calendar-event"]')
        .first()
        .boundingBox()
    const denseTimeSlotBox = await denseTimeSlot.boundingBox()
    expect(denseSlotAddBox?.x).toBeGreaterThanOrEqual(denseTimeSlotBox?.x ?? 0)
    expect((denseSlotAddBox?.x ?? 0) + (denseSlotAddBox?.width ?? 0)).toBeLessThanOrEqual(
        (denseTimeSlotBox?.x ?? 0) + (denseTimeSlotBox?.width ?? 0)
    )
    expect(denseSlotAddBox?.y).toBeGreaterThanOrEqual(denseTimeSlotBox?.y ?? 0)
    expect((denseSlotAddBox?.y ?? 0) + (denseSlotAddBox?.height ?? 0)).toBeLessThanOrEqual(
        (denseTimeSlotBox?.y ?? 0) + (denseTimeSlotBox?.height ?? 0)
    )
    expect(denseSlotAddBox?.y).toBeLessThanOrEqual(
        firstDenseEventBox?.y ?? Number.POSITIVE_INFINITY
    )
    const denseSlotStackZIndex = await denseTimeSlot
        .locator('[data-slot="event-calendar-event"]')
        .first()
        .evaluate(element => getComputedStyle(element.parentElement ?? element).zIndex)
    const denseSlotAddZIndex = await denseSlotAdd.evaluate(
        element => getComputedStyle(element).zIndex
    )
    expect(Number(denseSlotAddZIndex)).toBeGreaterThan(Number(denseSlotStackZIndex))
    expect(denseTimeSlotBox?.height).toBe(denseTimeSlotBeforeHoverBox?.height)
    expect(denseTimeSlotBox?.width).toBe(denseTimeSlotBeforeHoverBox?.width)
    await expect(
        weekView.locator('[data-slot="event-calendar-time-slot"][data-empty]').first()
    ).toHaveCount(1)
    const emptySlotAdd = emptyTimeSlot.locator('[data-slot="event-calendar-time-slot-add"]')
    await expect(emptyTimeSlot.locator('[data-slot="event-calendar-time-slot-frame"]')).toHaveCount(
        0
    )
    await expect(emptySlotAdd).toHaveCSS('opacity', '0')
    await emptyTimeSlot.hover()
    await expect(emptySlotAdd).toHaveCSS('opacity', '1')
    const emptyTimeSlotBox = await emptyTimeSlot.boundingBox()
    expect(denseTimeSlotBox?.height).toBeGreaterThan(emptyTimeSlotBox?.height ?? 0)

    await weekScrollSurface.evaluate(element => {
        element.scrollLeft = element.scrollWidth - element.clientWidth
    })
    await expect
        .poll(() => weekScrollSurface.evaluate(element => element.scrollLeft))
        .toBeGreaterThan(0)
    const scrollSurfaceBox = await weekScrollSurface.boundingBox()
    const timeGutter = weekView.locator('[data-slot="event-calendar-time-gutter-slot"]').first()
    await expect(timeGutter).toHaveCSS('position', 'sticky')
    const timeGutterBox = await timeGutter.boundingBox()
    expect(Math.abs((timeGutterBox?.x ?? 0) - (scrollSurfaceBox?.x ?? 0))).toBeLessThanOrEqual(1)
    await weekScrollSurface.evaluate(element => {
        element.scrollLeft = 0
    })

    await emptySlotAdd.click()
    const newPublicationUrl = new URL(page.url())
    expect(newPublicationUrl.pathname).toBe(`/dashboard/projects/${projectId}/publications/new`)
    expect(newPublicationUrl.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(newPublicationUrl.searchParams.get('time')).toBe('00:00')
    await expect(page.getByLabel('Content', { exact: true })).toBeVisible()
    await expect(page.locator('input[type="datetime-local"]').first()).toHaveValue(
        `${newPublicationUrl.searchParams.get('date')}T00:00`
    )

    await page.goto(`/dashboard/projects/${projectId}/overview`)
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
    expect(new URL(page.url()).searchParams.get('view')).toBe('day')
    await page.reload()
    await expect(calendar.locator('[data-calendar-view="day"]')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('view')).toBe('day')

    await page.setViewportSize({ width: 390, height: 844 })
    await calendar.getByRole('button', { name: 'Week', exact: true }).click()
    const narrowWeek = calendar.locator('[data-calendar-view="week"]')
    await expect(narrowWeek).toBeVisible()
    const weekScroll = await narrowWeek
        .locator('[data-slot="event-calendar-time-grid-scroll"] > div')
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

async function visibleCalendarTimes(scrollSurface: ReturnType<Page['locator']>): Promise<string[]> {
    return scrollSurface.evaluate(element => {
        const container = element.getBoundingClientRect()
        const header = element.querySelector<HTMLElement>(
            '[data-slot="event-calendar-time-grid-header"]'
        )
        const contentTop = Math.max(
            container.top,
            header?.getBoundingClientRect().bottom ?? container.top
        )
        const visible = Array.from(
            element.querySelectorAll<HTMLElement>('[data-slot="event-calendar-time-slot"]')
        )
            .filter(slot => {
                const rect = slot.getBoundingClientRect()
                return rect.bottom > contentTop && rect.top < container.bottom
            })
            .map(slot => slot.dataset.time ?? '')
        return [...new Set(visible)]
    })
}

function currentMonthNoon() {
    return currentMonthAt(12)
}

function currentMonthAt(hour: number, minute = 0) {
    const now = new Date()
    return Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        Math.min(now.getUTCDate(), 28),
        hour,
        minute
    )
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

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
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
