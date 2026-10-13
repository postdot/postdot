import { describe, expect, it } from 'bun:test'

import type { ReconcileMediaResult } from '@postbot/db'

import { createMediaReconciliationRuntime } from './runtime'

describe('media runtime maintenance', () => {
    it('reconciles periodically, avoids overlapping runs, and stops cleanly', async () => {
        let calls = 0
        let release: (() => void) | undefined
        const media = {
            reconcile: () => {
                calls += 1
                return new Promise<ReconcileMediaResult>(resolve => {
                    release = () =>
                        resolve({ expiredUploads: 0, missingObjects: 0, deletedAssets: 0 })
                })
            },
        }
        const runtime = createMediaReconciliationRuntime(media, { intervalMs: 5 })

        expect(runtime.state).toBe('idle')
        runtime.start()
        runtime.start()
        expect(runtime.state).toBe('started')
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(calls).toBe(1)
        expect(runtime.state).toBe('running')

        release?.()
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(calls).toBe(2)
        expect(runtime.state).toBe('running')
        release?.()
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(runtime.state).toBe('running')

        runtime.stop()
        expect(runtime.state).toBe('stopped')
        const callsAfterStop = calls
        await new Promise(resolve => setTimeout(resolve, 15))
        expect(calls).toBe(callsAfterStop)
    })

    it('waits for an in-flight reconciliation before completing shutdown', async () => {
        let calls = 0
        let release: (() => void) | undefined
        let reconciliationStarted: (() => void) | undefined
        const started = new Promise<void>(resolve => {
            reconciliationStarted = resolve
        })
        const runtime = createMediaReconciliationRuntime(
            {
                reconcile: () => {
                    calls += 1
                    reconciliationStarted?.()
                    return new Promise<ReconcileMediaResult>(resolve => {
                        release = () =>
                            resolve({ expiredUploads: 0, missingObjects: 0, deletedAssets: 0 })
                    })
                },
            },
            { intervalMs: 5 }
        )

        runtime.start()
        await started

        let stopped = false
        const shutdown = runtime.stop().then(() => {
            stopped = true
        })

        await Promise.resolve()
        expect(stopped).toBe(false)
        expect(runtime.state).toBe('stopped')
        expect(calls).toBe(1)

        release?.()
        await shutdown

        expect(stopped).toBe(true)
        expect(runtime.state).toBe('stopped')
    })

    it('marks failed reconciliation and can recover when restarted', async () => {
        let calls = 0
        const failure = new Error('storage unavailable')
        const errors: unknown[] = []
        const runtime = createMediaReconciliationRuntime(
            {
                reconcile: async () => {
                    calls += 1
                    if (calls === 1) throw failure
                    return { expiredUploads: 0, missingObjects: 0, deletedAssets: 0 }
                },
            },
            { intervalMs: 50, onError: error => errors.push(error) }
        )

        runtime.start()
        await new Promise(resolve => setTimeout(resolve, 70))
        expect(runtime.state).toBe('failed')
        expect(errors).toEqual([failure])

        runtime.stop()
        runtime.start()
        expect(runtime.state).toBe('recovering')
        await new Promise(resolve => setTimeout(resolve, 70))
        expect(runtime.state).toBe('started')
        expect(calls).toBe(2)

        runtime.stop()
    })

    it('rejects an invalid reconciliation interval', () => {
        expect(() =>
            createMediaReconciliationRuntime(
                {
                    reconcile: async () => ({
                        expiredUploads: 0,
                        missingObjects: 0,
                        deletedAssets: 0,
                    }),
                },
                { intervalMs: 0 }
            )
        ).toThrow('Media reconciliation interval')
    })
})
