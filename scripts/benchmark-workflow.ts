import { cpus, totalmem } from 'node:os'
import { parseArgs } from 'node:util'

import { createExponentialRetryPolicy, processNextWorkflowEvent } from '../packages/core/src'
import { createWorkflowStore, runMigrations } from '../packages/db/src'
import { testEngines } from '../packages/db/src/sql/test-engines'
import { seedWorkflowBenchmark } from './fixtures/workflow-benchmark'

// Each case owns a fresh on-disk SQLite file or disposable PostgreSQL database.
// Never reads application credentials or opens an operator database.
const { values } = parseArgs({
    options: {
        samples: { type: 'string', default: '30' },
        'cold-statistics': { type: 'boolean', default: false },
    },
})
const samples = Number(values.samples)
if (!Number.isSafeInteger(samples) || samples < 10 || samples > 1_000)
    throw new Error('samples must be between 10 and 1000')
const cases = [
    { backlog: 100, concurrency: 1, effectMs: 0 },
    { backlog: 1_000, concurrency: 1, effectMs: 0 },
    { backlog: 10_000, concurrency: 1, effectMs: 0 },
    { backlog: 1_000, concurrency: 4, effectMs: 0 },
    { backlog: 1_000, concurrency: 1, effectMs: 100 },
    { backlog: 1_000, concurrency: 4, effectMs: 100 },
]
const percentile = (values: number[], fraction: number) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null
}
const results = []
let postgresSettings: Record<string, unknown> | null = null
for (const engine of testEngines) {
    for (const scenario of cases) {
        const opened = await engine.open()
        try {
            if (engine.name === 'postgres' && postgresSettings === null) {
                postgresSettings =
                    (await opened.database.sql
                        .statement<Record<string, unknown>>(
                            "select version() as version, current_setting('fsync') as fsync, current_setting('synchronous_commit') as synchronous_commit, current_setting('jit') as jit"
                        )
                        .get()) ?? null
            }
            await runMigrations(opened.database)
            await seedWorkflowBenchmark(opened.database, Math.max(samples, scenario.backlog))
            if (!values['cold-statistics']) await opened.database.sql.statement('ANALYZE').run()
            const store = createWorkflowStore(opened.database)
            const durations: number[] = []
            const errors: string[] = []
            let next = 0
            let published = 0
            let empty = 0
            const started = performance.now()
            const cpu = process.cpuUsage()
            await Promise.all(
                Array.from({ length: scenario.concurrency }, async () => {
                    while (next++ < samples) {
                        const before = performance.now()
                        try {
                            const result = await processNextWorkflowEvent({
                                store,
                                actorId: 'system',
                                leaseDuration: 60_000,
                                retryPolicy: createExponentialRetryPolicy({
                                    maxAttempts: 3,
                                    initialDelay: 1_000,
                                    maximumDelay: 60_000,
                                }),
                                createClaimToken: () => crypto.randomUUID(),
                                performExternalEffect: async job => {
                                    if (scenario.effectMs) await Bun.sleep(scenario.effectMs)
                                    return { type: 'published', externalId: `benchmark-${job.id}` }
                                },
                            })
                            if (result.outcome === 'published') published++
                            else empty++
                        } catch (error) {
                            errors.push(error instanceof Error ? error.message : String(error))
                        }
                        durations.push(performance.now() - before)
                    }
                })
            )
            const elapsedMs = performance.now() - started
            const usedCpu = process.cpuUsage(cpu)
            const [state] = await opened.database.sql
                .statement<{ pending: number; running: number }>(
                    "select sum(case when state = 'pending' then 1 else 0 end) as pending, sum(case when state = 'running' then 1 else 0 end) as running from jobs"
                )
                .all()
            const result = {
                engine: engine.name,
                ...scenario,
                samples,
                published,
                empty,
                errors: errors.length,
                errorExamples: [...new Set(errors)].slice(0, 3),
                elapsedMs,
                jobsPerSecond: (published * 1_000) / elapsedMs,
                sampleDurationsMs: durations,
                firstMs: durations[0] ?? null,
                p50Ms: percentile(durations, 0.5),
                p95Ms: percentile(durations, 0.95),
                cpuMs: (usedCpu.user + usedCpu.system) / 1_000,
                rssBytes: process.memoryUsage().rss,
                remaining: state,
            }
            results.push(result)
            console.error(JSON.stringify(result))
        } finally {
            await opened.close()
        }
    }
}
console.log(
    JSON.stringify(
        {
            generatedAt: new Date().toISOString(),
            warmups: 0,
            statistics: values['cold-statistics']
                ? 'No explicit ANALYZE after bulk seed'
                : 'ANALYZE after bulk seed',
            postgresSettings,
            runtime: Bun.version,
            cpu: cpus()[0]?.model,
            logicalCpus: cpus().length,
            memoryBytes: totalmem(),
            samples,
            scope: 'Real workflow persistence and executor; synthetic effects; no HTTP, media, provider rate limits or full API worker admission. One project/channel; burst drain including cold plans, not an arrival-rate load test. Four-consumer cases deliberately bypass the API limit of one active job per project (two projects globally). CPU/RSS cover the Bun client, not the database server.',
            results,
        },
        null,
        2
    )
)
