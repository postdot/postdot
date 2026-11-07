import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The frozen Drizzle migration chain of releases before ADR-097 §6.
 *
 * Postdot no longer applies it: an existing SQLite database whose chain is
 * complete is adopted in place by `runMigrations`. The files stay so tests can
 * build such databases and prove the portable baseline reproduces them.
 */
export const legacyMigrationsFolder = fileURLToPath(
    new URL('../../legacy-migrations', import.meta.url)
)

/** The last legacy migration (`0026_postdot_identity`) and the size of the chain. */
export const legacyChainEnd = { count: 27, createdAt: 1_793_200_000_000 } as const

interface JournalEntry {
    readonly idx: number
    readonly tag: string
    readonly when: number
}

/**
 * Test fixture: applies the legacy chain through `throughIndex` with
 * Drizzle's history format, as an older Postdot release did.
 */
export function applyLegacyChain(client: Database, throughIndex = legacyChainEnd.count - 1) {
    const journal = JSON.parse(
        readFileSync(join(legacyMigrationsFolder, 'meta/_journal.json'), 'utf8')
    ) as { readonly entries: readonly JournalEntry[] }
    client.run('PRAGMA foreign_keys = OFF')
    try {
        client.transaction(() => {
            client.run(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
                id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric
            )`)
            for (const entry of journal.entries.filter(entry => entry.idx <= throughIndex)) {
                const text = readFileSync(join(legacyMigrationsFolder, `${entry.tag}.sql`), 'utf8')
                for (const statement of text.split('--> statement-breakpoint')) {
                    if (statement.trim() !== '') client.run(statement)
                }
                client
                    .query('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
                    .run(createHash('sha256').update(text).digest('hex'), entry.when)
            }
        })()
    } finally {
        client.run('PRAGMA foreign_keys = ON')
    }
}
