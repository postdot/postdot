import { fileURLToPath } from 'node:url'

import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { PostbotDatabase } from './client'

export const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

export interface MigrationChecks {
    /** Runs under the migration transaction before any schema/history changes. */
    readonly preflight?: (database: PostbotDatabase) => void
    /** Checks domain preservation after SQL/FK checks, before committing. */
    readonly verify?: (database: PostbotDatabase) => void
}

export interface MigrationRehearsal {
    readonly pending: readonly { readonly hash: string; readonly timestamp: number }[]
}

class RehearsalComplete extends Error {
    constructor(readonly report: MigrationRehearsal) {
        super('Migration rehearsal completed')
    }
}

export function runMigrations(
    database: PostbotDatabase,
    migrationsFolder = defaultMigrationsFolder,
    checks: MigrationChecks = {}
): void {
    applyMigrations(database, migrationsFolder, checks, false)
}

/** Requires the same exclusive runtime boundary as applying an upgrade. Rolls back all SQL and history after checking them. */
export function rehearseMigrations(
    database: PostbotDatabase,
    migrationsFolder = defaultMigrationsFolder,
    checks: MigrationChecks = {}
): MigrationRehearsal {
    return applyMigrations(database, migrationsFolder, checks, true)
}

function applyMigrations(
    database: PostbotDatabase,
    migrationsFolder: string,
    checks: MigrationChecks,
    rehearsal: boolean
): MigrationRehearsal {
    const client = database.$client
    if (client.inTransaction) throw new Error('Database migrations require their own transaction')
    const migrations = readMigrationFiles({ migrationsFolder })
    const foreignKeysWereEnabled =
        client.query<{ readonly foreign_keys: number }, []>('PRAGMA foreign_keys').get()
            ?.foreign_keys === 1

    // SQLite table rebuilds need foreign keys disabled outside the transaction.
    // Keep Drizzle's file parsing and history format, but validate before commit:
    // a failed check must roll back the schema, data and history together.
    client.run('PRAGMA foreign_keys = OFF')

    try {
        try {
            return client
                .transaction(() => {
                    checks.preflight?.(database)
                    client.run(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
                    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric
                )`)
                    const last = client
                        .query<{ created_at: number }, []>(
                            'select created_at from __drizzle_migrations order by created_at desc limit 1'
                        )
                        .get()
                    const pending: { hash: string; timestamp: number }[] = []
                    for (const migration of migrations) {
                        if (last && Number(last.created_at) >= migration.folderMillis) continue
                        for (const statement of migration.sql) client.run(statement)
                        client
                            .query(
                                'insert into __drizzle_migrations (hash,created_at) values (?,?)'
                            )
                            .run(migration.hash, migration.folderMillis)
                        pending.push({ hash: migration.hash, timestamp: migration.folderMillis })
                    }
                    const violations = client
                        .query<{ table: string; rowid: number; parent: string; fkid: number }, []>(
                            'PRAGMA foreign_key_check'
                        )
                        .all()
                    if (violations.length)
                        throw new Error(
                            `Database migration would leave foreign-key violations: ${JSON.stringify(violations)}`
                        )
                    checks.verify?.(database)
                    const report = { pending }
                    if (rehearsal) throw new RehearsalComplete(report)
                    return report
                })
                .immediate()
        } catch (error) {
            if (error instanceof RehearsalComplete) return error.report
            if (!hasExistingSchemaObject(error)) throw error
            throw new Error(
                `The database schema conflicts with the committed migration history in "${migrationsFolder}". This development database has no supported upgrade path; stop Postdot and move the disposable database file aside before restarting. Do not use this recovery for a database with data to preserve.`,
                { cause: error }
            )
        }
    } finally {
        client.run(`PRAGMA foreign_keys = ${foreignKeysWereEnabled ? 'ON' : 'OFF'}`)
    }
}

function hasExistingSchemaObject(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    if (/already exists/i.test(error.message)) return true

    return hasExistingSchemaObject(error.cause)
}
