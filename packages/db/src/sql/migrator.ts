import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DatabaseHandle } from '../client'
import type { SqlDialect } from './port'

/**
 * Postdot-owned portable migrations (ADR-097 §6).
 *
 * A migration is `NNNN_name.sql`. Lines `-- postdot:common`, `-- postdot:sqlite`
 * and `-- postdot:postgres` open sections; sections run in file order and only
 * `common` plus the current engine's sections apply. Applied migrations are
 * recorded with a checksum: editing an applied migration fails closed.
 */

export const portableMigrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url))

const sectionMarker = /^--\s*postdot:(common|sqlite|postgres)\s*$/
const fileName = /^(\d{4})_([a-z0-9_]+)\.sql$/

/** Arbitrary constant identifying Postdot's migration advisory lock. */
const postgresMigrationLock = 7_310_201_611

export interface PortableMigration {
    readonly id: number
    readonly name: string
    readonly checksum: string
    readonly sections: readonly { readonly engine: SqlDialect | 'common'; readonly sql: string }[]
}

export function loadPortableMigrations(folder = portableMigrationsFolder): PortableMigration[] {
    return readdirSync(folder)
        .filter(file => file.endsWith('.sql'))
        .sort()
        .map(file => {
            const match = fileName.exec(file)
            if (!match) throw new Error(`Invalid migration file name: ${file}`)
            const text = readFileSync(join(folder, file), 'utf8')
            return {
                id: Number(match[1]),
                name: match[2]!,
                checksum: createHash('sha256').update(text).digest('hex'),
                sections: parseSections(file, text),
            }
        })
        .map((migration, index) => {
            if (migration.id !== index) {
                throw new Error(`Migration ids must be contiguous from 0000; found ${migration.id}`)
            }
            return migration
        })
}

function parseSections(file: string, text: string): PortableMigration['sections'] {
    const sections: { engine: SqlDialect | 'common'; lines: string[] }[] = []
    for (const line of text.split('\n')) {
        const marker = sectionMarker.exec(line.trim())
        if (marker) {
            sections.push({ engine: marker[1] as SqlDialect | 'common', lines: [] })
        } else if (sections.length > 0) {
            sections.at(-1)!.lines.push(line)
        } else if (line.trim() !== '' && !line.trim().startsWith('--')) {
            throw new Error(`${file}: SQL before the first postdot section marker`)
        }
    }
    return sections.map(section => ({ engine: section.engine, sql: section.lines.join('\n') }))
}

/** The SQL a migration runs on one engine, in file order. */
export function migrationSql(migration: PortableMigration, dialect: SqlDialect): string {
    return migration.sections
        .filter(section => section.engine === 'common' || section.engine === dialect)
        .map(section => section.sql.trim())
        .filter(sql => sql.length > 0)
        .join('\n\n')
}

export interface PortableMigrationResult {
    readonly applied: readonly string[]
}

export async function runPortableMigrations(
    database: DatabaseHandle,
    migrations: readonly PortableMigration[] = loadPortableMigrations()
): Promise<PortableMigrationResult> {
    const { sql } = database
    await sql.exec(`create table if not exists postdot_migrations (
        id bigint primary key not null,
        name text not null,
        checksum text not null,
        applied_at bigint not null
    )`)
    const applied: string[] = []
    for (const migration of migrations) {
        const done = await sql.transaction(async () => {
            if (sql.dialect === 'postgres') {
                // Instances racing at startup apply each migration exactly once.
                await sql
                    .statement<never, [number]>('select pg_advisory_xact_lock(?1)')
                    .get(postgresMigrationLock)
            }
            const recorded = await sql
                .statement<{ checksum: string }, [number]>(
                    'select checksum from postdot_migrations where id = ?1'
                )
                .get(migration.id)
            if (recorded !== null) {
                if (recorded.checksum !== migration.checksum) {
                    throw new Error(
                        `Applied migration ${migration.id}_${migration.name} was modified; refusing to continue`
                    )
                }
                return false
            }
            await sql.exec(migrationSql(migration, sql.dialect))
            await sql
                .statement<never, [number, string, string, number]>(
                    'insert into postdot_migrations (id, name, checksum, applied_at) values (?1, ?2, ?3, ?4)'
                )
                .run(migration.id, migration.name, migration.checksum, Date.now())
            return true
        }, 'immediate')
        if (done) applied.push(`${String(migration.id).padStart(4, '0')}_${migration.name}`)
    }
    return { applied }
}
