import { randomUUID } from 'node:crypto'
import {
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'

const RUNTIME_LOCK_VERSION = 1
const RUNTIME_LOCK_SUFFIX = '.runtime.lock'

export type RuntimeQuiescenceOwner = 'server' | 'restore' | 'recovery'

export interface RuntimeQuiescenceLock {
    readonly databaseFilename: string
    readonly lockFilename: string
    readonly owner: RuntimeQuiescenceOwner
    /**
     * Removes the marker when it still carries this lock's token. Returns
     * true when no marker remains and false when a marker is retained. A
     * false result keeps the fail-closed exclusion: callers must report it,
     * never delete the marker by another path.
     *
     * The first outcome is memoized: repeated calls return it without
     * retrying the removal or closing the descriptor twice.
     */
    release(): boolean
}

/**
 * Acquires the process-level boundary shared by the API runtime and recovery
 * commands. The marker is deliberately fail-closed: a leftover marker is not
 * reclaimed based on a possibly reused PID. An operator must verify that no
 * Postbot process is using the database before removing such a marker.
 */
export function acquireRuntimeQuiescenceLock(
    databaseFilename: string,
    owner: RuntimeQuiescenceOwner
): RuntimeQuiescenceLock {
    if (databaseFilename === ':memory:') {
        throw new Error('Runtime quiescence requires a filesystem-backed database')
    }

    const databasePath = resolve(databaseFilename)
    const lockFilename = `${databasePath}${RUNTIME_LOCK_SUFFIX}`
    mkdirSync(dirname(lockFilename), { recursive: true })

    let descriptor: number
    try {
        descriptor = openSync(lockFilename, 'wx', 0o600)
    } catch (error) {
        if (errorCode(error) === 'EEXIST') {
            throw new Error(
                `Cannot acquire Postbot runtime lock for ${databasePath}: ${lockFilename} is already held. Stop the active Postbot runtime, or verify and remove this exact stale marker after a forced stop, before retrying.`
            )
        }
        throw error
    }

    const token = randomUUID()
    const record = {
        version: RUNTIME_LOCK_VERSION,
        owner,
        pid: process.pid,
        host: hostname(),
        acquiredAt: new Date().toISOString(),
        token,
    }

    try {
        writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
        fsyncSync(descriptor)
    } catch (error) {
        closeSync(descriptor)
        removeLockIfOwned(lockFilename, token)
        throw error
    }

    let outcome: boolean | undefined
    return {
        databaseFilename: databasePath,
        lockFilename,
        owner,
        release() {
            if (outcome !== undefined) return outcome
            try {
                closeSync(descriptor)
                outcome = removeLockIfOwned(lockFilename, token)
            } catch (error) {
                outcome = false
                throw error
            }
            return outcome
        },
    }
}

function removeLockIfOwned(lockFilename: string, token: string): boolean {
    if (!existsSync(lockFilename)) return true

    let parsed: unknown
    try {
        parsed = JSON.parse(readFileSync(lockFilename, 'utf8'))
    } catch {
        return false
    }
    if (!isRecord(parsed) || parsed.token !== token) return false

    try {
        unlinkSync(lockFilename)
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return true
        console.error(`[postbot-db] failed to release runtime lock ${lockFilename}`, error)
        return false
    }
    return true
}

function errorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
    return typeof error.code === 'string' ? error.code : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
