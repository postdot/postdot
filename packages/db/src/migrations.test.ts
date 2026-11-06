import { describe, expect, it } from 'bun:test'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeDatabase, createDatabase, type PostdotDatabase } from './client'
import { defaultMigrationsFolder, runMigrations } from './migrations'
import { applyLegacyChain, legacyChainEnd } from './sql/legacy-chain'
import { loadPortableMigrations } from './sql/migrator'
import { describeSchema } from './sql/schema-introspection'

function tables(database: PostdotDatabase): string[] {
    return database.$client
        .query<{ readonly name: string }, []>(
            "select name from sqlite_master where type = 'table' order by name"
        )
        .all()
        .map(row => row.name)
}

function appliedMigrations(database: PostdotDatabase): string[] {
    return database.$client
        .query<{ readonly name: string }, []>('select name from postdot_migrations order by id')
        .all()
        .map(row => row.name)
}

async function withDatabase(run: (database: PostdotDatabase) => Promise<void>) {
    const database = createDatabase(':memory:')
    try {
        await run(database)
    } finally {
        closeDatabase(database)
    }
}

const allMigrations = loadPortableMigrations().map(migration => migration.name)

describe('database migrations', () => {
    it('creates the current schema and seeds a claimable instance', async () => {
        await withDatabase(async database => {
            expect((await runMigrations(database)).applied).toHaveLength(allMigrations.length)
            expect(tables(database)).toEqual(expect.arrayContaining(['instance_state', 'apikey']))
            expect(tables(database)).not.toContain('__drizzle_migrations')
            expect(
                database.$client
                    .query(
                        `select state, bootstrap_blocked as bootstrapBlocked
                         from instance_state where id = 'default'`
                    )
                    .get()
            ).toEqual({ state: 'claimable', bootstrapBlocked: 0 })
            expect(appliedMigrations(database)).toEqual(allMigrations)
        })
    })

    it('is idempotent and preserves the connection foreign-key setting', async () => {
        await withDatabase(async database => {
            await runMigrations(database)
            expect((await runMigrations(database)).applied).toEqual([])
            expect(database.$client.query('pragma foreign_keys').get()).toEqual({
                foreign_keys: 1,
            })
        })
    })

    it('adopts a database whose legacy chain is complete, keeping its data', async () => {
        await withDatabase(async legacy => {
            applyLegacyChain(legacy.$client)
            legacy.$client.run("insert into projects (id, name) values ('kept', 'Kept project')")

            const result = await runMigrations(legacy)

            expect(result.applied).toEqual(
                loadPortableMigrations()
                    .slice(1)
                    .map(m => `${String(m.id).padStart(4, '0')}_${m.name}`)
            )
            expect(appliedMigrations(legacy)).toEqual(allMigrations)
            expect(
                legacy.$client.query("select name from projects where id = 'kept'").get()
            ).toEqual({
                name: 'Kept project',
            })
            await withDatabase(async fresh => {
                await runMigrations(fresh)
                expect(await describeSchema(legacy)).toEqual(await describeSchema(fresh))
            })
            // A second start is a no-op.
            expect((await runMigrations(legacy)).applied).toEqual([])
        })
    })

    it('refuses an incomplete legacy chain without changing the database', async () => {
        await withDatabase(async legacy => {
            applyLegacyChain(legacy.$client, legacyChainEnd.count - 2)
            const before = await describeSchema(legacy)
            await expect(runMigrations(legacy)).rejects.toThrow('upgrades are incomplete')
            expect(tables(legacy)).not.toContain('postdot_migrations')
            expect(await describeSchema(legacy)).toEqual(before)
        })
    })

    it('refuses a legacy database whose schema drifted from the baseline', async () => {
        await withDatabase(async legacy => {
            applyLegacyChain(legacy.$client)
            legacy.$client.run('create index local_projects_name_idx on projects (name)')
            await expect(runMigrations(legacy)).rejects.toThrow('table projects')
            expect(tables(legacy)).not.toContain('postdot_migrations')
        })
    })

    it('refuses an applied migration that was modified afterwards', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'postdot-migrations-'))
        try {
            copyFileSync(
                join(defaultMigrationsFolder, '0000_baseline.sql'),
                join(folder, '0000_baseline.sql')
            )
            await withDatabase(async database => {
                await runMigrations(database, folder)
                writeFileSync(join(folder, '0000_baseline.sql'), '-- postdot:common\nselect 1;\n')
                await expect(runMigrations(database, folder)).rejects.toThrow('was modified')
            })
        } finally {
            rmSync(folder, { recursive: true, force: true })
        }
    })

    it('rolls back a migration that would leave foreign-key violations', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'postdot-migrations-'))
        try {
            copyFileSync(
                join(defaultMigrationsFolder, '0000_baseline.sql'),
                join(folder, '0000_baseline.sql')
            )
            writeFileSync(
                join(folder, '0001_dangling.sql'),
                `-- postdot:common
                 create table migration_probe (id text primary key);
                 insert into actors (id, project_id, kind, subject_id, display_name)
                 values ('dangling', 'missing-project', 'human', 'nobody', 'Nobody');`
            )
            await withDatabase(async database => {
                await expect(runMigrations(database, folder)).rejects.toThrow(
                    'foreign-key violations'
                )
                expect(tables(database)).not.toContain('migration_probe')
                expect(appliedMigrations(database)).toEqual(['baseline'])
                expect(database.$client.query('pragma foreign_keys').get()).toEqual({
                    foreign_keys: 1,
                })
            })
        } finally {
            rmSync(folder, { recursive: true, force: true })
        }
    })

    it('refuses to run inside a caller transaction', async () => {
        await withDatabase(async database => {
            await database.sql.transaction(async () => {
                await expect(runMigrations(database)).rejects.toThrow('their own transaction')
            })
        })
    })
})
