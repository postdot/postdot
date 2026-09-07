import { describe, expect, it } from 'bun:test'

import { parseEventJournalCursor, type EventJournalEntry } from '@herald/db'

import { createProjectRealtimeRuntime } from './realtime-runtime'

function journalEntry(input: {
    readonly id: string
    readonly projectId: string
    readonly sequence: number
}): EventJournalEntry {
    return {
        id: input.id,
        projectId: input.projectId,
        actorId: 'actor-1',
        name: 'publication.published',
        version: 1,
        subject: { type: 'publication', id: `publication-${input.id}` },
        payload: {},
        occurredAt: 1_800_000_000_000,
        correlationId: null,
        causationId: null,
        cursor: parseEventJournalCursor(`event-sequence:${input.sequence}`),
    }
}

function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

describe('project realtime runtime', () => {
    it('uses one global scan to wake only projects with new journal entries', async () => {
        let entries: readonly EventJournalEntry[] = []
        let reads = 0
        const changed: string[][] = []
        const runtime = createProjectRealtimeRuntime(
            {
                latestCursor: () => null,
                readAfterGlobal: () => {
                    reads += 1
                    const result = entries
                    entries = []
                    return result
                },
            },
            {
                pollIntervalMs: 5,
                onProjectsChanged: projectIds => changed.push([...projectIds]),
            }
        )

        const firstController = new AbortController()
        const secondController = new AbortController()
        const unrelatedController = new AbortController()
        const first = runtime.hub.waitForChange('project-1', firstController.signal)
        const second = runtime.hub.waitForChange('project-3', secondController.signal)
        let unrelatedResolved = false
        const unrelated = runtime.hub
            .waitForChange('project-2', unrelatedController.signal)
            .then(() => {
                unrelatedResolved = true
            })
        entries = [
            journalEntry({ id: 'event-1', projectId: 'project-1', sequence: 1 }),
            journalEntry({ id: 'event-2', projectId: 'project-3', sequence: 2 }),
        ]

        await Promise.race([
            Promise.all([first, second]),
            wait(250).then(() => {
                throw new Error('The realtime runtime did not wake its waiters')
            }),
        ])

        expect(reads).toBe(2)
        expect(changed).toEqual([['project-1', 'project-3']])
        await wait(10)
        expect(unrelatedResolved).toBe(false)
        runtime.stop()
        await unrelated
    })

    it('still wakes streams when the projection callback fails', async () => {
        const errors: unknown[] = []
        let releaseEntry = false
        const runtime = createProjectRealtimeRuntime(
            {
                latestCursor: () => null,
                readAfterGlobal: () =>
                    releaseEntry
                        ? [journalEntry({ id: 'event-1', projectId: 'project-1', sequence: 1 })]
                        : [],
            },
            {
                pollIntervalMs: 5,
                onProjectsChanged: () => {
                    throw new Error('projection failed')
                },
                onError: error => errors.push(error),
            }
        )

        const controller = new AbortController()
        const pending = runtime.hub.waitForChange('project-1', controller.signal)
        releaseEntry = true
        await Promise.race([
            pending,
            wait(250).then(() => {
                throw new Error('The realtime runtime did not recover from the callback failure')
            }),
        ])

        expect(errors).toHaveLength(1)
        runtime.stop()
    })

    it('resolves waiters when the runtime stops', async () => {
        const runtime = createProjectRealtimeRuntime({
            latestCursor: () => null,
            readAfterGlobal: () => [],
        })
        const pending = runtime.hub.waitForChange('project-1', new AbortController().signal)

        runtime.stop()
        await Promise.race([
            pending,
            wait(250).then(() => {
                throw new Error('The realtime runtime did not resolve on shutdown')
            }),
        ])
    })
})
