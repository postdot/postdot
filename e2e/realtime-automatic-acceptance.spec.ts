// cspell:ignore framenavigated requestfailed
import { randomUUID } from 'node:crypto'

import { expect, test, type Page, type Request, type Response } from '@playwright/test'

interface RealtimeRecorderEvent {
    readonly url: string
    readonly listenerType: string
    readonly type: string
    readonly cursor: string | null
    readonly lastEventId: string
    readonly projectId: string | null
    readonly entityId: string | null
    readonly data: string
}

interface ReceiverRequestObservation {
    readonly deliveryId: string
    readonly body: {
        readonly event?: string
        readonly webhookVersion?: string
        readonly deliveryId?: string
        readonly publication?: { readonly id?: string; readonly projectId?: string }
        readonly channel?: { readonly id?: string }
        readonly content?: { readonly body?: string }
    }
    readonly headers: Record<string, string>
    readonly released: boolean
}

interface ReceiverObservations {
    readonly requests: readonly ReceiverRequestObservation[]
}

interface NavigationState {
    readonly marker: string | null
    readonly loads: number
}

/**
 * A body-only custom destination. No built-in execution means the web UI renders
 * the plain textarea target control rather than a rich editor, and the pinned
 * target body is what the worker must deliver to the receiver.
 */
