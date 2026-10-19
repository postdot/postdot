import { describe, expect, it } from 'bun:test'

import { parseEventJournalCursor, type EventJournalEntry } from '@postbot/db'

import {
    createProjectEventStream,
    createUserEventStream,
    toProjectRealtimeEvent,
    type ProjectRealtimeEventType,
} from './realtime-routes'
import { createProjectRealtimeRuntime } from './realtime-runtime'
import { readFrame } from './realtime-stream-reader'

function journalEntry(input: {
    readonly id: string
    readonly projectId?: string
    readonly name?: ProjectRealtimeEventType | string
    readonly sequence: number
}): EventJournalEntry {
    return {
        id: input.id,
        projectId: input.projectId ?? 'project-1',
        actorId: 'actor-1',
        name: input.name ?? 'publication.execution.failed',
        version: 1,
        subject: { type: 'publication', id: `publication-${input.id}` },
        payload: {
            accessToken: 'must-not-be-streamed',
            providerResponse: 'must-not-be-streamed',
        },
        occurredAt: 1_800_000_000_000,
        correlationId: 'correlation-secret-context',
        causationId: 'causation-secret-context',
        cursor: parseEventJournalCursor(`event-sequence:${input.sequence}`),
    }
}

const readText = readFrame

function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

describe('SSE-318 stream lifecycle', () => {
    it('opens both streams with a comment frame that carries no event and no cursor', async () => {
        const projectStream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [] },
            after: null,
            options: { heartbeatIntervalMs: 60_000, batchSize: 8 },
        })
        const userStream = createUserEventStream({
            request: new Request('http://localhost/api/notifications/events'),
            userId: 'user-1',
            listProjectIds: () => ['project-1'],
            journal: { readAllAfter: () => [] },
            after: null,
            options: { heartbeatIntervalMs: 60_000, batchSize: 8 },
        })

        for (const stream of [projectStream, userStream]) {
            const reader = stream.getReader()
            const opening = await reader.read()
            await reader.cancel()

            expect(opening.done).toBe(false)
            const text = new TextDecoder().decode(opening.value)
            // Establishes the connection immediately, and nothing else: no event
            // name, no data, and no cursor for a client to resume from.
            expect(text).toBe(': connected\n\n')
            expect(text).not.toContain('event:')
            expect(text).not.toContain('data:')
            expect(text).not.toContain('id:')
        }
    })

    it('keeps heartbeats after the opening comment', async () => {
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [] },
            after: null,
            options: { heartbeatIntervalMs: 20, batchSize: 8 },
        })
        const reader = stream.getReader()
        const opening = await reader.read()
        const heartbeat = await readFrame(reader)
        await reader.cancel()

        expect(new TextDecoder().decode(opening.value)).toBe(': connected\n\n')
        expect(heartbeat.text).toBe(': heartbeat\n\n')
    })

    it('leaves the durable cursor untouched by the opening frame', async () => {
        const reads: unknown[] = []
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: {
                readAfter: input => {
                    reads.push(input)
                    return []
                },
            },
            after: parseEventJournalCursor('event-sequence:7'),
            options: { heartbeatIntervalMs: 20, batchSize: 8 },
        })
        const reader = stream.getReader()
        await reader.read()
        await readFrame(reader)
        await reader.cancel()

        // Resuming still asks the journal for everything after the client's
        // cursor, so the opening frame cannot silently skip an entry.
        expect(reads.length).toBeGreaterThan(0)
        expect(reads[0]).toEqual({ projectId: 'project-1', after: 'event-sequence:7', limit: 8 })
    })
})

