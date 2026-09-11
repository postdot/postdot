import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

export const projectQueryKeys = {
    data: (projectId: string) => ['project', projectId, 'data'] as const,
    calendarPublications: (projectId: string) =>
        ['project', projectId, 'calendar-publications'] as const,
    notifications: (projectId: string) => ['project', projectId, 'notifications'] as const,
    notificationPreferences: (projectId: string) =>
        ['project', projectId, 'notification-preferences'] as const,
} as const

const projectRealtimeEventTypes = [
    'project.created',
    'project.timezone_updated',
    'channel.created',
    'channel.renamed',
    'channel.archived',
    'channel.restored',
    'channel.deleted',
    'channel.profile_draft.created',
    'channel.profile_draft.updated',
    'channel.profile_activated',
    'post.created',
    'publication.created',
    'publication.draft.rebased',
    'publication.target_promoted',
    'publication.ready',
    'publication.published',
    'publication.reconciled',
    'publication.execution.claimed',
    'publication.execution.effect_started',
    'publication.execution.succeeded',
    'publication.execution.retry_scheduled',
    'publication.execution.failed',
    'publication.execution.ambiguous',
    'publication.execution.claim_recovered',
    'publication.execution.ambiguity_recovered',
    'publication.execution.cancelled',
    'publisher.connected',
    'publisher.disconnected',
    'project_tag.created',
    'project_tag.renamed',
    'project_tag.archived',
    'project_tag.restored',
    'publication.tags_replaced',
] as const

export type ProjectRealtimeEventType = (typeof projectRealtimeEventTypes)[number]

export interface ProjectRealtimeEvent {
    readonly id: string
    readonly cursor: string
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

export type ProjectRealtimeSignal =
    | { readonly kind: 'update'; readonly event: ProjectRealtimeEvent }
    | { readonly kind: 'resync-required'; readonly reason: string }
    | { readonly kind: 'access-revoked' }

export type ProjectRealtimeStatus = 'connected' | 'disconnected'

export interface ProjectRealtimeEventSource {
    subscribe(
        listener: (signal: ProjectRealtimeSignal) => void,
        statusListener?: (status: ProjectRealtimeStatus) => void
    ): () => void
    close(): void
}

export interface ProjectRealtimeEventSourceLike {
    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
    close(): void
}

export type UserRealtimeEvent = ProjectRealtimeEvent

export type UserRealtimeSignal =
    | { readonly kind: 'update'; readonly event: UserRealtimeEvent }
    | { readonly kind: 'resync-required'; readonly reason: string }

export interface UserRealtimeEventSource {
    subscribe(
        listener: (signal: UserRealtimeSignal) => void,
        statusListener?: (status: ProjectRealtimeStatus) => void
    ): () => void
    close(): void
}

export type ProjectRealtimeEventSourceFactory = (
    url: string,
    init: { readonly withCredentials: boolean }
) => ProjectRealtimeEventSourceLike

const reconnectRefreshDelays = [0, 80, 240, 800] as const

export class BrowserProjectRealtimeEventSource implements ProjectRealtimeEventSource {
    private readonly listeners = new Set<(signal: ProjectRealtimeSignal) => void>()
    private readonly statusListeners = new Set<(status: ProjectRealtimeStatus) => void>()
    private readonly eventSource: ProjectRealtimeEventSourceLike
    private closed = false
    private status: ProjectRealtimeStatus = 'disconnected'

    constructor(
        private readonly projectId: string,
        eventSourceFactory: ProjectRealtimeEventSourceFactory = createBrowserEventSource
    ) {
        this.eventSource = eventSourceFactory(
            `/api/projects/${encodeURIComponent(projectId)}/events`,
            { withCredentials: true }
        )
        this.eventSource.addEventListener('open', () => this.setStatus('connected'))
        this.eventSource.addEventListener('error', () => this.setStatus('disconnected'))
        this.eventSource.addEventListener('project.update', event => {
            const parsed = parseProjectRealtimeEvent(event.data, this.projectId)
            if (parsed === null) return
            for (const listener of this.listeners) listener({ kind: 'update', event: parsed })
        })
        this.eventSource.addEventListener('project.resync-required', event => {
            const value = parseJsonObject(event.data)
            const reason = typeof value?.reason === 'string' ? value.reason : 'unknown'
            for (const listener of this.listeners) listener({ kind: 'resync-required', reason })
        })
        this.eventSource.addEventListener('project.access-revoked', event => {
            const value = parseJsonObject(event.data)
            if (value?.projectId !== this.projectId) return
            for (const listener of this.listeners) listener({ kind: 'access-revoked' })
            this.close()
        })
    }

