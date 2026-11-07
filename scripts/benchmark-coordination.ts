import { parseArgs } from 'node:util'

import { SQL } from 'bun'

import { createPostgresCoordination } from '../packages/db/src/coordination'

const { values } = parseArgs({ options: { 'resync-ms': { type: 'string', default: '30000' } } })
const resyncMs = Number(values['resync-ms'])
if (!Number.isSafeInteger(resyncMs) || resyncMs < 50 || resyncMs > 60_000)
    throw new Error('resync-ms must be between 50 and 60000')
const source = process.env.POSTDOT_TEST_POSTGRES_URL
if (!source) throw new Error('POSTDOT_TEST_POSTGRES_URL must permit disposable database creation')
const admin = new SQL(source, { max: 1 })
const name = `postdot_signal_benchmark_${crypto.randomUUID().replaceAll('-', '')}`
await admin.unsafe(`create database ${name}`)
const target = new URL(source)
target.pathname = `/${name}`
const sql = new SQL(target.toString(), { max: 1 })
const errors: string[] = []
const open = () =>
    createPostgresCoordination(target.toString(), {
        resyncMs,
        onError: error => errors.push(error instanceof Error ? error.message : String(error)),
    })
const first = open()
const second = open()
const latencies = new Map<number, number>()
const sent = new Map<number, number>()
let recoveredAt: number | undefined
let recoveryReads = 0
async function waitFor(condition: () => boolean, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
        if (Date.now() > deadline) return false
        await Bun.sleep(5)
    }
    return true
}
const bursts = []
let firstClosed = false
try {
    await sql.unsafe('create table pending_work (id integer primary key)')
    await first.subscribe({ signal: () => {}, resync: () => {} })
    await second.subscribe({
        signal: signal => {
            if (signal.kind !== 'draft') return
            const id = signal.change.id as number
            const start = sent.get(id)
            if (start !== undefined && !latencies.has(id))
                latencies.set(id, performance.now() - start)
        },
        resync: async () => {
            recoveryReads++
            const rows = await sql.unsafe('select id from pending_work')
            if (rows.length && recoveredAt === undefined) recoveredAt = performance.now()
        },
    })
    first.lead({ acquired: () => {}, lost: () => {} })
    if (!(await waitFor(() => first.isLeader(), 5_000))) throw new Error('Leader not elected')
    second.lead({ acquired: () => {}, lost: () => {} })
    let sequence = 0
    for (const count of [1, 100, 1_000]) {
        latencies.clear()
        sent.clear()
        const started = performance.now()
        for (let i = 0; i < count; i++) {
            const id = sequence++
            sent.set(id, performance.now())
            first.publish({ kind: 'draft', change: { id } })
        }
        await waitFor(() => latencies.size === count, 10_000)
        const ordered = [...latencies.values()].sort((a, b) => a - b)
        bursts.push({
            count,
            delivered: latencies.size,
            elapsedMs: performance.now() - started,
            p50Ms: ordered[Math.floor(ordered.length * 0.5)] ?? null,
            p95Ms: ordered[Math.floor(ordered.length * 0.95)] ?? null,
        })
    }
    const releasedAt = performance.now()
    await first.close()
    firstClosed = true
    if (!(await waitFor(() => second.isLeader(), 5_000)))
        throw new Error('Follower did not take leadership')
    const failoverMs = performance.now() - releasedAt
    await sql.unsafe('insert into pending_work values (1)')
    const committedAt = performance.now()
    // Deliberately omit the notification; only the periodic recovery can see this row.
    const recovered = await waitFor(() => recoveredAt !== undefined, resyncMs + 5_000)
    console.log(
        JSON.stringify(
            {
                runtime: Bun.version,
                bursts,
                failoverMs,
                recovery: {
                    resyncMs,
                    recovered,
                    delayMs: recoveredAt === undefined ? null : recoveredAt - committedAt,
                    recoveryReads,
                },
                errors,
                scope: 'Two local coordination clients, notification bursts, graceful leader release, and a committed marker without notification; not full API or cross-region latency.',
            },
            null,
            2
        )
    )
} finally {
    if (!firstClosed) await first.close()
    await second.close()
    await sql.close()
    await admin.unsafe(`drop database ${name} with (force)`)
    await admin.close()
}
