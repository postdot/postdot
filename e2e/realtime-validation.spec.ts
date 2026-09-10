import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

type TestEventSourceController = {
    readonly url: string
    readonly withCredentials: boolean
    emit: (type: string, data?: string) => void
}

test('keeps an invalid project URL explicit instead of changing project context', async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    await page.goto('/dashboard/projects/not-a-project/overview')
    await expect(
        page.getByRole('heading', { name: 'Project unavailable', exact: true })
    ).toBeVisible()
    await expect(page).toHaveURL(/\/dashboard\/projects\/not-a-project\/overview$/)
    await expect(
        page.getByText('This project could not be found or you no longer have access to it.')
    ).toBeVisible()

    await page.getByRole('link', { name: 'Return to projects', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/?$/)
    await expect(page.getByRole('heading', { name: 'Select project', exact: true })).toBeVisible()
})

test('refreshes project data after realtime reconnect and project events', async ({ page }) => {
    test.setTimeout(30_000)

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
    await expect.poll(() => publicationRequests.length).toBeGreaterThan(initialRequestCount)
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
    await expect.poll(() => publicationRequests.length).toBeGreaterThan(updateRequestCount)
    await page.waitForTimeout(1_400)

    const resyncRequestCount = publicationRequests.length
    await emitEventSourceSignal(
        page,
        'project.resync-required',
        JSON.stringify({ reason: 'e2e-validation' })
    )
    await expect.poll(() => publicationRequests.length).toBeGreaterThan(resyncRequestCount)
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
    await page.route(notificationsUrl, async route => {
        if (!route.request().url().includes('/notifications')) {
            await route.continue()
            return
        }
        await notificationsReleased
        await route.continue()
    })

    await createAccountAndProject(page, suffix)

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
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E realtime ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-realtime-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-realtime-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByText('Create project', { exact: true }).click()
    await page.locator('#new-project').fill(`E2E realtime project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    return projectIdFromUrl(page.url())
}

function projectIdFromUrl(value: string): string {
    const match = new URL(value).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${value}`)
    }

    return match[1]
}
