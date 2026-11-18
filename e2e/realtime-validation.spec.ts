import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import de from '../apps/web/messages/de.json' with { type: 'json' }
import en from '../apps/web/messages/en.json' with { type: 'json' }
import es from '../apps/web/messages/es.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }
import { calendarLocales } from '../packages/ui/src/components/calendar'
import { openLanguageMenu, switchTheme } from './locale'

type TestEventSourceController = {
    readonly url: string
    readonly withCredentials: boolean
    emit: (type: string, data?: string) => void
}

test('returns an invalid project URL to the explicit no-project context', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    await page.goto('/dashboard/projects/not-a-project/overview')
    await expect(page).toHaveURL(/\/dashboard\?projectId=none$/)
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
})

test('refreshes project data after realtime reconnect and project events', async ({ page }) => {
    test.setTimeout(45_000)

    await installFakeEventSource(page)
    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const publicationRequests: string[] = []

    page.on('request', request => {
        if (
            request.method() === 'GET' &&
            request.url().includes(`/api/projects/${projectId}/publications`)
        ) {
            publicationRequests.push(request.url())
        }
    })

    await expect
        .poll(() => readEventSource(page))
        .toMatchObject({
            url: `/api/projects/${projectId}/events`,
            withCredentials: true,
        })

    await emitEventSourceSignal(page, 'open')
    const initialRequestCount = publicationRequests.length

    await emitEventSourceSignal(page, 'error')
    await emitEventSourceSignal(page, 'open')
    await expect
        .poll(() => publicationRequests.length, { timeout: 10_000 })
        .toBeGreaterThan(initialRequestCount)
    await page.waitForTimeout(1_400)

    const updateRequestCount = publicationRequests.length
    await emitEventSourceSignal(
        page,
        'project.update',
        JSON.stringify({
            id: 'e2e-realtime-publication-1',
            cursor: 'event-sequence:1',
            projectId,
            version: 1,
            type: 'publication.created',
            occurredAt: Date.now(),
            entity: { type: 'publication', id: 'publication-1' },
            payload: {},
        })
    )
    await expect
        .poll(() => publicationRequests.length, { timeout: 10_000 })
        .toBeGreaterThan(updateRequestCount)
    await page.waitForTimeout(1_400)

    const resyncRequestCount = publicationRequests.length
    await emitEventSourceSignal(
        page,
        'project.resync-required',
        JSON.stringify({ reason: 'e2e-validation' })
    )
    await expect
        .poll(() => publicationRequests.length, { timeout: 10_000 })
        .toBeGreaterThan(resyncRequestCount)
})

