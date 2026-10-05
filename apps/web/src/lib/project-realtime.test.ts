import { describe, expect, test } from 'bun:test'

import {
    createProjectRealtimeClient,
    createUserRealtimeClient,
    notifyProjectAccessRevocation,
    subscribeProjectAccessRevocation,
    type ProjectRealtimeEventSourceLike,
} from '@/lib/project-realtime'

class FakeEventSource implements ProjectRealtimeEventSourceLike {
    readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()
    closed = false

    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
    }

    close(): void {
        this.closed = true
    }

    emit(type: string, data = ''): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(new MessageEvent(type, { data }))
        }
    }
}

describe('project realtime event source', () => {
    test('opens with same-origin credentials and validates project update envelopes', () => {
        const fake = new FakeEventSource()
        const signals: unknown[] = []
        const statuses: string[] = []
        const source = createProjectRealtimeClient('project-1', (url, init) => {
            expect(url).toBe('/api/projects/project-1/events')
            expect(init).toEqual({ withCredentials: true })
            return fake
        })

        const unsubscribe = source.subscribe(
            signal => signals.push(signal),
            status => statuses.push(status)
        )

        expect(statuses).toEqual(['disconnected'])
        fake.emit('open')
        expect(statuses).toEqual(['disconnected', 'connected'])

        fake.emit(
            'project.update',
            JSON.stringify({
                id: 'event-1',
                cursor: 'event-sequence:1',
                projectId: 'project-1',
                version: 1,
                type: 'publication.execution.failed',
                entity: { type: 'publication', id: 'publication-1' },
                occurredAt: 1_800_000_000_000,
                payload: {},
            })
        )
        fake.emit(
            'project.update',
            JSON.stringify({
                id: 'foreign-event',
                cursor: 'event-sequence:2',
                projectId: 'project-2',
                version: 1,
                type: 'publication.execution.failed',
                entity: { type: 'publication', id: 'publication-2' },
                occurredAt: 1_800_000_000_001,
                payload: {},
            })
        )
        fake.emit('project.update', '{invalid')

        expect(signals).toHaveLength(1)
        expect(signals[0]).toMatchObject({
            kind: 'update',
            event: {
                id: 'event-1',
                projectId: 'project-1',
                type: 'publication.execution.failed',
                payload: {},
            },
        })

        unsubscribe()
        source.close()
        expect(fake.closed).toBe(true)
    })

    test('opens the user-wide notification stream and validates project context', () => {
        const fake = new FakeEventSource()
        const signals: unknown[] = []
        const source = createUserRealtimeClient((url, init) => {
            expect(url).toBe('/api/notifications/events')
            expect(init).toEqual({ withCredentials: true })
            return fake
        })

        source.subscribe(signal => signals.push(signal))
        fake.emit(
            'user.update',
            JSON.stringify({
                id: 'event-1',
                cursor: 'event-sequence:1',
                projectId: 'project-1',
                version: 1,
                type: 'publication.execution.failed',
                entity: { type: 'publication', id: 'publication-1' },
                occurredAt: 1_800_000_000_000,
                payload: {},
            })
        )
        fake.emit(
            'user.update',
            JSON.stringify({
                id: 'event-2',
                cursor: 'event-sequence:2',
                projectId: 'project-2',
                version: 1,
                type: 'publication.execution.failed',
                entity: { type: 'publication', id: 'publication-2' },
                occurredAt: 1_800_000_000_001,
                payload: {},
            })
        )
        fake.emit('user.update', '{invalid')

        expect(signals).toHaveLength(2)
        expect(signals[0]).toMatchObject({
            kind: 'update',
            event: { id: 'event-1', projectId: 'project-1' },
        })
        expect(signals[1]).toMatchObject({
            kind: 'update',
            event: { id: 'event-2', projectId: 'project-2' },
        })
        source.close()
        expect(fake.closed).toBe(true)
    })

    test('forwards a resynchronization control event without exposing its payload as data', () => {
        const fake = new FakeEventSource()
        const signals: unknown[] = []
        const source = createProjectRealtimeClient('project-1', () => fake)
        source.subscribe(signal => signals.push(signal))

        fake.emit(
            'project.resync-required',
            JSON.stringify({ projectId: 'project-1', reason: 'cursor_gap' })
        )

        expect(signals).toEqual([{ kind: 'resync-required', reason: 'cursor_gap' }])
        source.close()
    })

    test('stops the user stream when the server revokes every project access', () => {
        const fake = new FakeEventSource()
        const signals: unknown[] = []
        const source = createUserRealtimeClient(() => fake)
        source.subscribe(signal => signals.push(signal))

        fake.emit('user.access-revoked', JSON.stringify({ reason: 'access_revoked' }))

        expect(signals).toEqual([{ kind: 'access-revoked' }])
        expect(fake.closed).toBe(true)
    })

    test('stops a project stream when the server revokes project access', () => {
        const fake = new FakeEventSource()
        const signals: unknown[] = []
        const source = createProjectRealtimeClient('project-1', () => fake)
        source.subscribe(signal => signals.push(signal))

        fake.emit(
            'project.access-revoked',
            JSON.stringify({ projectId: 'project-1', reason: 'access_revoked' })
        )

        expect(signals).toEqual([{ kind: 'access-revoked' }])
        expect(fake.closed).toBe(true)
    })

    test('accepts taxonomy invalidation events without exposing their payload', () => {
        const fake = new FakeEventSource()
        const signals: unknown[] = []
        const source = createProjectRealtimeClient('project-1', () => fake)
        source.subscribe(signal => signals.push(signal))

        fake.emit(
            'project.update',
            JSON.stringify({
                id: 'tag-created',
                cursor: 'event-sequence:1',
                projectId: 'project-1',
                version: 1,
                type: 'project_tag.created',
                entity: { type: 'project_tag', id: 'tag-1' },
                occurredAt: 1_800_000_000_000,
                payload: {},
            })
        )

        expect(signals).toMatchObject([
            { kind: 'update', event: { type: 'project_tag.created', payload: {} } },
        ])
        source.close()
    })
})

