import { existsSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const currentName = 'postdot.sqlite'
const legacyName = 'postbot.sqlite'
const companionSuffixes = ['', '-wal', '-shm', '.recovery.json'] as const

/**
 * Moves a database created before the Postdot rename to its current default name so an installation
 * keeps its data when its configuration switches to the new file name. Only the default names are
 * recognized; a custom `DB_FILE_NAME` is never touched. Callers must already hold the runtime lock
 * for `databasePath`. Returns whether a database was adopted.
 */
export function adoptLegacyDatabaseName(databasePath: string): boolean {
    if (basename(databasePath) !== currentName || existsSync(databasePath)) return false

    const directory = dirname(databasePath)
    const legacyPath = join(directory, legacyName)
    if (!existsSync(legacyPath)) return false

    if (existsSync(`${legacyPath}.runtime.lock`)) {
        throw new Error(
            `Cannot adopt ${legacyPath}: ${legacyPath}.runtime.lock is held. Stop the Postdot runtime that uses it, or verify and remove that stale marker, before retrying.`
        )
    }

    for (const suffix of companionSuffixes) {
        const source = `${legacyPath}${suffix}`
        if (existsSync(source)) renameSync(source, `${databasePath}${suffix}`)
    }
    console.warn(`Adopted the existing database ${legacyPath} as ${databasePath}.`)

    return true
}
