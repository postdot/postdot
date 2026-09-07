import {
    eventJournalCursorSequence,
    parseEventJournalCursor,
    type EventJournalCursor,
    type EventJournalEntry,
    type EventJournalStore,
    type NotificationStore,
} from '@herald/db'
import type { OpenAPIV3 } from 'openapi-types'

import { sessionSecurity } from '../../plugins/auth'
import { errorResponse, projectParams } from './models'
import type { ProjectRealtimeHub } from './realtime-runtime'
import type { AuthenticatedElysia } from './types'

const supportedProjectEventSubjects = {
    'project.created': 'project',
    'project.timezone_updated': 'project',
    'channel.created': 'channel',
    'channel.renamed': 'channel',
    'channel.archived': 'channel',
    'channel.restored': 'channel',
    'channel.deleted': 'channel',
    'channel.profile_draft.created': 'channel',
    'channel.profile_draft.updated': 'channel',
    'channel.profile_activated': 'channel',
    'post.created': 'post',
    'publication.created': 'publication',
    'publication.draft.rebased': 'publication',
    'publication.target_promoted': 'publication',
    'publication.ready': 'publication',
    'publication.published': 'publication',
    'publication.reconciled': 'publication',
    'publication.execution.claimed': 'publication',
    'publication.execution.effect_started': 'publication',
    'publication.execution.succeeded': 'publication',
    'publication.execution.retry_scheduled': 'publication',
    'publication.execution.failed': 'publication',
    'publication.execution.ambiguous': 'publication',
    'publication.execution.claim_recovered': 'publication',
    'publication.execution.ambiguity_recovered': 'publication',
    'publication.execution.cancelled': 'publication',
    'publisher.connected': 'publisher',
    'publisher.disconnected': 'publisher',
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
    readonly pollIntervalMs?: number
    readonly heartbeatIntervalMs?: number
    readonly batchSize?: number
}

interface ProjectEventStreamInput {
    readonly request: Request
    readonly projectId: string
    readonly journal: Pick<EventJournalStore, 'readAfter'>
    readonly after: EventJournalCursor | null
    readonly projectChanges?: ProjectRealtimeHub
    readonly options?: ProjectEventStreamOptions
}

const defaultStreamOptions: Required<ProjectEventStreamOptions> = {
    pollIntervalMs: 250,
    heartbeatIntervalMs: 15_000,
    batchSize: 100,
}

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
    projectChanges?: ProjectRealtimeHub
) {
    return app.get(
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

            const access = notifications.list({
                projectId: params.projectId,
                subjectId: user.id,
                limit: 1,
            })
            if (access === null) return status(404, notFoundResponse)

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
    options,
}: ProjectEventStreamInput): ReadableStream<Uint8Array> {
    const streamOptions = normalizeStreamOptions(options)
    const encoder = new TextEncoder()
    let scanCursor = after
    let lastSequence = after === null ? 0 : eventJournalCursorSequence(after)
    let heartbeatAt = Date.now() + streamOptions.heartbeatIntervalMs
    let closed = false
    let releaseWait: (() => void) | undefined

    function close(controller: ReadableStreamDefaultController<Uint8Array>) {
        if (closed) return
        closed = true
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

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (closed) return

            while (!closed) {
                if (request.signal.aborted) {
                    close(controller)
                    return
                }

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

                const frames: string[] = []
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
                        return
                    }
                    heartbeatAt = now + streamOptions.heartbeatIntervalMs
                    return
                }

                const active = await waitForChangeOrHeartbeat({
                    projectChanges,
                    projectId,
                    request,
                    timeoutMs:
                        projectChanges === undefined
                            ? Math.min(streamOptions.pollIntervalMs, heartbeatAt - now)
                            : heartbeatAt - now,
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
            }
        },
        cancel() {
            closed = true
            releaseWait?.()
            releaseWait = undefined
        },
    })
}

async function waitForChangeOrHeartbeat(input: {
    readonly projectChanges: ProjectRealtimeHub | undefined
    readonly projectId: string
    readonly request: Request
    readonly timeoutMs: number
    readonly setCancellation: (cancel: () => void) => void
    readonly clearCancellation: (cancel: () => void) => void
}): Promise<boolean> {
    const projectChanges = input.projectChanges
    if (projectChanges === undefined) {
        return waitForNextPoll(
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

function waitForNextPoll(
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
