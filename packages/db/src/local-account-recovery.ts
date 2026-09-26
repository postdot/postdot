import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { backupDatabase } from './backup'
import { acquireRuntimeQuiescenceLock } from './runtime-quiescence'

const SQLITE_BUSY_TIMEOUT_MILLISECONDS = 5_000

export interface LocalAccountPasswordRecoveryOptions {
    readonly databaseFilename: string
    readonly email: string
    readonly passwordHash: string
    readonly now?: () => number
}

export interface LocalAccountPasswordRecoveryResult {
    readonly databaseFilename: string
    readonly backupFilename: string
    readonly email: string
    readonly revokedSessionCount: number
    readonly invalidatedResetTokenCount: number
}

interface RecoverableCredential {
    readonly userId: string
    readonly accountId: string
}

/** Resets one existing email/password account while the Herald runtime is stopped. */
export function recoverLocalAccountPassword(
    options: LocalAccountPasswordRecoveryOptions
): LocalAccountPasswordRecoveryResult {
    const databaseFilename = resolve(options.databaseFilename)
    const email = options.email.trim()
    const now = options.now ?? Date.now

    if (email.length === 0) throw new Error('An account email is required')
    if (options.passwordHash.length === 0) throw new Error('A password hash is required')
    if (!statSync(databaseFilename).isFile()) {
        throw new Error(`The target database is not a regular file: ${databaseFilename}`)
    }

    const runtimeLock = acquireRuntimeQuiescenceLock(databaseFilename, 'recovery')
    try {
        const preflight = openReadOnlyDatabase(databaseFilename)
        let credential: RecoverableCredential
        try {
            assertHeraldSchema(preflight, databaseFilename)
            credential = findRecoverableCredential(preflight, email)
        } finally {
            preflight.close()
        }

        const backupDirectory = createRecoveryBackupDirectory(databaseFilename, now())
        mkdirSync(backupDirectory, { mode: 0o700 })
        const backupFilename = join(backupDirectory, 'database.sqlite')
        try {
            backupDatabase(databaseFilename, backupFilename)
            chmodSync(backupFilename, 0o600)
        } catch (error) {
            throw new Error(
                `Could not safely create the recovery backup in ${backupDirectory}; the account was not changed`,
                { cause: error }
            )
        }

        const database = new Database(databaseFilename)
        database.run('PRAGMA foreign_keys = ON')
        database.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MILLISECONDS}`)
        try {
            const recover = database.transaction(() => {
                const currentCredential = findRecoverableCredential(database, email)
                if (
                    currentCredential.userId !== credential.userId ||
                    currentCredential.accountId !== credential.accountId
                ) {
                    throw new Error('The selected account changed during recovery')
                }

                const updated = database
                    .query(
                        `UPDATE account
                         SET password = ?1, updated_at = ?2
                         WHERE id = ?3 AND user_id = ?4 AND provider_id = 'credential'`
                    )
                    .run(options.passwordHash, now(), credential.accountId, credential.userId)
                if (updated.changes !== 1) {
                    throw new Error('The selected email/password credential could not be updated')
                }

                const revokedSessionCount = database
                    .query('DELETE FROM session WHERE user_id = ?1')
                    .run(credential.userId).changes
                const invalidatedResetTokenCount = database
                    .query(
                        `DELETE FROM verification
                         WHERE identifier LIKE 'reset-password:%' AND value = ?1`
                    )
                    .run(credential.userId).changes

                return { revokedSessionCount, invalidatedResetTokenCount }
            })

            const counts = recover.immediate()
            return {
                databaseFilename,
                backupFilename,
                email,
                ...counts,
            }
        } finally {
            database.close()
        }
    } finally {
        runtimeLock.release()
    }
}

function findRecoverableCredential(database: Database, email: string): RecoverableCredential {
    const users = database
        .query<{ readonly id: string }, [email: string]>(
            'SELECT id FROM user WHERE lower(email) = lower(?1)'
        )
        .all(email)

    if (users.length === 0) throw new Error('No Herald account exists for that email address')
    if (users.length > 1) {
        throw new Error(
            'More than one account matches that email address; recovery was not applied'
        )
    }

    const user = users[0]
    if (user === undefined) throw new Error('The selected Herald account could not be read')

    const credentials = database
        .query<{ readonly id: string }, [userId: string]>(
            `SELECT id FROM account
             WHERE user_id = ?1 AND provider_id = 'credential'`
        )
        .all(user.id)

    if (credentials.length === 0) {
        throw new Error('The selected account has no email/password credential to recover')
    }
    if (credentials.length > 1) {
        throw new Error('The selected account has ambiguous email/password credentials')
    }

    const credential = credentials[0]
    if (credential === undefined) {
        throw new Error('The selected email/password credential could not be read')
    }

    return { userId: user.id, accountId: credential.id }
}

function openReadOnlyDatabase(filename: string): Database {
    const database = new Database(filename, { readonly: true })
    database.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MILLISECONDS}`)
    return database
}

function assertHeraldSchema(database: Database, filename: string): void {
    const migrationsTable = database
        .query<{ readonly name: string }, []>(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = '__drizzle_migrations'`
        )
        .get()
    if (migrationsTable === null || migrationsTable === undefined) {
        throw new Error(`The target file is not a Herald database: ${filename}`)
    }
}

function createRecoveryBackupDirectory(databaseFilename: string, timestamp: number): string {
    const timestampLabel = new Date(timestamp).toISOString().replaceAll(':', '-').replace('.', '-')
    return `${databaseFilename}.before-password-recovery-${timestampLabel}-${randomUUID()}`
}
