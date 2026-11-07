import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SQL } from 'bun'

import {
    closeDatabase,
    closePostgresDatabase,
    createDatabase,
    createPostgresDatabase,
    type DatabaseHandle,
} from '../client'

/**
 * Test engines for persistence parity (ADR-097, DB-611). SQLite always runs;
 * PostgreSQL runs when `POSTDOT_TEST_POSTGRES_URL` names a server where the
 * user may create databases. Each test receives its own disposable database.
 */
export interface TestEngine {
    readonly name: 'sqlite' | 'postgres'
    open(): Promise<OpenedTestDatabase>
}

export interface OpenedTestDatabase {
    readonly database: DatabaseHandle
    close(): Promise<void>
}

export const postgresTestUrl = process.env.POSTDOT_TEST_POSTGRES_URL

const sqliteEngine: TestEngine = {
    name: 'sqlite',
    async open() {
        const directory = mkdtempSync(join(tmpdir(), 'postdot-engine-'))
        const database = createDatabase(join(directory, 'test.sqlite'))
        return {
            database,
            async close() {
                closeDatabase(database)
                rmSync(directory, { recursive: true, force: true })
            },
        }
    },
}

const postgresEngine = (url: string): TestEngine => ({
    name: 'postgres',
    async open() {
        const name = `postdot_test_${crypto.randomUUID().replaceAll('-', '')}`
        const admin = new SQL(url, { max: 1 })
        await admin.unsafe(`create database ${name}`)
        const target = new URL(url)
        target.pathname = `/${name}`
        const database = createPostgresDatabase(target.toString(), { max: 4 })
        return {
            database,
            async close() {
                await closePostgresDatabase(database)
                await admin.unsafe(`drop database if exists ${name} with (force)`)
                await admin.close()
            },
        }
    },
})

export const testEngines: readonly TestEngine[] =
    postgresTestUrl === undefined ? [sqliteEngine] : [sqliteEngine, postgresEngine(postgresTestUrl)]
