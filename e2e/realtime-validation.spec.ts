import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

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
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await page.getByLabel('Content', { exact: true }).fill('E2E realtime editor content')
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

    await page.locator('[data-publication-action="retry"]').click()
    await expect(page.getByRole('alert')).toContainText('Delivery retry scheduled.')
    await expect(page.locator('[data-publication-action="retry"]')).toHaveCount(0)
    expect(retryCalls).toBe(1)
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
    await expect(page.getByRole('alert')).toContainText('The request could not be completed.')

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
                        body: 'Herald confirmed that the publication was delivered.',
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

async function installFakeEventSource(page: Page): Promise<void> {
    await page.addInitScript(() => {
        type Listener = (event: { readonly data: string }) => void
        type Controller = {
            readonly url: string
            readonly withCredentials: boolean
            emit: (type: string, data?: string) => void
        }

        const windowWithController = globalThis as typeof globalThis & {
            __heraldTestEventSource?: Controller
        }

        class TestEventSource implements Controller {
            readonly url: string
            readonly withCredentials: boolean
            private readonly listeners = new Map<string, Set<Listener>>()
            private closed = false

            constructor(url: string, init?: { readonly withCredentials?: boolean }) {
                this.url = url
                this.withCredentials = init?.withCredentials === true
                windowWithController.__heraldTestEventSource = this
            }

            addEventListener(type: string, listener: Listener): void {
                const listeners = this.listeners.get(type) ?? new Set<Listener>()
                listeners.add(listener)
                this.listeners.set(type, listeners)
            }

            close(): void {
                this.closed = true
                windowWithController.__heraldTestEventSource = undefined
            }

            emit(type: string, data = ''): void {
                if (this.closed) return
                for (const listener of this.listeners.get(type) ?? []) listener({ data })
            }
        }

        Object.defineProperty(windowWithController, '__heraldTestEventSource', {
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
            __heraldTestEventSource?: TestEventSourceController
        }
        return windowWithController.__heraldTestEventSource ?? null
    })
}

async function emitEventSourceSignal(page: Page, type: string, data = ''): Promise<void> {
    await page.evaluate(
        ({ type: signalType, data: signalData }) => {
            const windowWithController = globalThis as typeof globalThis & {
                __heraldTestEventSource?: TestEventSourceController
            }
            windowWithController.__heraldTestEventSource?.emit(signalType, signalData)
        },
        { type, data }
    )
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E realtime ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-realtime-${suffix}@herald.local`)
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