describe('project event stream', () => {
    it('emits a safe invalidation envelope and removes sensitive journal fields', async () => {
        const entry = journalEntry({ id: 'event-1', sequence: 1 })
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [entry] },
            after: null,
            options: { heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const result = await readText(reader)
        await reader.cancel()

        expect(result.text).toContain('id: event-sequence:1')
        expect(result.text).toContain('event: project.update')
        expect(result.text).toContain('"id":"event-1"')
        expect(result.text).toContain('"payload":{}')
        expect(result.text).not.toContain('must-not-be-streamed')
        expect(result.text).not.toContain('actor-1')
        expect(result.text).not.toContain('correlation-secret-context')
    })

    it('emits a user stream only for the projects currently visible to that user', async () => {
        const visible = journalEntry({ id: 'visible-event', projectId: 'project-1', sequence: 1 })
        const hidden = journalEntry({ id: 'hidden-event', projectId: 'project-2', sequence: 2 })
        const stream = createUserEventStream({
            request: new Request('http://localhost/api/notifications/events'),
            userId: 'user-1',
            listProjectIds: () => ['project-1'],
            journal: { readAllAfter: () => [visible, hidden] },
            after: null,
            options: { heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const result = await readText(reader)
        await reader.cancel()

        expect(result.text).toContain('event: user.update')
        expect(result.text).toContain('"id":"visible-event"')
        expect(result.text).not.toContain('hidden-event')
        expect(result.text).not.toContain('project-2')
    })

    it('emits access revocation when its session is no longer authorized', async () => {
        const stream = createUserEventStream({
            request: new Request('http://localhost/api/notifications/events'),
            userId: 'user-1',
            listProjectIds: () => ['project-1'],
            journal: { readAllAfter: () => [] },
            after: null,
            isAuthorized: () => false,
            options: { heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const result = await readText(reader)
        const terminal = await readText(reader)

        expect(result.text).toContain('event: user.access-revoked')
        expect(terminal.done).toBe(true)
    })

    it('emits an access-revoked signal when the user loses every visible project', async () => {
        const stream = createUserEventStream({
            request: new Request('http://localhost/api/notifications/events'),
            userId: 'user-1',
            listProjectIds: () => [],
            journal: { readAllAfter: () => [] },
            after: null,
            options: { heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const result = await readText(reader)
        const terminal = await readText(reader)

        expect(result.text).toContain('event: user.access-revoked')
        expect(result.text).toContain('"reason":"access_revoked"')
        expect(terminal.done).toBe(true)
    })

    it('replays after a cursor and emits heartbeats while idle', async () => {
        const first = journalEntry({ id: 'event-1', sequence: 1 })
        const second = journalEntry({ id: 'event-2', sequence: 2 })
        let calls = 0
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: {
                readAfter: () => {
                    calls += 1
                    return calls === 1 ? [second] : []
                },
            },
            after: first.cursor,
            options: { heartbeatIntervalMs: 5, batchSize: 10 },
        })

        const reader = stream.getReader()
        const replay = await readText(reader)
        expect(replay.text).toContain('id: event-sequence:2')
        expect(replay.text).not.toContain('id: event-sequence:1')
        await reader.cancel()

        const heartbeatStream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [] },
            after: null,
            options: { heartbeatIntervalMs: 5, batchSize: 10 },
        })
        const heartbeatReader = heartbeatStream.getReader()
        const heartbeat = await readText(heartbeatReader)
        await heartbeatReader.cancel()

        expect(heartbeat.text).toBe(': heartbeat\n\n')
    })

    it('closes with a resynchronization signal when the journal cursor regresses', async () => {
        const first = journalEntry({ id: 'event-1', sequence: 2 })
        const regressed = journalEntry({ id: 'event-2', sequence: 2 })
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [first, regressed] },
            after: null,
            options: { heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const result = await readText(reader)
        const terminal = await readText(reader)

        expect(result.text).toContain('event: project.resync-required')
        expect(result.text).toContain('"reason":"cursor_gap"')
        expect(terminal.done).toBe(true)
    })

    it('stops waiting after the request is aborted', async () => {
        const controller = new AbortController()
        let calls = 0
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events', {
                signal: controller.signal,
            }),
            projectId: 'project-1',
            journal: {
                readAfter: () => {
                    calls += 1
                    return []
                },
            },
            after: null,
            options: { heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const pending = readText(reader)
        await new Promise(resolve => setTimeout(resolve, 1))
        controller.abort()
        const result = await pending
        const callsAtClose = calls
        await new Promise(resolve => setTimeout(resolve, 20))

        expect(result.done).toBe(true)
        expect(calls).toBe(callsAtClose)
    })

    it('closes with an access-revoked signal before serving events after membership removal', async () => {
        const entry = journalEntry({ id: 'must-not-leak', sequence: 1 })
        let authorized = true
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [entry] },
            after: null,
            isAuthorized: () => {
                authorized = false
                return authorized
            },
            options: { heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const result = await readText(reader)
        const terminal = await readText(reader)

        expect(result.text).toContain('event: project.access-revoked')
        expect(result.text).toContain('"reason":"access_revoked"')
        expect(result.text).not.toContain('must-not-leak')
        expect(terminal.done).toBe(true)
    })

    it('waits for a process wakeup instead of polling SQLite per connection', async () => {
        const entry = journalEntry({ id: 'event-1', sequence: 1 })
        let calls = 0
        let releaseWakeup!: () => void
        const wakeup = new Promise<void>(resolve => {
            releaseWakeup = resolve
        })
        let entries: readonly EventJournalEntry[] = []
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: {
                readAfter: () => {
                    calls += 1
                    const result = entries
                    entries = []
                    return result
                },
            },
            projectChanges: {
                waitForChange: () => wakeup,
            },
            after: null,
            options: { heartbeatIntervalMs: 1_000, batchSize: 10 },
        })

        const reader = stream.getReader()
        const pending = readText(reader)
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(calls).toBe(1)
        entries = [entry]
        releaseWakeup()
        const result = await pending
        await reader.cancel()

        expect(calls).toBeGreaterThanOrEqual(2)
        expect(result.text).toContain('id: event-sequence:1')
    })

    it('delivers preview completion without paths or codec diagnostics', () => {
        const event = toProjectRealtimeEvent({
            ...journalEntry({
                id: 'poster-ready',
                name: 'project.media_previews.updated',
                sequence: 1,
            }),
            subject: { type: 'project', id: 'project-1' },
            payload: { privatePath: 'not public' },
        })
        expect(event).toMatchObject({ type: 'project.media_previews.updated', payload: {} })
    })

    it('filters unsupported event versions and subject mismatches', () => {
        const unsupported = toProjectRealtimeEvent(
            journalEntry({ id: 'unsupported', name: 'publisher.secret_rotated', sequence: 1 })
        )
        const mismatched = toProjectRealtimeEvent({
            ...journalEntry({ id: 'mismatched', sequence: 2 }),
            subject: { type: 'channel', id: 'channel-1' },
        })

        expect(unsupported).toBeNull()
        expect(mismatched).toBeNull()
    })

    it('delivers taxonomy changes through the same safe project event contract', () => {
        const tagCreated = toProjectRealtimeEvent({
            ...journalEntry({ id: 'tag-created', name: 'project_tag.created', sequence: 1 }),
            subject: { type: 'project_tag', id: 'tag-1' },
        })
        const tagsReplaced = toProjectRealtimeEvent({
            ...journalEntry({
                id: 'tags-replaced',
                name: 'publication.tags_replaced',
                sequence: 2,
            }),
            subject: { type: 'publication', id: 'publication-1' },
        })

        expect(tagCreated).toMatchObject({
            type: 'project_tag.created',
            entity: { type: 'project_tag', id: 'tag-1' },
            payload: {},
        })
        expect(tagsReplaced).toMatchObject({
            type: 'publication.tags_replaced',
            entity: { type: 'publication', id: 'publication-1' },
            payload: {},
        })

        const rescheduled = toProjectRealtimeEvent(
            journalEntry({ id: 'rescheduled', name: 'publication.rescheduled', sequence: 3 })
        )
        const cancelled = toProjectRealtimeEvent(
            journalEntry({ id: 'cancelled', name: 'publication.cancelled', sequence: 4 })
        )
        expect(rescheduled).toMatchObject({ type: 'publication.rescheduled' })
        expect(cancelled).toMatchObject({ type: 'publication.cancelled' })
    })

    it('closes instead of emitting an entry returned for another project', async () => {
        const foreignEntry = journalEntry({
            id: 'foreign-event',
            projectId: 'project-2',
            sequence: 1,
        })
        const stream = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [foreignEntry] },
            after: null,
            options: { heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const result = await readText(reader)
        const terminal = await readText(reader)

        expect(result.text).toContain('event: project.resync-required')
        expect(result.text).toContain('"reason":"cursor_gap"')
        expect(result.text).not.toContain('project-2')
        expect(terminal.done).toBe(true)
    })
})

describe('ephemeral draft changes', () => {
    it('targets project subscribers and coalesces changes without durable ids', async () => {
        const runtime = createProjectRealtimeRuntime()
        const controller = new AbortController()
        const reader = createProjectEventStream({
            request: new Request('http://localhost/events', { signal: controller.signal }),
            projectId: 'project-1',
            journal: { readAfter: () => [] },
            after: null,
            projectChanges: runtime.hub,
            options: { heartbeatIntervalMs: 1000 },
        }).getReader()
        const next = readText(reader)
        runtime.hub.publishDraftChange?.({
            projectId: 'project-2',
            postId: 'foreign',
            publicationId: 'foreign',
            sourceChanged: true,
        })
        runtime.hub.publishDraftChange?.({
            projectId: 'project-1',
            postId: 'post-1',
            publicationId: 'publication-1',
            sourceChanged: true,
        })
        runtime.hub.publishDraftChange?.({
            projectId: 'project-1',
            postId: 'post-1',
            publicationId: 'publication-1',
            sourceChanged: false,
        })
        const frame = (await next).text
        expect(frame).toContain('event: project.draft-changed')
        expect(frame).toContain('"sourceChanged":true')
        expect(frame.match(/event: project.draft-changed/g)).toHaveLength(1)
        expect(frame).not.toContain('foreign')
        expect(frame).not.toContain('id:')
        await reader.cancel()
        runtime.stop()
    })

    it('checks authorization before delivering a queued draft change', async () => {
        const runtime = createProjectRealtimeRuntime()
        const reader = createProjectEventStream({
            request: new Request('http://localhost/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [] },
            after: null,
            projectChanges: runtime.hub,
            isAuthorized: () => false,
        }).getReader()
        runtime.hub.publishDraftChange?.({
            projectId: 'project-1',
            postId: 'private-post',
            publicationId: 'private-publication',
            sourceChanged: true,
        })
        const frame = (await readText(reader)).text
        expect(frame).toContain('project.access-revoked')
        expect(frame).not.toContain('private-post')
        expect(frame).not.toContain('project.draft-changed')
        expect((await readText(reader)).done).toBe(true)
        runtime.stop()
    })
})

describe('stream shutdown', () => {
    it('ends an idle project stream when the realtime runtime stops', async () => {
        const runtime = createProjectRealtimeRuntime()
        const reader = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [] },
            after: null,
            projectChanges: runtime.hub,
            options: { heartbeatIntervalMs: 60_000, batchSize: 8 },
        }).getReader()

        const opening = await reader.read()
        expect(opening.done).toBe(false)

        const terminal = reader.read()
        runtime.stop()
        const result = await Promise.race([terminal, wait(1_000).then(() => null)])

        // The stream ends on its own: nothing is left waiting for a wakeup
        // that the stopped runtime will never publish.
        expect(result?.done).toBe(true)
        expect(result?.value).toBeUndefined()
    })

    it('ends an idle user stream when the realtime runtime stops', async () => {
        const runtime = createProjectRealtimeRuntime()
        const reader = createUserEventStream({
            request: new Request('http://localhost/api/notifications/events'),
            userId: 'user-1',
            listProjectIds: () => ['project-1'],
            journal: { readAllAfter: () => [] },
            after: null,
            userChanges: runtime.userHub,
            options: { heartbeatIntervalMs: 60_000, batchSize: 8 },
        }).getReader()

        const opening = await reader.read()
        expect(opening.done).toBe(false)

        const terminal = reader.read()
        runtime.stop()
        const result = await Promise.race([terminal, wait(1_000).then(() => null)])

        expect(result?.done).toBe(true)
        expect(result?.value).toBeUndefined()
    })

    it('ends a project stream opened after the runtime stopped', async () => {
        const runtime = createProjectRealtimeRuntime()
        runtime.stop()

        const reader = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [] },
            after: null,
            projectChanges: runtime.hub,
            options: { heartbeatIntervalMs: 60_000, batchSize: 8 },
        }).getReader()

        const result = await Promise.race([reader.read(), wait(1_000).then(() => null)])

        expect(result?.done).toBe(true)
    })

    it('ends a user stream opened after the runtime stopped', async () => {
        const runtime = createProjectRealtimeRuntime()
        runtime.stop()

        const reader = createUserEventStream({
            request: new Request('http://localhost/api/notifications/events'),
            userId: 'user-1',
            listProjectIds: () => ['project-1'],
            journal: { readAllAfter: () => [] },
            after: null,
            userChanges: runtime.userHub,
            options: { heartbeatIntervalMs: 60_000, batchSize: 8 },
        }).getReader()

        const result = await Promise.race([reader.read(), wait(1_000).then(() => null)])

        expect(result?.done).toBe(true)
    })

    it('stops reading the journal and the session once the runtime stopped', async () => {
        const runtime = createProjectRealtimeRuntime()
        let reads = 0
        let checks = 0
        const reader = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: {
                readAfter: () => {
                    reads += 1
                    return []
                },
            },
            after: null,
            projectChanges: runtime.hub,
            // The authorization check yields to the event loop, so a stream that
            // kept polling after the shutdown would fail the assertions below
            // instead of starving the test runner.
            isAuthorized: async () => {
                checks += 1
                await Bun.sleep(0)
                return true
            },
            options: { heartbeatIntervalMs: 60_000, batchSize: 8 },
        }).getReader()

        await reader.read()
        const terminal = reader.read()
        await wait(20)
        const readsAtStop = reads
        const checksAtStop = checks

        runtime.stop()
        const result = await Promise.race([terminal, wait(1_000).then(() => null)])

        expect(result?.done).toBe(true)
        await wait(50)
        expect(reads).toBe(readsAtStop)
        expect(checks).toBe(checksAtStop)
    })

    it('releases the draft subscription and the shutdown subscription it holds', async () => {
        let draftUnsubscribed = false
        let shutdownUnsubscribed = false
        let notifyShutdown: () => void = () => {}
        const reader = createProjectEventStream({
            request: new Request('http://localhost/api/projects/project-1/events'),
            projectId: 'project-1',
            journal: { readAfter: () => [] },
            after: null,
            projectChanges: {
                waitForChange: () => new Promise<void>(() => {}),
                subscribeDraftChanges: () => () => {
                    draftUnsubscribed = true
                },
                subscribeShutdown: listener => {
                    notifyShutdown = listener
                    return () => {
                        shutdownUnsubscribed = true
                    }
                },
            },
            options: { heartbeatIntervalMs: 60_000, batchSize: 8 },
        }).getReader()

        await reader.read()
        const terminal = reader.read()
        notifyShutdown()
        const result = await Promise.race([terminal, wait(1_000).then(() => null)])

        expect(result?.done).toBe(true)
        expect(draftUnsubscribed).toBe(true)
        expect(shutdownUnsubscribed).toBe(true)
    })
})
