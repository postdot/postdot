import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
    exportDatabase,
    importDatabase,
    openQuiescedDatabase,
    transferMedia,
    type TransferDatabaseProfile,
} from '@postdot/db'

import type { PostdotTransferConfig } from './config'
import { createConfiguredMediaStore } from './modules/media/runtime'

/**
 * Offline transfer between storage profiles (ADR-097 §8): `export` and
 * `import` move the database between SQLite and PostgreSQL through an
 * engine-neutral directory; `media transfer` copies media to another store.
 * Every command needs the servers stopped.
 */
export const transferUsage = {
    export: `Usage: bun /app/postdot.js export --output <directory> [--database <path>]

Write an engine-neutral export of the configured database (SQLite, or
PostgreSQL with POSTDOT_DATABASE_URL) to a directory that must not exist.
Stop every server first. The database must be at this release's schema:
start this release on it once before exporting.`,
    import: `Usage: bun /app/postdot.js import --input <directory> [--database <path>]

Import an export into the configured database, which must be empty: a new
SQLite file, or an empty PostgreSQL database. Rows load in one transaction
that verifies every checksum before committing; a failed import loads nothing.
Stop every server first.`,
    media: `Usage: bun /app/postdot.js media transfer [--database <path>]

Copy every media object from a source store to the configured store, verify
each copy, then point the database at the configured store. Describe the
source with the media variables prefixed with SOURCE_, for example
SOURCE_POSTDOT_MEDIA_STORE=local, SOURCE_POSTDOT_MEDIA_STORE_ID=local-default
and SOURCE_POSTDOT_MEDIA_DIRECTORY=/data/media. The configured store needs
its own POSTDOT_MEDIA_STORE_ID. The source store is never changed; rerun the
command after an interruption. Stop every server first.`,
} as const

export function isTransferCommand(args: readonly string[]): boolean {
    return args[0] === 'export' || args[0] === 'import' || args[0] === 'media'
}

export async function runTransferCommand(
    args: readonly string[],
    config: PostdotTransferConfig
): Promise<void> {
    const profile = databaseProfile(args, config)
    if (args[0] === 'export') {
        const output = resolve(requiredOption(args, '--output'))
        const opened = await openQuiescedDatabase(profile, { mustExist: true })
        try {
            const manifest = await exportDatabase(opened.database, output, {
                migrationsFolder: config.database.migrationsDirectory,
            })
            console.log(
                JSON.stringify({
                    exported: output,
                    engine: manifest.sourceEngine,
                    tables: manifest.tables.length,
                    rows: manifest.tables.reduce((total, table) => total + table.rows, 0),
                })
            )
        } finally {
            await opened.close()
        }
        return
    }

    if (args[0] === 'import') {
        const input = resolve(requiredOption(args, '--input'))
        const created = profile.engine === 'sqlite' && !existsSync(profile.fileName)
        const opened = await openQuiescedDatabase(profile, { mustExist: false })
        let imported = false
        try {
            const manifest = await importDatabase(opened.database, input, {
                migrationsFolder: config.database.migrationsDirectory,
            })
            imported = true
            console.log(
                JSON.stringify({
                    imported: input,
                    engine: profile.engine,
                    from: manifest.sourceEngine,
                    tables: manifest.tables.length,
                    rows: manifest.tables.reduce((total, table) => total + table.rows, 0),
                })
            )
        } finally {
            await opened.close()
            // A SQLite file this command created holds nothing useful after a failure.
            if (created && !imported) {
                for (const suffix of ['', '-wal', '-shm']) {
                    await rm(`${profile.fileName}${suffix}`, { force: true })
                }
            }
        }
        return
    }

    if (args[1] !== 'transfer') throw new Error('Use media transfer')
    if (config.sourceMedia === undefined) {
        throw new Error(
            'Describe the source store with SOURCE_POSTDOT_MEDIA_STORE, SOURCE_POSTDOT_MEDIA_STORE_ID ' +
                'and its other SOURCE_POSTDOT_MEDIA_* variables'
        )
    }
    const source = createConfiguredMediaStore(config.sourceMedia)
    const destination = createConfiguredMediaStore(config.media)
    const opened = await openQuiescedDatabase(profile, { mustExist: true })
    try {
        const report = await transferMedia({
            database: opened.database,
            source,
            destination,
            onProgress: ({ done, total }) => {
                if (done > 0 && done % 100 === 0) {
                    console.error(`[postdot-transfer] ${done}/${total} media objects`)
                }
            },
        })
        console.log(JSON.stringify({ from: source.storeId, to: destination.storeId, ...report }))
    } finally {
        await opened.close()
    }
}

function databaseProfile(
    args: readonly string[],
    config: PostdotTransferConfig
): TransferDatabaseProfile {
    const fileName = optionValue(args, '--database')
    if (config.database.engine === 'postgres') {
        if (fileName !== undefined) {
            throw new Error('--database names a SQLite file; unset POSTDOT_DATABASE_URL to use one')
        }
        return { engine: 'postgres', url: config.database.url }
    }
    return { engine: 'sqlite', fileName: fileName ?? config.database.fileName }
}

function optionValue(args: readonly string[], name: string): string | undefined {
    const index = args.indexOf(name)
    const value = index === -1 ? undefined : args[index + 1]
    return value === undefined || value.startsWith('--') ? undefined : value
}

function requiredOption(args: readonly string[], name: string): string {
    const value = optionValue(args, name)
    if (value === undefined) throw new Error(`Missing required option ${name}`)
    return value
}
