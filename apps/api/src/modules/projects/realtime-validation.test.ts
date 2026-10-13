import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    closeDatabase,
    createDatabase,
    createDatabaseTransaction,
    createEventJournalStore,
    createManualStore,
    createNotificationStore,
    runMigrations,
    setDatabaseCommitObserver,
    type EventJournalCursor,
    type EventJournalEntry,
    type PostbotDatabase,
} from '@postbot/db'

import { createNotificationProjectionRuntime } from '../notifications/runtime'
import { createProjectEventStream } from './realtime-routes'
import { createProjectRealtimeRuntime, type ProjectRealtimeHub } from './realtime-runtime'
import { readFrame, readOpeningComment } from './realtime-stream-reader'

const eventTime = 1_800_000_000_000
const projectionTime = eventTime + 1_000
const idleHeartbeatIntervalMs = 60_000

function createFixture(database: PostbotDatabase) {
    let nextId = 0
    const createId = () => `realtime-106-${++nextId}`
    database.$client
        .query(
            `insert into user (id, name, email, email_verified, created_at, updated_at)
             values ('realtime-106-human', 'Realtime Validation Human', 'realtime-106-human@postbot.local', 0, ?1, ?1)`
        )
        .run(eventTime)
    database.$client
        .query(
            `insert into instance_memberships
             (id, user_id, role, state, created_at, updated_at)
             values ('instance-membership:realtime-106-human', 'realtime-106-human', 'admin', 'enabled', ?1, ?1)`
        )
        .run(eventTime)
    const manual = createManualStore(database, {
        createId,
        now: () => eventTime,
    })
    const project = manual.createProject({
        name: 'Realtime validation project',
        subjectId: 'realtime-106-human',
        displayName: 'Realtime validation human',
    })
    if (project === null) throw new Error('The realtime validation project was not created')

    const journal = createEventJournalStore(database, { createId })
    const baselineCursor = journal.latestCursor()
    if (baselineCursor === null) throw new Error('The fixture project event is missing')

    return {
        database,
        project: project.project,
        actor: project.actor,
        journal,
        baselineCursor,
        notifications: createNotificationStore(database, {
            createId,
            now: () => projectionTime,
        }),
    }
}

function appendPublicationEvent(
    fixture: ReturnType<typeof createFixture>,
    id: string,
    occurredAt = eventTime
) {
    return fixture.journal.append({
        id,
        projectId: fixture.project.id,
        actorId: fixture.actor.id,
        name: 'publication.execution.succeeded',
        version: 1,
        subject: { type: 'publication', id: `publication-${id}` },
        occurredAt,
    })
}

function createRealtimeBridge(fixture: ReturnType<typeof createFixture>) {
    const projectionErrors: unknown[] = []
    const observerErrors: unknown[] = []
    const projection = createNotificationProjectionRuntime(fixture.notifications, {
        onError: error => projectionErrors.push(error),
    })
    const realtime = createProjectRealtimeRuntime({
        onProjectsChanged: projectIds => projection.runProjects(projectIds),
    })
    const clearObserver = setDatabaseCommitObserver(
        fixture.database,
        projectIds => realtime.publish(projectIds),
        error => observerErrors.push(error)
    )

    return {
        projection,
        realtime,
        projectionErrors,
        observerErrors,
        dispose() {
            clearObserver()
            realtime.stop()
            projection.stop()
        },
    }
}

function createProjectStream(
    fixture: ReturnType<typeof createFixture>,
    after: EventJournalCursor | null,
    projectChanges?: ProjectRealtimeHub
) {
    return createProjectEventStream({
        request: new Request(`http://localhost/api/projects/${fixture.project.id}/events`),
        projectId: fixture.project.id,
        journal: fixture.journal,
        after,
        projectChanges,
        options: {
            heartbeatIntervalMs: idleHeartbeatIntervalMs,
            batchSize: 32,
        },
    })
}

const readChunk = readFrame

function eventIdsFromSse(text: string): string[] {
    return text
        .split('\n')
        .filter(line => line.startsWith('data: '))
        .map(line => JSON.parse(line.slice('data: '.length)) as { id: string })
        .map(event => event.id)
}

function eventCursorsFromSse(text: string): string[] {
    return text
        .split('\n')
        .filter(line => line.startsWith('id: '))
        .map(line => line.slice('id: '.length))
}

async function flushMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
}

function createWaiterTracker() {
    let pending = 0
    const hub: ProjectRealtimeHub = {
        waitForChange(_projectId, signal) {
            pending += 1
            return new Promise<void>(resolve => {
                const finish = () => {
                    pending -= 1
                    signal.removeEventListener('abort', finish)
                    resolve()
                }
                if (signal.aborted) {
                    finish()
                    return
                }
                signal.addEventListener('abort', finish, { once: true })
            })
        },
    }

    return {
        hub,
        get pending() {
            return pending
        },
    }
}