const customWebhookProfile = {
    id: 'custom-webhook',
    version: 1,
    origin: 'custom',
    contentSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
            body: { type: 'string', minLength: 1, maxLength: 1_000_000 },
        },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
    capabilities: {
        revision: 'postdot-custom-v1',
        textFields: [
            {
                bindingId: 'body',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: 1_000_000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: {
        kind: 'declarative_http',
        contractId: 'custom-webhook',
        revision: 'v1',
        mode: 'postdot_webhook',
    },
}

const sourceText = 'Automatic realtime source'
const initialDestination = 'Initial automatic destination'
const localDestination = 'Local destination kept during automatic delivery'

for (const dirty of [false, true]) {
    test(
        dirty
            ? 'keeps an unsaved local destination when an automatic publication completes'
            : 'adopts the server state when an automatic publication completes',
        async ({ page }) => {
            test.setTimeout(120_000)
            const receiverOrigin = requireReceiverOrigin()
            await releaseAllDeliveries(receiverOrigin)

            await installNavigationRecorder(page)
            await installRealtimeRecorder(page)

            let mainFrameNavigationCount = 0
            page.on('framenavigated', frame => {
                if (frame === page.mainFrame()) mainFrameNavigationCount += 1
            })

            const suffix = randomUUID().slice(0, 8)
            const projectId = await createAccountAndProject(page, suffix)
            if (process.env.POSTDOT_E2E_TLS_PROXY === 'true') {
                const sessionCookie = (await page.context().cookies()).find(cookie =>
                    cookie.name.endsWith('better-auth.session_token')
                )
                expect(sessionCookie?.secure).toBe(true)
                expect(sessionCookie?.httpOnly).toBe(true)
            }
            const currentTimeZone = await readProjectTimeZone(page, projectId)
            const otherTimeZone =
                ['UTC', 'Pacific/Kiritimati', 'America/New_York'].find(
                    candidate => candidate !== currentTimeZone
                ) ?? 'UTC'
            const channelId = await createCustomWebhookChannel(page, projectId, suffix)
            await connectCustomHttpPublisher(page, projectId, channelId, receiverOrigin)
            const publicationId = await createScheduledAutomaticPublication(
                page,
                projectId,
                channelId
            )

            const editorPath = `/api/projects/${projectId}/publications/${publicationId}/editor`
            const projectDataMatcher = (url: URL) =>
                url.pathname === `/api/projects/${projectId}/channels`
            const draftPath = `/api/projects/${projectId}/publications/${publicationId}/draft`
            const draftMatcher = (url: URL) => url.pathname === draftPath

            let releaseProjectRead: (() => void) | undefined
            const projectReadGate = new Promise<void>(resolve => {
                releaseProjectRead = resolve
            })
            let projectReadHeld: (() => void) | undefined
            const heldProjectRead = new Promise<void>(resolve => {
                projectReadHeld = resolve
            })
            let projectReadCaptured = false
            let streamResponse: Response | undefined

            let completedEditorReads = 0
            let publicationListReads = 0
            const pendingProjectReads = new Set<Request>()
            page.on('framenavigated', frame => {
                if (frame !== page.mainFrame()) return
                // Requests from the previous document cannot gate this editor's startup.
                pendingProjectReads.clear()
                completedEditorReads = 0
                publicationListReads = 0
            })
            page.on('request', request => {
                const path = new URL(request.url()).pathname
                if (
                    request.method() === 'GET' &&
                    path.startsWith(`/api/projects/${projectId}/`) &&
                    !path.endsWith('/events')
                )
                    pendingProjectReads.add(request)
            })
            page.on('response', response => {
                const url = new URL(response.url())
                if (url.pathname === `/api/projects/${projectId}/events`) streamResponse = response
                if (
                    pendingProjectReads.has(response.request()) &&
                    response.ok() &&
                    response.request().method() === 'GET' &&
                    url.pathname === editorPath
                )
                    completedEditorReads += 1
                if (
                    pendingProjectReads.has(response.request()) &&
                    response.request().method() === 'GET' &&
                    url.pathname === `/api/projects/${projectId}/publications` &&
                    url.search === ''
                )
                    publicationListReads += 1
            })
            page.on('requestfinished', request => pendingProjectReads.delete(request))
            page.on('requestfailed', request => pendingProjectReads.delete(request))

            try {
                await page.goto(`/dashboard/projects/${projectId}/publications/${publicationId}`)
                await expect(page.locator('[data-publication-lifecycle="true"]')).toBeVisible()
                await expect
                    .poll(() => projectRealtimeSourceCount(page, projectId))
                    .toBeGreaterThan(0)
                await expect
                    .poll(() => projectRealtimeOpenCount(page, projectId), {
                        timeout: 15_000,
                        message: 'the project realtime stream to open',
                    })
                    .toBeGreaterThan(0)

                if (process.env.POSTDOT_E2E_TLS_PROXY === 'true') {
                    expect(new URL(page.url()).protocol).toBe('https:')
                    if (streamResponse === undefined)
                        throw new Error('Expected the TLS event stream')
                    expect(new URL(streamResponse.url()).origin).toBe(new URL(page.url()).origin)
                    expect((await streamResponse.securityDetails())?.protocol).toMatch(/^TLS/)
                }

                // The active editor loads without repeatedly refreshing the unfiltered overview list.
                // Drain active startup reads before gating the navigation metadata refresh.
                await expect
                    .poll(
                        () => ({
                            editorLoaded: completedEditorReads > 0,
                            pending: [...pendingProjectReads]
                                .map(request => new URL(request.url()).pathname)
                                .sort(),
                        }),
                        { timeout: 20_000, message: 'startup project refreshes to finish' }
                    )
                    .toEqual({ editorLoaded: true, pending: [] })
                expect(publicationListReads).toBe(0)

                const baseline = await readNavigationState(page)
                const baselineMainFrameNavigationCount = mainFrameNavigationCount

                if (dirty) {
                    await openCustomization(page)
                    await page.route(draftMatcher, route => route.abort('failed'))
                    const local = page.locator('[data-target-field="body"] textarea')
                    await local.fill(localDestination)
                    await expect(
                        page.getByRole('status', { name: 'Save failed', exact: true })
                    ).toBeVisible()
                }

                await page.route(projectDataMatcher, async route => {
                    const request = route.request()
                    if (request.method() !== 'GET' || projectReadCaptured) {
                        await route.continue()
                        return
                    }
                    projectReadCaptured = true
                    const response = await route.fetch()
                    projectReadHeld?.()
                    await projectReadGate
                    await route.fulfill({ response })
                })

                const timezonePatch = await page.request.patch(`/api/projects/${projectId}`, {
                    data: { timeZone: otherTimeZone },
                })
                expect(timezonePatch.ok()).toBe(true)
                await withTimeout(
                    heldProjectRead,
                    20_000,
                    'the unrelated project refresh to read project data'
                )

                const reschedule = await page.request.patch(
                    `/api/projects/${projectId}/publications/schedule`,
                    {
                        data: {
                            publicationIds: [publicationId],
                            scheduledAt: Date.now() + 1_000,
                        },
                    }
                )
                expect(reschedule.ok()).toBe(true)

                await expect
                    .poll(
                        async () =>
                            (await readReceiverObservations(receiverOrigin)).requests.filter(
                                request => request.body.publication?.id === publicationId
                            ).length,
                        { timeout: 30_000, message: 'the custom webhook delivery to arrive' }
                    )
                    .toBeGreaterThan(0)

                const observation = (await readReceiverObservations(receiverOrigin)).requests.find(
                    request => request.body.publication?.id === publicationId
                )
                if (observation === undefined) {
                    throw new Error('Expected the custom webhook delivery to be recorded')
                }
                expect(observation.body.event).toBe('publication.delivery')
                expect(observation.body.webhookVersion).toBe('1')
                expect(observation.body.deliveryId).toBe(observation.deliveryId)
                expect(observation.body.publication?.id).toBe(publicationId)
                expect(observation.body.publication?.projectId).toBe(projectId)
                expect(observation.body.channel?.id).toBe(channelId)
                expect(observation.body.content?.body).toBe(initialDestination)
                expect(headerValue(observation.headers, 'x-postdot-delivery-id')).toBe(
                    observation.deliveryId
                )
                expect(observation.released).toBe(false)

                const editorPublishedResponse = page.waitForResponse(
                    async response => {
                        if (response.request().method() !== 'GET') return false
                        if (new URL(response.url()).pathname !== editorPath) return false
                        try {
                            const body = (await response.json()) as {
                                editor?: { publication?: { state?: string } }
                            }
                            return body.editor?.publication?.state === 'published'
                        } catch {
                            return false
                        }
                    },
                    { timeout: 30_000 }
                )

                await releaseDelivery(receiverOrigin, observation.deliveryId)

                const rescheduledEvent = await waitForProjectEvent(
                    page,
                    projectId,
                    event =>
                        event.type === 'publication.rescheduled' &&
                        event.entityId === publicationId,
                    15_000,
                    'the rescheduled publication event'
                )
                const publishedEvent = await waitForProjectEvent(
                    page,
                    projectId,
                    event =>
                        event.type === 'publication.execution.succeeded' &&
                        event.entityId === publicationId,
                    20_000,
                    'the published publication event'
                )
                expect(publishedEvent.cursor).toMatch(/^event-sequence:\d+$/)
                expect(publishedEvent.lastEventId).toBe(publishedEvent.cursor)
                expect(cursorSequence(publishedEvent.cursor)).toBeGreaterThan(
                    cursorSequence(rescheduledEvent.cursor)
                )

                const authoritative = await page.request.get(editorPath)
                expect(authoritative.ok()).toBe(true)
                expect((await authoritative.json()).editor.publication.state).toBe('published')

                // Publication/editor updates must not wait for unrelated navigation data.
                const publishedResponse = await editorPublishedResponse
                releaseProjectRead?.()
                expect(publishedResponse.ok()).toBe(true)
                const publishedBody = (await publishedResponse.json()) as {
                    editor: { publication: { state: string; publishedAt: number | null } }
                }
                expect(publishedBody.editor.publication.state).toBe('published')
                expect(publishedBody.editor.publication.publishedAt).not.toBeNull()

                if (dirty) {
                    await expect(page.locator('[data-target-field="body"] textarea')).toHaveValue(
                        localDestination,
                        { timeout: 30_000 }
                    )
                    await expect(page.locator('[data-publication-conflict="true"]')).toBeVisible({
                        timeout: 30_000,
                    })
                    await expect(
                        page
                            .locator('[data-publication-editor-message="true"]')
                            .filter({ hasText: 'The server has newer work' })
                    ).toBeVisible({ timeout: 30_000 })
                } else {
                    await expect(page.locator('[data-publication-lifecycle="true"]')).toContainText(
                        'Published',
                        { timeout: 30_000 }
                    )
                    const passive = page.locator('[data-passive-update="true"]')
                    await expect(passive).toBeVisible({ timeout: 30_000 })
                    await expect(passive).toContainText(
                        'The publication changed in the background.'
                    )
                }

                const finalObservations = await readReceiverObservations(receiverOrigin)
                const matchingRequests = finalObservations.requests.filter(
                    request => request.body.publication?.id === publicationId
                )
                expect(matchingRequests).toHaveLength(1)
                expect(matchingRequests[0]?.body.content?.body).toBe(initialDestination)
                expect(matchingRequests[0]?.released).toBe(true)

                const finalNavigation = await readNavigationState(page)
                expect(finalNavigation.marker).not.toBeNull()
                expect(finalNavigation.marker).toBe(baseline.marker)
                expect(finalNavigation.loads).toBe(baseline.loads)
                expect(mainFrameNavigationCount).toBe(baselineMainFrameNavigationCount)
            } finally {
                releaseProjectRead?.()
                await page.unroute(projectDataMatcher).catch(() => undefined)
                await page.unroute(draftMatcher).catch(() => undefined)
                await releaseAllDeliveries(receiverOrigin).catch(() => undefined)
            }
        }
    )
}

function requireReceiverOrigin(): string {
    if (process.env.POSTDOT_E2E_REALTIME_ACCEPTANCE !== 'true') {
        throw new Error(
            'POSTDOT_E2E_REALTIME_ACCEPTANCE must be "true" to run the realtime automatic acceptance spec'
        )
    }
    const port = process.env.POSTDOT_E2E_RECEIVER_PORT
    if (port === undefined || port.trim() === '') {
        throw new Error('POSTDOT_E2E_RECEIVER_PORT must point at the running E2E webhook receiver')
    }
    return `http://127.0.0.1:${port}`
}

async function installNavigationRecorder(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const scope = globalThis as unknown as {
            sessionStorage: Storage
        } & Record<string, unknown>
        const loads = Number(scope.sessionStorage.getItem('__postdotAcceptanceLoads') ?? '0')
        scope.sessionStorage.setItem('__postdotAcceptanceLoads', String(loads + 1))
        if (typeof scope.__postdotAcceptanceMarker !== 'string') {
            scope.__postdotAcceptanceMarker = `${Date.now()}-${Math.random()}`
        }
    })
}

