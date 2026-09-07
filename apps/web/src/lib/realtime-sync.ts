import {
    eventIsApplied,
    type ProjectRealtimeDataSource,
    type RealtimeConnectionStatus,
    type RealtimeEvent,
    type RealtimeEventSource,
    type RealtimeMetrics,
    type RealtimeSnapshot,
} from '@/lib/realtime-prototype'
import { wait } from '@/lib/realtime-prototype'

export interface RealtimeRefreshAdapter {
    refreshForEvent(event: RealtimeEvent): Promise<void>
    refreshAll(): Promise<void>
}

export interface RealtimeCoordinatorOptions {
    readonly projectId: string
    readonly events: RealtimeEventSource
    readonly metrics: RealtimeMetrics
    readonly adapter: RealtimeRefreshAdapter
}

export class RealtimeCoordinator {
    private readonly handledEventIds = new Set<string>()
    private readonly inFlightEvents = new Map<string, Promise<void>>()
    private unsubscribe: (() => void) | null = null
    private wasDisconnected = false

    constructor(private readonly options: RealtimeCoordinatorOptions) {}

    start(): void {
        if (this.unsubscribe !== null) return
        this.unsubscribe = this.options.events.subscribe(
            event => this.handleEvent(event),
            status => this.handleStatus(status)
        )
    }

    stop(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
        this.inFlightEvents.clear()
    }

    async handleEvent(event: RealtimeEvent): Promise<void> {
        if (event.projectId !== this.options.projectId) return

        const inFlight = this.inFlightEvents.get(event.id)
        if (inFlight !== undefined) return inFlight
        if (this.handledEventIds.has(event.id)) {
            this.options.metrics.record('deduplicatedEvents')
            return
        }

        this.options.metrics.record('receivedEvents')
        const refresh = this.options.adapter
            .refreshForEvent(event)
            .then(() => {
                this.handledEventIds.add(event.id)
            })
            .finally(() => {
                this.inFlightEvents.delete(event.id)
            })
        this.inFlightEvents.set(event.id, refresh)
        return refresh
    }

    private async handleStatus(status: RealtimeConnectionStatus): Promise<void> {
        if (status === 'disconnected') {
            this.wasDisconnected = true
            return
        }

        if (!this.wasDisconnected) return
        this.wasDisconnected = false
        this.options.metrics.record('reconnects')
        await this.options.adapter.refreshAll()
    }
}

export interface RetryRefreshOptions {
    readonly event: RealtimeEvent
    readonly getSnapshot: () => RealtimeSnapshot
    readonly refresh: () => Promise<void>
    readonly metrics: RealtimeMetrics
    readonly delaysMs?: readonly number[]
}

export async function refreshUntilEventApplied(options: RetryRefreshOptions): Promise<void> {
    const delays = options.delaysMs ?? [0, 20, 80, 160]
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
        await options.refresh()
        if (eventIsApplied(options.getSnapshot(), options.event)) return

        const delay = delays[attempt + 1]
        if (delay === undefined) break
        options.metrics.record('projectionWaits')
        await wait(delay)
    }
}

export async function refreshWithReconnectRetry(
    refresh: () => Promise<void>,
    metrics: RealtimeMetrics,
    delaysMs: readonly number[] = [0, 50, 120]
): Promise<void> {
    for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
        await refresh()
        const delay = delaysMs[attempt + 1]
        if (delay === undefined) return
        metrics.record('projectionWaits')
        await wait(delay)
    }
}

export function eventResource(event: RealtimeEvent): 'publications' | 'notifications' {
    return event.type.startsWith('publication') ? 'publications' : 'notifications'
}

export function createRealtimeDataSourceGuard(
    source: ProjectRealtimeDataSource,
    projectId: string
): ProjectRealtimeDataSource {
    return {
        listPublications: requestedProjectId => {
            assertProject(projectId, requestedProjectId)
            return source.listPublications(requestedProjectId)
        },
        listNotifications: requestedProjectId => {
            assertProject(projectId, requestedProjectId)
            return source.listNotifications(requestedProjectId)
        },
        markNotificationRead: (requestedProjectId, notificationId) => {
            assertProject(projectId, requestedProjectId)
            return source.markNotificationRead(requestedProjectId, notificationId)
        },
    }
}

function assertProject(expectedProjectId: string, requestedProjectId: string): void {
    if (expectedProjectId !== requestedProjectId) {
        throw new Error('realtime data source rejected a cross-project request')
    }
}
