import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }
import { calendarLocales } from '../packages/ui/src/components/calendar'

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
    await expect(page.getByRole('heading', { name: 'Select project', exact: true })).toBeVisible()
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
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('button', { name: 'Configure content', exact: true }).click()
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    await page.getByRole('link', { name: 'New publication', exact: true }).click()
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
        page.locator('[data-publication-lifecycle="true"]').getByText('Queued', { exact: true })
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
            await page.locator('[data-slot="language-switcher-trigger"]').click()
            await page.getByRole('menuitem', { name: en.language_french, exact: true }).click()
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
            page.getByText(copy.notification_uncertain_body, { exact: true })
        ).toBeVisible()
        await expect(page.getByText('Custom integration report', { exact: true })).toBeVisible()
        await expect(
            page.getByText('Keep this integration-owned message unchanged.', { exact: true })
        ).toBeVisible()
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
        await page.locator('summary').filter({ hasText: copy.editor_channel_details }).click()
        const target = page.locator('[data-target-editor="true"]')
        await expect(target.getByText(copy.profile_field_body, { exact: true })).toBeVisible()
        // The destination headline label states the field availability next to
        // the localized field name, so the field is addressed by the full
        // localized accessible name instead of a bare label.
        await expect(
            target.getByRole('textbox', {
                name: `${copy.profile_field_headline} ${copy.builder_optional}`,
                exact: true,
            })
        ).toBeVisible()
        await expect(target.getByText(copy.builder_optional, { exact: true })).toBeVisible()
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
            await page.getByRole('button', { name: copy.nav_toggle, exact: true }).click()
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
            __postbotTestEventSource?: Controller
        }

        class TestEventSource implements Controller {
            readonly url: string
            readonly withCredentials: boolean
            private readonly listeners = new Map<string, Set<Listener>>()
            private closed = false

            constructor(url: string, init?: { readonly withCredentials?: boolean }) {
                this.url = url
                this.withCredentials = init?.withCredentials === true
                windowWithController.__postbotTestEventSource = this
            }

            addEventListener(type: string, listener: Listener): void {
                const listeners = this.listeners.get(type) ?? new Set<Listener>()
                listeners.add(listener)
                this.listeners.set(type, listeners)
            }

            close(): void {
                this.closed = true
                windowWithController.__postbotTestEventSource = undefined
            }

            emit(type: string, data = ''): void {
                if (this.closed) return
                for (const listener of this.listeners.get(type) ?? []) listener({ data })
            }
        }

        Object.defineProperty(windowWithController, '__postbotTestEventSource', {
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
            __postbotTestEventSource?: TestEventSourceController
        }
        return windowWithController.__postbotTestEventSource ?? null
    })
}

async function emitEventSourceSignal(page: Page, type: string, data = ''): Promise<void> {
    await page.evaluate(
        ({ type: signalType, data: signalData }) => {
            const windowWithController = globalThis as typeof globalThis & {
                __postbotTestEventSource?: TestEventSourceController
            }
            windowWithController.__postbotTestEventSource?.emit(signalType, signalData)
        },
        { type, data }
    )
}

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
        await page
            .getByRole('button', {
                name: en.theme_switch_to.replace('{theme}', en.theme_light),
                exact: true,
            })
            .click()
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
            .getByRole('button', {
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
        page.getByRole('button', { name: 'Open publication: Unknown subject', exact: true })
    ).toHaveCount(0)
    const subject = page.getByRole('button', {
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
    await page
        .getByRole('button', {
            name: en.theme_switch_to.replace('{theme}', en.theme_dark),
            exact: true,
        })
        .click()
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
    await page.getByRole('link', { name: en.nav_overview, exact: true }).click()
    await expect(page).toHaveURL(/\/overview$/)
    expect(mutations).toBe(0)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E realtime ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-realtime-${suffix}@postbot.local`)
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
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E realtime project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
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
