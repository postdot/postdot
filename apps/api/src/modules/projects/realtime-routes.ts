import type { PostbotAuth } from '@postbot/auth'
import { projectNotificationTemplate } from '@postbot/core'
import {
    eventJournalCursorSequence,
    parseEventJournalCursor,
    type EventJournalCursor,
    type EventJournalEntry,
    type EventJournalStore,
    type NotificationStore,
    type AccessStore,
} from '@postbot/db'
import type { OpenAPIV3 } from 'openapi-types'

import { sessionSecurity } from '../../plugins/auth'
import { keepResponseAliveBeyondIdleTimeout } from '../../serving'
import { errorResponse, projectParams } from './models'
import type {
    DraftChangeSignal,
    ProjectRealtimeHub,
    RealtimeHub,
    UserRealtimeHub,
} from './realtime-runtime'
import type { AuthenticatedElysia } from './types'

const supportedProjectEventSubjects = {
    'project.created': 'project',
    'project.timezone_updated': 'project',
    'project.media_previews.updated': 'project',
    'channel.created': 'channel',
    'channel.renamed': 'channel',
    'channel.archived': 'channel',
    'channel.restored': 'channel',
    'channel.deleted': 'channel',
    'channel.profile_draft.created': 'channel',
    'channel.profile_draft.updated': 'channel',
    'channel.profile_activated': 'channel',
    'post.created': 'post',
    'post.source.updated': 'post',
    'publication.created': 'publication',
    'publication.approval_requested': 'publication',
    'publication.approval_approved': 'publication',
    'publication.approval_rejected': 'publication',
    'publication.approval_superseded': 'publication',
    'publication.draft.rebased': 'publication',
    'publication.target_promoted': 'publication',
    'publication.ready': 'publication',
    'publication.published': 'publication',
    'publication.reconciled': 'publication',
    'publication.retry_requested': 'publication',
    'publication.rescheduled': 'publication',
    'publication.cancelled': 'publication',
    'publication.execution.claimed': 'publication',
    'publication.execution.effect_started': 'publication',
    'publication.execution.succeeded': 'publication',
    'publication.execution.deferred': 'publication',
    'publication.execution.retry_scheduled': 'publication',
    'publication.execution.failed': 'publication',
    'publication.execution.ambiguous': 'publication',
    'publication.execution.claim_recovered': 'publication',
    'publication.execution.ambiguity_recovered': 'publication',
    'publication.execution.cancelled': 'publication',
    'publisher.connected': 'publisher',
    'publisher.disconnected': 'publisher',
    'project_tag.created': 'project_tag',
    'project_tag.renamed': 'project_tag',
    'project_tag.archived': 'project_tag',
    'project_tag.restored': 'project_tag',
    'publication.tags_replaced': 'publication',
} as const

export type ProjectRealtimeEventType = keyof typeof supportedProjectEventSubjects

export interface ProjectRealtimeEvent {
    readonly id: string
    readonly cursor: EventJournalCursor
    readonly projectId: string
    readonly version: 1
    readonly type: ProjectRealtimeEventType
    readonly entity: {
        readonly type: string
        readonly id: string
    }
    readonly occurredAt: number
    readonly payload: Record<string, never>
}

export interface ProjectEventStreamOptions {
    readonly heartbeatIntervalMs?: number
    readonly batchSize?: number
}

interface ProjectEventStreamInput {
    readonly request: Request
    readonly projectId: string
    readonly journal: Pick<EventJournalStore, 'readAfter'>
    readonly after: EventJournalCursor | null
    readonly projectChanges?: ProjectRealtimeHub
    readonly isAuthorized?: () => boolean | Promise<boolean>
    readonly options?: ProjectEventStreamOptions
}

interface UserEventStreamInput {
    readonly request: Request
    readonly userId: string
    readonly listProjectIds: () => readonly string[]
    readonly journal: Pick<EventJournalStore, 'readAllAfter'>
    readonly after: EventJournalCursor | null
    readonly userChanges?: UserRealtimeHub
    readonly isAuthorized?: () => boolean | Promise<boolean>
    readonly options?: ProjectEventStreamOptions
}

const defaultStreamOptions: Required<ProjectEventStreamOptions> = {
    heartbeatIntervalMs: 15_000,
    batchSize: 100,
}

