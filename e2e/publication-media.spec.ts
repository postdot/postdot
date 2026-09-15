import { randomUUID } from 'node:crypto'

import type { MediaReference } from '@herald/client'
import { expect, test, type Route } from '@playwright/test'

const e2eApiPort = process.env.HERALD_E2E_API_PORT
if (e2eApiPort === undefined) {
    throw new Error('HERALD_E2E_API_PORT must be set by the Playwright E2E runtime')
}
const e2eApiOrigin = `http://127.0.0.1:${e2eApiPort}`

const mediaFilename = 'herald-e2e-pixel.png'
const editedMediaFilename = 'herald-e2e-pixel-edited.png'
const secondMediaFilename = 'herald-e2e-second-pixel.png'
const pickerMediaFilename = 'herald-e2e-picker-pixel.png'
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

    await page.addInitScript(() => {
        const mediaDevices = navigator.mediaDevices ?? {}
        Object.defineProperty(mediaDevices, 'getUserMedia', {
            configurable: true,
            value: async () => new MediaStream(),
        })
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: mediaDevices,
        })

        Object.defineProperty(HTMLVideoElement.prototype, 'readyState', {
            configurable: true,
            get: () => 4,
        })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
            configurable: true,
            get: () => 640,
        })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
            configurable: true,
            get: () => 480,
        })
        HTMLMediaElement.prototype.play = () => Promise.resolve()
    })

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

    const selectedMediaPreview = newPublicationEditor.locator('[data-media-preview="true"]').first()
    await selectedMediaPreview.click()
    const mediaViewer = page.getByRole('dialog').filter({ hasText: mediaFilename }).last()
    await expect(mediaViewer).toBeVisible()
    await expect(mediaViewer.getByRole('button', { name: 'Edit image', exact: true })).toBeVisible()
    await mediaViewer.getByRole('button', { name: 'Edit image', exact: true }).click()

    const mediaEditor = page.getByRole('dialog').filter({ hasText: mediaFilename }).last()
    await expect(mediaEditor).toBeVisible()
    await expect(
        mediaEditor.getByRole('button', { name: 'Original', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await mediaEditor.getByRole('button', { name: 'Square', exact: true }).click()
    await expect(mediaEditor.getByRole('button', { name: 'Square', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await mediaEditor.getByRole('button', { name: 'Rotate right', exact: true }).click()
    await expect(mediaEditor.getByText('90°', { exact: true })).toBeVisible()
    await mediaEditor.getByRole('button', { name: 'Save as new media', exact: true }).click()
    await expect(
        page.getByRole('button', { name: new RegExp(`Remove ${editedMediaFilename}`) })
    ).toBeVisible()
    await expect(mediaEditor).toHaveCount(0)

    await page.locator('input[type="file"]').setInputFiles({
        name: secondMediaFilename,
        mimeType: 'image/png',
        buffer: mediaBytes,
    })
    const selectedMediaOrder = () =>
        newPublicationEditor
            .locator('[data-media-reorderable="true"] [data-media-preview="true"]')
            .evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))
    await expect(newPublicationEditor.locator('[data-media-reorderable="true"]')).toHaveCount(2)
    await expect
        .poll(selectedMediaOrder)
        .toEqual([`View ${editedMediaFilename}`, `View ${secondMediaFilename}`])
    const firstReorderable = newPublicationEditor.locator('[data-media-reorderable="true"]').first()
    const secondReorderable = newPublicationEditor.locator('[data-media-reorderable="true"]').nth(1)
    await firstReorderable.dragTo(secondReorderable)
    await expect
        .poll(selectedMediaOrder)
        .toEqual([`View ${secondMediaFilename}`, `View ${editedMediaFilename}`])
    await newPublicationEditor
        .getByRole('button', { name: `Move ${secondMediaFilename} right`, exact: true })
        .click()
    await expect
        .poll(selectedMediaOrder)
        .toEqual([`View ${editedMediaFilename}`, `View ${secondMediaFilename}`])
    await newPublicationEditor
        .getByRole('button', { name: `Remove ${secondMediaFilename}`, exact: true })
        .click()
    await expect(
        newPublicationEditor.getByRole('button', {
            name: new RegExp(`Remove ${secondMediaFilename}`),
        })
    ).toHaveCount(0)

    await page.getByRole('link', { name: 'Media', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/media$/)
    await expect(page.getByRole('heading', { name: 'Media', exact: true })).toBeVisible()
    await expect(page.locator('[data-media-dropzone="true"]')).toBeVisible()
    await expect(page.locator('[data-media-selection-toggle="true"]')).toHaveCount(0)
    await expect(page.locator('[data-media-import-zone="true"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
    await expect(page.locator('[data-media-drop-hint="true"]')).toBeVisible()
    await expect(
        page
            .locator('[data-media-import-zone="true"]')
            .getByRole('button', { name: 'Browse', exact: true })
    ).toBeVisible()
    const droppedMediaFilename = `herald-e2e-dropped-${suffix}.png`
    await page.locator('[data-media-import-zone="true"]').evaluate(
        (element, file) => {
            const dataTransfer = new DataTransfer()
            dataTransfer.items.add(
                new File([Uint8Array.from(file.bytes)], file.name, { type: file.mimeType })
            )
            element.dispatchEvent(
                new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
            )
        },
        { name: droppedMediaFilename, mimeType: 'image/png', bytes: [...mediaBytes] }
    )
    await expect(
        page.getByRole('button', { name: `View ${droppedMediaFilename}`, exact: true })
    ).toBeVisible()
    const mediaLibraryViewer = page.locator('[data-media-viewer="true"]')
    const mediaBulkActionBar = page.locator('[data-bulk-action-bar="true"]')
    const droppedMediaCard = page
        .locator('[data-media-bulk-selection-card="true"]')
        .filter({ hasText: droppedMediaFilename })
    await expect(droppedMediaCard.locator('[data-media-open-trigger="true"]')).toHaveCount(0)
    await droppedMediaCard.click({ position: { x: 2, y: 2 } })
    await expect(mediaLibraryViewer).toBeVisible()
    const viewerChromeLayout = await mediaLibraryViewer.evaluate(viewer => {
        const header = viewer.querySelector<HTMLElement>('[data-slot="dialog-header"]')
        const title = viewer.querySelector<HTMLElement>('[data-slot="dialog-title"]')
        const group = viewer.querySelector<HTMLElement>('[data-slot="button-group"]')
        const zoomStatus = viewer.querySelector<HTMLElement>('[data-slot="button-group-text"]')
        const zoomOut = viewer.querySelector<HTMLElement>('[data-media-viewer-zoom-out="true"]')
        const close = viewer.querySelector<HTMLElement>('[data-media-viewer-close="true"]')
        if (
            header === null ||
            title === null ||
            group === null ||
            zoomStatus === null ||
            zoomOut === null ||
            close === null
        )
            return null

        const headerBounds = header.getBoundingClientRect()
        const titleBounds = title.getBoundingClientRect()
        const groupBounds = group.getBoundingClientRect()
        const statusBounds = zoomStatus.getBoundingClientRect()
        const closeBounds = close.getBoundingClientRect()
        return {
            headerBottom: headerBounds.bottom,
            titleBottom: titleBounds.bottom,
            titleHeight: titleBounds.height,
            titleLineHeight: Number.parseFloat(getComputedStyle(title).lineHeight),
            groupHeight: groupBounds.height,
            statusHeight: statusBounds.height,
            closeHeight: closeBounds.height,
            groupBackground: getComputedStyle(group).backgroundColor,
            buttonBackground: getComputedStyle(zoomOut).backgroundColor,
            statusBackground: getComputedStyle(zoomStatus).backgroundColor,
        }
    })
    expect(viewerChromeLayout).not.toBeNull()
    expect(viewerChromeLayout?.titleLineHeight).toBeGreaterThan(16)
    expect(viewerChromeLayout?.titleHeight).toBeGreaterThanOrEqual(
        (viewerChromeLayout?.titleLineHeight ?? 0) - 1
    )
    expect(viewerChromeLayout?.titleBottom).toBeLessThanOrEqual(
        (viewerChromeLayout?.headerBottom ?? 0) + 1
    )
    expect(
        Math.abs((viewerChromeLayout?.groupHeight ?? 0) - (viewerChromeLayout?.closeHeight ?? 0))
    ).toBeLessThanOrEqual(1)
    expect(
        Math.abs((viewerChromeLayout?.statusHeight ?? 0) - (viewerChromeLayout?.groupHeight ?? 0))
    ).toBeLessThanOrEqual(1)
    expect(viewerChromeLayout?.groupBackground).not.toBe(viewerChromeLayout?.buttonBackground)
    expect(viewerChromeLayout?.statusBackground).not.toBe(viewerChromeLayout?.buttonBackground)
    await expect(
        mediaLibraryViewer.getByRole('button', { name: 'Enter fullscreen', exact: true })
    ).toBeVisible()
    const mediaViewerZoomOut = mediaLibraryViewer.getByRole('button', {
        name: 'Zoom out',
        exact: true,
    })
    const mediaViewerZoomIn = mediaLibraryViewer.getByRole('button', {
        name: 'Zoom in',
        exact: true,
    })
    const mediaViewerZoomReset = mediaLibraryViewer.getByRole('button', {
        name: 'Reset zoom',
        exact: true,
    })
    await expect(mediaViewerZoomOut).toBeDisabled()
    await expect(mediaViewerZoomIn).toBeEnabled()
    await mediaViewerZoomIn.click()
    await expect(mediaViewerZoomReset).toBeEnabled()
    await expect(mediaLibraryViewer.getByText('150%', { exact: true })).toBeVisible()
    await mediaViewerZoomReset.click()
    await expect(mediaViewerZoomReset).toBeDisabled()
    const viewerImage = mediaLibraryViewer.locator('main img').first()
    const viewerImageBounds = await viewerImage.boundingBox()
    expect(viewerImageBounds).not.toBeNull()
    await page.mouse.move(
        (viewerImageBounds?.x ?? 0) + (viewerImageBounds?.width ?? 0) / 2,
        (viewerImageBounds?.y ?? 0) + (viewerImageBounds?.height ?? 0) / 2
    )
    await page.mouse.wheel(0, -100)
    await expect(mediaLibraryViewer.getByText('115%', { exact: true })).toBeVisible()
    await mediaViewerZoomReset.click()
    await expect(mediaViewerZoomReset).toBeDisabled()
    const initialViewerFilename = await mediaLibraryViewer
        .locator('[data-slot="dialog-title"]')
        .textContent()
    await page.keyboard.press('ArrowRight')
    await expect(mediaLibraryViewer.locator('[data-slot="dialog-title"]')).not.toHaveText(
        initialViewerFilename ?? ''
    )
    await page.keyboard.press('ArrowLeft')
    await expect(mediaLibraryViewer.locator('[data-slot="dialog-title"]')).toHaveText(
        initialViewerFilename ?? ''
    )
    const viewerThumbnailViewport = mediaLibraryViewer.locator('[data-media-viewer-thumbnails]')
    const viewerThumbnailTrack = mediaLibraryViewer.locator(
        '[data-media-viewer-thumbnail-track="true"]'
    )
    await page.setViewportSize({ width: 390, height: 844 })
    const mobileViewerHeaderLayout = await mediaLibraryViewer.evaluate(viewer => {
        const header = viewer.querySelector<HTMLElement>('[data-slot="dialog-header"]')
        const group = viewer.querySelector<HTMLElement>('[data-slot="button-group"]')
        const close = viewer.querySelector<HTMLElement>('[data-media-viewer-close="true"]')
        if (header === null || group === null || close === null) return null

        return {
            headerRight: header.getBoundingClientRect().right,
            groupRight: group.getBoundingClientRect().right,
            closeRight: close.getBoundingClientRect().right,
        }
    })
    expect(mobileViewerHeaderLayout).not.toBeNull()
    expect(mobileViewerHeaderLayout?.groupRight).toBeLessThanOrEqual(
        (mobileViewerHeaderLayout?.headerRight ?? 0) + 1
    )
    expect(mobileViewerHeaderLayout?.closeRight).toBeLessThanOrEqual(
        (mobileViewerHeaderLayout?.headerRight ?? 0) + 1
    )
    await page.setViewportSize({ width: 200, height: 480 })
    await expect(viewerThumbnailViewport).toBeVisible()
    await expect(viewerThumbnailTrack).toHaveCSS('cursor', 'grab')
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(
        mediaLibraryViewer.getByRole('button', { name: 'Next media', exact: true })
    ).toBeEnabled()
    await mediaLibraryViewer.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(mediaLibraryViewer).toHaveCount(0)

    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await expect(mediaBulkActionBar).toBeVisible()
    await expect(mediaBulkActionBar).toContainText('0 selected')
    await droppedMediaCard.click({ position: { x: 2, y: 2 } })
    await expect(droppedMediaCard).toHaveAttribute('data-media-action-selected', 'true')
    await droppedMediaCard.click({ position: { x: 2, y: 2 } })
    await expect(droppedMediaCard).not.toHaveAttribute('data-media-action-selected')
    await page.getByRole('button', { name: `Select ${mediaFilename}`, exact: true }).click()
    await expect(mediaBulkActionBar).toBeVisible()
    await expect(
        mediaBulkActionBar.getByRole('button', { name: 'Select all', exact: true })
    ).toBeVisible()
    await expect(
        mediaBulkActionBar.getByRole('button', { name: 'Deselect', exact: true })
    ).toBeVisible()
    await expect(
        mediaBulkActionBar.getByRole('button', { name: 'Delete (1)', exact: true })
    ).toBeVisible()
    await expect(
        mediaBulkActionBar.getByRole('button', { name: 'Open (1)', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: `Select ${secondMediaFilename}`, exact: true }).click()
    await expect(mediaBulkActionBar).toContainText('2 selected')
    await mediaBulkActionBar.getByRole('button', { name: 'Open (2)', exact: true }).click()
    await expect(mediaLibraryViewer).toBeVisible()
    await expect(mediaLibraryViewer.locator('[data-media-viewer-thumbnail="true"]')).toHaveCount(2)
    await expect(
        mediaLibraryViewer.getByRole('button', { name: 'Next media', exact: true })
    ).toBeEnabled()
    await mediaLibraryViewer.getByRole('button', { name: 'Next media', exact: true }).click()
    await expect(mediaLibraryViewer.getByText('2 of 2', { exact: true })).toHaveCount(1)
    await mediaLibraryViewer.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(mediaLibraryViewer).toHaveCount(0)
    await mediaBulkActionBar.getByRole('button', { name: 'Delete (2)', exact: true }).click()
    const mediaBulkDeletionDialog = page.locator('[data-media-bulk-delete-dialog="true"]')
    await expect(mediaBulkDeletionDialog).toBeVisible()
    await expect(
        mediaBulkDeletionDialog.locator(
            '[data-media-bulk-delete-body="true"] [data-media-bulk-delete-preview="true"]'
        )
    ).toHaveCount(2)
    const mediaBulkDeleteConfirm = mediaBulkDeletionDialog.getByRole('button', {
        name: 'Delete',
        exact: true,
    })
    await expect(mediaBulkDeleteConfirm).toBeEnabled()
    await mediaBulkDeleteConfirm.click()
    await expect(mediaBulkDeletionDialog).toHaveCount(0)
    await expect(
        page.getByRole('button', { name: `View ${mediaFilename}`, exact: true })
    ).toHaveCount(0)
    await expect(
        page.getByRole('button', { name: `View ${secondMediaFilename}`, exact: true })
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Exit selection', exact: true }).click()
    await expect(mediaBulkActionBar).toHaveCount(0)
    const mediaSearch = page.getByRole('searchbox', { name: 'Search media', exact: true })
    await expect(mediaSearch).toBeVisible()

    let releaseSearchResponse: (() => void) | undefined
    let searchRequestStarted = () => {}
    let searchResponseCompleted = () => {}
    const searchRequest = new Promise<void>(resolve => {
        searchRequestStarted = resolve
    })
    const searchResponse = new Promise<void>(resolve => {
        searchResponseCompleted = resolve
    })
    await page.route('**/api/projects/*/media*', async route => {
        const requestUrl = new URL(route.request().url())
        const isDelayedSearch = requestUrl.searchParams.get('search') === droppedMediaFilename
        if (isDelayedSearch) {
            searchRequestStarted()
            await new Promise<void>(resolve => {
                releaseSearchResponse = resolve
            })
        }
        await route.continue()
        if (isDelayedSearch) searchResponseCompleted()
    })
    await mediaSearch.fill(droppedMediaFilename)
    await searchRequest
    await expect(
        page.getByRole('button', { name: `View ${droppedMediaFilename}`, exact: true })
    ).toBeVisible()
    releaseSearchResponse?.()
    await searchResponse
    await page.unroute('**/api/projects/*/media*')
    await mediaSearch.fill(`missing-${suffix}`)
    await expect(page.getByText('No media matches this search.', { exact: true })).toBeVisible()
    await mediaSearch.fill('')
    await expect(
        page.getByRole('button', { name: `View ${droppedMediaFilename}`, exact: true })
    ).toBeVisible()
    const mediaView = page.locator('[data-media-library-view]')
    await expect(page.locator('[data-media-view-controls="true"]')).toBeVisible()
    await expect(mediaView).toHaveAttribute('data-media-library-view', 'grid')
    await expect(page.getByRole('button', { name: 'Gallery view', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await page.getByRole('button', { name: 'Compact view', exact: true }).click()
    await expect(mediaView).toHaveAttribute('data-media-library-view', 'compact')
    await expect(page.locator('[data-media-card-layout="compact"]')).not.toHaveCount(0)
    await page.getByRole('button', { name: 'List view', exact: true }).click()
    await expect(page.locator('[data-media-library-view]')).toHaveAttribute(
        'data-media-library-view',
        'list'
    )
    await droppedMediaCard
        .getByRole('button', { name: `Actions for ${droppedMediaFilename}`, exact: true })
        .click()
    await page.getByRole('menuitem', { name: 'Information', exact: true }).click()
    const mediaInformationDialog = page.locator('[data-media-info-dialog="true"]')
    await expect(mediaInformationDialog).toBeVisible()
    await expect(mediaInformationDialog.getByText('File details', { exact: true })).toBeVisible()
    await expect(
        mediaInformationDialog.getByText('No references in this project.', { exact: true })
    ).toBeVisible()
    await mediaInformationDialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(mediaInformationDialog).toHaveCount(0)
    await droppedMediaCard
        .getByRole('button', { name: `Actions for ${droppedMediaFilename}`, exact: true })
        .click()
    const mediaDownload = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download', exact: true }).click()
    expect((await mediaDownload).suggestedFilename()).toBe(droppedMediaFilename)
    await droppedMediaCard
        .getByRole('button', { name: `Actions for ${droppedMediaFilename}`, exact: true })
        .click()
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    const mediaDeletionDialog = page.locator('[data-media-delete-dialog="true"]')
    await expect(mediaDeletionDialog).toBeVisible()
    await expect(
        mediaDeletionDialog.locator(
            '[data-media-delete-body="true"] [data-media-delete-preview="true"]'
        )
    ).toBeVisible()
    await expect(mediaDeletionDialog).not.toContainText('Not used')
    const mediaDeleteConfirm = mediaDeletionDialog.locator('[data-media-delete-confirm="true"]')
    await expect(mediaDeleteConfirm).toBeEnabled()
    await mediaDeleteConfirm.click()
    await expect(mediaDeletionDialog).toHaveCount(0)
    await expect(
        page.getByRole('button', { name: `View ${droppedMediaFilename}`, exact: true })
    ).toHaveCount(0)

    await expect(
        page.locator('main').getByRole('button', { name: 'New publication', exact: true })
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'New publication', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/publications\/new$/)

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
    const attachmentLibrary = page.locator('[data-media-library="true"]')
    await expect(attachmentLibrary).toHaveAttribute('data-media-picker-mode', 'attach')
    await expect(attachmentLibrary.locator('[data-media-asset-actions="true"]')).toHaveCount(0)
    await expect(attachmentLibrary.locator('[data-media-attachment-scroll="true"]')).toBeVisible()
    await expect(attachmentLibrary.locator('input[id^="media-alt-"]')).toHaveCount(0)
    await expect(attachmentLibrary.locator('[data-media-library-toolbar="true"]')).toBeVisible()
    await expect(
        attachmentLibrary.getByRole('group', { name: 'Media view', exact: true })
    ).toBeVisible()
    await expect(attachmentLibrary.getByText('Attach', { exact: true })).toHaveCount(0)
    const attachmentScroll = attachmentLibrary.locator('[data-media-attachment-scroll="true"]')
    await expect(attachmentScroll).toHaveCSS('overflow-y', 'auto')
    const attachmentSearch = attachmentLibrary.getByRole('searchbox', {
        name: 'Search media',
        exact: true,
    })

    await attachmentLibrary.getByRole('button', { name: 'Import', exact: true }).click()
    const deviceSourcePicker = page.locator('[data-media-source-picker="true"]')
    await expect(deviceSourcePicker).toBeVisible()
    await deviceSourcePicker.locator('[data-media-source="device"]').click()
    await page.locator('input[type="file"]').setInputFiles({
        name: pickerMediaFilename,
        mimeType: 'image/png',
        buffer: mediaBytes,
    })
    await expect(attachmentLibrary).toBeVisible()
    const deviceCard = attachmentLibrary
        .locator('article')
        .filter({ hasText: pickerMediaFilename })
        .first()
    await expect(deviceCard).toBeVisible()
    await expect(deviceCard.locator('[data-media-selection-toggle="true"]')).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await expect(
        page.getByRole('button', { name: new RegExp(`Remove ${pickerMediaFilename}`) })
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    const deviceRemoveButton = page.getByRole('button', {
        name: new RegExp(`Remove ${pickerMediaFilename}`),
    })
    await expect(deviceRemoveButton).toBeVisible()
    await deviceRemoveButton.click()
    await expect(deviceRemoveButton).toHaveCount(0)

    await page.getByRole('button', { name: 'Add media', exact: true }).click()
    await expect(attachmentLibrary).toBeVisible()
    await attachmentLibrary.getByRole('button', { name: 'Import', exact: true }).click()
    const webcamSourcePicker = page.locator('[data-media-source-picker="true"]')
    await expect(webcamSourcePicker).toBeVisible()
    await webcamSourcePicker.locator('[data-media-source="webcam"]').click()
    const webcamDialog = page.locator('[data-media-webcam-dialog="true"]')
    await expect(webcamDialog).toBeVisible()
    const webcamVideo = webcamDialog.locator('video')
    await webcamVideo.dispatchEvent('loadedmetadata')
    await webcamVideo.dispatchEvent('canplay')
    const captureButton = webcamDialog.getByRole('button', { name: 'Take photo', exact: true })
    await expect(captureButton).toBeEnabled()
    await captureButton.click()
    await expect(webcamDialog).toHaveCount(0)
    await expect(attachmentLibrary).toBeVisible()
    const webcamCard = attachmentLibrary
        .locator('article')
        .filter({ hasText: /webcam-.*\.jpg/ })
        .first()
    await expect(webcamCard).toBeVisible()
    await expect(webcamCard.locator('[data-media-selection-toggle="true"]')).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await expect(
        page.locator('[data-new-publication-editor="true"] [data-media-selection-preview="true"]')
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(
        page.locator('[data-new-publication-editor="true"] [data-media-selection-preview="true"]')
    ).toHaveCount(1)
    const webcamRemoveButton = page.getByRole('button', {
        name: /^Remove webcam-.*\.jpg$/,
    })
    await expect(webcamRemoveButton).toBeVisible()
    await webcamRemoveButton.click()
    await expect(webcamRemoveButton).toHaveCount(0)

    const mediaProjectId = projectIdFromUrl(page.url())
    const mediaList = (await page.evaluate(async projectId => {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/media?limit=1`)
        if (!response.ok) {
            throw new Error(`Could not load a media fixture (${response.status})`)
        }
        return response.json()
    }, mediaProjectId)) as { media: MediaReference[] }
    const urlMediaReference = mediaList.media[0]
    if (urlMediaReference === undefined) {
        throw new Error('The URL import flow requires at least one media fixture')
    }

    const urlImport = 'https://example.com/herald-e2e-url.png'
    let requestedUrl: string | undefined
    const urlImportRoute = async (route: Route) => {
        const body = route.request().postDataJSON() as { url?: unknown }
        requestedUrl = typeof body.url === 'string' ? body.url : undefined
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'ready', media: urlMediaReference }),
        })
    }
    await page.route('**/api/projects/*/media/imports/url', urlImportRoute)

    await page.getByRole('button', { name: 'Add media', exact: true }).click()
    await expect(attachmentLibrary).toBeVisible()
    await attachmentLibrary.getByRole('button', { name: 'Import', exact: true }).click()
    const urlSourcePicker = page.locator('[data-media-source-picker="true"]')
    await expect(urlSourcePicker).toBeVisible()
    await urlSourcePicker.locator('[data-media-source="url"]').click()
    await urlSourcePicker.locator('#media-source-url').fill(urlImport)
    await urlSourcePicker.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(attachmentLibrary).toBeVisible()
    expect(requestedUrl).toBe(urlImport)

    const urlMediaCard = attachmentLibrary
        .locator('article')
        .filter({ hasText: urlMediaReference.asset.originalFilename })
        .first()
    await expect(urlMediaCard).toBeVisible()
    await expect(urlMediaCard.locator('[data-media-selection-toggle="true"]')).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await expect(
        page.locator('[data-new-publication-editor="true"] [data-media-selection-preview="true"]')
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(
        page.locator('[data-new-publication-editor="true"] [data-media-selection-preview="true"]')
    ).toHaveCount(1)
    const urlRemoveButton = page.getByRole('button', {
        name: new RegExp(`Remove ${urlMediaReference.asset.originalFilename}`),
    })
    await expect(urlRemoveButton).toBeVisible()
    await urlRemoveButton.click()
    await expect(urlRemoveButton).toHaveCount(0)
    await page.unroute('**/api/projects/*/media/imports/url', urlImportRoute)

    await page.getByRole('button', { name: 'Add media', exact: true }).click()
    await expect(attachmentLibrary).toBeVisible()
    await attachmentSearch.fill(editedMediaFilename)
    const attachmentCard = attachmentLibrary
        .locator('article')
        .filter({ hasText: editedMediaFilename })
        .first()
    await expect(attachmentCard).toHaveCount(1)
    await attachmentSearch.fill('')
    await attachmentCard.locator('[data-media-preview="true"]').click()
    await expect(attachmentCard.locator('[data-media-selection-toggle="true"]')).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await expect(attachmentCard).toHaveAttribute('data-media-selection-active', 'true')
    await page.keyboard.press('Escape')
    await expect(attachmentLibrary).toHaveCount(0)
    await expect(
        page.getByRole('button', { name: new RegExp(`Remove ${editedMediaFilename}`) })
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Add media', exact: true }).click()
    await expect(attachmentLibrary).toBeVisible()
    const reopenedAttachmentCard = attachmentLibrary
        .locator('article')
        .filter({ hasText: editedMediaFilename })
        .first()
    const reopenedMediaToggle = reopenedAttachmentCard.locator(
        '[data-media-selection-toggle="true"]'
    )
    await expect(reopenedMediaToggle).toHaveAttribute('aria-pressed', 'false')
    await reopenedMediaToggle.focus()
    await reopenedMediaToggle.press('Space')
    await expect(reopenedMediaToggle).toHaveAttribute('aria-pressed', 'true')
    const selectedCardGaps = await attachmentLibrary
        .locator('[data-media-selection-active="true"]')
        .first()
        .evaluate(card => {
            const scroll = card.closest('[data-media-attachment-scroll="true"]')
            if (scroll === null) return null
            const cardRect = card.getBoundingClientRect()
            const scrollRect = scroll.getBoundingClientRect()
            return {
                bottom: scrollRect.bottom - cardRect.bottom,
                left: cardRect.left - scrollRect.left,
                right: scrollRect.right - cardRect.right,
                top: cardRect.top - scrollRect.top,
            }
        })
    expect(selectedCardGaps).not.toBeNull()
    expect(selectedCardGaps?.top).toBeGreaterThan(0)
    expect(selectedCardGaps?.left).toBeGreaterThan(0)
    expect(selectedCardGaps?.right).toBeGreaterThan(0)
    expect(selectedCardGaps?.bottom).toBeGreaterThan(0)
    await expect(
        page.getByRole('button', { name: new RegExp(`Remove ${editedMediaFilename}`) })
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(
        page.locator('[data-new-publication-editor="true"] [data-media-selection-preview="true"]')
    ).toHaveCount(1)
    await expect(
        page.getByRole('button', { name: new RegExp(`Remove ${editedMediaFilename}`) })
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
    const editorMediaPicker = page.locator('[data-media-picker="true"]')
    await expect(editorMediaPicker.locator('[data-media-selection-preview="true"]')).toHaveCount(1)
    await expect(editorMediaPicker.locator('input[id^="media-alt-"]')).toHaveCount(1)
    await editorMediaPicker.getByRole('button', { name: 'Add media', exact: true }).click()
    const editorAttachmentLibrary = page.locator('[data-media-library="true"]')
    await expect(editorAttachmentLibrary).toBeVisible()
    await expect(editorAttachmentLibrary.locator('input[id^="media-alt-"]')).toHaveCount(0)
    const editorSelectedCard = editorAttachmentLibrary
        .locator('article')
        .filter({ hasText: editedMediaFilename })
        .first()
    const editorMediaToggle = editorSelectedCard.locator('[data-media-selection-toggle="true"]')
    await expect(editorMediaToggle).toHaveAttribute('aria-pressed', 'true')
    await editorSelectedCard.locator('[data-media-preview="true"]').click()
    await expect(editorMediaToggle).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Escape')
    await expect(editorAttachmentLibrary).toHaveCount(0)
    await expect(editorMediaPicker.locator('[data-media-selection-preview="true"]')).toHaveCount(1)

    await page.setViewportSize({ width: 320, height: 844 })
    const mobileEditorMediaLayout = await editorMediaPicker
        .locator('[data-media-selection-preview="true"]')
        .first()
        .evaluate(element => {
            const preview = element as HTMLElement
            const thumbnail = preview.querySelector('[data-media-preview="true"]')
            const accessibilityInput = preview.querySelector('input[id^="media-alt-"]')
            if (thumbnail === null || accessibilityInput === null) return null

            const previewRect = preview.getBoundingClientRect()
            const thumbnailRect = thumbnail.getBoundingClientRect()
            const inputRect = accessibilityInput.getBoundingClientRect()
            return {
                clientWidth: preview.clientWidth,
                scrollWidth: preview.scrollWidth,
                previewWidth: previewRect.width,
                thumbnailBottom: thumbnailRect.bottom,
                inputTop: inputRect.top,
            }
        })
    expect(mobileEditorMediaLayout).not.toBeNull()
    expect(mobileEditorMediaLayout?.scrollWidth).toBeLessThanOrEqual(
        mobileEditorMediaLayout?.clientWidth ?? 0
    )
    expect(mobileEditorMediaLayout?.previewWidth).toBeLessThanOrEqual(
        mobileEditorMediaLayout?.clientWidth ?? 0
    )
    expect(mobileEditorMediaLayout?.inputTop).toBeGreaterThanOrEqual(
        (mobileEditorMediaLayout?.thumbnailBottom ?? 0) - 1
    )
    await page.setViewportSize({ width: 1280, height: 720 })

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
    await expect(page.locator('[data-media-selection-preview="true"]')).toHaveCount(1)

    const mediaOnlyTarget = parseTargetContent(await page.getByLabel('Target JSON').inputValue())
    expect(mediaOnlyTarget.body).toBeUndefined()
    expect(mediaOnlyTarget.media).toHaveLength(1)
    expect(mediaOnlyTarget.media[0]?.assetId).toBe(assetId)

    await page.getByRole('link', { name: 'Media', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/media$/)
    await expect(page.locator('[data-media-library-view]')).toHaveAttribute(
        'data-media-library-view',
        'list'
    )
    await page.getByRole('button', { name: 'Compact view', exact: true }).click()
    await expect(page.locator('[data-media-library-view]')).toHaveAttribute(
        'data-media-library-view',
        'compact'
    )
    await page.reload()
    await expect(page.locator('[data-media-library-view]')).toHaveAttribute(
        'data-media-library-view',
        'compact'
    )
    const editedMediaCard = page
        .locator('[data-media-bulk-selection-card="true"]')
        .filter({ hasText: editedMediaFilename })
        .first()
    await expect(editedMediaCard).toBeVisible()
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await editedMediaCard.click({ position: { x: 2, y: 2 } })
    const usedMediaBulkActionBar = page.locator('[data-bulk-action-bar="true"]')
    await usedMediaBulkActionBar.getByRole('button', { name: 'Delete (1)', exact: true }).click()
    const usedMediaBulkDeletionDialog = page.locator('[data-media-bulk-delete-dialog="true"]')
    await expect(
        usedMediaBulkDeletionDialog.locator('[data-media-bulk-delete-usage="blocked"]')
    ).toBeVisible()
    await expect(
        usedMediaBulkDeletionDialog.getByRole('button', { name: 'Delete', exact: true })
    ).toBeDisabled()
    await usedMediaBulkDeletionDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(usedMediaBulkDeletionDialog).toHaveCount(0)

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
