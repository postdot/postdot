import { describe, expect, it } from 'bun:test'

import { parseEventJournalCursor, type EventJournalEntry } from '@herald/db'

import {
    createProjectEventStream,
    toProjectRealtimeEvent,
    type ProjectRealtimeEventType,
} from './realtime-routes'

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
            options: { pollIntervalMs: 1, heartbeatIntervalMs: 100, batchSize: 10 },
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
            options: { pollIntervalMs: 1, heartbeatIntervalMs: 5, batchSize: 10 },
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
            options: { pollIntervalMs: 1, heartbeatIntervalMs: 5, batchSize: 10 },
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
            options: { pollIntervalMs: 1, heartbeatIntervalMs: 100, batchSize: 10 },
        })

        const reader = stream.getReader()
        const result = await readText(reader)
        const terminal = await readText(reader)

        expect(result.text).toContain('event: project.resync-required')
        expect(result.text).toContain('"reason":"cursor_gap"')
        expect(terminal.done).toBe(true)
    })

    it('stops polling after the request is aborted', async () => {
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
            options: { pollIntervalMs: 10, heartbeatIntervalMs: 100, batchSize: 10 },
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
            options: { pollIntervalMs: 1, heartbeatIntervalMs: 100, batchSize: 10 },
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
