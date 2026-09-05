import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

import type { HeraldDatabase } from './client'

export const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

export function runMigrations(
    database: HeraldDatabase,
    migrationsFolder = defaultMigrationsFolder
) {
    const client = database.$client
    const foreignKeysWereEnabled =
        client.query<{ readonly foreign_keys: number }, []>('PRAGMA foreign_keys').get()
            ?.foreign_keys === 1

    // SQLite cannot change this pragma from inside Drizzle's migration transaction. The
    // committed migrations already use the same bounded rebuild pattern, so disable checks
    // before Drizzle starts the transaction and validate the final schema before restoring them.
    client.run('PRAGMA foreign_keys = OFF')

    try {
        try {
            migrate(database, { migrationsFolder })
        } catch (error) {
            if (!hasExistingSchemaObject(error)) throw error

            throw new Error(
                `The database schema conflicts with the committed migration history in "${migrationsFolder}". If this is an unreleased local database, stop Herald and move the database file aside before restarting. Do not use this recovery for a database with data to preserve.`,
                { cause: error }
            )
        }

        const foreignKeyViolations = client
            .query<
                {
                    readonly table: string
                    readonly rowid: number
                    readonly parent: string
                    readonly fkid: number
                },
                []
            >('PRAGMA foreign_key_check')
            .all()

        if (foreignKeyViolations.length > 0) {
            throw new Error(
                `Database migrations left foreign-key violations: ${JSON.stringify(foreignKeyViolations)}`
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