    subscribe(
        listener: (signal: ProjectRealtimeSignal) => void,
        statusListener?: (status: ProjectRealtimeStatus) => void
    ): () => void {
        this.listeners.add(listener)
        if (statusListener !== undefined) this.statusListeners.add(statusListener)
        if (statusListener !== undefined) statusListener(this.status)

        return () => {
            this.listeners.delete(listener)
            if (statusListener !== undefined) this.statusListeners.delete(statusListener)
        }
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        this.eventSource.close()
        this.setStatus('disconnected')
        this.listeners.clear()
        this.statusListeners.clear()
    }

    private setStatus(status: ProjectRealtimeStatus): void {
        if (this.closed || this.status === status) return
        this.status = status
        for (const listener of this.statusListeners) listener(status)
    }
}

export function createProjectRealtimeClient(
    projectId: string,
    eventSourceFactory?: ProjectRealtimeEventSourceFactory
): ProjectRealtimeEventSource {
    return new BrowserProjectRealtimeEventSource(projectId, eventSourceFactory)
}

export function createUserRealtimeClient(
    eventSourceFactory: ProjectRealtimeEventSourceFactory = createBrowserEventSource
): UserRealtimeEventSource {
    return new BrowserUserRealtimeEventSource(eventSourceFactory)
}

export function ProjectRealtimeProvider({
    children,
    projectId,
}: {
    readonly children: ReactNode
    readonly projectId: string | null
}) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: Number.POSITIVE_INFINITY,
                        refetchOnWindowFocus: false,
                        refetchOnReconnect: false,
                    },
                    mutations: { retry: false },
                },
            })
    )

    useEffect(() => {
        return () => queryClient.clear()
    }, [queryClient])

    return (
        <QueryClientProvider client={queryClient}>
            <UserRealtimeBridge />
            {projectId === null ? null : <ProjectRealtimeBridge projectId={projectId} />}
            {children}
        </QueryClientProvider>
    )
}

class BrowserUserRealtimeEventSource implements UserRealtimeEventSource {
    private readonly listeners = new Set<(signal: UserRealtimeSignal) => void>()
    private readonly statusListeners = new Set<(status: ProjectRealtimeStatus) => void>()
    private readonly eventSource: ProjectRealtimeEventSourceLike
    private closed = false
    private status: ProjectRealtimeStatus = 'disconnected'

    constructor(eventSourceFactory: ProjectRealtimeEventSourceFactory) {
        this.eventSource = eventSourceFactory('/api/notifications/events', {
            withCredentials: true,
        })
        this.eventSource.addEventListener('open', () => this.setStatus('connected'))
        this.eventSource.addEventListener('error', () => this.setStatus('disconnected'))
        this.eventSource.addEventListener('user.update', event => {
            const parsed = parseProjectRealtimeEvent(event.data, null)
            if (parsed === null) return
            for (const listener of this.listeners) listener({ kind: 'update', event: parsed })
        })
        this.eventSource.addEventListener('user.resync-required', event => {
            const value = parseJsonObject(event.data)
            const reason = typeof value?.reason === 'string' ? value.reason : 'unknown'
            for (const listener of this.listeners) listener({ kind: 'resync-required', reason })
        })
    }

    subscribe(
        listener: (signal: UserRealtimeSignal) => void,
        statusListener?: (status: ProjectRealtimeStatus) => void
    ): () => void {
        this.listeners.add(listener)
        if (statusListener !== undefined) this.statusListeners.add(statusListener)
        if (statusListener !== undefined) statusListener(this.status)

        return () => {
            this.listeners.delete(listener)
            if (statusListener !== undefined) this.statusListeners.delete(statusListener)
        }
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        this.eventSource.close()
        this.setStatus('disconnected')
        this.listeners.clear()
        this.statusListeners.clear()
    }

    private setStatus(status: ProjectRealtimeStatus): void {
        if (this.closed || this.status === status) return
        this.status = status
        for (const listener of this.statusListeners) listener(status)
    }
}

function UserRealtimeBridge() {
    const queryClient = useQueryClient()

    useEffect(() => {
        const source = createUserRealtimeClient()
        let stopped = false
        let wasDisconnected = false
        let pendingRefresh: Promise<void> | undefined

        const refresh = (full = false): Promise<void> => {
            if (pendingRefresh !== undefined) return pendingRefresh

            pendingRefresh = (async () => {
                for (const delay of reconnectRefreshDelays) {
                    if (stopped) return
                    if (delay > 0) await wait(delay)
                    await queryClient.invalidateQueries({
                        queryKey: ['notifications'],
                        refetchType: full ? 'all' : 'active',
                    })
                }
            })().finally(() => {
                pendingRefresh = undefined
            })

            return pendingRefresh
        }

        const unsubscribe = source.subscribe(
            signal => {
                if (signal.kind === 'resync-required') {
                    void refresh(true)
                    return
                }
                void refresh()
            },
            status => {
                if (status === 'disconnected') {
                    wasDisconnected = true
                    return
                }
                if (!wasDisconnected) return
                wasDisconnected = false
                void refresh(true)
            }
        )

        return () => {
            stopped = true
            unsubscribe()
            source.close()
            pendingRefresh = undefined
        }
    }, [queryClient])

    return null
}

