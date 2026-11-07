import { isDeepStrictEqual } from 'node:util'

import { createDatabase, closeDatabase, type DatabaseHandle } from './client'
import { legacyChainEnd } from './sql/legacy-chain'
import {
    loadPortableMigrations,
    portableMigrationsFolder,
    recordAppliedMigration,
    runPortableMigrations,
    type PortableMigrationResult,
} from './sql/migrator'
import { describeSchema, type SchemaDescription } from './sql/schema-introspection'

export const defaultMigrationsFolder = portableMigrationsFolder

/**
 * Brings a database to the current schema (ADR-097 §6).
 *
 * A SQLite database created by an earlier release (the legacy Drizzle chain)
 * is adopted in place when its chain is complete and its schema is exactly the
 * portable baseline; anything else is refused before any change.
 */
export async function runMigrations(
    database: DatabaseHandle,
    migrationsFolder = defaultMigrationsFolder
): Promise<PortableMigrationResult> {
    const migrations = loadPortableMigrations(migrationsFolder)
    if (database.sql.dialect === 'sqlite') await adoptLegacyDatabase(database, migrations)
    return runPortableMigrations(database, migrations)
}

async function tableExists(database: DatabaseHandle, name: string): Promise<boolean> {
    return (
        (await database.sql
            .statement<{ readonly name: string }, [string]>(
                "select name from sqlite_master where type = 'table' and name = ?1"
            )
            .get(name)) !== null
    )
}

async function adoptLegacyDatabase(
    database: DatabaseHandle,
    migrations: ReturnType<typeof loadPortableMigrations>
): Promise<void> {
    if (!(await tableExists(database, '__drizzle_migrations'))) return
    if (await tableExists(database, 'postdot_migrations')) return

    const history = await database.sql
        .statement<{ readonly count: number; readonly last: number | null }>(
            'select count(*) as count, max(cast(created_at as integer)) as last from __drizzle_migrations'
        )
        .get()
    if (history?.count !== legacyChainEnd.count || history.last !== legacyChainEnd.createdAt) {
        throw new Error(
            'This database was created by an older Postdot release whose upgrades are incomplete. ' +
                'Start the previous Postdot release once so it finishes its migrations, then upgrade to this release.'
        )
    }

    const baseline = migrations[0]
    if (baseline === undefined) throw new Error('The portable baseline migration is missing')
    const expected = await baselineSchema(baseline)
    const actual = await describeSchema(database)
    if (!isDeepStrictEqual(actual, expected)) {
        throw new Error(
            `The database schema differs from the Postdot baseline and cannot be adopted: ${schemaDifferences(expected, actual).join('; ')}`
        )
    }
    await database.sql.transaction(async () => {
        await recordAppliedMigration(database, baseline)
    }, 'immediate')
}

async function baselineSchema(
    baseline: ReturnType<typeof loadPortableMigrations>[number]
): Promise<SchemaDescription> {
    const reference = createDatabase(':memory:')
    try {
        await runPortableMigrations(reference, [baseline])
        return await describeSchema(reference)
    } finally {
        closeDatabase(reference)
    }
}

function schemaDifferences(expected: SchemaDescription, actual: SchemaDescription): string[] {
    const differences: string[] = []
    for (const name of new Set([...Object.keys(expected.tables), ...Object.keys(actual.tables)])) {
        if (!isDeepStrictEqual(expected.tables[name], actual.tables[name])) {
            differences.push(`table ${name}`)
        }
    }
    for (const name of new Set([...Object.keys(expected.views), ...Object.keys(actual.views)])) {
        if (!isDeepStrictEqual(expected.views[name], actual.views[name])) {
            differences.push(`view ${name}`)
        }
    }
    if (!isDeepStrictEqual(expected.triggers, actual.triggers)) differences.push('triggers')
    return differences.slice(0, 10)
}