test('fans a project access revocation out to that project subscribers only', () => {
    const first: string[] = []
    const second: string[] = []
    const unsubscribeFirst = subscribeProjectAccessRevocation('project-1', () =>
        first.push('revoked')
    )
    const unsubscribeSecond = subscribeProjectAccessRevocation('project-2', () =>
        second.push('revoked')
    )

    notifyProjectAccessRevocation('project-1')
    expect(first).toEqual(['revoked'])
    expect(second).toEqual([])

    unsubscribeFirst()
    notifyProjectAccessRevocation('project-1')
    expect(first).toEqual(['revoked'])

    unsubscribeSecond()
    notifyProjectAccessRevocation('project-2')
    expect(second).toEqual([])
})

test('accepts scoped draft hints without treating them as durable events', () => {
    const fake = new FakeEventSource()
    const signals: unknown[] = []
    const source = createProjectRealtimeClient('project-1', () => fake)
    source.subscribe(signal => signals.push(signal))
    const change = {
        projectId: 'project-1',
        postId: 'post-1',
        publicationId: 'publication-1',
        sourceChanged: true,
    }
    fake.emit('project.draft-changed', JSON.stringify({ ...change, projectId: 'project-2' }))
    fake.emit('project.draft-changed', JSON.stringify({ ...change, sourceChanged: 'true' }))
    fake.emit('project.draft-changed', JSON.stringify({ ...change, postId: '' }))
    expect(signals).toEqual([])
    fake.emit(
        'project.draft-changed',
        JSON.stringify({ ...change, content: 'not forwarded', cursor: 'not durable' })
    )
    expect(signals).toEqual([{ kind: 'draft-changed', change }])
    source.close()
})