function ProjectRealtimeBridge({ projectId }: { readonly projectId: string }) {
    const queryClient = useQueryClient()

    useEffect(() => {
        const source = createProjectRealtimeClient(projectId)
        let stopped = false
        let wasDisconnected = false
        const pendingRefreshes = new Map<string, Promise<void>>()

        const refresh = (key: string, full = false): Promise<void> => {
            const existing = pendingRefreshes.get(key)
            if (existing !== undefined) return existing

            const operation = (async () => {
                for (const delay of reconnectRefreshDelays) {
                    if (stopped) return
                    if (delay > 0) await wait(delay)
                    if (key === 'project') {
                        await Promise.all([
                            queryClient.invalidateQueries({
                                queryKey: projectQueryKeys.data(projectId),
                                refetchType: full ? 'all' : 'active',
                            }),
                            queryClient.invalidateQueries({
                                queryKey: projectQueryKeys.calendarPublications(projectId),
                                refetchType: full ? 'all' : 'active',
                            }),
                        ])
                    } else {
                        await Promise.all([
                            queryClient.invalidateQueries({
                                queryKey: projectQueryKeys.notifications(projectId),
                                refetchType: full ? 'all' : 'active',
                            }),
                            queryClient.invalidateQueries({
                                queryKey: ['notifications', projectId],
                                refetchType: full ? 'all' : 'active',
                            }),
                        ])
                    }
                }
            })().finally(() => pendingRefreshes.delete(key))

            pendingRefreshes.set(key, operation)
            return operation
        }

        const unsubscribe = source.subscribe(
            signal => {
                if (signal.kind === 'resync-required') {
                    void refresh('project', true)
                    void refresh('notifications', true)
                    return
                }
                if (signal.kind === 'access-revoked') {
                    void refresh('project', true)
                    void refresh('notifications', true)
                    return
                }

                const resource = eventResource(signal.event.type)
                if (resource === 'project') void refresh('project')
                else {
                    void refresh('project')
                    void refresh('notifications')
                }
            },
            status => {
                if (status === 'disconnected') {
                    wasDisconnected = true
                    return
                }
                if (!wasDisconnected) return
                wasDisconnected = false
                void refresh('project', true)
                void refresh('notifications', true)
            }
        )

        return () => {
            stopped = true
            unsubscribe()
            source.close()
            pendingRefreshes.clear()
        }
    }, [projectId, queryClient])

    return null
}

function createBrowserEventSource(url: string, init: { readonly withCredentials: boolean }) {
    return new EventSource(url, init)
}

function parseProjectRealtimeEvent(
    data: string,
    expectedProjectId: string | null
): ProjectRealtimeEvent | null {
    const value = parseJsonObject(data)
    if (
        value === null ||
        typeof value.projectId !== 'string' ||
        (expectedProjectId !== null && value.projectId !== expectedProjectId) ||
        value.version !== 1 ||
        typeof value.id !== 'string' ||
        typeof value.cursor !== 'string' ||
        typeof value.type !== 'string' ||
        !projectRealtimeEventTypes.includes(value.type as ProjectRealtimeEventType) ||
        typeof value.occurredAt !== 'number' ||
        !Number.isFinite(value.occurredAt) ||
        !isEntity(value.entity) ||
        !isEmptyPayload(value.payload)
    ) {
        return null
    }

    return {
        id: value.id,
        cursor: value.cursor,
        projectId: value.projectId,
        version: 1,
        type: value.type as ProjectRealtimeEventType,
        entity: value.entity,
        occurredAt: value.occurredAt,
        payload: {},
    }
}

function parseJsonObject(data: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(data)
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null
    } catch {
        return null
    }
}

function isEntity(value: unknown): value is { readonly type: string; readonly id: string } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const entity = value as Record<string, unknown>
    return (
        typeof entity.type === 'string' &&
        entity.type.length > 0 &&
        typeof entity.id === 'string' &&
        entity.id.length > 0
    )
}

function isEmptyPayload(value: unknown): value is Record<string, never> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
    )
}

function eventResource(type: ProjectRealtimeEventType): 'project' | 'publications' {
    if (type.startsWith('publication') || type === 'post.created') return 'publications'
    return 'project'
}

async function wait(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return
    await new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}
