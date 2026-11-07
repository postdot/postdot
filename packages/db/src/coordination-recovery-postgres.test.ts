import { expect, test } from 'bun:test'

import { NextEventScheduler } from '@postdot/core'
import { SQL } from 'bun'

import { createPostgresCoordination } from './coordination'
import { postgresTestUrl } from './sql/test-engines'

test.skipIf(postgresTestUrl === undefined)(
    'an idle scheduler recovers committed work after a failed NOTIFY without a reconnect',
    async () => {
        const admin = new SQL(postgresTestUrl!, { max: 1 })
        const name = `postdot_recovery_${crypto.randomUUID().replaceAll('-', '')}`
        await admin.unsafe(`create database ${name}`)
        const url = new URL(postgresTestUrl!)
        url.pathname = `/${name}`
        const sql = new SQL(url.toString(), { max: 2 })
        const errors: unknown[] = []
        const coordination = createPostgresCoordination(url.toString(), {
            resyncMs: 100,
            onError: error => errors.push(error),
        })
        let scans = 0
        let executions = 0
        const scheduler = new NextEventScheduler({
            getNextEventAt: async () => {
                const [row] = await sql.unsafe(
                    'select min(due_at)::float8 as due from recovery_work where completed = false'
                )
                return row.due as number | null
            },
            processDueEvents: async () => {
                const rows = await sql.unsafe(
                    'update recovery_work set completed = true where completed = false returning id'
                )
                executions += rows.length
            },
            onError: error => errors.push(error),
        })
        try {
            await sql.unsafe(
                'create table recovery_work (id integer primary key, due_at bigint not null, completed boolean not null default false)'
            )
            await scheduler.start()
            expect(scheduler.scheduledAt).toBeNull()
            await coordination.subscribe({
                signal: signal => {
                    if (signal.kind === 'work' && coordination.isLeader()) void scheduler.replan()
                },
                resync: async () => {
                    scans++
                    if (coordination.isLeader()) await scheduler.replan()
                },
            })
            coordination.lead({ acquired: () => {}, lost: () => {} })
            const electionDeadline = Date.now() + 2_000
            while (!coordination.isLeader() && Date.now() < electionDeadline) await Bun.sleep(5)
            expect(coordination.isLeader()).toBe(true)
            await sql.unsafe('insert into recovery_work (id, due_at) values (1, $1)', [Date.now()])
            // PostgreSQL really rejects this payload. No successful notification or reconnect follows.
            const oversizedSignal = { kind: 'work' as const, oversized: 'x'.repeat(9_000) }
            coordination.publish(oversizedSignal)
            const deadline = Date.now() + 2_000
            while (executions === 0 && Date.now() < deadline) await Bun.sleep(10)
            expect(executions).toBe(1)
            expect(
                errors.some(
                    error =>
                        error instanceof Error && error.message.includes('payload string too long')
                )
            ).toBe(true)
            expect(scans).toBeGreaterThan(0)
            await Bun.sleep(220)
            expect(executions).toBe(1)
        } finally {
            await coordination.close()
            await scheduler.stop()
            await sql.close()
            await admin.unsafe(`drop database ${name} with (force)`)
            await admin.close()
        }
    },
    10_000
)
