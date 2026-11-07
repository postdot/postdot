import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { SQL } from 'bun'

import {
    defineTransaction,
    recordDatabaseCommitProject,
    setDatabaseCommitObserver,
    type DatabaseHandle,
} from '../client'
import {
    acquirePostgresInstanceLock,
    closePostgresDatabase,
    createPostgresDatabase,
} from '../client'
import { isUniqueConstraintError } from './dialect'
import { postgresTestUrl, testEngines, type OpenedTestDatabase } from './test-engines'

/** Behaviour every persistence engine must provide identically (ADR-097). */
for (const engine of testEngines) {
    describe(`persistence port contract (${engine.name})`, () => {
        let opened: OpenedTestDatabase
        let database: DatabaseHandle

        const values = async (): Promise<string[]> =>
            (
                await database.sql.statement<{ v: string }>('select v from items order by id').all()
            ).map(row => row.v)
        const insert = (v: string) =>
            database.sql.statement<never, [string]>('insert into items (v) values (?1)').run(v)

        beforeEach(async () => {
            opened = await engine.open()
            database = opened.database
            await database.sql.exec(
                engine.name === 'postgres'
                    ? 'create table items (id bigserial primary key, v text not null unique, n bigint)'
                    : 'create table items (id integer primary key, v text not null unique, n integer)'
            )
        })

        afterEach(async () => {
            await opened.close()
        })

        test('runs exclusive sections one at a time per key, never inside a transaction', async () => {
            const trace: string[] = []
            const section = (key: string, label: string, pause: number) =>
                database.sql.exclusive(key, async () => {
                    trace.push(`${label}:start`)
                    await Bun.sleep(pause)
                    trace.push(`${label}:end`)
                    return label
                })
            const results = await Promise.all([
                section('credential:a', 'first', 30),
                section('credential:a', 'second', 1),
                section('credential:b', 'other', 1),
            ])
            expect(results).toEqual(['first', 'second', 'other'])
            // The same key never overlaps; another key does not wait.
            expect(trace.indexOf('second:start')).toBeGreaterThan(trace.indexOf('first:end'))
            expect(trace.indexOf('other:end')).toBeLessThan(trace.indexOf('first:end'))
            await expect(
                database.sql.transaction(() =>
                    database.sql.exclusive('credential:a', async () => 1)
                )
            ).rejects.toThrow('inside a transaction')
        })

        test('maps rows, nulls, int8 values and camelCase aliases identically', async () => {
            await database.sql
                .statement<never, [string, number]>('insert into items (v, n) values (?1, ?2)')
                .run('a', 1_793_200_000_000)
            const row = await database.sql
                .statement<{ itemValue: string; createdAt: number; missing: null }, [string]>(
                    'select v as itemValue, n as createdAt, null as missing from items where v = ?1'
                )
                .get('a')
            expect(row).toEqual({ itemValue: 'a', createdAt: 1_793_200_000_000, missing: null })
            expect(
                await database.sql.statement('select v from items where v = ?1').get('x')
            ).toBeNull()
            expect(
                await database.sql.statement('select v, n from items order by id').values()
            ).toEqual([['a', 1_793_200_000_000]])
            const iterated: unknown[] = []
            for await (const item of database.sql
                .statement<{ v: string }>('select v from items')
                .iterate())
                iterated.push(item.v)
            expect(iterated).toEqual(['a'])
        })

        test('reports changed rows and classifies unique conflicts', async () => {
            await insert('a')
            await insert('b')
            const changed = await database.sql
                .statement<never, [string]>("update items set v = v || ?1 where v in ('a', 'b')")
                .run('!')
            expect(changed.changes).toBe(2)
            const conflict = await insert('a!').catch((error: unknown) => error)
            expect(isUniqueConstraintError(conflict)).toBe(true)
        })

        test('rolls back every statement of a failed transaction', async () => {
            await expect(
                database.sql.transaction(async () => {
                    await insert('a')
                    await insert('a')
                })
            ).rejects.toThrow()
            expect(await values()).toEqual([])
            await insert('b')
            expect(await values()).toEqual(['b'])
        })

        test('never exposes a partially applied transaction to another flow', async () => {
            let reachedPause!: () => void
            const paused = new Promise<void>(resolve => {
                reachedPause = resolve
            })
            let resume!: () => void
            const held = new Promise<void>(resolve => {
                resume = resolve
            })
            const transaction = database.sql.transaction(async () => {
                await insert('inside-1')
                reachedPause()
                await held
                await insert('inside-2')
            }, 'immediate')
            await paused
            const outsideRead = values()
            await Bun.sleep(5)
            resume()
            await transaction
            // SQLite waits for the writer gate (sees the commit); PostgreSQL reads
            // the last committed snapshot. Neither may observe inside-1 alone.
            expect([[], ['inside-1', 'inside-2']]).toContainEqual(await outsideRead)
            expect(await values()).toEqual(['inside-1', 'inside-2'])
        })

        test('runs nested transactions as savepoints', async () => {
            await database.sql.transaction(async () => {
                await insert('outer')
                await expect(
                    database.sql.transaction(async () => {
                        await insert('inner')
                        throw new Error('inner failure')
                    })
                ).rejects.toThrow('inner failure')
                await database.sql.transaction(async () => {
                    await database.sql.transaction(() => insert('deep'))
                })
            })
            expect(await values()).toEqual(['outer', 'deep'])
        })

        test('refuses concurrent nested transactions in one transaction', async () => {
            await expect(
                database.sql.transaction(async () => {
                    await Promise.all([
                        database.sql.transaction(async () => {
                            await Bun.sleep(1)
                            await insert('x')
                        }),
                        database.sql.transaction(() => insert('y')),
                    ])
                })
            ).rejects.toThrow('Concurrent nested transactions are not supported')
            expect(await values()).toEqual([])
        })

        test('keeps concurrent top-level transactions atomic', async () => {
            await Promise.all(
                ['a', 'b', 'c'].map(name =>
                    database.sql.transaction(async () => {
                        await insert(`${name}1`)
                        await Bun.sleep(1)
                        await insert(`${name}2`)
                    })
                )
            )
            expect((await values()).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2'])
        })

        test('replays read-then-write transactions so concurrent writers stay serializable', async () => {
            // Each writer reads the count and inserts a row named after it. Under
            // SQLite's single writer, and PostgreSQL serializable retries, the
            // names are always distinct consecutive numbers.
            await Promise.all(
                Array.from({ length: 6 }, () =>
                    database.sql.transaction(async () => {
                        const row = await database.sql
                            .statement<{ count: number }>('select count(*) as count from items')
                            .get()
                        await Bun.sleep(2)
                        await insert(`item-${Number(row!.count)}`)
                    }, 'immediate')
                )
            )
            expect((await values()).sort()).toEqual(
                Array.from({ length: 6 }, (_, index) => `item-${index}`).sort()
            )
        })

        test('runs after-commit callbacks only after the outermost commit', async () => {
            const events: string[] = []
            await database.sql.transaction(async () => {
                database.sql.afterCommit(() => events.push('outer'))
                await expect(
                    database.sql.transaction(async () => {
                        database.sql.afterCommit(() => events.push('rolled back'))
                        database.sql.afterCommit(() => events.push('durable'), 'transaction')
                        throw new Error('rollback')
                    })
                ).rejects.toThrow('rollback')
                events.push('before commit')
            })
            expect(events).toEqual(['before commit', 'outer', 'durable'])
        })

        test('publishes recorded projects once after commit', async () => {
            const published: string[][] = []
            const clear = setDatabaseCommitObserver(database, projects =>
                published.push([...projects])
            )
            try {
                const transaction = defineTransaction(database, async (projectId: string) => {
                    recordDatabaseCommitProject(database, projectId)
                    recordDatabaseCommitProject(database, 'other')
                    await insert(projectId)
                    expect(published).toEqual([])
                    return projectId
                })
                expect(await transaction.immediate('project-1')).toBe('project-1')
                expect(published).toEqual([['project-1', 'other']])
                await transaction('project-1').catch(() => undefined)
                expect(published).toHaveLength(1)
            } finally {
                clear()
            }
        })
    })
}

describe.skipIf(postgresTestUrl === undefined)('PostgreSQL exclusive sections', () => {
    test('exclude each other across independent connection pools, as across processes', async () => {
        const first = createPostgresDatabase(postgresTestUrl!, { max: 2 })
        const second = createPostgresDatabase(postgresTestUrl!, { max: 2 })
        try {
            const trace: string[] = []
            const hold = Promise.withResolvers<void>()
            const entered = Promise.withResolvers<void>()
            const a = first.sql.exclusive('cross-process', async () => {
                trace.push('a:start')
                entered.resolve()
                await hold.promise
                trace.push('a:end')
            })
            await entered.promise
            const b = second.sql.exclusive('cross-process', async () => {
                trace.push('b:start')
            })
            await Bun.sleep(100)
            expect(trace).toEqual(['a:start'])
            hold.resolve()
            await Promise.all([a, b])
            expect(trace).toEqual(['a:start', 'a:end', 'b:start'])
        } finally {
            await closePostgresDatabase(first)
            await closePostgresDatabase(second)
        }
    })
})

describe.skipIf(postgresTestUrl === undefined)('PostgreSQL instance lock', () => {
    test('refuses a second server on the same database until the first releases', async () => {
        const first = await acquirePostgresInstanceLock(postgresTestUrl!)
        try {
            await expect(acquirePostgresInstanceLock(postgresTestUrl!)).rejects.toThrow(
                'Another Postdot server'
            )
        } finally {
            await first.close()
        }
        const again = await acquirePostgresInstanceLock(postgresTestUrl!)
        await again.close()
    })

    test('reports a lock lost with its connection', async () => {
        let lost = 0
        const lock = await acquirePostgresInstanceLock(postgresTestUrl!, {
            heartbeatMs: 50,
            onLost: () => lost++,
        })
        try {
            const admin = new SQL(postgresTestUrl!, { max: 1 })
            try {
                await admin.unsafe(
                    `select pg_terminate_backend(pid) from pg_locks
                     where locktype = 'advisory' and objsubid = 1
                       and ((classid::bigint << 32) | objid::bigint) = 7310201612`
                )
            } finally {
                await admin.close()
            }
            const deadline = Date.now() + 5_000
            while (lost === 0 && Date.now() < deadline) await Bun.sleep(20)
            expect(lost).toBe(1)
        } finally {
            await lock.close().catch(() => {})
        }
    })
})
