import { describe, expect, it } from 'bun:test'

import { createNotificationProjectionRuntime } from './runtime'

describe('notification projection runtime', () => {
    it('drains bounded batches and exposes lifecycle state', async () => {
        let calls = 0
        const runtime = createNotificationProjectionRuntime(
            {
                listProjectIds: () => ['project-1'],
                project: () => ({
                    scanned: 1,
                    created: 0,
                    hasMore: ++calls < 3,
                }),
            },
            { intervalMs: 60_000 }
        )

        runtime.start()
        await Promise.resolve()
        expect(calls).toBe(3)
        expect(runtime.state).toBe('started')
        runtime.stop()
        expect(runtime.state).toBe('stopped')
    })

    it('reports failure and recovers on a later run', () => {
        let fail = true
        const errors: unknown[] = []
        const runtime = createNotificationProjectionRuntime(
            {
                listProjectIds: () => {
                    if (fail) throw new Error('database unavailable')
                    return []
                },
                project: () => ({ scanned: 0, created: 0, hasMore: false }),
            },
            { onError: error => errors.push(error) }
        )

        runtime.runNow()
        expect(runtime.state).toBe('failed')
        expect(errors).toHaveLength(1)
        fail = false
        runtime.runNow()
        expect(runtime.state).toBe('idle')
    })

    it('rejects invalid intervals', () => {
        expect(() =>
            createNotificationProjectionRuntime(
                {
                    listProjectIds: () => [],
                    project: () => ({ scanned: 0, created: 0, hasMore: false }),
                },
                { intervalMs: 0 }
            )
        ).toThrow('positive safe integer')
    })

    it('does not run queued startup work after an immediate stop', async () => {
        let calls = 0
        const runtime = createNotificationProjectionRuntime(
            {
                listProjectIds: () => {
                    calls += 1
                    return []
                },
                project: () => ({ scanned: 0, created: 0, hasMore: false }),
            },
            { intervalMs: 60_000 }
        )

        runtime.start()
        runtime.stop()
        await Promise.resolve()
        expect(calls).toBe(0)
        expect(runtime.state).toBe('stopped')
    })
})
