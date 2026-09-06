import { describe, expect, it } from 'bun:test'

import { DomainInvariantError } from '@herald/core'

import { createAnalyticsStore } from './analytics-store'
import { closeDatabase, createDatabase } from './client'
import { createEventJournalStore } from './event-journal-store'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'

describe('analytics store', () => {
    it('derives provider-neutral counts and local daily buckets from durable events', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => 100 })
            const created = store.createProject({
                name: 'Analytics project',
                subjectId: 'user-1',
                displayName: 'Operator',
                timeZone: 'Europe/Paris',
            })
            const channel = store.createChannel({
                projectId: created.project.id,
                subjectId: 'user-1',
                name: 'Manual channel',
            })
            if (channel === null) throw new Error('The analytics channel is missing')
            const post = store.createPost({
                projectId: created.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Analytics source', format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id }],
            })
            if (post === null) throw new Error('The analytics publication is missing')

            const publicationId = post.publications[0]?.id
            if (publicationId === undefined) throw new Error('The publication id is missing')
            const journal = createEventJournalStore(database, {
                createId: (() => {
                    let sequence = 0
                    return () => `analytics-event-${++sequence}`
                })(),
            })
            const eventTime = Date.UTC(2026, 0, 1, 23, 30)
            const append = (name: string, payload: Readonly<Record<string, unknown>> = {}) =>
                journal.append({
                    projectId: created.project.id,
                    actorId: created.actor.id,
                    name,
                    version: 1,
                    subject: { type: 'publication', id: publicationId },
                    payload,
                    occurredAt: eventTime,
                })

            append('publication.created')
            append('publication.execution.effect_started')
            append('publication.execution.retry_scheduled')
            append('publication.execution.failed')
            append('publication.published')

            const analytics = createAnalyticsStore(database).getProjectAnalytics({
                projectId: created.project.id,
                subjectId: 'user-1',
                from: eventTime,
                to: eventTime + 1,
            })

            expect(analytics).toMatchObject({
                projectId: created.project.id,
                timeZone: 'Europe/Paris',
                range: { from: eventTime, to: eventTime + 1 },
                inventory: {
                    total: 1,
                    byChannel: [
                        expect.objectContaining({
                            channelId: channel.id,
                            channelName: 'Manual channel',
                            provider: null,
                            total: 1,
                        }),
                    ],
                },
                events: {
                    publicationsCreated: 1,
                    publicationsPublished: 1,
                    publicationsFailed: 1,
                    executionAttempts: 1,
                    executionRetriesScheduled: 1,
                    executionFailed: 1,
                },
                daily: [
                    {
                        date: '2026-01-02',
                        publicationsCreated: 1,
                        publicationsPublished: 1,
                        publicationsFailed: 1,
                        publicationsAmbiguous: 0,
                        executionAttempts: 1,
                        executionRetriesScheduled: 1,
                    },
                ],
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('enforces project access and a half-open time range', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => 100 })
            const created = store.createProject({
                name: 'Analytics access project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const analyticsStore = createAnalyticsStore(database)

            expect(
                analyticsStore.getProjectAnalytics({
                    projectId: created.project.id,
                    subjectId: 'other-user',
                })
            ).toBeNull()
            expect(() =>
                analyticsStore.getProjectAnalytics({
                    projectId: created.project.id,
                    subjectId: 'user-1',
                    from: 200,
                    to: 199,
                })
            ).toThrow(DomainInvariantError)

            expect(
                analyticsStore.getProjectAnalytics({
                    projectId: created.project.id,
                    subjectId: 'user-1',
                    from: 100,
                    to: 100,
                })?.daily
            ).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })
})
