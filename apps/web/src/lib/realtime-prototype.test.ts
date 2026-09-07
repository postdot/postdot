import { afterEach, describe, expect, test } from 'bun:test'

import { createLiveQueryCollection, eq, isNull } from '@tanstack/react-db'

import { createDbRealtimeAdapter } from '@/lib/realtime-db'
import {
    createHeraldRealtimeDataSource,
    FixtureRealtimeEnvironment,
    selectAttentionGroups,
    selectQueue,
    type RealtimeEvent,
} from '@/lib/realtime-prototype'
import { createQueryRealtimeAdapter } from '@/lib/realtime-query'
import { createRealtimeDataSourceGuard } from '@/lib/realtime-sync'

const activeAdapters: Array<{ dispose(): void | Promise<void> }> = []

afterEach(async () => {
    await Promise.all(activeAdapters.splice(0).map(adapter => adapter.dispose()))
})

describe('realtime prototype selectors', () => {
    test('derives a project queue and attention groups from safe rows', () => {
        const environment = new FixtureRealtimeEnvironment('selector-project')

        const snapshot = {
            publications: [
                {
                    id: 'publication-1',
                    projectId: 'selector-project',
                    postId: 'post-1',
                    channelId: 'channel-1',
                    channelName: 'LinkedIn',
                    postTitle: 'A post',
                    state: 'scheduled' as const,
                    scheduledAt: 1_700_000_001_000,
                    updatedAt: 1_700_000_000_000,
                },
                {
                    id: 'publication-2',
                    projectId: 'selector-project',
                    postId: 'post-1',
                    channelId: 'channel-2',
                    channelName: 'Editorial review',
                    postTitle: 'A post',
                    state: 'published' as const,
                    scheduledAt: null,
                    updatedAt: 1_700_000_000_000,
                },
            ],
            notifications: [
                {
                    id: 'notification-1',
                    projectId: 'selector-project',
                    subjectType: 'publication',
                    subjectId: 'publication-1',
                    kind: 'publication_failed' as const,
                    severity: 'error' as const,
                    title: 'Needs attention',
                    body: 'A publication needs attention.',
                    readAt: null,
                    archivedAt: null,
                    createdAt: 1_700_000_000_000,
                },
            ],
        }

        expect(selectQueue(snapshot.publications).map(item => item.id)).toEqual(['publication-1'])
        expect(selectAttentionGroups(snapshot.publications, snapshot.notifications)).toEqual([
            {
                channelName: 'LinkedIn',
                publicationCount: 1,
                unreadNotificationCount: 1,
            },
        ])
        expect(environment.projectId).toBe('selector-project')
    })
})

