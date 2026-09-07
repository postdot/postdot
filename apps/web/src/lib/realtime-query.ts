import { QueryClient, type QueryKey } from '@tanstack/react-query'

import {
    realtimeQueryKeys,
    type ProjectRealtimeDataSource,
    type RealtimeEvent,
    type RealtimeEventSource,
    type RealtimeMetrics,
    type RealtimeNotification,
    type RealtimePublication,
    type RealtimeSnapshot,
} from '@/lib/realtime-prototype'
import {
    createRealtimeDataSourceGuard,
    eventResource,
    refreshUntilEventApplied,
    refreshWithReconnectRetry,
    RealtimeCoordinator,
} from '@/lib/realtime-sync'

export interface QueryRealtimeAdapter {
    readonly projectId: string
    readonly queryClient: QueryClient
    readonly coordinator: RealtimeCoordinator
    load(): Promise<void>
    start(): void
    stop(): void
    dispose(): void
    getSnapshot(): RealtimeSnapshot
    markNotificationRead(notificationId: string): Promise<RealtimeNotification>
}

const queryDefaults = {
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
} as const

export function createQueryRealtimeAdapter(options: {
    readonly projectId: string
    readonly source: ProjectRealtimeDataSource
    readonly events: RealtimeEventSource
    readonly metrics: RealtimeMetrics
}): QueryRealtimeAdapter {
    const source = createRealtimeDataSourceGuard(options.source, options.projectId)
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: queryDefaults,
            mutations: { retry: false },
        },
    })

    const publicationQuery = {
        queryKey: realtimeQueryKeys.publications(options.projectId),
        queryFn: () => source.listPublications(options.projectId),
        ...queryDefaults,
    }
    const notificationQuery = {
        queryKey: realtimeQueryKeys.notifications(options.projectId),
        queryFn: () => source.listNotifications(options.projectId),
        ...queryDefaults,
    }

    async function refreshKeys(keys: readonly QueryKey[]): Promise<void> {
        await Promise.all(
            keys.map(async queryKey => {
                await queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
                await queryClient.refetchQueries({ queryKey, type: 'all' })
            })
        )
    }

    function getSnapshot(): RealtimeSnapshot {
        return {
            publications:
                queryClient.getQueryData<readonly RealtimePublication[]>(
                    realtimeQueryKeys.publications(options.projectId)
                ) ?? [],
            notifications:
                queryClient.getQueryData<readonly RealtimeNotification[]>(
                    realtimeQueryKeys.notifications(options.projectId)
                ) ?? [],
        }
    }

    const coordinator = new RealtimeCoordinator({
        projectId: options.projectId,
        events: options.events,
        metrics: options.metrics,
        adapter: {
            refreshForEvent: async (event: RealtimeEvent) => {
                const queryKey =
                    eventResource(event) === 'publications'
                        ? realtimeQueryKeys.publications(options.projectId)
                        : realtimeQueryKeys.notifications(options.projectId)
                await refreshUntilEventApplied({
                    event,
                    getSnapshot,
                    metrics: options.metrics,
                    refresh: () => refreshKeys([queryKey]),
                })
            },
            refreshAll: () =>
                refreshWithReconnectRetry(
                    () =>
                        refreshKeys([
                            realtimeQueryKeys.publications(options.projectId),
                            realtimeQueryKeys.notifications(options.projectId),
                        ]),
                    options.metrics
                ),
        },
    })

    return {
        projectId: options.projectId,
        queryClient,
        coordinator,
        load: async () => {
            await Promise.all([
                queryClient.fetchQuery(publicationQuery),
                queryClient.fetchQuery(notificationQuery),
            ])
        },
        start: () => coordinator.start(),
        stop: () => coordinator.stop(),
        dispose: () => {
            coordinator.stop()
            queryClient.clear()
        },
        getSnapshot,
        markNotificationRead: async notificationId => {
            const updated = await source.markNotificationRead(options.projectId, notificationId)
            await refreshKeys([realtimeQueryKeys.notifications(options.projectId)])
            return updated
        },
    }
}