async function readNavigationState(page: Page): Promise<NavigationState> {
    return page.evaluate(() => {
        const scope = globalThis as unknown as {
            sessionStorage: Storage
        } & Record<string, unknown>
        return {
            marker:
                typeof scope.__postdotAcceptanceMarker === 'string'
                    ? scope.__postdotAcceptanceMarker
                    : null,
            loads: Number(scope.sessionStorage.getItem('__postdotAcceptanceLoads') ?? '0'),
        }
    })
}

async function installRealtimeRecorder(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const NativeEventSource = globalThis.EventSource
        const recorder: {
            sources: { url: string; withCredentials: boolean }[]
            events: unknown[]
        } = { sources: [], events: [] }
        Object.defineProperty(globalThis, '__postdotRealtimeRecorder', {
            configurable: true,
            writable: true,
            value: recorder,
        })

        const listenerTypes = [
            'project.update',
            'project.draft-changed',
            'project.resync-required',
            'project.access-revoked',
            'open',
            'error',
        ]

        const record = (url: string, listenerType: string, event: Event) => {
            const message = event as MessageEvent
            const data = typeof message.data === 'string' ? message.data : ''
            let cursor: string | null = null
            let type = listenerType
            let projectId: string | null = null
            let entityId: string | null = null
            try {
                const parsed: unknown = data === '' ? null : JSON.parse(data)
                if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const value = parsed as Record<string, unknown>
                    if (typeof value.cursor === 'string') cursor = value.cursor
                    if (typeof value.type === 'string') type = value.type
                    if (typeof value.projectId === 'string') projectId = value.projectId
                    const entity = value.entity
                    if (entity !== null && typeof entity === 'object' && !Array.isArray(entity)) {
                        const id = (entity as Record<string, unknown>).id
                        if (typeof id === 'string') entityId = id
                    }
                }
            } catch {
                cursor = null
            }
            recorder.events.push({
                url,
                listenerType,
                type,
                cursor,
                lastEventId: typeof message.lastEventId === 'string' ? message.lastEventId : '',
                projectId,
                entityId,
                data,
            })
        }

        class RecordingEventSource extends NativeEventSource {
            constructor(url: string | URL, init?: EventSourceInit) {
                super(url, init)
                recorder.sources.push({
                    url: String(url),
                    withCredentials: init?.withCredentials === true,
                })
                for (const listenerType of listenerTypes) {
                    this.addEventListener(listenerType, event =>
                        record(String(url), listenerType, event)
                    )
                }
            }
        }

        Object.defineProperty(globalThis, 'EventSource', {
            configurable: true,
            writable: true,
            value: RecordingEventSource,
        })
    })
}