/**
 * A comment frame with no event name and no data. It carries no business
 * event, does not move the durable cursor, and is ignored by every SSE client,
 * but it flushes the response so the connection is established immediately
 * instead of after the first heartbeat.
 */
const streamConnectedComment = ': connected\n\n'

const humanOnlyResponse = {
    error: {
        code: 'forbidden',
        message: 'A human session is required for the project event stream',
    },
} as const
const notFoundResponse = {
    error: { code: 'not_found', message: 'Project not found' },
} as const
const invalidCursorResponse = {
    error: { code: 'invalid_cursor', message: 'The event stream cursor is invalid' },
} as const
const cursorAheadResponse = {
    error: {
        code: 'cursor_ahead',
        message:
            'The event stream cursor is newer than the durable journal; refetch before retrying',
    },
} as const

export function registerRealtimeRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    journal: EventJournalStore,
    notifications: NotificationStore,
    access: AccessStore,
    auth: PostbotAuth,
    projectChanges?: RealtimeHub,
    userChanges?: UserRealtimeHub
) {
    const withProjectEvents = app.get(
        '/api/projects/:projectId/events',
        {
            auth: true,
            params: projectParams,
            response: {
                400: errorResponse,
                401: errorResponse,
                403: errorResponse,
                404: errorResponse,
                409: errorResponse,
            },
            detail: {
                operationId: 'streamProjectEvents',
                summary: 'Stream safe project updates over Server-Sent Events',
                tags: ['Projects'],
                security: sessionSecurity,
                responses: {
                    200: {
                        description: 'A reconnectable project event stream',
                        content: {
                            'text/event-stream': {
                                schema: {
                                    type: 'string',
                                } as OpenAPIV3.SchemaObject,
                            },
                        },
                    },
                },
            },
        },
        ({ authMethod, params, request, status, user }) => {
            if (authMethod !== 'session') return status(403, humanOnlyResponse)

            const notificationAccess = notifications.list({
                projectId: params.projectId,
                subjectId: user.id,
                limit: 1,
            })
            if (notificationAccess === null) return status(404, notFoundResponse)

            keepResponseAliveBeyondIdleTimeout(request)

            let after: EventJournalCursor | null
            try {
                after = parseLastEventId(request.headers.get('last-event-id'))
            } catch {
                return status(400, invalidCursorResponse)
            }

            const latestCursor = journal.latestCursor()
            if (
                after !== null &&
                (latestCursor === null ||
                    eventJournalCursorSequence(after) > eventJournalCursorSequence(latestCursor))
            ) {
                return status(409, cursorAheadResponse)
            }

            return new Response(
                createProjectEventStream({
                    request,
                    projectId: params.projectId,
                    journal,
                    after,
                    projectChanges,
                    isAuthorized: async () => {
                        const session = await auth.api.getSession({ headers: request.headers })
                        return (
                            session !== null &&
                            access.canAccessProject(params.projectId, session.user.id)
                        )
                    },
                }),
                {
                    headers: {
                        'cache-control': 'no-cache, no-store',
                        connection: 'keep-alive',
                        'content-type': 'text/event-stream; charset=utf-8',
                        'x-accel-buffering': 'no',
                    },
                }
            )
        }
    )

    return withProjectEvents.get(
        '/api/notifications/events',
        {
            auth: true,
            response: {
                400: errorResponse,
                401: errorResponse,
                403: errorResponse,
                409: errorResponse,
            },
            detail: {
                operationId: 'streamUserNotificationEvents',
                summary: 'Stream user-visible updates over Server-Sent Events',
                tags: ['Notifications'],
                security: sessionSecurity,
                responses: {
                    200: {
                        description: 'A reconnectable user notification event stream',
                        content: {
                            'text/event-stream': {
                                schema: {
                                    type: 'string',
                                } as OpenAPIV3.SchemaObject,
                            },
                        },
                    },
                },
            },
        },
        ({ authMethod, request, status, user }) => {
            if (authMethod !== 'session') return status(403, humanOnlyResponse)

            keepResponseAliveBeyondIdleTimeout(request)

            let after: EventJournalCursor | null
            try {
                after = parseLastEventId(request.headers.get('last-event-id'))
            } catch {
                return status(400, invalidCursorResponse)
            }

            const latestCursor = journal.latestCursor()
            if (
                after !== null &&
                (latestCursor === null ||
                    eventJournalCursorSequence(after) > eventJournalCursorSequence(latestCursor))
            ) {
                return status(409, cursorAheadResponse)
            }

            return new Response(
                createUserEventStream({
                    request,
                    userId: user.id,
                    listProjectIds: () => notifications.listProjectIdsForUser(user.id),
                    journal,
                    after,
                    userChanges,
                    isAuthorized: async () => {
                        const session = await auth.api.getSession({ headers: request.headers })
                        return (
                            session?.user.id === user.id &&
                            notifications.listProjectIdsForUser(user.id).length > 0
                        )
                    },
                }),
                {
                    headers: {
                        'cache-control': 'no-cache, no-store',
                        connection: 'keep-alive',
                        'content-type': 'text/event-stream; charset=utf-8',
                        'x-accel-buffering': 'no',
                    },
                }
            )
        }
    )
}