describe('TanStack Query prototype', () => {
    test('invalidates only the affected list and retries a signal that beats projection', async () => {
        const environment = new FixtureRealtimeEnvironment('query-project', {
            networkDelayMs: 1,
        })
        const adapter = createQueryRealtimeAdapter({
            projectId: environment.projectId,
            source: environment.source,
            events: environment.events,
            metrics: environment.metrics,
        })
        activeAdapters.push(adapter)

        await adapter.load()
        const publicationReadsBefore = environment.metrics.snapshot().publicationReads
        const notificationReadsBefore = environment.metrics.snapshot().notificationReads
        adapter.start()

        await environment.simulatePublicationStatusChange('published', 35)

        expect(adapter.getSnapshot().publications[0]?.state).toBe('published')
        expect(environment.metrics.snapshot().publicationReads).toBeGreaterThan(
            publicationReadsBefore
        )
        expect(environment.metrics.snapshot().notificationReads).toBe(notificationReadsBefore)

        const duplicateEvent: RealtimeEvent = {
            id: 'query-project-duplicate',
            projectId: environment.projectId,
            sequence: 999,
            entityId: `${environment.projectId}-publication-1`,
            type: 'publication.status_changed',
            payload: { state: 'published' },
        }
        await adapter.coordinator.handleEvent(duplicateEvent)
        const readsAfterFirstEvent = environment.metrics.snapshot().publicationReads
        await adapter.coordinator.handleEvent(duplicateEvent)
        expect(environment.metrics.snapshot().publicationReads).toBe(readsAfterFirstEvent)
        expect(environment.metrics.snapshot().deduplicatedEvents).toBe(1)
    })

    test('reconnect performs a bounded full refresh for missed events', async () => {
        const environment = new FixtureRealtimeEnvironment('query-reconnect')
        const adapter = createQueryRealtimeAdapter({
            projectId: environment.projectId,
            source: environment.source,
            events: environment.events,
            metrics: environment.metrics,
        })
        activeAdapters.push(adapter)

        await adapter.load()
        adapter.start()
        await environment.events.disconnect()
        const event = await environment.simulateNotificationCreated(25)
        await environment.events.reconnect()

        expect(adapter.getSnapshot().notifications.some(item => item.id === event.entityId)).toBe(
            true
        )
        expect(environment.metrics.snapshot().reconnects).toBe(1)
    })

    test('projects update, create, and read signals into the affected resource', async () => {
        const environment = new FixtureRealtimeEnvironment('query-events', {
            networkDelayMs: 1,
        })
        const adapter = createQueryRealtimeAdapter({
            projectId: environment.projectId,
            source: environment.source,
            events: environment.events,
            metrics: environment.metrics,
        })
        activeAdapters.push(adapter)

        await adapter.load()
        adapter.start()

        await environment.simulatePublicationUpdate()
        expect(adapter.getSnapshot().publications[0]?.postTitle).toContain('revised')

        const created = await environment.simulateNotificationCreated()
        expect(adapter.getSnapshot().notifications.some(item => item.id === created.entityId)).toBe(
            true
        )

        await environment.simulateNotificationRead(created.entityId)
        expect(
            adapter.getSnapshot().notifications.find(item => item.id === created.entityId)?.readAt
        ).not.toBeNull()
    })
})

describe('TanStack DB prototype', () => {
    test('updates live collections and rolls back a failed optimistic read mutation', async () => {
        const environment = new FixtureRealtimeEnvironment('db-project', {
            networkDelayMs: 20,
        })
        const adapter = createDbRealtimeAdapter({
            projectId: environment.projectId,
            source: environment.source,
            events: environment.events,
            metrics: environment.metrics,
        })
        activeAdapters.push(adapter)

        await adapter.load()
        adapter.start()
        const notificationId = `${environment.projectId}-notification-1`
        const pendingRead = adapter.markNotificationRead(notificationId)
        expect(adapter.notifications.get(notificationId)?.readAt).not.toBeNull()
        await pendingRead
        expect(adapter.notifications.get(notificationId)?.readAt).not.toBeNull()

        const created = await environment.simulateNotificationCreated(0)
        expect(adapter.notifications.get(created.entityId)?.readAt).toBeNull()

        const attention = createLiveQueryCollection({
            id: 'db-project-attention-test',
            startSync: true,
            query: query =>
                query
                    .from({ publication: adapter.publications })
                    .join(
                        { notification: adapter.notifications },
                        ({ publication, notification }) =>
                            eq(notification.subjectId, publication.id)
                    )
                    .where(({ notification }) => isNull(notification.readAt))
                    .select(({ publication, notification }) => ({
                        channelName: publication.channelName,
                        notificationId: notification.id,
                        publicationId: publication.id,
                        publicationState: publication.state,
                    })),
        })
        expect((await attention.toArrayWhenReady()).length).toBeGreaterThan(0)

        environment.failNextNotificationWrite()
        await expect(adapter.markNotificationRead(created.entityId)).rejects.toThrow(
            'fixture notification write failed'
        )
        expect(adapter.notifications.get(created.entityId)?.readAt).toBeNull()

        const statusEvent = await environment.simulatePublicationStatusChange('failed', 20)
        expect(adapter.publications.get(statusEvent.entityId)?.state).toBe('failed')
        await attention.cleanup()
    })
})

describe('project boundaries', () => {
    test('rejects data access outside the selected project', async () => {
        const source = createHeraldRealtimeDataSource()
        const guarded = createRealtimeDataSourceGuard(source, 'allowed-project')

        expect(() => guarded.listPublications('other-project')).toThrow('cross-project')
    })
})