async function readRealtimeSources(page: Page): Promise<{ url?: string }[]> {
    return page.evaluate(() => {
        const recorder = (
            globalThis as typeof globalThis & {
                __postdotRealtimeRecorder?: { sources?: { url?: string }[] }
            }
        ).__postdotRealtimeRecorder
        return recorder?.sources ?? []
    })
}

async function readRealtimeEvents(page: Page): Promise<RealtimeRecorderEvent[]> {
    return page.evaluate(() => {
        const recorder = (
            globalThis as typeof globalThis & {
                __postdotRealtimeRecorder?: { events?: unknown[] }
            }
        ).__postdotRealtimeRecorder
        return (recorder?.events ?? []) as RealtimeRecorderEvent[]
    })
}

function projectEvents(
    events: RealtimeRecorderEvent[],
    projectId: string
): RealtimeRecorderEvent[] {
    const expected = `/api/projects/${projectId}/events`
    return events.filter(event => event.url === expected)
}

async function projectRealtimeSourceCount(page: Page, projectId: string): Promise<number> {
    const sources = await readRealtimeSources(page)
    const expected = `/api/projects/${projectId}/events`
    return sources.filter(source => source.url === expected).length
}

async function projectRealtimeOpenCount(page: Page, projectId: string): Promise<number> {
    const events = projectEvents(await readRealtimeEvents(page), projectId)
    return events.filter(event => event.listenerType === 'open').length
}

