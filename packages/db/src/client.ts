import { Database } from 'bun:sqlite'

import { SQL } from 'bun'

import type { SqlDatabase, SqlTransactionMode } from './sql/port'
import { PostgresSqlDatabase } from './sql/postgres-adapter'
import { SqliteSqlDatabase } from './sql/sqlite-adapter'

export type DatabaseCommitObserver = (projectIds: readonly string[]) => void
export type DatabaseCommitErrorHandler = (error: unknown) => void

interface CommitObserverRegistration {
    readonly observer: DatabaseCommitObserver
    readonly onError?: DatabaseCommitErrorHandler
}

const commitObservers = new WeakMap<object, CommitObserverRegistration>()
const asyncCommitProjects = new WeakMap<object, Set<string>>()

/** The SQLite profile: the port plus the raw client for SQLite-only features (backup, WAL). */
export interface PostdotDatabase extends DatabaseHandle {
    readonly $client: Database
}

export function createDatabase(filename: string): PostdotDatabase {
    const client = new Database(filename)
    try {
        client.run('PRAGMA busy_timeout = 5000')
        const mode = client.query<{ journal_mode: string }, []>('PRAGMA journal_mode = WAL').get()
        // SQLite keeps in-memory databases in memory journal mode.
        if (mode?.journal_mode !== 'wal' && mode?.journal_mode !== 'memory') {
            throw new Error('SQLite could not enable WAL journal mode')
        }
        client.run('PRAGMA synchronous = FULL')
        client.run('PRAGMA foreign_keys = ON')
        const sql: SqlDatabase = new SqliteSqlDatabase(client)
        return { sql, $client: client }
    } catch (error) {
        client.close(true)
        throw error
    }
}

/**
 * Engine-neutral persistence handle (ADR-097). Stores depend only on the
 * port; the SQLite database (`createDatabase`) and the PostgreSQL database
 * (`createPostgresDatabase`) both satisfy it.
 */
export interface DatabaseHandle {
    readonly sql: SqlDatabase
}

/**
 * Installs the process-local callback used after a transaction that appended
 * project facts has committed. The callback is deliberately not part of the
 * transaction: a realtime wakeup must never be able to make a committed
 * database write look failed.
 */
export function setDatabaseCommitObserver(
    database: DatabaseHandle,
    observer: DatabaseCommitObserver,
    onError?: DatabaseCommitErrorHandler
): () => void {
    const registration = { observer, onError }
    commitObservers.set(database, registration)

    return () => {
        if (commitObservers.get(database) === registration) commitObservers.delete(database)
    }
}

/**
 * Records the project whose audit fact is being appended by the current
 * transaction. It is intentionally a no-op when no observer is installed so
 * database tests and maintenance commands keep the same behavior, and outside
 * a transaction, as before: facts are always appended transactionally.
 */
export function recordDatabaseCommitProject(database: DatabaseHandle, projectId: string): void {
    const registration = commitObservers.get(database)
    const scope = database.sql.transactionScope()
    if (registration === undefined || scope === undefined) return
    let projects = asyncCommitProjects.get(scope)
    if (projects === undefined) {
        const recorded = new Set<string>()
        projects = recorded
        asyncCommitProjects.set(scope, recorded)
        // Published once, after the outermost commit. A project recorded by a
        // savepoint that later rolled back still produces a wakeup; wakeups
        // are hints and readers re-read the durable journal.
        database.sql.afterCommit(() => {
            if (commitObservers.get(database) === registration) {
                publishCommittedProjects(registration, [...recorded])
            }
        }, 'transaction')
    }
    projects.add(projectId)
}

function publishCommittedProjects(
    registration: CommitObserverRegistration,
    projectIds: readonly string[]
): void {
    try {
        if (projectIds.length > 0) registration.observer(projectIds)
    } catch (error) {
        handleCommitObserverError(registration, error)
    }
}

function handleCommitObserverError(registration: CommitObserverRegistration, error: unknown): void {
    if (registration.onError !== undefined) {
        try {
            registration.onError(error)
        } catch (reportingError) {
            console.error('[postdot-db] post-commit error handler failed', reportingError)
        }
        return
    }
    console.error('[postdot-db] post-commit observer failed', error)
}