export function toProjectRealtimeEvent(entry: EventJournalEntry): ProjectRealtimeEvent | null {
    if (entry.version !== 1) return null

    const expectedSubjectType =
        supportedProjectEventSubjects[entry.name as ProjectRealtimeEventType]
    if (expectedSubjectType === undefined || entry.subject.type !== expectedSubjectType) {
        return null
    }

    return {
        id: entry.id,
        cursor: entry.cursor,
        projectId: entry.projectId,
        version: 1,
        type: entry.name as ProjectRealtimeEventType,
        entity: entry.subject,
        occurredAt: entry.occurredAt,
        payload: {},
    }
}

export function createProjectEventStream({
    request,
    projectId,
    journal,
    after,
    projectChanges,
    isAuthorized,
    options,
}: ProjectEventStreamInput): ReadableStream<Uint8Array> {
    const streamOptions = normalizeStreamOptions(options)
    const encoder = new TextEncoder()
    let scanCursor = after
    let lastSequence = after === null ? 0 : eventJournalCursorSequence(after)
    let heartbeatAt = Date.now() + streamOptions.heartbeatIntervalMs
    let closed = false
    let releaseWait: (() => void) | undefined
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    let unsubscribeShutdown: (() => void) | undefined

    const pendingDraftChanges = new Map<string, DraftChangeSignal>()
    const unsubscribeDraftChanges = projectChanges?.subscribeDraftChanges?.(projectId, change => {
        const previous = pendingDraftChanges.get(change.publicationId)
        pendingDraftChanges.set(change.publicationId, {
            ...change,
            sourceChanged: change.sourceChanged || previous?.sourceChanged === true,
        })
    })
    const cleanupDraftChanges = () => {
        unsubscribeDraftChanges?.()
        pendingDraftChanges.clear()
        request.signal.removeEventListener('abort', cleanupDraftChanges)
    }
    request.signal.addEventListener('abort', cleanupDraftChanges, { once: true })

    function cleanupShutdownSubscription(): void {
        unsubscribeShutdown?.()
        unsubscribeShutdown = undefined
    }

    function close(controller: ReadableStreamDefaultController<Uint8Array>) {
        if (closed) return
        closed = true
        cleanupDraftChanges()
        cleanupShutdownSubscription()
        releaseWait?.()
        releaseWait = undefined
        try {
            controller.close()
        } catch {
            // The reader may already have cancelled the stream.
        }
    }

    function closeWithResync(
        controller: ReadableStreamDefaultController<Uint8Array>,
        reason: 'cursor_gap' | 'journal_error'
    ) {
        if (closed) return
        closed = true
        cleanupDraftChanges()
        cleanupShutdownSubscription()
        releaseWait?.()
        releaseWait = undefined
        try {
            controller.enqueue(
                encoder.encode(
                    `event: project.resync-required\ndata: ${JSON.stringify({ projectId, reason })}\n\n`
                )
            )
            controller.close()
        } catch {
            // The reader may already have cancelled the stream.
        }
    }

    function closeWithAccessRevoked(controller: ReadableStreamDefaultController<Uint8Array>) {
        if (closed) return
        closed = true
        cleanupDraftChanges()
        cleanupShutdownSubscription()
        releaseWait?.()
        releaseWait = undefined
        try {
            controller.enqueue(
                encoder.encode(
                    `event: project.access-revoked\ndata: ${JSON.stringify({ projectId, reason: 'access_revoked' })}\n\n`
                )
            )
            controller.close()
        } catch {
            // The reader may already have cancelled the stream.
        }
    }

    async function ensureAuthorized(
        controller: ReadableStreamDefaultController<Uint8Array>
    ): Promise<boolean> {
        if (isAuthorized === undefined) return true
        try {
            if (await isAuthorized()) return true
        } catch {
            // Treat an authorization lookup failure as a revocation. A stream
            // must fail closed rather than continue serving project events.
        }
        closeWithAccessRevoked(controller)
        return false
    }

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            streamController = controller
            // A stopped runtime ends this stream at once. A stream left waiting
            // for a wakeup would keep the graceful server stop waiting for a
            // request that can never finish.
            unsubscribeShutdown = projectChanges?.subscribeShutdown?.(() => {
                if (streamController !== undefined) close(streamController)
            })
            if (closed) return
            try {
                controller.enqueue(encoder.encode(streamConnectedComment))
            } catch {
                closed = true
                cleanupDraftChanges()
                cleanupShutdownSubscription()
            }
        },
        async pull(controller) {
            if (closed) return

            while (!closed) {
                if (request.signal.aborted) {
                    close(controller)
                    return
                }

                if (!(await ensureAuthorized(controller))) return
                if (closed) return

                let entries: readonly EventJournalEntry[]
                try {
                    entries = journal.readAfter({
                        projectId,
                        after: scanCursor,
                        limit: streamOptions.batchSize,
                    })
                } catch {
                    closeWithResync(controller, 'journal_error')
                    return
                }

                if (!(await ensureAuthorized(controller))) return
                if (closed) return

                const frames: string[] = [...pendingDraftChanges.values()].map(
                    change => `event: project.draft-changed\ndata: ${JSON.stringify(change)}\n\n`
                )
                pendingDraftChanges.clear()
                for (const entry of entries) {
                    if (entry.projectId !== projectId) {
                        closeWithResync(controller, 'cursor_gap')
                        return
                    }
                    let sequence: number
                    try {
                        sequence = eventJournalCursorSequence(entry.cursor)
                    } catch {
                        closeWithResync(controller, 'cursor_gap')
                        return
                    }
                    if (sequence <= lastSequence) {
                        closeWithResync(controller, 'cursor_gap')
                        return
                    }

                    lastSequence = sequence
                    scanCursor = entry.cursor
                    const event = toProjectRealtimeEvent(entry)
                    if (event !== null) frames.push(formatProjectRealtimeEvent(event))
                }

                if (frames.length > 0) {
                    try {
                        controller.enqueue(encoder.encode(frames.join('')))
                    } catch {
                        closed = true
                        cleanupDraftChanges()
                        cleanupShutdownSubscription()
                        return
                    }
                    heartbeatAt = Date.now() + streamOptions.heartbeatIntervalMs
                    return
                }

                if (entries.length >= streamOptions.batchSize) continue

                const now = Date.now()
                if (now >= heartbeatAt) {
                    try {
                        controller.enqueue(encoder.encode(': heartbeat\n\n'))
                    } catch {
                        closed = true
                        cleanupDraftChanges()
                        cleanupShutdownSubscription()
                        return
                    }
                    heartbeatAt = now + streamOptions.heartbeatIntervalMs
                    return
                }

                const active = await waitForChangeOrHeartbeat({
                    projectChanges,
                    projectId,
                    request,
                    timeoutMs: heartbeatAt - now,
                    setCancellation: cancel => {
                        releaseWait = cancel
                    },
                    clearCancellation: cancel => {
                        if (releaseWait === cancel) releaseWait = undefined
                    },
                })
                if (!active && (closed || request.signal.aborted)) {
                    close(controller)
                    return
                }
                if (closed) return
            }
        },
        cancel() {
            closed = true
            cleanupDraftChanges()
            cleanupShutdownSubscription()
            releaseWait?.()
            releaseWait = undefined
        },
    })
}

