import { describe, expect, it } from 'bun:test'

import type { ReconcileMediaResult } from '@herald/db'

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

        runtime.start()
        runtime.start()
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(calls).toBe(1)

        release?.()
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(calls).toBe(2)
        release?.()

        runtime.stop()
        const callsAfterStop = calls
        await new Promise(resolve => setTimeout(resolve, 15))
        expect(calls).toBe(callsAfterStop)
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