export type DatabaseTransaction<Args extends unknown[], Result> = {
    (...args: Args): Promise<Result>
    deferred: (...args: Args) => Promise<Result>
    immediate: (...args: Args) => Promise<Result>
    exclusive: (...args: Args) => Promise<Result>
}

/**
 * Declares an asynchronous transaction (ADR-097). Statements awaited inside
 * `callback` run on the transaction bound to the async context; nested
 * transactions become savepoints, and commit observers fire only after the
 * outermost commit. `callback` must not perform external I/O.
 */
export function defineTransaction<Args extends unknown[], Result>(
    database: DatabaseHandle,
    callback: (...args: Args) => Promise<Result>
): DatabaseTransaction<Args, Result> {
    const run =
        (mode: SqlTransactionMode) =>
        (...args: Args): Promise<Result> =>
            database.sql.transaction(() => callback(...args), mode)
    return Object.assign(run('deferred'), {
        deferred: run('deferred'),
        immediate: run('immediate'),
        exclusive: run('exclusive'),
    })
}

export interface PostgresDatabase extends DatabaseHandle {
    readonly sql: PostgresSqlDatabase
}

/**
 * Opens the PostgreSQL profile (ADR-097) on Bun's built-in client. `int8`
 * values are read as BigInt and normalized to numbers by the adapter.
 */
export function createPostgresDatabase(
    url: string,
    options: { readonly max?: number } = {}
): PostgresDatabase {
    const client = new SQL(url, { bigint: true, max: options.max ?? 10 })
    return { sql: new PostgresSqlDatabase(client) }
}

export async function closePostgresDatabase(database: PostgresDatabase): Promise<void> {
    await database.sql.close()
}

export function closeDatabase(database: PostdotDatabase) {
    // Finalize prepared statements before releasing the runtime lock.
    database.$client.close(true)
}

/** Arbitrary constant identifying the Postdot server instance lock. */
const postgresInstanceLock = 7_310_201_612

export interface PostgresInstanceLock {
    /** Releases the lock by closing its dedicated session. */
    close(): Promise<void>
}

export interface PostgresInstanceLockOptions {
    /** Called once if the lock disappears without being released (lost connection). */
    readonly onLost?: () => void
    readonly heartbeatMs?: number
}

/**
 * Holds the single-server guarantee on PostgreSQL, as the runtime lock file
 * does for SQLite (ADR-097 §7): profiles that keep local state (media files)
 * allow one server per database. The lock lives on a reserved session and
 * disappears with it, including when the process dies; a heartbeat reports a
 * lock lost with its connection so the server stops instead of running beside
 * a newcomer.
 */
export async function acquirePostgresInstanceLock(
    url: string,
    options: PostgresInstanceLockOptions = {}
): Promise<PostgresInstanceLock> {
    const client = new SQL(url, { max: 1, idleTimeout: 0 })
    let session: Awaited<ReturnType<SQL['reserve']>> | undefined
    try {
        session = await client.reserve()
        const [row] = (await session.unsafe('select pg_try_advisory_lock($1) as acquired', [
            postgresInstanceLock,
        ])) as { acquired: boolean }[]
        if (row?.acquired !== true) {
            throw new Error(
                'Another Postdot server is already using this PostgreSQL database. ' +
                    'This profile allows one server (local media); stop the other server first.'
            )
        }
    } catch (error) {
        await session?.release()
        await client.close()
        throw error
    }
    let closed = false
    const heartbeat = setInterval(() => {
        void session!
            .unsafe(
                `select exists (select 1 from pg_locks where locktype = 'advisory' and granted
                   and pid = pg_backend_pid() and objsubid = 1
                   and ((classid::bigint << 32) | objid::bigint) = $1) as held`,
                [postgresInstanceLock]
            )
            .then(
                rows => (rows as { held: boolean }[])[0]?.held === true,
                () => false
            )
            .then(held => {
                if (held || closed) return
                closed = true
                clearInterval(heartbeat)
                options.onLost?.()
            })
    }, options.heartbeatMs ?? 5_000)
    return {
        async close() {
            closed = true
            clearInterval(heartbeat)
            await session!.release()
            await client.close()
        },
    }
}