export function createUserEventStream({
    request,
    userId,
    listProjectIds,
    journal,
    after,
    userChanges,
    isAuthorized,
    options,
}: UserEventStreamInput): ReadableStream<Uint8Array> {
    const streamOptions = normalizeStreamOptions(options)
    const encoder = new TextEncoder()
    let scanCursor = after
    let lastSequence = after === null ? 0 : eventJournalCursorSequence(after)
    let heartbeatAt = Date.now() + streamOptions.heartbeatIntervalMs
    let closed = false
    let releaseWait: (() => void) | undefined
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    let unsubscribeShutdown: (() => void) | undefined

    function cleanupShutdownSubscription(): void {
        unsubscribeShutdown?.()
        unsubscribeShutdown = undefined
    }

    function close(controller: ReadableStreamDefaultController<Uint8Array>) {
        if (closed) return
        closed = true
        cleanupShutdownSubscription()
        releaseWait?.()
        releaseWait = undefined
        try {
            controller.close()
        } catch {
            // The reader may already have cancelled the stream.
        }
    }

    function closeWithResync(
        controller: ReadableStreamDefaultController<Uint8Array>,
        reason: 'cursor_gap' | 'journal_error'
    ) {
        if (closed) return
        closed = true
        cleanupShutdownSubscription()
        releaseWait?.()
        releaseWait = undefined
        try {
            controller.enqueue(
                encoder.encode(
                    `event: user.resync-required\ndata: ${JSON.stringify({ reason })}\n\n`
                )
            )
            controller.close()
        } catch {
            // The reader may already have cancelled the stream.
        }
    }

    function closeWithAccessRevoked(controller: ReadableStreamDefaultController<Uint8Array>) {
        if (closed) return
        closed = true
        cleanupShutdownSubscription()
        releaseWait?.()
        releaseWait = undefined
        try {
            controller.enqueue(
                encoder.encode(
                    `event: user.access-revoked\ndata: ${JSON.stringify({ reason: 'access_revoked' })}\n\n`
                )
            )
            controller.close()
        } catch {
            // The reader may already have cancelled the stream.
        }
    }

    return new ReadableStream<Uint8Array>({
        start(controller) {
            streamController = controller
            // A stopped runtime ends this stream at once. A stream left waiting
            // for a wakeup would keep the graceful server stop waiting for a
            // request that can never finish.
            unsubscribeShutdown = userChanges?.subscribeShutdown?.(() => {
                if (streamController !== undefined) close(streamController)
            })
            if (closed) return
            try {
                controller.enqueue(encoder.encode(streamConnectedComment))
            } catch {
                closed = true
                cleanupShutdownSubscription()
            }
        },
        async pull(controller) {
            if (closed) return

            while (!closed) {
                if (request.signal.aborted) {
                    close(controller)
                    return
                }
                if (isAuthorized !== undefined && !(await isAuthorized())) {
                    closeWithAccessRevoked(controller)
                    return
                }
                if (closed) return

                let entries: readonly EventJournalEntry[]
                try {
                    entries = journal.readAllAfter({
                        after: scanCursor,
                        limit: streamOptions.batchSize,
                    })
                } catch {
                    closeWithResync(controller, 'journal_error')
                    return
                }

                const projectIds = new Set(listProjectIds())
                if (projectIds.size === 0) {
                    closeWithAccessRevoked(controller)
                    return
                }
                if (closed) return
                const frames: string[] = []
                for (const entry of entries) {
                    let sequence: number
                    try {
                        sequence = eventJournalCursorSequence(entry.cursor)
                    } catch {
                        closeWithResync(controller, 'cursor_gap')
                        return
                    }
                    if (sequence <= lastSequence) {
                        closeWithResync(controller, 'cursor_gap')
                        return
                    }

                    lastSequence = sequence
                    scanCursor = entry.cursor
                    const event = toProjectRealtimeEvent(entry)
                    if (
                        event !== null &&
                        projectIds.has(event.projectId) &&
                        projectNotificationTemplate(entry) !== null
                    ) {
                        frames.push(formatUserRealtimeEvent(event))
                    }
                }

                if (frames.length > 0) {
                    try {
                        controller.enqueue(encoder.encode(frames.join('')))
                    } catch {
                        closed = true
                        cleanupShutdownSubscription()
                        return
                    }
                    heartbeatAt = Date.now() + streamOptions.heartbeatIntervalMs
                    return
                }

                if (entries.length >= streamOptions.batchSize) continue

                const now = Date.now()
                if (now >= heartbeatAt) {
                    try {
                        controller.enqueue(encoder.encode(': heartbeat\n\n'))
                    } catch {
                        closed = true
                        cleanupShutdownSubscription()
                        return
                    }
                    heartbeatAt = now + streamOptions.heartbeatIntervalMs
                    return
                }

                const active = await waitForChangeOrHeartbeat({
                    projectChanges: userChanges,
                    projectId: userId,
                    request,
                    timeoutMs: heartbeatAt - now,
                    setCancellation: cancel => {
                        releaseWait = cancel
                    },
                    clearCancellation: cancel => {
                        if (releaseWait === cancel) releaseWait = undefined
                    },
                })
                if (!active && (closed || request.signal.aborted)) {
                    close(controller)
                    return
                }
                if (closed) return
            }
        },
        cancel() {
            closed = true
            cleanupShutdownSubscription()
            releaseWait?.()
            releaseWait = undefined
        },
    })
}

