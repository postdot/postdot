import { Database } from 'bun:sqlite'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from './schema'
import type { SqlDatabase, SqlTransactionMode } from './sql/port'
import { SqliteSqlDatabase } from './sql/sqlite-adapter'

export type DatabaseCommitObserver = (projectIds: readonly string[]) => void
export type DatabaseCommitErrorHandler = (error: unknown) => void

export type DatabaseTransaction<Args extends unknown[], Result> = {
    (...args: Args): Result
    deferred: (...args: Args) => Result
    immediate: (...args: Args) => Result
    exclusive: (...args: Args) => Result
}

interface CommitObserverRegistration {
    readonly observer: DatabaseCommitObserver
    readonly onError?: DatabaseCommitErrorHandler
}

interface TransactionState {
    frames: Set<string>[]
}

const commitObservers = new WeakMap<object, CommitObserverRegistration>()
const transactionStates = new WeakMap<object, TransactionState>()
const asyncCommitProjects = new WeakMap<object, Set<string>>()

export function createDatabase(filename: string) {
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
        return Object.assign(drizzle({ client, schema }), { sql })
    } catch (error) {
        client.close(true)
        throw error
    }
}

export type PostdotDatabase = ReturnType<typeof createDatabase>

/**
 * Installs the process-local callback used after a transaction that appended
 * project facts has committed. The callback is deliberately not part of the
 * transaction: a realtime wakeup must never be able to make a committed
 * database write look failed.
 */
export function setDatabaseCommitObserver(
    database: PostdotDatabase,
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
 * database tests and maintenance commands keep the same behavior.
 */
export function recordDatabaseCommitProject(database: PostdotDatabase, projectId: string): void {
    const scope = database.sql.transactionScope()
    if (scope !== undefined) {
        const registration = commitObservers.get(database)
        if (registration === undefined) return
        let projects = asyncCommitProjects.get(scope)
        if (projects === undefined) {
            const recorded = new Set<string>()
            projects = recorded
            asyncCommitProjects.set(scope, recorded)
            // Published once, after the outermost commit. A project recorded
            // by a savepoint that later rolled back still produces a wakeup;
            // wakeups are hints and readers re-read the durable journal.
            database.sql.afterCommit(() => publishCommittedProjects(registration, [...recorded]))
        }
        projects.add(projectId)
        return
    }
    const state = transactionStates.get(database)
    state?.frames.at(-1)?.add(projectId)
}

/**
 * Wraps a Bun SQLite transaction and emits the affected project ids only
 * after Bun has successfully returned from the transaction (that is, after
 * SQLite committed it). The journal remains durable; the callback is only a
 * low-latency in-process wakeup.
 */
export function createDatabaseTransaction<Args extends unknown[], Result>(
    database: PostdotDatabase,
    callback: (...args: Args) => Result
): DatabaseTransaction<Args, Result> {
    const legacy = database.$client.transaction(callback)
    const sqlite = database.sql as SqliteSqlDatabase
    const guard =
        (operation: (...args: Args) => Result) =>
        (...args: Args): Result => {
            // Transitional (DB-609): a synchronous transaction must not start
            // while an async transaction owns the shared connection.
            if (sqlite.busy) {
                throw new Error('Synchronous transaction attempted while the SQLite writer is busy')
            }
            return operation(...args)
        }
    const transaction = Object.assign(guard(legacy), {
        deferred: guard(legacy.deferred),
        immediate: guard(legacy.immediate),
        exclusive: guard(legacy.exclusive),
    })

    const execute = (operation: (...args: Args) => Result, args: Args): Result => {
        const registration = commitObservers.get(database)
        if (registration === undefined) return operation(...args)

        const state = transactionStates.get(database) ?? { frames: [] }
        transactionStates.set(database, state)
        const outermost = state.frames.length === 0
        const frame = new Set<string>()
        state.frames.push(frame)

        try {
            const result = operation(...args)
            state.frames.pop()
            const parent = state.frames.at(-1)
            if (parent !== undefined) {
                for (const projectId of frame) parent.add(projectId)
            } else if (outermost) publishCommittedProjects(registration, [...frame])

            return result
        } catch (error) {
            state.frames.pop()
            throw error
        }
    }

    const wrapped = ((...args: Args) => execute(transaction, args)) as DatabaseTransaction<
        Args,
        Result
    >
    wrapped.deferred = (...args: Args) => execute(transaction.deferred, args)
    wrapped.immediate = (...args: Args) => execute(transaction.immediate, args)
    wrapped.exclusive = (...args: Args) => execute(transaction.exclusive, args)
    return wrapped
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

export type AsyncDatabaseTransaction<Args extends unknown[], Result> = {
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
    database: PostdotDatabase,
    callback: (...args: Args) => Promise<Result>
): AsyncDatabaseTransaction<Args, Result> {
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

export function closeDatabase(database: PostdotDatabase) {
    // Finalize Drizzle prepared statements before releasing the runtime lock.
    database.$client.close(true)
}
