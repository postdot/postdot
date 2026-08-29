import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

import type { HeraldDatabase } from './client'

export const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

export function runMigrations(
    database: HeraldDatabase,
    migrationsFolder = defaultMigrationsFolder
) {
    migrate(database, { migrationsFolder })
}