async function waitForChangeOrHeartbeat(input: {
    readonly projectChanges: RealtimeHub | undefined
    readonly projectId: string
    readonly request: Request
    readonly timeoutMs: number
    readonly setCancellation: (cancel: () => void) => void
    readonly clearCancellation: (cancel: () => void) => void
}): Promise<boolean> {
    const projectChanges = input.projectChanges
    if (projectChanges === undefined) {
        // The production app always supplies the post-commit hub. This
        // heartbeat-only path keeps the stream utility usable in isolation;
        // it is not the normal event-discovery mechanism.
        return waitForHeartbeat(
            input.request,
            input.timeoutMs,
            input.setCancellation,
            input.clearCancellation
        )
    }
    if (input.request.signal.aborted) return false

    const waitController = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let settled = false

    return new Promise(resolve => {
        const cancel = () => finish(false)
        const finish = (active: boolean) => {
            if (settled) return
            settled = true
            if (timeout !== undefined) clearTimeout(timeout)
            input.request.signal.removeEventListener('abort', onAbort)
            input.clearCancellation(cancel)
            waitController.abort()
            resolve(active)
        }
        const onAbort = () => finish(false)

        input.setCancellation(cancel)
        timeout = setTimeout(() => finish(true), input.timeoutMs)
        input.request.signal.addEventListener('abort', onAbort, { once: true })
        void projectChanges
            .waitForChange(input.projectId, waitController.signal)
            .then(() => finish(true))
            .catch(() => finish(true))
    })
}

