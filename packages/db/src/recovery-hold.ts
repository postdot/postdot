import { randomUUID } from 'node:crypto'
import {
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface RecoveryHold {
    readonly version: 1
    readonly token: string
    readonly createdAt: string
    readonly reason: 'restore' | 'external_restore'
}

export function readRecoveryHold(databaseFilename: string): RecoveryHold | null {
    if (databaseFilename === ':memory:') return null
    const filename = recoveryFilename(databaseFilename)
    let content: string
    try {
        content = readFileSync(filename, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
    }
    const value = JSON.parse(content) as Partial<RecoveryHold> | null
    if (
        !value ||
        value.version !== 1 ||
        typeof value.token !== 'string' ||
        !value.token ||
        typeof value.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(value.createdAt)) ||
        (value.reason !== 'restore' && value.reason !== 'external_restore')
    )
        throw new Error(
            'Invalid Postdot recovery hold; keep the server stopped and inspect the marker'
        )
    return value as RecoveryHold
}

/** Caller must own the database runtime lock. Persist before replacing SQLite. */
export function createRecoveryHold(
    databaseFilename: string,
    reason: RecoveryHold['reason'],
    replaceExisting = false
): RecoveryHold {
    const existing = readRecoveryHold(databaseFilename)
    if (existing && !replaceExisting) return existing
    const filename = recoveryFilename(databaseFilename)
    mkdirSync(dirname(filename), { recursive: true })
    const value: RecoveryHold = {
        version: 1,
        token: randomUUID(),
        createdAt: new Date().toISOString(),
        reason,
    }
    const temporary = `${filename}.${randomUUID()}.tmp`
    try {
        const descriptor = openSync(temporary, 'wx', 0o600)
        try {
            writeFileSync(descriptor, `${JSON.stringify(value)}\n`)
            fsyncSync(descriptor)
        } finally {
            closeSync(descriptor)
        }
        renameSync(temporary, filename)
        syncDirectory(dirname(filename))
    } finally {
        if (existsSync(temporary)) unlinkSync(temporary)
    }
    return value
}

/** Token prevents an old administrator view from acknowledging a different hold. */
export function releaseRecoveryHold(databaseFilename: string, token: string): void {
    const current = readRecoveryHold(databaseFilename)
    if (!current || current.token !== token)
        throw new Error('Recovery hold changed; reload its state')
    unlinkSync(recoveryFilename(databaseFilename))
    syncDirectory(dirname(recoveryFilename(databaseFilename)))
}

function recoveryFilename(databaseFilename: string) {
    if (databaseFilename === ':memory:') throw new Error('Recovery requires a filesystem database')
    return `${resolve(databaseFilename)}.recovery.json`
}

function syncDirectory(directory: string) {
    const descriptor = openSync(directory, 'r')
    try {
        fsyncSync(descriptor)
    } finally {
        closeSync(descriptor)
    }
}
