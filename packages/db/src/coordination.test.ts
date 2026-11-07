import { describe, expect, test } from 'bun:test'

import { SQL } from 'bun'

import {
    createLocalCoordination,
    createPostgresCoordination,
    type CoordinationSignal,
    type InstanceCoordination,
} from './coordination'
import { postgresTestUrl } from './sql/test-engines'

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('Condition not reached in time')
        await Bun.sleep(20)
    }
}

describe('local coordination (single instance)', () => {
    test('leads at once and delivers signals in process', async () => {
        const coordination = createLocalCoordination()
        const received: CoordinationSignal[] = []
        await coordination.subscribe({ signal: s => received.push(s), resync: () => {} })
        let acquired = false
        coordination.lead({ acquired: () => (acquired = true), lost: () => {} })
        coordination.publish({ kind: 'work' })
        expect(acquired).toBe(true)
        expect(coordination.isLeader()).toBe(true)
        expect(received).toEqual([{ kind: 'work' }])
        await coordination.close()
    })
})

describe.skipIf(postgresTestUrl === undefined)(
    'PostgreSQL coordination (several instances)',
    () => {
        test('elects one leader, hands leadership over and signals every instance', async () => {
            const instances: InstanceCoordination[] = []
            const open = () => {
                const coordination = createPostgresCoordination(postgresTestUrl!, {
                    retryMs: 50,
                    heartbeatMs: 50,
                })
                instances.push(coordination)
                return coordination
            }
            try {
                const first = open()
                const second = open()
                const received = new Map<InstanceCoordination, CoordinationSignal[]>()
                for (const instance of [first, second]) {
                    received.set(instance, [])
                    await instance.subscribe({
                        signal: s => received.get(instance)!.push(s),
                        resync: () => {},
                    })
                }
                const lost: string[] = []
                first.lead({ acquired: () => {}, lost: () => lost.push('first') })
                await waitFor(() => first.isLeader())
                second.lead({ acquired: () => {}, lost: () => lost.push('second') })
                await Bun.sleep(200)
                expect(second.isLeader()).toBe(false)

                // Large project lists are split under the NOTIFY payload limit.
                const projectIds = Array.from(
                    { length: 600 },
                    (_, i) => `project-${i}-${'x'.repeat(20)}`
                )
                first.publish({ kind: 'projects', projectIds })
                second.publish({ kind: 'work' })
                const delivered = (instance: InstanceCoordination) =>
                    received
                        .get(instance)!
                        .flatMap(s => (s.kind === 'projects' ? s.projectIds : []))
                await waitFor(
                    () =>
                        delivered(first).length === 600 &&
                        delivered(second).length === 600 &&
                        received.get(first)!.some(s => s.kind === 'work')
                )
                expect(delivered(second)).toEqual(projectIds)

                // A leader that leaves releases leadership to the other instance.
                await first.close()
                instances.shift()
                await waitFor(() => second.isLeader())
                expect(lost).toEqual([])

                // A leader whose session is cut learns it lost leadership.
                const admin = new SQL(postgresTestUrl!, { max: 1 })
                try {
                    await admin.unsafe(
                        `select pg_terminate_backend(pid) from pg_locks
                         where locktype = 'advisory' and classid = 731020162 and objsubid = 2`
                    )
                } finally {
                    await admin.close()
                }
                await waitFor(() => lost.includes('second'))
                expect(second.isLeader()).toBe(false)
            } finally {
                for (const instance of instances) await instance.close()
            }
        })
    }
)
