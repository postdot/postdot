import { describe, expect, it } from 'bun:test'

import { createNotificationProjectionRuntime } from './runtime'

describe('notification projection runtime', () => {
    it('waits for an in-flight projection before completing shutdown', async () => {
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const runtime = createNotificationProjectionRuntime({
            listProjectIds: async () => ['project-1'],
            async project() {
                entered.resolve()
                await release.promise
                return { scanned: 1, created: 1, hasMore: false }
            },
        })
        runtime.start()
        await entered.promise
        let stopped = false
        const stopping = runtime.stop().then(() => {
            stopped = true
        })
        await Promise.resolve()
        expect(stopped).toBe(false)
        release.resolve()
        await stopping
        expect(runtime.state).toBe('stopped')
    })

    it('drains bounded batches and exposes lifecycle state', async () => {
        let calls = 0
        const runtime = createNotificationProjectionRuntime(
            {
                listProjectIds: async () => ['project-1'],
                project: async () => ({
                    scanned: 1,
                    created: 0,
                    hasMore: ++calls < 3,
                }),
            },
            { intervalMs: 60_000 }
        )

        runtime.start()
        await runtime.runNow()
        expect(calls).toBeGreaterThanOrEqual(3)
        expect(runtime.state).toBe('started')
        await runtime.stop()
        expect(runtime.state).toBe('stopped')
    })

    it('continues projecting after the per-run batch budget is reached', async () => {
        let calls = 0
        const runtime = createNotificationProjectionRuntime({
            listProjectIds: async () => ['project-1'],
            project: async () => ({
                scanned: 1,
                created: 0,
                hasMore: ++calls < 25,
            }),
        })

        runtime.start()
        await new Promise(resolve => setTimeout(resolve, 25))

        expect(calls).toBe(25)
        expect(runtime.state).toBe('started')
        await runtime.stop()
    })

    it('reports failure and recovers on a later run', async () => {
        let fail = true
        const errors: unknown[] = []
        const runtime = createNotificationProjectionRuntime(
            {
                listProjectIds: async () => {
                    if (fail) throw new Error('database unavailable')
                    return []
                },
                project: async () => ({ scanned: 0, created: 0, hasMore: false }),
            },
            { onError: error => errors.push(error) }
        )

        await runtime.runNow()
        expect(runtime.state).toBe('failed')
        expect(errors).toHaveLength(1)
        fail = false
        await runtime.runNow()
        expect(runtime.state).toBe('idle')
    })

    it('rejects invalid intervals', () => {
        expect(() =>
            createNotificationProjectionRuntime(
                {
                    listProjectIds: async () => [],
                    project: async () => ({ scanned: 0, created: 0, hasMore: false }),
                },
                { intervalMs: 0 }
            )
        ).toThrow('positive safe integer')
    })

    it('does not run queued startup work after an immediate stop', async () => {
        let calls = 0
        const runtime = createNotificationProjectionRuntime(
            {
                listProjectIds: async () => {
                    calls += 1
                    return []
                },
                project: async () => ({ scanned: 0, created: 0, hasMore: false }),
            },
            { intervalMs: 60_000 }
        )

        runtime.start()
        await runtime.stop()
        await Promise.resolve()
        expect(calls).toBe(0)
        expect(runtime.state).toBe('stopped')
    })
})
