import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

import type { HeraldDatabase } from './client'

export const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

export function runMigrations(
    database: HeraldDatabase,
    migrationsFolder = defaultMigrationsFolder
) {
    try {
        migrate(database, { migrationsFolder })
    } catch (error) {
        if (!hasExistingSchemaObject(error)) throw error

        throw new Error(
            `The database schema conflicts with the committed migration history in "${migrationsFolder}". If this is an unreleased local database, stop Herald and move the database file aside before restarting. Do not use this recovery for a database with data to preserve.`,
            { cause: error }
        )
    }
}

function hasExistingSchemaObject(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    if (/already exists/i.test(error.message)) return true

    return hasExistingSchemaObject(error.cause)
}
