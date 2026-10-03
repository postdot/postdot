import { describe, expect, it } from 'bun:test'

import { parseEventJournalCursor, type EventJournalEntry } from '@herald/db'

import {
    createProjectEventStream,
    createUserEventStream,
    toProjectRealtimeEvent,
    type ProjectRealtimeEventType,
} from './realtime-routes'
import { createProjectRealtimeRuntime } from './realtime-runtime'

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

async function readText(reader: { read: () => Promise<{ done: boolean; value?: Uint8Array }> }) {
    const result = await reader.read()
    return {
        done: result.done,
        text: result.value === undefined ? '' : new TextDecoder().decode(result.value),
    }
}

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