async function createTemporaryDatabase() {
    const directory = await mkdtemp(join(tmpdir(), 'postbot-realtime-106-'))
    return {
        filename: join(directory, 'postbot.sqlite'),
        async remove() {
            await rm(directory, { recursive: true, force: true })
        },
    }
}

describe('REALTIME-106 realtime validation', () => {
    it('keeps CLI-style writes correct with zero SSE subscribers and projects for a later browser', async () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const fixture = createFixture(database)
            let globalRecoveryScans = 0
            const projectedProjects: string[] = []
            const projection = createNotificationProjectionRuntime({
                listProjectIds: () => {
                    globalRecoveryScans += 1
                    return fixture.notifications.listProjectIds()
                },
                project: projectId => {
                    projectedProjects.push(projectId)
                    return fixture.notifications.project(projectId)
                },
            })
            const realtime = createProjectRealtimeRuntime({
                onProjectsChanged: projectIds => projection.runProjects(projectIds),
            })
            const clearObserver = setDatabaseCommitObserver(database, projectIds => {
                realtime.publish(projectIds)
            })

            try {
                const event = appendPublicationEvent(fixture, 'zero-subscriber-event')

                expect(projectedProjects).toEqual([fixture.project.id])
                expect(globalRecoveryScans).toBe(0)
                expect(
                    fixture.notifications
                        .list({
                            projectId: fixture.project.id,
                            subjectId: 'realtime-106-human',
                        })
                        ?.items.map(notification => notification.sourceEventId)
                ).toEqual([event.id])

                const reader = createProjectStream(
                    fixture,
                    fixture.baselineCursor,
                    realtime.hub
                ).getReader()
                const laterBrowser = await readChunk(reader)
                await reader.cancel()

                expect(eventIdsFromSse(laterBrowser.text)).toEqual([event.id])
            } finally {
                clearObserver()
                realtime.stop()
                projection.stop()
            }
        } finally {
            closeDatabase(database)
        }
    })

    it('isolates project signals while waking every subscriber for the changed project', async () => {
        const changed: string[][] = []
        const runtime = createProjectRealtimeRuntime({
            onProjectsChanged: projectIds => changed.push([...projectIds]),
        })
        const firstController = new AbortController()
        const secondController = new AbortController()
        const unrelatedController = new AbortController()
        let firstResolved = false
        let secondResolved = false
        let unrelatedResolved = false

        try {
            const first = runtime.hub
                .waitForChange('project-a', firstController.signal)
                .then(() => {
                    firstResolved = true
                })
            const second = runtime.hub
                .waitForChange('project-a', secondController.signal)
                .then(() => {
                    secondResolved = true
                })
            const unrelated = runtime.hub
                .waitForChange('project-b', unrelatedController.signal)
                .then(() => {
                    unrelatedResolved = true
                })

            runtime.publish(['project-a', 'project-a'])
            await Promise.all([first, second])

            expect(changed).toEqual([['project-a']])
            expect(firstResolved).toBe(true)
            expect(secondResolved).toBe(true)
            expect(unrelatedResolved).toBe(false)

            unrelatedController.abort()
            await unrelated
        } finally {
            runtime.stop()
        }
    })

    it('replays disconnected commits once across cursor reconnects and continues from the last cursor', async () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const fixture = createFixture(database)
            const bridge = createRealtimeBridge(fixture)

            try {
                const first = appendPublicationEvent(fixture, 'reconnect-first')
                const firstReader = createProjectStream(
                    fixture,
                    fixture.baselineCursor,
                    bridge.realtime.hub
                ).getReader()
                const firstChunk = await readChunk(firstReader)
                await firstReader.cancel()

                expect(eventIdsFromSse(firstChunk.text)).toEqual([first.id])
                expect(eventCursorsFromSse(firstChunk.text)).toEqual([first.cursor])

                const second = appendPublicationEvent(fixture, 'reconnect-second')
                const replayReader = createProjectStream(
                    fixture,
                    first.cursor,
                    bridge.realtime.hub
                ).getReader()
                const replayChunk = await readChunk(replayReader)
                await replayReader.cancel()

                expect(eventIdsFromSse(replayChunk.text)).toEqual([second.id])
                expect(eventCursorsFromSse(replayChunk.text)).toEqual([second.cursor])

                const thirdReader = createProjectStream(
                    fixture,
                    second.cursor,
                    bridge.realtime.hub
                ).getReader()
                // The read is issued past the opening comment, so the stream is
                // already waiting on the hub when the commit lands.
                const thirdRead = readChunk(thirdReader)
                await flushMicrotasks()

                const third = appendPublicationEvent(fixture, 'reconnect-third')
                const thirdChunk = await thirdRead
                await thirdReader.cancel()

                expect(thirdChunk.done).toBe(false)
                expect(eventIdsFromSse(thirdChunk.text)).toEqual([third.id])
                expect(bridge.observerErrors).toEqual([])
            } finally {
                bridge.dispose()
            }
        } finally {
            closeDatabase(database)
        }
    })

    it('recovers journal replay and notification projection after reopening a temporary database', async () => {
        const temporary = await createTemporaryDatabase()
        let database: PostbotDatabase | undefined
        try {
            database = createDatabase(temporary.filename)
            runMigrations(database)
            const fixture = createFixture(database)
            const event = appendPublicationEvent(fixture, 'restart-event')
            const projectId = fixture.project.id
            const baselineCursor = fixture.baselineCursor
            closeDatabase(database)
            database = undefined

            const reopened = createDatabase(temporary.filename)
            database = reopened
            runMigrations(reopened)
            const journal = createEventJournalStore(reopened)
            const notifications = createNotificationStore(reopened, {
                now: () => projectionTime,
            })
            const projection = createNotificationProjectionRuntime(notifications)
            projection.start()
            await flushMicrotasks()

            expect(projection.state).toBe('started')
            expect(
                notifications
                    .list({ projectId, subjectId: 'realtime-106-human' })
                    ?.items.map(notification => notification.sourceEventId)
            ).toEqual([event.id])
            expect(
                journal.readAfter({ projectId, after: baselineCursor }).map(entry => entry.id)
            ).toEqual([event.id])

            const stream = createProjectEventStream({
                request: new Request(`http://localhost/api/projects/${projectId}/events`),
                projectId,
                journal,
                after: baselineCursor,
                options: {
                    heartbeatIntervalMs: idleHeartbeatIntervalMs,
                    batchSize: 10,
                },
            })
            const reader = stream.getReader()
            const replay = await readChunk(reader)
            await reader.cancel()

            expect(eventIdsFromSse(replay.text)).toEqual([event.id])
            expect(eventCursorsFromSse(replay.text)).toEqual([event.cursor])
            projection.stop()
        } finally {
            if (database !== undefined) closeDatabase(database)
            await temporary.remove()
        }
    })

    it('keeps a temporary-database burst ordered, deduplicated, and bounded after subscriber cleanup', async () => {
        const temporary = await createTemporaryDatabase()
        let database: PostbotDatabase | undefined
        try {
            database = createDatabase(temporary.filename)
            runMigrations(database)
            const fixture = createFixture(database)
            const bridge = createRealtimeBridge(fixture)
            const eventCount = 240
            const eventIds = Array.from(
                { length: eventCount },
                (_, index) => `burst-event-${String(index).padStart(3, '0')}`
            )

            try {
                const committed = createDatabaseTransaction(database, () =>
                    eventIds.map((id, index) =>
                        appendPublicationEvent(fixture, id, eventTime + index)
                    )
                )()
                expect(committed.map(event => event.id)).toEqual(eventIds)

                const journalEntries: EventJournalEntry[] = []
                let after: EventJournalCursor | null = null
                while (true) {
                    const batch = fixture.journal.readAfter({
                        projectId: fixture.project.id,
                        after: after ?? fixture.baselineCursor,
                        limit: 37,
                    })
                    journalEntries.push(...batch)
                    if (batch.length < 37) break
                    after = batch.at(-1)?.cursor ?? null
                }
                expect(journalEntries.map(entry => entry.id)).toEqual(eventIds)
                expect(bridge.observerErrors).toEqual([])

                const sourceEventIds: string[] = []
                let before: string | null | undefined
                do {
                    const page = fixture.notifications.list({
                        projectId: fixture.project.id,
                        subjectId: 'realtime-106-human',
                        limit: 100,
                        before,
                    })
                    expect(page).not.toBeNull()
                    sourceEventIds.push(...(page?.items.map(item => item.sourceEventId) ?? []))
                    before = page?.nextCursor
                } while (before !== null && before !== undefined)

                expect(sourceEventIds).toEqual([...eventIds].reverse())
                expect(new Set(sourceEventIds).size).toBe(eventCount)

                bridge.projection.runProjects([fixture.project.id])
                expect(
                    fixture.notifications
                        .list({
                            projectId: fixture.project.id,
                            subjectId: 'realtime-106-human',
                            limit: 100,
                        })
                        ?.items.map(item => item.sourceEventId)
                ).toEqual(eventIds.slice().reverse().slice(0, 100))

                const streamReader = createProjectStream(
                    fixture,
                    fixture.baselineCursor,
                    bridge.realtime.hub
                ).getReader()
                const streamedIds: string[] = []
                const streamedCursors: string[] = []
                const chunkCount = Math.ceil(eventCount / 32)
                for (let index = 0; index < chunkCount; index += 1) {
                    const chunk = await readChunk(streamReader)
                    expect(chunk.done).toBe(false)
                    streamedIds.push(...eventIdsFromSse(chunk.text))
                    streamedCursors.push(...eventCursorsFromSse(chunk.text))
                }
                await streamReader.cancel()

                expect(streamedIds).toEqual(eventIds)
                expect(streamedCursors).toHaveLength(eventCount)

                const tracker = createWaiterTracker()
                const lastCursor = fixture.journal.latestCursor()
                if (lastCursor === null) throw new Error('The burst cursor is missing')
                const idleReaders = Array.from({ length: 24 }, () =>
                    createProjectStream(fixture, lastCursor, tracker.hub).getReader()
                )
                // Each idle stream opens with its own comment frame, so that frame
                // is consumed before the stream starts waiting on the hub.
                await Promise.all(idleReaders.map(reader => readOpeningComment(reader)))
                const idleReads = idleReaders.map(reader => reader.read())
                await flushMicrotasks()
                expect(tracker.pending).toBe(idleReaders.length)

                const cancellations = idleReaders.map(reader => reader.cancel())
                await Promise.all(cancellations)
                await Promise.all(idleReads)
                expect(tracker.pending).toBe(0)
            } finally {
                bridge.dispose()
            }
        } finally {
            if (database !== undefined) closeDatabase(database)
            await temporary.remove()
        }
    })

    it('emits no signal for rollback and keeps the committed fact recoverable after observer failure', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const fixture = createFixture(database)
            const observed: string[][] = []
            const clearObserver = setDatabaseCommitObserver(database, projectIds => {
                observed.push([...projectIds])
            })

            try {
                const rollback = createDatabaseTransaction(database, () => {
                    appendPublicationEvent(fixture, 'rollback-event')
                    throw new Error('intentional rollback')
                })
                expect(() => rollback()).toThrow('intentional rollback')
                expect(observed).toEqual([])
                expect(
                    fixture.journal.readAfter({
                        projectId: fixture.project.id,
                        after: fixture.baselineCursor,
                    })
                ).toEqual([])
            } finally {
                clearObserver()
            }

            const observerErrors: unknown[] = []
            const clearFailingObserver = setDatabaseCommitObserver(
                database,
                () => {
                    throw new Error('intentional observer failure')
                },
                error => observerErrors.push(error)
            )
            try {
                const event = appendPublicationEvent(fixture, 'observer-failure-event')
                expect(event.id).toBe('observer-failure-event')
                expect(observerErrors).toHaveLength(1)
                expect(
                    fixture.journal.readAfter({
                        projectId: fixture.project.id,
                        after: fixture.baselineCursor,
                    })
                ).toHaveLength(1)
            } finally {
                clearFailingObserver()
            }
        } finally {
            closeDatabase(database)
        }
    })

    it('recovers a committed event when notification projection fails after commit', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const fixture = createFixture(database)
            const bridge = createRealtimeBridge(fixture)

            try {
                database.$client.run(`
                    create trigger reject_realtime_projection_cursor
                    before insert on notification_projection_cursors
                    begin
                        select raise(abort, 'projection unavailable');
                    end
                `)

                const event = appendPublicationEvent(fixture, 'projection-failure-event')
                expect(bridge.observerErrors).toEqual([])
                expect(bridge.projectionErrors).toHaveLength(1)
                expect(
                    fixture.journal.readAfter({
                        projectId: fixture.project.id,
                        after: fixture.baselineCursor,
                    })
                ).toEqual([event])
                expect(
                    fixture.notifications.list({
                        projectId: fixture.project.id,
                        subjectId: 'realtime-106-human',
                    })?.items
                ).toEqual([])

                database.$client.run('drop trigger reject_realtime_projection_cursor')
                bridge.projection.runNow()

                expect(bridge.projection.state).toBe('idle')
                expect(
                    fixture.notifications
                        .list({
                            projectId: fixture.project.id,
                            subjectId: 'realtime-106-human',
                        })
                        ?.items.map(notification => notification.sourceEventId)
                ).toEqual([event.id])
            } finally {
                bridge.dispose()
            }
        } finally {
            closeDatabase(database)
        }
    })
})