test('refreshes an open publication editor after a worker state change', async ({ page }) => {
    test.setTimeout(45_000)

    await installFakeEventSource(page)
    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E realtime channel ${suffix}`

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('radio', { name: 'Other (publish by hand)', exact: true }).click()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('button', { name: 'Content rules', exact: true }).click()
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    await page.getByRole('link', { name: 'New post', exact: true }).click()
    await expect(page.locator('[data-new-publication-form]')).toHaveAttribute('aria-busy', 'false')
    await page.getByLabel('Content', { exact: true }).fill('E2E realtime editor content')
    await expect(page.getByLabel('Content', { exact: true })).toHaveText(
        'E2E realtime editor content'
    )
    const publicationResponse = page.waitForResponse(
        response => response.url().endsWith('/posts') && response.request().method() === 'POST'
    )
    await page.locator('button[name="publication-action"][value="schedule"]').click()
    const publicationResult = (await (await publicationResponse).json()) as {
        publications: { id: string }[]
    }
    const publicationId = publicationResult.publications[0]?.id
    if (publicationId === undefined) throw new Error('Expected a created publication')

    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    const publicationLink = page.locator(
        `a[data-publication-edit-link="true"][href$="/publications/${publicationId}"]`
    )
    await expect(publicationLink).toBeVisible()

    let editorRequestCount = 0
    let retryRequested = false
    let editorPublication: Record<string, unknown> | undefined
    await page.route(
        `**/api/projects/${projectId}/publications/${publicationId}/editor`,
        async route => {
            if (route.request().method() !== 'GET') {
                await route.continue()
                return
            }

            const response = await route.fetch()
            const body = (await response.json()) as {
                editor: { publication: Record<string, unknown> }
            }
            editorRequestCount += 1
            editorPublication = body.editor.publication
            if (editorRequestCount === 1 && !retryRequested) {
                await route.fulfill({
                    status: response.status(),
                    contentType: 'application/json',
                    body: JSON.stringify(body),
                })
                return
            }

            await route.fulfill({
                status: response.status(),
                contentType: 'application/json',
                body: JSON.stringify({
                    ...body,
                    editor: {
                        ...body.editor,
                        publication: {
                            ...body.editor.publication,
                            deliveryMode: 'automatic',
                            errorMessage: 'The worker could not deliver this publication',
                            state: retryRequested ? 'ready' : 'failed',
                        },
                    },
                }),
            })
        }
    )

    let retryCalls = 0
    await page.route(
        `**/api/projects/${projectId}/publications/${publicationId}/retry`,
        async route => {
            expect(route.request().method()).toBe('POST')
            retryCalls += 1
            retryRequested = true
            if (editorPublication === undefined) {
                throw new Error('Expected the publication editor to be loaded')
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    publication: {
                        ...editorPublication,
                        errorMessage: null,
                        state: 'ready',
                    },
                }),
            })
        }
    )

    await publicationLink.click()
    await expect(page.locator('[data-publication-lifecycle="true"]')).toBeVisible()
    await expect(
        page.locator('[data-publication-lifecycle="true"]').getByText('Scheduled', { exact: true })
    ).toBeVisible()
    await expect
        .poll(() => readEventSource(page))
        .toMatchObject({
            url: `/api/projects/${projectId}/events`,
            withCredentials: true,
        })

    await emitEventSourceSignal(
        page,
        'project.update',
        JSON.stringify({
            id: 'e2e-realtime-publication-failed',
            cursor: 'event-sequence:failed',
            projectId,
            version: 1,
            type: 'publication.execution.failed',
            occurredAt: Date.now(),
            entity: { type: 'publication', id: publicationId },
            payload: {},
        })
    )

    await expect.poll(() => editorRequestCount, { timeout: 10_000 }).toBeGreaterThan(1)
    await expect(
        page.locator('[data-publication-lifecycle="true"]').getByText('Failed', { exact: true })
    ).toBeVisible()
    await expect(page.locator('[data-publication-error="true"]')).toContainText(
        'The worker could not deliver this publication'
    )
    await expect(page.locator('[data-publication-action="retry"]')).toBeVisible()
    await expect(
        page.getByText('The publication changed in the background.', { exact: false })
    ).toBeVisible()

    const passiveNotice = page.locator('[data-passive-update="true"]')
    await expect(passiveNotice).toHaveAttribute('role', 'status')
    const sourcePrecedesNotice = await passiveNotice.evaluate(notice => {
        const source = document.querySelector('[data-publication-composer="true"]')
        return (
            source !== null &&
            Boolean(source.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING)
        )
    })
    expect(sourcePrecedesNotice).toBe(true)

    await page.locator('[data-publication-action="retry"]').click()
    await expect(
        page.getByRole('status').filter({ hasText: 'Delivery retry scheduled.' })
    ).toBeVisible()
    await expect(page.locator('[data-publication-action="retry"]')).toHaveCount(0)
    expect(retryCalls).toBe(1)
    await page.unrouteAll({ behavior: 'wait' })
})

test('shows notification loading, error, and retry states', async ({ page }) => {
    test.setTimeout(30_000)

    await installFakeEventSource(page)
    const suffix = randomUUID().slice(0, 8)
    const notificationsUrl = '**/api/**'
    let releaseNotifications: (() => void) | undefined
    const notificationsReleased = new Promise<void>(resolve => {
        releaseNotifications = resolve
    })
    let notificationListRequestCount = 0
    page.on('request', request => {
        if (
            request.method() === 'GET' &&
            request.url().includes('/api/notifications?') &&
            !request.url().includes('/api/notifications/events')
        ) {
            notificationListRequestCount += 1
        }
    })
    await page.route(notificationsUrl, async route => {
        if (!route.request().url().includes('/notifications')) {
            await route.continue()
            return
        }
        await notificationsReleased
        await route.continue()
    })

    await createAccountAndProject(page, suffix)
    await expect.poll(() => notificationListRequestCount).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Open notifications', exact: true }).click()
    await expect(page.getByRole('status', { name: /Loading notifications/ })).toBeVisible()
    releaseNotifications?.()
    await expect(page.getByText('No notifications', { exact: true })).toBeVisible()
    await page.unroute(notificationsUrl)

    const notificationErrorUrl = '**/api/**'
    await page.route(notificationErrorUrl, async route => {
        if (!route.request().url().includes('/api/notification-preferences')) {
            await route.continue()
            return
        }
        await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({
                error: { code: 'not_found', message: 'Project or notification not found' },
            }),
        })
    })
    await page.getByRole('button', { name: 'Open notification preferences', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(
        'The requested resource could not be found.'
    )

    await page.unroute(notificationErrorUrl)
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(
        page.getByRole('heading', { name: 'Notification preferences', exact: true })
    ).toBeVisible()
})

test('shows unread notification count before opening the inbox', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)

    await page.route('**/api/notifications?*', async route => {
        const response = await route.fetch()
        const body = (await response.json()) as {
            readonly notifications: readonly unknown[]
            readonly nextCursor: string | null
            readonly unreadCount: number
            readonly totalUnreadCount: number
        }

        await route.fulfill({
            response,
            body: JSON.stringify({
                ...body,
                notifications: [
                    {
                        id: 'e2e-unread-notification',
                        projectId,
                        sourceEventId: 'e2e-unread-notification-event',
                        kind: 'publication_published',
                        severity: 'success',
                        subject: {
                            type: 'publication',
                            id: 'e2e-unread-publication',
                        },
                        title: 'Publication delivered',
                        body: 'Postdot confirmed that the publication was delivered.',
                        readAt: null,
                        archivedAt: null,
                        createdAt: Date.now(),
                    },
                ],
                unreadCount: 1,
                totalUnreadCount: 1,
            }),
        })
    })

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const notificationButton = page.getByRole('button', {
        name: 'Open notifications, 1 unread',
        exact: true,
    })
    await expect(notificationButton).toBeVisible()

    await notificationButton.click()
    await expect(page.getByText('Publication delivered', { exact: true })).toBeVisible()
})

test('keeps operational labels localized without changing custom notification copy', async ({
    page,
}, testInfo) => {
    test.setTimeout(60_000)
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const templates = [
        [
            'publication_published',
            'success',
            'Publication delivered',
            'Postdot confirmed that the publication was delivered.',
        ],
        [
            'publication_failed',
            'error',
            'Publication failed',
            'The publication could not be delivered and needs attention.',
        ],
        [
            'publication_ambiguous',
            'warning',
            'Publication outcome unknown',
            'Postdot could not confirm whether the publication was delivered.',
        ],
        [
            'publication_failed',
            'error',
            'Custom integration report',
            'Keep this integration-owned message unchanged.',
        ],
    ]
    await page.route('**/api/notifications?*', async route => {
        await route.fulfill({
            json: {
                notifications: templates.map(([kind, severity, title, body], index) => ({
                    id: `locale-notification-${index}`,
                    projectId,
                    sourceEventId: `locale-event-${index}`,
                    kind,
                    severity,
                    title,
                    body,
                    subject: { type: 'publication', id: `locale-publication-${index}` },
                    readAt: null,
                    archivedAt: null,
                    createdAt: Date.now(),
                })),
                nextCursor: null,
                unreadCount: 4,
                totalUnreadCount: 4,
            },
        })
    })
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Locale test destination', profile: 'manual-message' },
    })
    expect(channelResponse.ok()).toBe(true)
    const { channel } = (await channelResponse.json()) as { channel: { id: string } }
    const postResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: {
                body: { format: 'plain_text', text: 'Localized field review' },
                media: [],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(postResponse.ok()).toBe(true)
    const { publications } = (await postResponse.json()) as { publications: { id: string }[] }
    await page.reload()

    for (const locale of ['en', 'fr'] as const) {
        const copy = locale === 'fr' ? fr : en
        if (locale === 'fr') {
            await openLanguageMenu(page)
            await page.getByRole('menuitem', { name: 'Français', exact: true }).click()
        }
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await page.setViewportSize({ width: locale === 'fr' ? 390 : 1280, height: 844 })
        await page
            .getByRole('button', {
                name: copy.notifications_open_unread.replace('{count}', '4'),
                exact: true,
            })
            .click()
        await expect(
            page.getByText(copy.notification_delivered_title, { exact: true })
        ).toBeVisible()
        await expect(page.getByText(copy.notification_failed_title, { exact: true })).toBeVisible()
        await expect(
            page.getByText(copy.notification_uncertain_title, { exact: true })
        ).toBeVisible()
        await expect(page.getByText('Custom integration report', { exact: true })).toBeVisible()
        await expect(
            page.getByText('Keep this integration-owned message unchanged.', { exact: true })
        ).toHaveCount(0)
        await expect(page.locator('[data-notification-row] time')).toHaveCount(4)
        await expect(
            page.getByRole('button', {
                name: copy.notifications_mark_as_read.replace(
                    '{title}',
                    copy.notification_delivered_title
                ),
                exact: true,
            })
        ).toBeVisible()
        const readAction = page.getByRole('button', {
            name: copy.notifications_mark_as_read.replace(
                '{title}',
                copy.notification_delivered_title
            ),
            exact: true,
        })
        const archiveAction = page.getByRole('button', {
            name: copy.notifications_archive_item.replace(
                '{title}',
                copy.notification_delivered_title
            ),
            exact: true,
        })
        const minimumTarget = locale === 'fr' ? 44 : 32
        await expect
            .poll(async () => (await readAction.boundingBox())?.width ?? 0)
            .toBeGreaterThanOrEqual(minimumTarget)
        const readBounds = await readAction.boundingBox()
        const archiveBounds = await archiveAction.boundingBox()
        expect(readBounds).not.toBeNull()
        expect(archiveBounds).not.toBeNull()
        expect(readBounds!.width).toBeGreaterThanOrEqual(minimumTarget)
        expect(readBounds!.height).toBeGreaterThanOrEqual(minimumTarget)
        expect(archiveBounds!.width).toBeGreaterThanOrEqual(minimumTarget)
        expect(archiveBounds!.x).toBeGreaterThanOrEqual(readBounds!.x + readBounds!.width + 4)
        await page.screenshot({ path: testInfo.outputPath(`notifications-${locale}.png`) })
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        expect(
            await page.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth)
        ).toBe(true)
        await page.keyboard.press('Escape')

        await page.goto(`/dashboard/projects/${projectId}/publications/${publications[0]!.id}`)
        // The post editor (SPEC-013) shows the channel text in its editor and the title in
        // its title field; the remaining channel fields sit in Content options.
        await expect(
            page.getByRole('textbox', { name: copy.publication_new_channel_copy, exact: true })
        ).toBeVisible()
        await expect(
            page.getByRole('textbox', { name: copy.builder_title_optional, exact: true })
        ).toBeVisible()
        await page
            .locator('[data-post-channel-panel] [data-publication-customization="true"] > summary')
            .click()
        const target = page.locator('[data-target-editor="true"]')
        await expect(target.getByText(copy.profile_field_language, { exact: true })).toBeVisible()
        await page.goto(`/dashboard/projects/${projectId}/publications/new`)
        await page.locator('[data-publication-schedule-disclosure] > summary').click()
        await page.locator('#publication-default-schedule').click()
        const picker = page.getByRole('dialog', { name: copy.date_time_picker_date, exact: true })
        const labels = calendarLocales[locale].labels
        await expect(
            picker.getByRole('combobox', {
                name: calendarLabel(labels?.labelMonthDropdown),
                exact: true,
            })
        ).toBeVisible()
        await expect(
            picker.getByRole('combobox', {
                name: calendarLabel(labels?.labelYearDropdown),
                exact: true,
            })
        ).toBeVisible()
        await expect(
            picker.getByRole('button', { name: calendarLabel(labels?.labelNext), exact: true })
        ).toBeVisible()
        await expect(
            picker.getByRole('textbox', { name: copy.date_time_picker_time, exact: true })
        ).toBeVisible()
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.keyboard.press('Escape')
        if (locale === 'fr') {
            await page.getByRole('button', { name: copy.nav_show_menu, exact: true }).click()
            const navigation = page.getByRole('dialog', { name: copy.nav_aria_label, exact: true })
            await expect(navigation).toBeVisible()
            await expect(
                navigation.getByRole('button', { name: copy.common_close, exact: true })
            ).toBeVisible()
            await expect(navigation.getByText('Displays the mobile sidebar.')).toHaveCount(0)
            await page.keyboard.press('Escape')
        }
    }
})

async function installFakeEventSource(page: Page): Promise<void> {
    await page.addInitScript(() => {
        type Listener = (event: { readonly data: string }) => void
        type Controller = {
            readonly url: string
            readonly withCredentials: boolean
            emit: (type: string, data?: string) => void
        }

        const windowWithController = globalThis as typeof globalThis & {
            __postdotTestEventSource?: Controller
        }

        class TestEventSource implements Controller {
            readonly url: string
            readonly withCredentials: boolean
            private readonly listeners = new Map<string, Set<Listener>>()
            private closed = false

            constructor(url: string, init?: { readonly withCredentials?: boolean }) {
                this.url = url
                this.withCredentials = init?.withCredentials === true
                windowWithController.__postdotTestEventSource = this
            }

            addEventListener(type: string, listener: Listener): void {
                const listeners = this.listeners.get(type) ?? new Set<Listener>()
                listeners.add(listener)
                this.listeners.set(type, listeners)
            }

            close(): void {
                this.closed = true
                windowWithController.__postdotTestEventSource = undefined
            }

            emit(type: string, data = ''): void {
                if (this.closed) return
                for (const listener of this.listeners.get(type) ?? []) listener({ data })
            }
        }

        Object.defineProperty(windowWithController, '__postdotTestEventSource', {
            configurable: true,
            writable: true,
            value: undefined,
        })
        Object.defineProperty(windowWithController, 'EventSource', {
            configurable: true,
            writable: true,
            value: TestEventSource,
        })
    })
}

async function readEventSource(page: Page): Promise<TestEventSourceController | null> {
    return page.evaluate(() => {
        const windowWithController = globalThis as typeof globalThis & {
            __postdotTestEventSource?: TestEventSourceController
        }
        return windowWithController.__postdotTestEventSource ?? null
    })
}

async function emitEventSourceSignal(page: Page, type: string, data = ''): Promise<void> {
    await page.evaluate(
        ({ type: signalType, data: signalData }) => {
            const windowWithController = globalThis as typeof globalThis & {
                __postdotTestEventSource?: TestEventSourceController
            }
            windowWithController.__postdotTestEventSource?.emit(signalType, signalData)
        },
        { type, data }
    )
}

test('reads grouped post outcomes and applies inbox actions to every member', async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000)
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Release team', profile: 'manual-message' },
    })
    expect(channelResponse.ok()).toBe(true)
    const { channel } = (await channelResponse.json()) as { channel: { id: string } }
    const postResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            title: 'November release notes and a calmer publishing workflow',
            sourceContent: {
                body: { format: 'plain_text', text: 'Release notes for the team' },
                media: [],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(postResponse.ok()).toBe(true)
    const { post, publications } = (await postResponse.json()) as {
        post: { id: string }
        publications: { id: string }[]
    }
    expect(
        (
            await page.request.patch(`/api/projects/${projectId}`, {
                data: { timeZone: 'America/New_York' },
            })
        ).ok()
    ).toBe(true)
    const timestamp = Date.now() - 5 * 60_000
    const title = 'November release notes and a calmer publishing workflow'
    const names = ['Release team with a long channel name', 'Community', 'Engineering', 'Partners']
    const notifications = names.map((name, index) => ({
        id: `grouped-${index}`,
        projectId,
        sourceEventId: `grouped-event-${index}`,
        kind: 'publication_published',
        severity: 'success',
        title: 'Publication delivered',
        body: 'Postdot confirmed that the publication was delivered.',
        subject: { type: 'publication', id: publications[0]!.id },
        readAt: null as number | null,
        archivedAt: null as number | null,
        createdAt: timestamp - index * 1_000,
        context: {
            postId: post.id,
            postTitle: title,
            sourceExcerpt: null,
            mediaCount: 0,
            projectId,
            projectName: 'Inbox review',
            scheduledAt: null,
            canRetry: false,
            channel: { id: `inbox-channel-${index}`, name, imageUrl: null },
        },
    }))
    notifications.push({
        ...notifications[0]!,
        id: 'retryable',
        kind: 'publication_failed',
        severity: 'error',
        title: 'Publication failed',
        body: 'The publication could not be delivered and needs attention.',
        context: {
            ...notifications[0]!.context,
            postId: 'failed-post',
            postTitle: 'A post that needs another attempt',
            canRetry: true,
        },
    })
    notifications.push({
        ...notifications[0]!,
        id: 'uncertain',
        kind: 'publication_ambiguous',
        severity: 'warning',
        title: 'Publication outcome unknown',
        body: 'Postdot could not confirm whether the publication was delivered.',
        readAt: timestamp,
        createdAt: timestamp - 86_400_000,
        context: {
            ...notifications[0]!.context,
            postId: 'uncertain-post',
            postTitle: 'An outcome to review',
        },
    })
    const readIds: string[] = []
    const archivedIds: string[] = []
    await page.route('**/api/notifications?*', route => {
        const active = notifications.filter(item => item.archivedAt === null)
        const unreadCount = active.filter(item => item.readAt === null).length
        return route.fulfill({
            json: {
                notifications: [
                    ...active,
                    {
                        ...notifications[0],
                        id: 'missing-subject',
                        context: null,
                        readAt: timestamp,
                        createdAt: timestamp - 9 * 86_400_000,
                    },
                ],
                unreadCount,
                totalUnreadCount: unreadCount,
                nextCursor: null,
            },
        })
    })
    await page.route('**/api/notifications/*/read', async route => {
        const id = route.request().url().split('/').at(-2)!
        const notification = notifications.find(item => item.id === id)!
        notification.readAt = Date.now()
        readIds.push(id)
        const { context: _context, ...response } = notification
        await route.fulfill({ json: response })
    })
    await page.route('**/api/notifications/*/archive', async route => {
        const id = route.request().url().split('/').at(-2)!
        const notification = notifications.find(item => item.id === id)!
        notification.archivedAt = Date.now()
        archivedIds.push(id)
        await route.fulfill({ json: notification })
    })
    let retries = 0
    await page.route(
        `**/api/projects/${projectId}/publications/${publications[0]!.id}/retry`,
        route => {
            retries += 1
            return route.fulfill({ json: {} })
        }
    )
    await page.reload()
    const catalogs = { en, fr, es, de }
    for (const locale of ['en', 'fr', 'es', 'de'] as const) {
        if (locale !== 'en') {
            await openLanguageMenu(page)
            await page
                .getByRole('menuitem', {
                    name: { fr: 'Français', es: 'Español', de: 'Deutsch' }[locale],
                    exact: true,
                })
                .click()
        }
        const copy = catalogs[locale]
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        for (const [width, theme] of [
            [1440, 'light'],
            [1440, 'dark'],
            [390, 'light'],
            [390, 'dark'],
        ] as const) {
            await page.setViewportSize({ width, height: 900 })
            await switchTheme(page, theme)
            await page
                .getByRole('button', {
                    name: copy.notifications_open_unread.replace('{count}', '5'),
                    exact: true,
                })
                .click()
            const group = page
                .locator('[data-notification-row]')
                .filter({ has: page.getByText(title, { exact: true }) })
            await expect(group).toHaveCount(1)
            await expect(group.locator('[data-channel-avatar]')).toHaveCount(3)
            await expect(group.getByText('+1', { exact: true })).toBeVisible()
            const channels = new Intl.ListFormat(locale, {
                style: 'long',
                type: 'conjunction',
            }).format([
                ...names.slice(0, 2),
                copy.notifications_more_channels.replace('{count}', '2'),
            ])
            await expect(
                group.getByText(copy.notifications_published_on.replace('{channels}', channels), {
                    exact: true,
                })
            ).toBeVisible()
            await expect(
                page.getByRole('heading', { name: copy.notifications_today, exact: true })
            ).toBeVisible()
            await expect(
                page.getByRole('heading', { name: copy.notifications_yesterday, exact: true })
            ).toBeVisible()
            await expect(
                page.getByRole('heading', { name: copy.notifications_earlier, exact: true })
            ).toBeVisible()
            await expect(page.locator('[data-notification-row]').last().locator('time')).toHaveText(
                /\d/
            )
            await expect(page.locator('[data-notification-row]').last()).not.toContainText(
                'Postdot confirmed'
            )
            const retryRow = page
                .locator('[data-notification-row]')
                .filter({ hasText: 'A post that needs another attempt' })
            await expect(
                retryRow.getByRole('button', { name: copy.common_retry, exact: true })
            ).toBeVisible()
            await expect(
                page
                    .locator('[data-notification-row]')
                    .filter({ hasText: 'An outcome to review' })
                    .getByRole('button', { name: copy.common_retry, exact: true })
            ).toHaveCount(0)
            await group.getByRole('link').focus()
            await page.keyboard.press('Tab')
            const tooltip = page.getByRole('tooltip')
            await expect(tooltip).toHaveText(
                new Intl.DateTimeFormat(locale, {
                    month: 'short',
                    day: 'numeric',
                    hour: locale === 'en' ? 'numeric' : '2-digit',
                    minute: '2-digit',
                    timeZone: 'America/New_York',
                }).format(timestamp)
            )
            expect(await group.getByRole('link').getAttribute('href')).toBe(
                `/dashboard/projects/${projectId}/posts/${post.id}`
            )
            expect(await page.locator('[data-notification-row] [title]').count()).toBe(0)
            expect(
                await page
                    .locator('[data-slot="scroll-area-viewport"]')
                    .last()
                    .evaluate(element => element.scrollWidth <= element.clientWidth)
            ).toBe(true)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            expect(
                await page
                    .locator('body')
                    .evaluate(element => element.scrollWidth <= window.innerWidth)
            ).toBe(true)
            await page.screenshot({
                path: testInfo.outputPath(`notification-groups-${locale}-${width}-${theme}.png`),
            })
            await page.keyboard.press('Escape')
        }
    }
    await openLanguageMenu(page)
    await page.getByRole('menuitem', { name: 'English', exact: true }).click()
    await page
        .getByRole('button', {
            name: en.notifications_open_unread.replace('{count}', '5'),
            exact: true,
        })
        .click()
    const group = page
        .locator('[data-notification-row]')
        .filter({ has: page.getByText(title, { exact: true }) })
    await group
        .getByRole('button', {
            name: en.notifications_mark_as_read.replace('{title}', title),
            exact: true,
        })
        .click()
    await expect.poll(() => readIds).toEqual(['grouped-0', 'grouped-1', 'grouped-2', 'grouped-3'])
    await expect(
        group.getByRole('button', {
            name: en.notifications_mark_as_read.replace('{title}', title),
            exact: true,
        })
    ).toHaveCount(0)
    await expect(group.getByRole('link')).toHaveAttribute(
        'href',
        `/dashboard/projects/${projectId}/posts/${post.id}`
    )
    await expect(
        page.getByRole('button', {
            name: en.notifications_open_unread.replace('{count}', '1'),
            exact: true,
        })
    ).toBeVisible()
    await page.getByRole('button', { name: en.common_retry, exact: true }).click()
    await expect.poll(() => retries).toBe(1)
    await group
        .getByRole('button', {
            name: en.notifications_archive_item.replace('{title}', title),
            exact: true,
        })
        .click()
    await expect
        .poll(() => archivedIds)
        .toEqual(['grouped-0', 'grouped-1', 'grouped-2', 'grouped-3'])
    await expect(group).toHaveCount(0)
})

test('opens notification subjects without acknowledgement and handles unavailable publications', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    const projectId = await createAccountAndProject(page, randomUUID().slice(0, 8))
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Notification destination', profile: 'manual-message' },
    })
    expect(channelResponse.ok()).toBe(true)
    const { channel } = (await channelResponse.json()) as { channel: { id: string } }
    const postResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: {
                body: { format: 'plain_text', text: 'Notification follow-up' },
                media: [],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(postResponse.ok()).toBe(true)
    const { publications } = (await postResponse.json()) as { publications: { id: string }[] }
    const publicationId = publications[0]!.id
    if ((await page.locator('html').getAttribute('class'))?.split(' ').includes('dark')) {
        await switchTheme(page, 'light')
    }
    const titles = ['Delivered subject', 'Failed subject', 'Uncertain subject']
    await page.route('**/api/notifications?*', route =>
        route.fulfill({
            json: {
                notifications: titles
                    .map((title, index) => ({
                        id: `follow-up-${index}`,
                        projectId,
                        sourceEventId: `follow-up-event-${index}`,
                        kind: [
                            'publication_published',
                            'publication_failed',
                            'publication_ambiguous',
                        ][index],
                        severity: ['success', 'error', 'warning'][index],
                        title,
                        body: null,
                        subject: { type: 'publication', id: publicationId },
                        readAt: null,
                        archivedAt: null,
                        createdAt: Date.now(),
                    }))
                    .concat([
                        {
                            id: 'unsupported',
                            projectId,
                            sourceEventId: 'unsupported-event',
                            kind: 'custom',
                            severity: 'info',
                            title: 'Unknown subject',
                            body: null,
                            subject: { type: 'unknown', id: 'unknown' },
                            readAt: null,
                            archivedAt: null,
                            createdAt: Date.now(),
                        },
                    ]),
                unreadCount: 4,
                totalUnreadCount: 4,
                nextCursor: null,
            },
        })
    )
    let mutations = 0
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            /\/notifications\/[^/]+\/(read|archive)/.test(request.url())
        )
            mutations += 1
    })
    const openInbox = async () => {
        await page
            .getByRole('button', {
                name: en.notifications_open_unread.replace('{count}', '4'),
                exact: true,
            })
            .click()
    }
    for (const title of titles) {
        await page.goto(`/dashboard/projects/${projectId}/overview`)
        await openInbox()
        await page
            .getByRole('link', {
                name: en.notifications_open_subject.replace('{title}', title),
                exact: true,
            })
            .focus()
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(new RegExp(`/publications/${publicationId}$`))
        await expect(
            page.getByText('Notification follow-up', { exact: true }).first()
        ).toBeVisible()
        expect(mutations).toBe(0)
    }
    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await page.setViewportSize({ width: 390, height: 844 })
    let mode: 'missing' | 'forbidden' | 'temporary' | 'race' = 'missing'
    let editorRequests = 0
    await page.route(
        `**/api/projects/${projectId}/publications/${publicationId}/editor`,
        async route => {
            editorRequests += 1
            if (mode === 'race' && editorRequests === 1) {
                await route.continue()
                return
            }
            const status = mode === 'forbidden' ? 403 : mode === 'temporary' ? 503 : 404
            await route.fulfill({
                status,
                json: {
                    error: {
                        code:
                            status === 404
                                ? 'not_found'
                                : status === 403
                                  ? 'forbidden'
                                  : 'provider_unavailable',
                        message: 'Subject lookup failed',
                    },
                },
            })
        }
    )
    await openInbox()
    await expect(
        page.getByRole('link', {
            name: en.notifications_open_subject.replace('{title}', 'Unknown subject'),
            exact: true,
        })
    ).toHaveCount(0)
    const subject = page.getByRole('link', {
        name: en.notifications_open_subject.replace('{title}', titles[1]!),
        exact: true,
    })
    for (const nextMode of ['missing', 'forbidden', 'temporary'] as const) {
        mode = nextMode
        await subject.click()
        await expect(page.getByRole('alert')).toBeVisible()
        if (mode !== 'temporary')
            await expect(page.getByRole('alert')).toHaveText(en.notifications_subject_unavailable)
        await expect(page).toHaveURL(/\/overview$/)
        expect(mutations).toBe(0)
    }
    await page.screenshot({ path: testInfo.outputPath('notification-unavailable-mobile.png') })
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.keyboard.press('Escape')
    await switchTheme(page, 'dark')
    await openInbox()
    mode = 'forbidden'
    await subject.click()
    await expect(page.getByRole('alert')).toHaveText(en.notifications_subject_unavailable)
    await page.screenshot({ path: testInfo.outputPath('notification-unavailable-dark-mobile.png') })
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    mode = 'race'
    editorRequests = 0
    await subject.click()
    await expect(
        page.getByRole('heading', { name: en.notifications_subject_unavailable, exact: true })
    ).toBeVisible()
    await page.getByRole('link', { name: en.editor_back_to_queue, exact: true }).click()
    await expect(page).toHaveURL(/\/queue$/)
    expect(mutations).toBe(0)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E realtime ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-realtime-${suffix}@postdot.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-realtime-password')
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
        .getByRole('textbox', { name: 'Name', exact: true })
        .fill(`E2E realtime project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'Name', exact: true }) })
        .getByRole('button', { name: 'Create project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    return projectIdFromUrl(page.url())
}

function projectIdFromUrl(value: string): string {
    const match = new URL(value).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${value}`)
    }

    return match[1]
}

function calendarLabel(value: string | ((argument: undefined) => string) | undefined): string {
    if (value === undefined) throw new Error('Expected a localized calendar label')
    return typeof value === 'string' ? value : value(undefined)
}