async function waitForProjectEvent(
    page: Page,
    projectId: string,
    predicate: (event: RealtimeRecorderEvent) => boolean,
    timeoutMs: number,
    description: string
): Promise<RealtimeRecorderEvent> {
    await expect
        .poll(
            async () => projectEvents(await readRealtimeEvents(page), projectId).some(predicate),
            { timeout: timeoutMs, message: description }
        )
        .toBe(true)
    const match = projectEvents(await readRealtimeEvents(page), projectId).find(predicate)
    if (match === undefined) throw new Error(`Expected ${description}`)
    return match
}

function cursorSequence(cursor: string | null): number {
    if (cursor === null) throw new Error('Expected a realtime cursor')
    const match = /^event-sequence:(\d+)$/.exec(cursor)
    if (match === null) throw new Error(`Unexpected realtime cursor: ${cursor}`)
    return Number(match[1])
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Postdot', exact: true }).click()
    await page.getByLabel('Name').fill(`Realtime acceptance ${suffix}`)
    await page.getByLabel('Email').fill(`realtime-acceptance-${suffix}@postdot.local`)
    await page.getByLabel('Password', { exact: true }).fill('realtime-acceptance-password')
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
        .fill(`Realtime acceptance project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    return projectIdFromUrl(page.url())
}

async function readProjectTimeZone(page: Page, projectId: string): Promise<string> {
    const response = await page.request.get('/api/projects')
    expect(response.ok()).toBe(true)
    const body = (await response.json()) as {
        projects: { id: string; timeZone: string }[]
    }
    const project = body.projects.find(candidate => candidate.id === projectId)
    if (project === undefined) throw new Error('Expected the created project to be listed')
    return project.timeZone
}

async function createCustomWebhookChannel(
    page: Page,
    projectId: string,
    suffix: string
): Promise<string> {
    const response = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: `Realtime webhook ${suffix}`, profile: customWebhookProfile },
    })
    expect(response.status()).toBe(201)
    const body = (await response.json()) as { channel: { id: string } }
    return body.channel.id
}

async function connectCustomHttpPublisher(
    page: Page,
    projectId: string,
    channelId: string,
    endpointUrl: string
): Promise<void> {
    const response = await page.request.post(
        `/api/projects/${projectId}/channels/${channelId}/publisher/custom-http/connect`,
        {
            data: {
                endpointUrl,
                authentication: { kind: 'none' },
                secret: 'postdot-e2e-realtime-secret-0123456789abcdef',
            },
        }
    )
    expect(response.ok()).toBe(true)
}

async function createScheduledAutomaticPublication(
    page: Page,
    projectId: string,
    channelId: string
): Promise<string> {
    const response = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: {
                body: { format: 'plain_text', text: sourceText },
                media: [],
            },
            publications: [
                {
                    channelId,
                    deliveryMode: 'automatic',
                    scheduledAt: Date.now() + 86_400_000,
                    targetContent: { body: initialDestination },
                },
            ],
        },
    })
    expect(response.ok()).toBe(true)
    const body = (await response.json()) as { publications: { id: string }[] }
    const publicationId = body.publications[0]?.id
    if (publicationId === undefined) {
        throw new Error('Expected an automatically scheduled publication')
    }
    return publicationId
}

async function openCustomization(page: Page): Promise<void> {
    const details = page.locator('[data-publication-customization="true"]')
    if ((await details.getAttribute('open')) === null) {
        await details.locator(':scope > summary').click()
    }
    await expect(details.locator('[data-target-field="body"] textarea')).toBeVisible()
}

async function readReceiverObservations(receiverOrigin: string): Promise<ReceiverObservations> {
    const response = await fetch(`${receiverOrigin}/observations`)
    if (!response.ok) {
        throw new Error(`Reading receiver observations failed with ${response.status}`)
    }
    return (await response.json()) as ReceiverObservations
}

async function releaseDelivery(receiverOrigin: string, deliveryId: string): Promise<void> {
    const response = await fetch(`${receiverOrigin}/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deliveryId }),
    })
    if (!response.ok) {
        throw new Error(`Releasing the webhook delivery failed with ${response.status}`)
    }
}

async function releaseAllDeliveries(receiverOrigin: string): Promise<void> {
    const response = await fetch(`${receiverOrigin}/release-all`, { method: 'POST' })
    if (!response.ok) {
        throw new Error(`Releasing all webhook deliveries failed with ${response.status}`)
    }
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
    const expected = name.toLowerCase()
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === expected) return value
    }
    return undefined
}

async function withTimeout(
    promise: Promise<void>,
    timeoutMs: number,
    description: string
): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Timed out waiting for ${description}`)),
            timeoutMs
        )
    })
    try {
        await Promise.race([promise, timeout])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

function projectIdFromUrl(value: string): string {
    const match = new URL(value).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${value}`)
    }
    return match[1]
}
