import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

const e2eApiPort = process.env.HERALD_E2E_API_PORT
if (e2eApiPort === undefined) {
    throw new Error('HERALD_E2E_API_PORT must be set by the Playwright E2E runtime')
}
const e2eApiOrigin = `http://127.0.0.1:${e2eApiPort}`

const mediaFilename = 'herald-e2e-pixel.png'
const mediaBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
)

type LayoutRectangle = {
    right: number
    left: number
    top: number
    width: number
    height: number
}

type LayoutElement = {
    getBoundingClientRect: () => LayoutRectangle
    parentElement: LayoutElement | null
    querySelector: (selector: string) => LayoutElement | null
    querySelectorAll: (selector: string) => ArrayLike<LayoutElement>
}

type LayoutView = {
    getComputedStyle: (element: unknown) => {
        position: string
    }
}

test('persists mixed and media-only publications through the dashboard', async ({
    page,
    request,
}) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const projectName = `E2E-33 Project ${suffix}`
    const channelName = `E2E-33 Channel ${suffix}`
    const secondChannelName = `E2E-33 Second channel ${suffix}`
    const mixedTitle = `E2E-33 Mixed ${suffix}`
    const mediaOnlyTitle = `E2E-33 Media only ${suffix}`
    const sourceText = `E2E-33 source ${suffix}`
    const targetText = `E2E-33 target ${suffix}`
    const secondTargetText = `E2E-33 second target ${suffix}`
    const scheduledDateTime = localDateTimeInHours(2)

    const readinessResponse = await request.get(`${e2eApiOrigin}/ready`)
    expect(readinessResponse.status()).toBe(200)
    expect(await readinessResponse.json()).toEqual({
        status: 'ready',
        checks: {
            database: 'ok',
            scheduler: 'started',
            mediaMaintenance: 'started',
            notifications: 'started',
        },
    })

    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(
        page.getByRole('heading', { name: 'Sign in to Herald.', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill('E2E-33 Operator')
    await page.getByLabel('Email').fill(`e2e-33-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-33-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toHaveCount(0)
    const dashboardLogo = page.locator('a[aria-label="Herald workspace"] svg')
    await expect(dashboardLogo).toBeVisible()
    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)
    await expect(dashboardLogo).toHaveAttribute('viewBox', '0 0 189 189')
    await expect(dashboardLogo.locator('[fill="currentColor"]')).toHaveCount(5)
    await expect(page.locator('a[aria-label="Herald workspace"]')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)'
    )

    await expect(
        page.getByRole('button', { name: 'Switch to light theme', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    await expect(
        page.getByRole('button', { name: 'Switch to dark theme', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click()
    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(
        page.getByRole('button', { name: 'Changer la langue pour Anglais', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Changer la langue pour Anglais', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Anglais', exact: true }).click()
    await expect(
        page.getByRole('button', { name: 'Switch language to French', exact: true })
    ).toBeVisible()

    await page.getByRole('button', { name: 'Open account menu', exact: true }).click()
    await expect(page.getByText(`e2e-33-${suffix}@herald.local`, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Toggle workspace navigation' }).click()
    const workNavigationLayout = await page
        .getByRole('navigation', { name: 'Work navigation' })
        .evaluate(element => {
            const links = Array.from(element.querySelectorAll('a'))
            const topOffsets = new Set(
                links.map(link =>
                    Math.round(
                        (
                            link as { getBoundingClientRect(): { top: number } }
                        ).getBoundingClientRect().top
                    )
                )
            )
            return { linkCount: links.length, topOffsetCount: topOffsets.size }
        })
    const projectNavigationLayout = await page
        .getByRole('navigation', { name: 'Project management navigation' })
        .evaluate(element => {
            const links = Array.from(element.querySelectorAll('a'))
            const topOffsets = new Set(
                links.map(link =>
                    Math.round(
                        (
                            link as { getBoundingClientRect(): { top: number } }
                        ).getBoundingClientRect().top
                    )
                )
            )
            return { linkCount: links.length, topOffsetCount: topOffsets.size }
        })
    expect(workNavigationLayout).toEqual({ linkCount: 2, topOffsetCount: 2 })
    expect(projectNavigationLayout).toEqual({ linkCount: 3, topOffsetCount: 3 })
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.setViewportSize({ width: 1280, height: 720 })

    await page.getByRole('button', { name: 'Toggle workspace navigation' }).click()
    const sidebarContainer = page.locator('[data-slot="sidebar-container"]')
    await expect(sidebarContainer).toHaveCSS('width', '64px')
    const collapsedSidebarLayout = await sidebarContainer.evaluate(container => {
        const sidebar = container as unknown as LayoutElement
        const containerRectangle = sidebar.getBoundingClientRect()
        const buttons = Array.from(sidebar.querySelectorAll('[data-slot="sidebar-menu-button"]'))
        return {
            containerWidth: Math.round(containerRectangle.width),
            buttons: buttons.map(button => {
                const rectangle = button.getBoundingClientRect()
                return {
                    left: Math.round(rectangle.left),
                    width: Math.round(rectangle.width),
                }
            }),
        }
    })
    expect(collapsedSidebarLayout.containerWidth).toBe(64)
    expect(collapsedSidebarLayout.buttons.length).toBeGreaterThan(0)
    expect(
        collapsedSidebarLayout.buttons.every(({ left, width }) => left === 8 && width === 48)
    ).toBe(true)
    await page.getByRole('button', { name: 'Toggle workspace navigation' }).click()
    await expect(sidebarContainer).toHaveCSS('width', '240px')

    const shellLayout = await page.locator('[data-slot="sidebar-inset"]').evaluate(inset => {
        const shell = inset as unknown as LayoutElement & {
            ownerDocument: { defaultView: LayoutView }
        }
        const header = shell.querySelector('[data-dashboard-header]')
        const scrollRegion = shell.querySelector('[data-dashboard-scroll]')
        const headerRectangle = header?.getBoundingClientRect()
        const scrollRectangle = scrollRegion?.getBoundingClientRect()
        return {
            headerIsSiblingToScroll:
                header?.parentElement !== null &&
                header?.parentElement === scrollRegion?.parentElement,
            headerPosition:
                header === null
                    ? null
                    : shell.ownerDocument.defaultView.getComputedStyle(header).position,
            headerTop: headerRectangle === undefined ? null : Math.round(headerRectangle.top),
            scrollTop: scrollRectangle === undefined ? null : Math.round(scrollRectangle.top),
        }
    })
    expect(shellLayout).toMatchObject({
        headerIsSiblingToScroll: true,
        headerPosition: 'sticky',
    })
    expect(shellLayout.scrollTop).toBeGreaterThan(shellLayout.headerTop ?? 0)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    const desktopProjectForm = page.locator('form').filter({ has: page.locator('#new-project') })
    await page.locator('#new-project').fill(projectName)
    await desktopProjectForm.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Select project' }).first()).toHaveText(
        projectName
    )
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await page.getByRole('button', { name: 'Open notifications', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
    await expect(page.getByText('No notifications', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open notification preferences', exact: true }).click()
    await expect(
        page.getByRole('heading', { name: 'Notification preferences', exact: true })
    ).toBeVisible()
    const failedPublicationPreference = page.getByRole('switch', {
        name: 'Failed publications: enabled',
        exact: true,
    })
    await expect(failedPublicationPreference).toBeVisible()
    await failedPublicationPreference.click()
    await expect(
        page.getByRole('switch', { name: 'Failed publications: disabled', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Back to notifications', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    const overviewLayout = await page.locator('[data-dashboard-scroll]').evaluate(scrollRegion => ({
        clientHeight: (scrollRegion as unknown as { clientHeight: number }).clientHeight,
        scrollHeight: (scrollRegion as unknown as { scrollHeight: number }).scrollHeight,
    }))
    expect(overviewLayout.scrollHeight).toBeGreaterThan(overviewLayout.clientHeight)

    await page.getByRole('link', { name: 'Access', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/access$/)
    await expect(page.getByRole('heading', { name: 'Project access', level: 1 })).toBeVisible()
    await expect(page.getByText('No project tokens', { exact: true })).toBeVisible()

    const tokenName = `E2E-68 token ${suffix}`
    await page.getByLabel('Name', { exact: true }).fill(tokenName)
    await page.getByRole('button', { name: 'Create token', exact: true }).click()
    await expect(
        page.getByRole('heading', { name: `Token created for ${tokenName}` })
    ).toBeVisible()
    const tokenSecret = await page.locator('code').innerText()
    expect(tokenSecret).toMatch(/^herald_pat_[A-Za-z0-9]+$/)
    await expect(page.getByText('Shown once', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('code')).toHaveCount(0)
    await expect(page.getByText(tokenName, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Revoke this token?' })).toBeVisible()
    await page.getByRole('button', { name: 'Revoke token', exact: true }).click()
    await expect(
        page
            .getByRole('listitem')
            .filter({ hasText: tokenName })
            .getByRole('button', { name: 'Revoked', exact: true })
    ).toBeVisible()

    await page.goto('/dashboard/settings/provider-applications')
    await expect(page).toHaveURL(/\/dashboard\/settings\/provider-applications$/)
    await expect(
        page.getByRole('heading', { name: 'Provider applications', level: 1 })
    ).toBeVisible()
    await expect(page.getByText('No provider applications', { exact: true })).toBeVisible()

    await page.goto('/dashboard')
    await page.getByRole('link', { name: 'Overview', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
    const overviewCalendar = page.locator('[data-calendar="reui"]')
    await expect(overviewCalendar).toBeVisible()
    await expect(overviewCalendar.locator('[data-calendar-view="month"]')).toBeVisible()
    const emptyCalendarNewPublication = page.locator(
        'a[data-slot="button"][href*="/publications/new?date="]'
    )
    await expect(emptyCalendarNewPublication).toHaveAttribute(
        'href',
        /\/dashboard\/projects\/[^/]+\/publications\/new\?date=\d{4}-\d{2}-\d{2}$/
    )
    await emptyCalendarNewPublication.click()
    await expect(page).toHaveURL(
        /\/dashboard\/projects\/[^/]+\/publications\/new\?date=\d{4}-\d{2}-\d{2}$/
    )
    await expect(page.getByLabel('Schedule').first()).toHaveValue(/T09:00$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/channels$/)

    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByLabel('Channel name')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Profile', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await page
        .locator('[data-slot="sidebar"]')
        .getByRole('button', { name: 'New publication', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/publications\/new$/)

    const newPublicationEditor = page.locator('[data-new-publication-editor="true"]')
    await expect(newPublicationEditor).toBeVisible()
    await expect(newPublicationEditor.locator('[data-media-picker="true"]')).toHaveCount(1)
    expect(
        await newPublicationEditor
            .locator('[data-media-picker="true"]')
            .evaluate(media => media.parentElement?.getAttribute('data-new-publication-editor'))
    ).toBe('true')

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    const channelProfile = page.getByRole('combobox', { name: 'Profile', exact: true })
    await channelProfile.click()
    await page.getByRole('option', { name: 'LinkedIn text', exact: true }).click()
    await page.getByLabel('Channel name').fill(secondChannelName)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(
        page.getByRole('paragraph').filter({ hasText: secondChannelName }).first()
    ).toBeVisible()
    const channelSidebarLayout = await page
        .locator('[data-slot="sidebar-menu-item"]')
        .filter({ hasText: channelName })
        .first()
        .evaluate(item => {
            const row = item as unknown as LayoutElement
            const button = row.querySelector('[data-slot="sidebar-menu-button"]')
            const label = button?.querySelector('span.truncate')
            const badge = button?.querySelector('[data-slot="sidebar-menu-badge"]')
            const labelRectangle = label?.getBoundingClientRect()
            const badgeRectangle = badge?.getBoundingClientRect()
            return {
                overlap:
                    labelRectangle === undefined || badgeRectangle === undefined
                        ? null
                        : Math.max(
                              0,
                              Math.min(labelRectangle.right, badgeRectangle.right) -
                                  Math.max(labelRectangle.left, badgeRectangle.left)
                          ),
            }
        })
    expect(channelSidebarLayout).toEqual({ overlap: 0 })
    await page.getByRole('button', { name: 'New publication', exact: true }).click()
    const publicationChannel = page.getByRole('combobox', { name: 'Channel' })
    await publicationChannel.click()
    await page.getByRole('option', { name: channelName, exact: true }).click()

    await page.locator('input[type="file"]').setInputFiles({
        name: mediaFilename,
        mimeType: 'image/png',
        buffer: mediaBytes,
    })

    await expect(
        page.getByRole('button', { name: new RegExp(`Remove ${mediaFilename}`) })
    ).toBeVisible()
    await expect(
        page.locator('[data-new-publication-editor="true"] [data-media-picker="true"] img')
    ).toBeVisible()
    await expect(
        page.locator(
            '[data-publication-draft-preview="true"] [data-publication-preview-media="true"] img'
        )
    ).toBeVisible()

    await page.getByLabel('Title', { exact: true }).fill(mixedTitle)
    await page.getByLabel('Content', { exact: true }).fill(sourceText)
    const defaultSchedule = await page.getByLabel('Schedule', { exact: true }).first().inputValue()
    await page.getByRole('button', { name: 'Customize for this channel', exact: true }).click()
    await page.getByLabel('Channel content', { exact: true }).fill(targetText)
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await expect(page.getByRole('tab', { name: new RegExp(secondChannelName) })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add channel', exact: true })).toBeDisabled()
    await expect(page.getByText('Uses shared settings', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Customize delivery', exact: true }).click()
    await expect(page.getByLabel('Channel schedule', { exact: true })).toHaveValue(defaultSchedule)
    await page.getByRole('button', { name: 'Customize for this channel', exact: true }).click()
    await page.getByLabel('Channel content', { exact: true }).fill(secondTargetText)
    const secondPublicationDelivery = page.getByRole('combobox', {
        name: 'Channel delivery',
        exact: true,
    })
    await secondPublicationDelivery.click()
    await page.getByRole('option', { name: 'Automatic publication', exact: true }).click()
    await page.getByLabel('Channel schedule', { exact: true }).fill(scheduledDateTime)

    await page.setViewportSize({ width: 390, height: 844 })
    const populatedNewPublicationOverflow = await page
        .locator('[data-dashboard-scroll]')
        .evaluate(scrollRegion => ({
            clientWidth: (scrollRegion as unknown as { clientWidth: number }).clientWidth,
            scrollWidth: (scrollRegion as unknown as { scrollWidth: number }).scrollWidth,
        }))
    expect(populatedNewPublicationOverflow.scrollWidth).toBeLessThanOrEqual(
        populatedNewPublicationOverflow.clientWidth
    )
    await expect(page.getByRole('tab', { name: new RegExp(channelName) })).toBeVisible()
    await expect(page.getByRole('tab', { name: new RegExp(secondChannelName) })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 720 })

    await page.getByRole('button', { name: 'Schedule 2', exact: true }).click()

    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    const mixedPublications = page.getByRole('link').filter({ hasText: mixedTitle })
    await expect(mixedPublications).toHaveCount(2)

    await page
        .locator('[data-slot="sidebar"]')
        .getByRole('button', { name: 'New publication', exact: true })
        .click()
    const mediaOnlyPublicationChannel = page.getByRole('combobox', { name: 'Channel' }).first()
    await mediaOnlyPublicationChannel.click()
    await page.getByRole('option', { name: channelName, exact: true }).click()
    await page.getByLabel('Title', { exact: true }).fill(mediaOnlyTitle)
    await page.getByRole('button', { name: 'Add media', exact: true }).click()
    const libraryMediaToggle = page.getByRole('button', { name: new RegExp(mediaFilename) })
    await libraryMediaToggle.click()
    await expect(libraryMediaToggle).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(
        page.getByRole('button', { name: new RegExp(`Remove ${mediaFilename}`) })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()

    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    const mediaOnlyPublication = page.getByRole('link').filter({ hasText: mediaOnlyTitle }).first()
    await expect(mediaOnlyPublication).toBeVisible()

    await page.getByRole('link', { name: 'Overview', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    const calendar = page.locator('[data-calendar="reui"]')
    const calendarMonth = calendar.locator('[data-calendar-view="month"]')
    await expect(calendarMonth).toBeVisible()
    await expect(
        calendarMonth.locator('[data-slot="event-calendar-event"]').filter({ hasText: mixedTitle })
    ).toHaveCount(2)
    const emptyCalendarDay = calendarMonth.locator('[data-slot="event-calendar-day-add"]').first()
    await expect(emptyCalendarDay).toBeVisible()
    await emptyCalendarDay.click()
    await expect(page).toHaveURL(
        /\/dashboard\/projects\/[^/]+\/publications\/new\?date=\d{4}-\d{2}-\d{2}$/
    )
    await expect(page.getByLabel('Schedule', { exact: true }).first()).toHaveValue(/T09:00$/)
    await page.goBack()
    await expect(calendarMonth).toBeVisible()
    await page.getByRole('button', { name: 'Next period', exact: true }).click()
    await expect(calendarMonth).toBeVisible()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(
        calendarMonth.locator('[data-slot="event-calendar-event"]').filter({ hasText: mixedTitle })
    ).toHaveCount(2)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('[data-calendar-view="agenda"]')).toBeVisible()
    const calendarOverflow = await page
        .locator('[data-dashboard-scroll]')
        .evaluate(scrollRegion => ({
            clientWidth: (scrollRegion as unknown as { clientWidth: number }).clientWidth,
            scrollWidth: (scrollRegion as unknown as { scrollWidth: number }).scrollWidth,
        }))
    expect(calendarOverflow.scrollWidth).toBeLessThanOrEqual(calendarOverflow.clientWidth)
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/queue$/)

    await page.reload()
    await expect(page.getByRole('link').filter({ hasText: mixedTitle }).first()).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: mediaOnlyTitle }).first()).toBeVisible()

    await mixedPublications.filter({ hasText: channelName }).first().click()
    await expect(page.getByRole('heading', { name: mixedTitle, level: 1 })).toBeVisible()
    await expect(page.locator('#source-body')).toHaveValue(sourceText)
    await expect(page.locator('[data-target-field="body"] textarea')).toHaveValue(targetText)
    await expect(
        page.locator('article').filter({ hasText: mediaFilename }).first().getByRole('button')
    ).toHaveAttribute('aria-pressed', 'true')

    const promotedSchedule = localDateTimeInHours(4)
    await page.locator('#deliver-at').fill(promotedSchedule)
    await page.getByRole('button', { name: 'Apply draft to target', exact: true }).click()
    await expect(page.locator('#deliver-at')).toHaveValue(promotedSchedule)
    await page.reload()
    await expect(page.locator('#deliver-at')).toHaveValue(promotedSchedule)

    const mixedTarget = parseTargetContent(await page.getByLabel('Target JSON').inputValue())
    expect(mixedTarget.body).toBe(targetText)
    expect(mixedTarget.media).toHaveLength(1)
    const assetId = mixedTarget.media[0]?.assetId
    expect(assetId).toEqual(expect.any(String))

    await page.getByRole('link', { name: /Back to queue/ }).click()
    await mixedPublications.filter({ hasText: secondChannelName }).first().click()
    await expect(page.getByRole('heading', { name: mixedTitle, level: 1 })).toBeVisible()
    await expect(page.locator('[data-target-field="commentary"] textarea')).toHaveValue(
        secondTargetText
    )
    const secondMixedTarget = parseTargetContent(await page.getByLabel('Target JSON').inputValue())
    expect(secondMixedTarget.commentary).toBe(secondTargetText)
    expect(secondMixedTarget.media).toHaveLength(1)
    expect(secondMixedTarget.media[0]?.assetId).toBe(assetId)

    await page.getByRole('link', { name: /Back to queue/ }).click()
    await page.getByRole('link').filter({ hasText: mediaOnlyTitle }).first().click()
    await expect(page.getByRole('heading', { name: mediaOnlyTitle })).toBeVisible()
    await expect(page.locator('#source-body')).toHaveValue('')
    await expect(
        page.locator('article').filter({ hasText: mediaFilename }).first().getByRole('button')
    ).toHaveAttribute('aria-pressed', 'true')

    const mediaOnlyTarget = parseTargetContent(await page.getByLabel('Target JSON').inputValue())
    expect(mediaOnlyTarget.body).toBeUndefined()
    expect(mediaOnlyTarget.media).toHaveLength(1)
    expect(mediaOnlyTarget.media[0]?.assetId).toBe(assetId)

    const firstProjectId = projectIdFromUrl(page.url())
    const secondProjectName = `E2E-51 Second project ${suffix}`
    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    await page.locator('#new-project').fill(secondProjectName)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page.getByRole('combobox', { name: 'Select project' }).first()).toHaveText(
        secondProjectName
    )
    const secondProjectId = projectIdFromUrl(page.url())
    expect(secondProjectId).not.toBe(firstProjectId)

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByText('No channels yet', { exact: true })).toBeVisible()
    await expect(page.getByText(channelName, { exact: true })).toHaveCount(0)

    await page.goto(`/dashboard/projects/${firstProjectId}/channels`)
    await expect(
        page.locator('#publisher-connections').getByText(channelName, { exact: true })
    ).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Select project' }).first()).toHaveText(
        projectName
    )

    await page.goto(`/dashboard/projects/${secondProjectId}/channels`)
    await expect(page.getByText('No channels yet', { exact: true })).toBeVisible()
    await expect(page.getByText(channelName, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Select project' }).first()).toHaveText(
        secondProjectName
    )
})

interface TargetContent {
    readonly body?: string
    readonly commentary?: string
    readonly media: readonly { readonly assetId: string }[]
}

function parseTargetContent(value: string): TargetContent {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || !Array.isArray(parsed.media)) {
        throw new Error('The editor target did not contain a media array')
    }

    return parsed as unknown as TargetContent
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function projectIdFromUrl(value: string): string {
    const match = new URL(value).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${value}`)
    }

    return match[1]
}

function localDateTimeInHours(hours: number) {
    const timestamp = Date.now() + hours * 60 * 60 * 1000
    const date = new Date(timestamp)
    const offset = date.getTimezoneOffset() * 60_000
    return new Date(timestamp - offset).toISOString().slice(0, 16)
}
