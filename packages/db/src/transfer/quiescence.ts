import { existsSync } from 'node:fs'

import { SQL } from 'bun'

import {
    closeDatabase,
    closePostgresDatabase,
    createDatabase,
    createPostgresDatabase,
    postgresInstanceLockKey,
    type DatabaseHandle,
} from '../client'
import { postgresLeaderLock } from '../coordination'
import { readRecoveryHold } from '../recovery-hold'
import { acquireRuntimeQuiescenceLock } from '../runtime-quiescence'

/** Where a transfer reads or writes: the same choice a server makes at startup. */
export type TransferDatabaseProfile =
    | { readonly engine: 'sqlite'; readonly fileName: string }
    | { readonly engine: 'postgres'; readonly url: string }

export interface QuiescedDatabase {
    readonly database: DatabaseHandle
    close(): Promise<void>
}

/**
 * Opens a database for an offline transfer (ADR-097 §8). No server may run on
 * it: SQLite takes the runtime lock; PostgreSQL holds the single-server and
 * leader locks (so no server can start meanwhile) and refuses while any other
 * session is connected to the database.
 */
export async function openQuiescedDatabase(
    profile: TransferDatabaseProfile,
    options: { readonly mustExist: boolean }
): Promise<QuiescedDatabase> {
    if (profile.engine === 'sqlite') {
        if (options.mustExist && !existsSync(profile.fileName)) {
            throw new Error(`No database exists at ${profile.fileName}`)
        }
        const lock = acquireRuntimeQuiescenceLock(profile.fileName, 'recovery')
        try {
            if (readRecoveryHold(profile.fileName) !== null) {
                throw new Error('This database is in recovery hold; resume it before a transfer')
            }
            const database = createDatabase(profile.fileName)
            return {
                database,
                async close() {
                    closeDatabase(database)
                    if (!lock.release()) {
                        throw new Error(`The runtime lock ${lock.lockFilename} was retained`)
                    }
                },
            }
        } catch (error) {
            lock.release()
            throw error
        }
    }

    const client = new SQL(profile.url, { max: 1, idleTimeout: 0 })
    let session: Awaited<ReturnType<SQL['reserve']>> | undefined
    let database: ReturnType<typeof createPostgresDatabase> | undefined
    const close = async () => {
        if (database !== undefined) await closePostgresDatabase(database)
        await session?.release()
        await client.close()
    }
    try {
        session = await client.reserve()
        const [locks] = (await session.unsafe(
            `select pg_try_advisory_lock($1) as instance,
                    pg_try_advisory_lock($2, $3) as leader,
                    pg_backend_pid() as pid`,
            [postgresInstanceLockKey, ...postgresLeaderLock]
        )) as { instance: boolean; leader: boolean; pid: number }[]
        if (locks?.instance !== true || locks.leader !== true) {
            throw new Error('A Postdot server is running on this database; stop every server first')
        }
        database = createPostgresDatabase(profile.url, { max: 1 })
        const own = await database.sql
            .statement<{ pid: number }>('select pg_backend_pid() as pid')
            .get()
        const others = await database.sql
            .statement<{ count: number }, [number, number]>(
                `select count(*) as count from pg_stat_activity
                 where datname = current_database() and backend_type = 'client backend'
                   and pid <> ?1 and pid <> ?2`
            )
            .get(Number(locks.pid), Number(own?.pid))
        if (Number(others?.count ?? 0) > 0) {
            throw new Error(
                'Other sessions are connected to this database; stop every Postdot server and client first'
            )
        }
        return { database, close }
    } catch (error) {
        await close()
        throw error
    }
}