function waitForHeartbeat(
    request: Request,
    milliseconds: number,
    setCancellation: (cancel: () => void) => void,
    clearCancellation: (cancel: () => void) => void
): Promise<boolean> {
    if (request.signal.aborted) return Promise.resolve(false)

    return new Promise(resolve => {
        let settled = false
        const timer = setTimeout(() => settle(true), milliseconds)
        const onAbort = () => settle(false)
        const cancel = () => settle(false)

        function settle(active: boolean) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            request.signal.removeEventListener('abort', onAbort)
            clearCancellation(cancel)
            resolve(active)
        }

        setCancellation(cancel)
        request.signal.addEventListener('abort', onAbort, { once: true })
    })
}

function parseLastEventId(value: string | null): EventJournalCursor | null {
    if (value === null || value.length === 0) return null
    return parseEventJournalCursor(value)
}

function formatProjectRealtimeEvent(event: ProjectRealtimeEvent): string {
    return `id: ${event.cursor}\nevent: project.update\ndata: ${JSON.stringify(event)}\n\n`
}

function formatUserRealtimeEvent(event: ProjectRealtimeEvent): string {
    return `id: ${event.cursor}\nevent: user.update\ndata: ${JSON.stringify(event)}\n\n`
}

function normalizeStreamOptions(
    options: ProjectEventStreamOptions | undefined
): Required<ProjectEventStreamOptions> {
    const resolved = { ...defaultStreamOptions, ...options }
    for (const [name, value] of Object.entries(resolved)) {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`${name} must be a positive safe integer`)
        }
    }
    return resolved
}
