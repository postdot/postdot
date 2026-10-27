import { describe, expect, it } from 'bun:test'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

import { closeDatabase, createDatabase } from './client'
import { defaultMigrationsFolder, runMigrations, rehearseMigrations } from './migrations'

const journal = JSON.parse(
    readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')
) as { entries: { tag: string }[] }

function listTables(database: ReturnType<typeof createDatabase>): string[] {
    return database.$client
        .query<{ readonly name: string }, []>(
            `select name from sqlite_master where type = 'table' order by name`
        )
        .all()
        .map(row => row.name)
}

describe('database migrations', () => {
    it('creates the current schema and seeds a claimable instance', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const tables = listTables(database)

            expect(tables).toContain('installation_email_settings')
            expect(tables).toContain('instance_state')
            expect(tables).toContain('instance_access_invitations')
            expect(tables).toContain('organization')
            expect(tables).toContain('member')
            expect(tables).toContain('team')
            expect(tables).toContain('team_member')
            expect(tables).toContain('workspaces')
            expect(tables).toContain('apikey')
            expect(tables).toContain('user_avatars')
            expect(tables).toContain('publication_approval_requests')
            expect(tables).not.toContain('project_memberships')
            expect(tables).not.toContain('access_invitations')
            expect(tables).not.toContain('project_access_tokens')
            expect(tables).not.toContain('access_legacy_retirement')

            const accountColumns = database.$client
                .query<{ readonly name: string; readonly notnull: number }, []>(
                    'PRAGMA table_info(account)'
                )
                .all()
            expect(accountColumns.find(column => column.name === 'issuer')?.notnull).toBe(0)

            expect(
                database.$client
                    .query<{ readonly state: string; readonly bootstrapBlocked: number }, []>(
                        `select state, bootstrap_blocked as bootstrapBlocked
                         from instance_state where id = 'default'`
                    )
                    .get()
            ).toEqual({ state: 'claimable', bootstrapBlocked: 0 })
            expect(
                database.$client
                    .query<{ readonly count: number }, []>(
                        'select count(*) as count from __drizzle_migrations'
                    )
                    .get()
            ).toEqual({ count: journal.entries.length })
        } finally {
            closeDatabase(database)
        }
    })

    it('is idempotent and preserves the connection foreign-key setting', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            runMigrations(database)

            expect(
                database.$client
                    .query<{ readonly foreign_keys: number }, []>('PRAGMA foreign_keys')
                    .get()
            ).toEqual({ foreign_keys: 1 })
            expect(
                database.$client
                    .query<{ readonly count: number }, []>(
                        'select count(*) as count from __drizzle_migrations'
                    )
                    .get()
            ).toEqual({ count: journal.entries.length })
        } finally {
            closeDatabase(database)
        }
    })

    it('keeps the committed migration folder in generated order', () => {
        const files = [...new Bun.Glob('*.sql').scanSync({ cwd: defaultMigrationsFolder })].sort()
        expect(files).toEqual(journal.entries.map(entry => `${entry.tag}.sql`))
        for (const [index, file] of files.entries())
            expect(file).toMatch(new RegExp(`^${String(index).padStart(4, '0')}_.+\\.sql$`))
    })
})

it('rolls back schema, data and migration history when foreign-key validation fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-migration-atomic-'))
    const filename = join(directory, 'preserved.sqlite')
    const database = createDatabase(filename)
    try {
        mkdirSync(join(directory, 'meta'))
        const entry = (idx: number, tag: string) => ({
            idx,
            version: '6',
            when: idx + 1,
            tag,
            breakpoints: true,
        })
        writeFileSync(
            join(directory, 'meta/_journal.json'),
            JSON.stringify({ version: '7', dialect: 'sqlite', entries: [entry(0, '0000_base')] })
        )
        writeFileSync(
            join(directory, '0000_base.sql'),
            "create table migration_parent (id text primary key, label text not null);--> statement-breakpoint\ninsert into migration_parent values ('parent','preserve');"
        )
        // Start from the official runner's persisted history, as an existing
        // installation does. Reopening below proves rollback survives shutdown.
        migrate(database, { migrationsFolder: directory })
        const before = database.$client.query('select * from __drizzle_migrations').all()
        writeFileSync(
            join(directory, 'meta/_journal.json'),
            JSON.stringify({
                version: '7',
                dialect: 'sqlite',
                entries: [entry(0, '0000_base'), entry(1, '0001_invalid')],
            })
        )
        writeFileSync(
            join(directory, '0001_invalid.sql'),
            "update migration_parent set label = 'changed';--> statement-breakpoint\ncreate table migration_child (id text primary key, parent_id text references migration_parent(id));--> statement-breakpoint\ninsert into migration_child values ('child','missing');"
        )
        expect(() => runMigrations(database, directory)).toThrow(/foreign.key/i)
        expect(database.$client.query('select label from migration_parent').get()).toEqual({
            label: 'preserve',
        })
        expect(database.$client.query('select * from __drizzle_migrations').all()).toEqual(before)
        expect(listTables(database)).not.toContain('migration_child')
        expect(database.$client.query('pragma foreign_keys').get()).toEqual({ foreign_keys: 1 })
        closeDatabase(database)
        const reopened = createDatabase(filename)
        try {
            expect(reopened.$client.query('select label from migration_parent').get()).toEqual({
                label: 'preserve',
            })
            expect(reopened.$client.query('select * from __drizzle_migrations').all()).toEqual(
                before
            )
            expect(listTables(reopened)).not.toContain('migration_child')
            expect(reopened.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(reopened)
        }
    } finally {
        closeDatabase(database)
        rmSync(directory, { recursive: true, force: true })
    }
})

