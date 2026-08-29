import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SQLITE_BUSY_TIMEOUT_MILLISECONDS = 5_000

export function backupDatabase(sourceFilename: string, destinationFilename: string) {
    const sourcePath = resolve(sourceFilename)
    const destinationPath = resolve(destinationFilename)

    assertDifferentPaths(sourcePath, destinationPath)
    assertExistingFile(sourcePath, 'Database')
    if (existsSync(destinationPath)) {
        throw new Error(`Backup destination already exists: ${destinationPath}`)
    }

    mkdirSync(dirname(destinationPath), { recursive: true })

    const database = openReadOnlyDatabase(sourcePath)
    try {
        assertHealthy(database, sourcePath)
        assertHeraldDatabase(database, sourcePath)
        database.query('VACUUM INTO ?').run(destinationPath)

        const backup = openReadOnlyDatabase(destinationPath)
        try {
            assertHealthy(backup, destinationPath)
            assertHeraldDatabase(backup, destinationPath)
        } finally {
            backup.close()
        }
    } catch (error) {
        removeIfPresent(destinationPath)
        throw error
    } finally {
        database.close()
    }
}

export function restoreDatabase(sourceFilename: string, destinationFilename: string) {
    const sourcePath = resolve(sourceFilename)
    const destinationPath = resolve(destinationFilename)
    const temporaryPath = `${destinationPath}.${randomUUID()}.restore`

    assertDifferentPaths(sourcePath, destinationPath)
    assertExistingFile(sourcePath, 'Backup')

    const backup = openReadOnlyDatabase(sourcePath)
    try {
        assertHealthy(backup, sourcePath)
        assertHeraldDatabase(backup, sourcePath)
    } finally {
        backup.close()
    }

    mkdirSync(dirname(destinationPath), { recursive: true })

    try {
        copyFileSync(sourcePath, temporaryPath)
        const restored = openReadOnlyDatabase(temporaryPath)
        try {
            assertHealthy(restored, temporaryPath)
            assertHeraldDatabase(restored, temporaryPath)
        } finally {
            restored.close()
        }
        renameSync(temporaryPath, destinationPath)
    } catch (error) {
        removeIfPresent(temporaryPath)
        throw error
    }
}

function openReadOnlyDatabase(filename: string) {
    const database = new Database(filename, { readonly: true })
    database.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MILLISECONDS}`)
    return database
}

function assertHealthy(database: Database, filename: string) {
    const result = database.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()
    if (result?.integrity_check !== 'ok') {
        throw new Error(`SQLite integrity check failed for ${filename}`)
    }
}

function assertHeraldDatabase(database: Database, filename: string) {
    const migrationsTable = database
        .query<{ name: string }, []>(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table' AND name = '__drizzle_migrations'`
        )
        .get()

    if (!migrationsTable) {
        throw new Error(`The SQLite file is not a Herald database: ${filename}`)
    }
}

function assertExistingFile(filename: string, label: string) {
    if (!existsSync(filename)) {
        throw new Error(`${label} file does not exist: ${filename}`)
    }
}

function assertDifferentPaths(sourcePath: string, destinationPath: string) {
    if (sourcePath === destinationPath) {
        throw new Error('Source and destination database paths must be different')
    }
}

function removeIfPresent(filename: string) {
    if (existsSync(filename)) unlinkSync(filename)
}
