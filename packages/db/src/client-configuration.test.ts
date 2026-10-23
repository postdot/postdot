import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeDatabase, createDatabase } from './client'

test('file connections choose WAL, full durability, foreign keys and a bounded busy wait', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-sqlite-policy-'))
    try {
        for (let opening = 0; opening < 2; opening++) {
            const database = createDatabase(join(directory, 'database.sqlite'))
            try {
                expect(database.$client.query('PRAGMA journal_mode').get()).toEqual({
                    journal_mode: 'wal',
                })
                expect(database.$client.query('PRAGMA synchronous').get()).toEqual({
                    synchronous: 2,
                })
                expect(database.$client.query('PRAGMA busy_timeout').get()).toEqual({
                    timeout: 5000,
                })
                expect(database.$client.query('PRAGMA foreign_keys').get()).toEqual({
                    foreign_keys: 1,
                })
            } finally {
                closeDatabase(database)
            }
        }
        const memory = createDatabase(':memory:')
        expect(memory.$client.query('PRAGMA journal_mode').get()).toEqual({
            journal_mode: 'memory',
        })
        closeDatabase(memory)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('a reader retains its snapshot while another connection commits a write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-sqlite-reader-'))
    const path = join(directory, 'database.sqlite')
    const writer = createDatabase(path)
    const reader = createDatabase(path)
    try {
        writer.$client.run('CREATE TABLE records (value INTEGER)')
        writer.$client.run('INSERT INTO records VALUES (1)')
        reader.$client.run('BEGIN')
        expect(reader.$client.query('SELECT value FROM records').get()).toEqual({ value: 1 })
        writer.$client.run('UPDATE records SET value = 2')
        expect(reader.$client.query('SELECT value FROM records').get()).toEqual({ value: 1 })
        reader.$client.run('COMMIT')
        expect(reader.$client.query('SELECT value FROM records').get()).toEqual({ value: 2 })
    } finally {
        closeDatabase(reader)
        closeDatabase(writer)
        await rm(directory, { recursive: true, force: true })
    }
})

test('a synchronous writer waits for an independent process to release its transaction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-sqlite-writer-'))
    const path = join(directory, 'database.sqlite')
    const database = createDatabase(path)
    database.$client.run('CREATE TABLE records (value INTEGER)')
    const holder = Bun.spawn(
        [
            process.execPath,
            '-e',
            `
        import { Database } from 'bun:sqlite';
        const database = new Database(process.argv[1]);
        database.run('BEGIN IMMEDIATE');
        console.log('locked');
        await Bun.stdin.text();
        await Bun.sleep(200);
        database.run('COMMIT');
        database.close();
    `,
            path,
        ],
        { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }
    )
    try {
        const output = holder.stdout.getReader()
        const ready = await output.read()
        expect(new TextDecoder().decode(ready.value)).toContain('locked')
        output.releaseLock()
        holder.stdin.write('release')
        holder.stdin.end()
        database.$client.run('INSERT INTO records VALUES (1)')
        expect(database.$client.query('SELECT value FROM records').get()).toEqual({ value: 1 })
        expect(await holder.exited).toBe(0)
    } finally {
        holder.kill()
        await holder.exited
        closeDatabase(database)
        await rm(directory, { recursive: true, force: true })
    }
})

test('a persistent competing writer times out without committing a partial write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-sqlite-timeout-'))
    const path = join(directory, 'database.sqlite')
    const database = createDatabase(path)
    const holder = new Database(path)
    try {
        database.$client.run('CREATE TABLE records (value INTEGER)')
        holder.run('BEGIN IMMEDIATE')
        const startedAt = performance.now()
        expect(() => database.$client.run('INSERT INTO records VALUES (1)')).toThrow('locked')
        const elapsed = performance.now() - startedAt
        expect(elapsed).toBeGreaterThanOrEqual(4500)
        expect(elapsed).toBeLessThan(8000)
        holder.run('ROLLBACK')
        expect(database.$client.query('SELECT * FROM records').all()).toEqual([])
    } finally {
        holder.close()
        closeDatabase(database)
        await rm(directory, { recursive: true, force: true })
    }
}, 10_000)

test('closing a connection finalizes prepared statements before the database can be replaced', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-sqlite-close-'))
    const path = join(directory, 'database.sqlite')
    const database = createDatabase(path)
    let reopened: Database | undefined
    try {
        database.$client.run('CREATE TABLE records (value INTEGER)')
        database.$client.run('INSERT INTO records VALUES (1)')
        const statement = database.$client.prepare('SELECT value FROM records')
        expect(statement.get()).toEqual({ value: 1 })
        closeDatabase(database)
        expect(() => statement.get()).toThrow()
        reopened = new Database(path)
        expect(reopened.query('PRAGMA journal_mode = DELETE').get()).toEqual({
            journal_mode: 'delete',
        })
    } finally {
        closeDatabase(database)
        reopened?.close()
        await rm(directory, { recursive: true, force: true })
    }
})