it('rehearses a successful upgrade, checks its data, rolls it back and can then apply it normally', () => {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-migration-rehearsal-'))
    const database = createDatabase(':memory:')
    try {
        mkdirSync(join(directory, 'meta'))
        writeFileSync(
            join(directory, 'meta/_journal.json'),
            JSON.stringify({
                version: '7',
                dialect: 'sqlite',
                entries: [{ idx: 0, version: '6', when: 1, tag: '0000_valid', breakpoints: true }],
            })
        )
        writeFileSync(
            join(directory, '0000_valid.sql'),
            "create table migration_parent (id text primary key);--> statement-breakpoint\ninsert into migration_parent values ('preserved');"
        )
        let checks = 0
        const verify = () => {
            expect(database.$client.query('select * from migration_parent').all()).toEqual([
                { id: 'preserved' },
            ])
            checks++
        }
        const report = rehearseMigrations(database, directory, { verify })
        expect(report.pending).toHaveLength(1)
        expect(report.pending[0]!.hash).toMatch(/^[a-f0-9]{64}$/)
        expect(checks).toBe(1)
        expect(listTables(database)).not.toContain('migration_parent')
        expect(listTables(database)).not.toContain('__drizzle_migrations')
        expect(database.$client.query('pragma foreign_keys').get()).toEqual({ foreign_keys: 1 })
        runMigrations(database, directory, { verify })
        expect(checks).toBe(2)
        expect(rehearseMigrations(database, directory).pending).toEqual([])
        expect(
            database.$client.query('select count(*) as count from __drizzle_migrations').get()
        ).toEqual({ count: 1 })
    } finally {
        closeDatabase(database)
        rmSync(directory, { recursive: true, force: true })
    }
})

it('runs ownership preflight before schema writes and rolls back failed domain preservation checks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-migration-checks-'))
    const database = createDatabase(':memory:')
    try {
        mkdirSync(join(directory, 'meta'))
        writeFileSync(
            join(directory, 'meta/_journal.json'),
            JSON.stringify({
                version: '7',
                dialect: 'sqlite',
                entries: [{ idx: 0, version: '6', when: 1, tag: '0000_valid', breakpoints: true }],
            })
        )
        writeFileSync(
            join(directory, '0000_valid.sql'),
            'create table migration_marker (id text primary key);'
        )
        expect(() =>
            runMigrations(database, directory, {
                preflight: () => {
                    throw new Error('Workspace ownership requires explicit resolution')
                },
            })
        ).toThrow('Workspace ownership requires explicit resolution')
        expect(listTables(database)).not.toContain('__drizzle_migrations')
        expect(() =>
            runMigrations(database, directory, {
                verify: () => {
                    throw new Error('Selected target changed')
                },
            })
        ).toThrow('Selected target changed')
        expect(listTables(database)).not.toContain('migration_marker')
        expect(listTables(database)).not.toContain('__drizzle_migrations')
        database.$client.run('pragma foreign_keys=off')
        expect(() =>
            rehearseMigrations(database, directory, {
                verify: () => {
                    throw new Error('Preservation failed')
                },
            })
        ).toThrow('Preservation failed')
        expect(database.$client.query('pragma foreign_keys').get()).toEqual({ foreign_keys: 0 })
        expect(listTables(database)).not.toContain('migration_marker')
    } finally {
        closeDatabase(database)
        rmSync(directory, { recursive: true, force: true })
    }
})

it('refuses a nested migration without changing its caller transaction or foreign-key policy', () => {
    const database = createDatabase(':memory:')
    try {
        database.$client
            .transaction(() => {
                expect(() => runMigrations(database)).toThrow('own transaction')
                expect(() => rehearseMigrations(database)).toThrow('own transaction')
                expect(database.$client.inTransaction).toBe(true)
                expect(database.$client.query('pragma foreign_keys').get()).toEqual({
                    foreign_keys: 1,
                })
            })
            .immediate()
    } finally {
        closeDatabase(database)
    }
})
