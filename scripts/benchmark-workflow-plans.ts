// cspell:ignore autovacuum
import { cpus } from 'node:os'
import { parseArgs } from 'node:util'

import { createWorkflowStore, runMigrations } from '../packages/db/src'
import { testEngines } from '../packages/db/src/sql/test-engines'
import { seedWorkflowBenchmark } from './fixtures/workflow-benchmark'

// Capture the actual store SQL, then EXPLAIN it in rollback-only transactions.
// This command only opens a new disposable database, never the application's DB.
const { values } = parseArgs({ options: { backlog: { type: 'string', default: '10000' } } })
const backlog = Number(values.backlog)
if (!Number.isInteger(backlog) || backlog < 100 || backlog > 100_000)
    throw new Error('backlog must be between 100 and 100000')
const engine = testEngines.find(engine => engine.name === 'postgres')
if (!engine) throw new Error('POSTDOT_TEST_POSTGRES_URL is required (disposable databases only)')
const opened = await engine.open()
const database = opened.database
const statements: string[] = []
const plans = []
try {
    await runMigrations(database)
    // Freeze automatic statistics only in this controlled experiment, so all initial plans
    // see the same absent statistics. This is not an installation recommendation.
    const tables = await database.sql
        .statement<{ name: string }>(
            "select tablename as name from pg_tables where schemaname = 'public'"
        )
        .all()
    for (const table of tables) {
        if (!/^[a-z_][a-z0-9_]*$/.test(table.name)) throw new Error('Unexpected fixture table name')
        await database.sql.exec(`ALTER TABLE "${table.name}" SET (autovacuum_enabled = false)`)
    }
    await seedWorkflowBenchmark(database, backlog)
    const sql = new Proxy(database.sql, {
        get(target, property) {
            if (property === 'statement')
                return (query: string) => {
                    statements.push(query)
                    return target.statement(query)
                }
            const value = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
    })
    createWorkflowStore({ sql })
    const claim = statements.find(query => /update jobs\s+set state = 'running'/.test(query))
    const discover = statements.find(query => /select min\(event_at\) as eventAt/.test(query))
    if (!claim || !discover) throw new Error('Workflow statement capture failed')
    const now = Date.now()
    const queries = [
        { name: 'claim', sql: claim, params: ['probe-claim', 'system', now, now + 60_000] },
        { name: 'next-event', sql: discover, params: [] },
    ]
    for (const statistics of ['initial', 'analyzed']) {
        if (statistics === 'analyzed') await database.sql.exec('ANALYZE')
        for (const jit of ['on', 'off']) {
            for (const query of queries) {
                let plan: unknown
                const rollback = Symbol('rollback explanation')
                try {
                    await database.sql.transaction(async () => {
                        await database.sql.exec(`SET LOCAL jit = ${jit}`)
                        await database.sql.exec("SET LOCAL statement_timeout = '120s'")
                        plan = await database.sql
                            .statement(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`)
                            .all(...query.params)
                        throw rollback
                    })
                } catch (error) {
                    if (error !== rollback) throw error
                }
                plans.push({ statistics, jit, ...query, plan })
                console.error(`${statistics}, jit=${jit}, ${query.name}: captured`)
            }
        }
    }
    const settings = await database.sql
        .statement(
            "select version(), current_setting('fsync') as fsync, current_setting('synchronous_commit') as synchronous_commit, current_setting('jit') as jit"
        )
        .get()
    console.log(
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                runtime: Bun.version,
                cpu: cpus()[0]?.model,
                backlog,
                settings,
                scope: 'Real workflow SQL; synthetic fixture with all jobs due; rollback after each EXPLAIN ANALYZE. Automatic statistics disabled only on disposable tables, then explicit ANALYZE. EXPLAIN adds instrumentation overhead. Initial/analyzed and JIT on/off share the same data; page caches are not reset.',
                plans,
            },
            null,
            2
        )
    )
} finally {
    await opened.close()
}
