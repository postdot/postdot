import { queryCollectionOptions, type QueryCollectionUtils } from '@tanstack/query-db-collection'
import { BasicIndex, collectionOptions, DbClient, type Collection } from '@tanstack/react-db'
import { QueryClient } from '@tanstack/react-query'

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

export interface DbRealtimeAdapter {
    readonly projectId: string
    readonly queryClient: QueryClient
    readonly dbClient: DbClient
    readonly publications: RealtimeCollection<RealtimePublication>
    readonly notifications: RealtimeCollection<RealtimeNotification>
    readonly coordinator: RealtimeCoordinator
    load(): Promise<void>
    start(): void
    stop(): void
    dispose(): Promise<void>
    getSnapshot(): RealtimeSnapshot
    markNotificationRead(notificationId: string): Promise<RealtimeNotification>
}

type RealtimeCollection<T extends object> = Collection<
    T,
    string,
    QueryCollectionUtils<T, string, T, unknown>,
    never,
    T
>

const queryDefaults = {
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
} as const

export function createDbRealtimeAdapter(options: {
    readonly projectId: string
    readonly source: ProjectRealtimeDataSource
    readonly events: RealtimeEventSource
    readonly metrics: RealtimeMetrics
}): DbRealtimeAdapter {
    const source = createRealtimeDataSourceGuard(options.source, options.projectId)
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: queryDefaults,
            mutations: { retry: false },
        },
    })
    const dbClient = new DbClient({ queryClient })
    const publicationCollectionId = `realtime-prototype:${options.projectId}:publications`
    const notificationCollectionId = `realtime-prototype:${options.projectId}:notifications`

    const publications = dbClient.collection(
        collectionOptions(publicationCollectionId, client =>
            queryCollectionOptions({
                id: publicationCollectionId,
                queryKey: realtimeQueryKeys.publications(options.projectId),
                queryClient: client.requireDependency<QueryClient>('queryClient'),
                queryFn: async () => [...(await source.listPublications(options.projectId))],
                getKey: publication => publication.id,
                ...queryDefaults,
            })
        )
    )

    const notifications = dbClient.collection(
        collectionOptions(notificationCollectionId, client =>
            queryCollectionOptions({
                id: notificationCollectionId,
                queryKey: realtimeQueryKeys.notifications(options.projectId),
                queryClient: client.requireDependency<QueryClient>('queryClient'),
                queryFn: async () => [...(await source.listNotifications(options.projectId))],
                getKey: notification => notification.id,
                defaultIndexType: BasicIndex,
                onUpdate: async ({ transaction }) => {
                    for (const mutation of transaction.mutations) {
                        if (mutation.changes.readAt === undefined) continue
                        await source.markNotificationRead(options.projectId, mutation.key)
                    }
                },
                ...queryDefaults,
            })
        )
    )
    notifications.createIndex(row => row.subjectId)

    async function refreshCollections(): Promise<void> {
        await Promise.all([
            publications.utils.refetch({ throwOnError: true }),
            notifications.utils.refetch({ throwOnError: true }),
        ])
    }

    const coordinator = new RealtimeCoordinator({
        projectId: options.projectId,
        events: options.events,
        metrics: options.metrics,
        adapter: {
            refreshForEvent: async (event: RealtimeEvent) => {
                const collection =
                    eventResource(event) === 'publications' ? publications : notifications
                await refreshUntilEventApplied({
                    event,
                    getSnapshot,
                    metrics: options.metrics,
                    refresh: async () => {
                        await collection.utils.refetch({ throwOnError: true })
                        await collection.toArrayWhenReady()
                    },
                })
            },
            refreshAll: () => refreshWithReconnectRetry(refreshCollections, options.metrics),
        },
    })

    function getSnapshot(): RealtimeSnapshot {
        return {
            publications: publications.toArray,
            notifications: notifications.toArray,
        }
    }

    return {
        projectId: options.projectId,
        queryClient,
        dbClient,
        publications,
        notifications,
        coordinator,
        load: async () => {
            await Promise.all([publications.preload(), notifications.preload()])
        },
        start: () => coordinator.start(),
        stop: () => coordinator.stop(),
        dispose: async () => {
            coordinator.stop()
            await dbClient.cleanup()
            queryClient.clear()
        },
        getSnapshot,
        markNotificationRead: async notificationId => {
            if (!notifications.has(notificationId)) {
                throw new Error('notification is not loaded in the project collection')
            }
            const transaction = notifications.update(notificationId, notification => {
                notification.readAt = Date.now()
            })
            await transaction.isPersisted.promise
            const updated = notifications.get(notificationId)
            if (updated === undefined) throw new Error('notification disappeared after update')
            return updated
        },
    }
}
