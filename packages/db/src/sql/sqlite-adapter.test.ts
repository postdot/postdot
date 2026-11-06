import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    closeDatabase,
    createDatabase,
    createDatabaseTransaction,
    defineTransaction,
    recordDatabaseCommitProject,
    setDatabaseCommitObserver,
    type PostdotDatabase,
} from '../client'

let directory: string
let database: PostdotDatabase

async function values(): Promise<string[]> {
    const rows = await database.sql
        .statement<{ v: string }>('select v from items order by id')
        .all()
    return rows.map(row => row.v)
}

function insert(v: string) {
    return database.sql.statement<never, [string]>('insert into items (v) values (?1)').run(v)
}

beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'postdot-sql-port-'))
    database = createDatabase(join(directory, 'port.sqlite'))
    await database.sql.exec('create table items (id integer primary key, v text not null unique)')
})

afterEach(() => {
    closeDatabase(database)
    rmSync(directory, { recursive: true, force: true })
})

describe('SQLite persistence port', () => {
    test('isolates an open async transaction from other async flows', async () => {
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
        // Both outside operations must wait for the transaction instead of
        // seeing its uncommitted row or being absorbed into it.
        const outsideRead = values()
        const outsideWrite = insert('outside')
        await Bun.sleep(5)
        resume()
        await transaction
        expect(await outsideRead).toEqual(['inside-1', 'inside-2'])
        await outsideWrite
        expect(await values()).toEqual(['inside-1', 'inside-2', 'outside'])
    })

    test('rolls back every statement of a failed transaction', async () => {
        await expect(
            database.sql.transaction(async () => {
                await insert('a')
                await insert('a')
            })
        ).rejects.toThrow(/UNIQUE constraint failed/)
        expect(await values()).toEqual([])
        // The gate is released after a failure.
        await insert('b')
        expect(await values()).toEqual(['b'])
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

    test('serializes concurrent top-level transactions', async () => {
        const order: string[] = []
        await Promise.all(
            ['a', 'b', 'c'].map(name =>
                database.sql.transaction(async () => {
                    order.push(`begin ${name}`)
                    await insert(`${name}1`)
                    await Bun.sleep(1)
                    await insert(`${name}2`)
                    order.push(`end ${name}`)
                })
            )
        )
        expect(order).toEqual(['begin a', 'end a', 'begin b', 'end b', 'begin c', 'end c'])
    })

    test('runs after-commit callbacks only after the outermost commit', async () => {
        const events: string[] = []
        await database.sql.transaction(async () => {
            database.sql.afterCommit(() => events.push('outer'))
            await expect(
                database.sql.transaction(async () => {
                    database.sql.afterCommit(() => events.push('rolled back'))
                    throw new Error('rollback')
                })
            ).rejects.toThrow('rollback')
            await database.sql.transaction(async () => {
                database.sql.afterCommit(() => events.push('savepoint'))
            })
            events.push('before commit')
        })
        expect(events).toEqual(['before commit', 'outer', 'savepoint'])

        await database.sql
            .transaction(async () => {
                database.sql.afterCommit(() => events.push('never'))
                throw new Error('abort')
            })
            .catch(() => undefined)
        expect(events).not.toContain('never')
    })

    test('a context escaping its transaction no longer uses it', async () => {
        let escaped!: () => Promise<unknown>
        await database.sql.transaction(async () => {
            escaped = () => insert('late')
        })
        expect(database.sql.inTransaction()).toBe(false)
        await escaped()
        expect(await values()).toEqual(['late'])
    })

    test('publishes recorded projects once after an async commit', async () => {
        const published: string[][] = []
        setDatabaseCommitObserver(database, projects => published.push([...projects]))
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
    })

    test('refuses a legacy synchronous transaction while the writer is busy', async () => {
        const legacy = createDatabaseTransaction(database, () => {
            database.$client.run("insert into items (v) values ('legacy')")
        })
        await expect(
            database.sql.transaction(async () => {
                await insert('async')
                legacy.immediate()
            })
        ).rejects.toThrow('Synchronous transaction attempted while the SQLite writer is busy')
        legacy.immediate()
        expect(await values()).toEqual(['legacy'])
    })
})
