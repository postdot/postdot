import type { Database, SQLQueryBindings, Statement } from 'bun:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'

import type { SqlDatabase, SqlParams, SqlRunResult, SqlStatement, SqlTransactionMode } from './port'

/**
 * SQLite profile of the persistence port (ADR-097).
 *
 * One `bun:sqlite` connection is shared by the process. Because a SQLite
 * connection has a single transaction, an async transaction that awaits
 * between statements must never be observed or joined by another async flow.
 * The writer gate admits one transaction or one autocommit statement at a
 * time; statements issued from inside the open transaction's async context
 * bypass the gate and run on that transaction.
 */

interface TransactionRoot {
    readonly owner: SqliteSqlDatabase
    closed: boolean
    readonly afterCommit: (() => void)[]
}

/** One frame per transaction or savepoint scope in the current async context. */
interface TransactionFrame {
    readonly root: TransactionRoot
    /** Set while a nested savepoint opened from this frame is running. */
    childActive: boolean
}

const transactionContext = new AsyncLocalStorage<TransactionFrame>()

class WriterGate {
    #held = false
    readonly #waiters: (() => void)[] = []

    get held(): boolean {
        return this.#held
    }

    tryAcquire(): boolean {
        if (this.#held) return false
        this.#held = true
        return true
    }

    acquire(): Promise<void> {
        if (this.tryAcquire()) return Promise.resolve()
        return new Promise(resolve => {
            this.#waiters.push(resolve)
        })
    }

    release(): void {
        const next = this.#waiters.shift()
        // Ownership passes directly to the next waiter; the gate stays held.
        if (next !== undefined) next()
        else this.#held = false
    }
}

export class SqliteSqlDatabase implements SqlDatabase {
    readonly dialect = 'sqlite' as const
    readonly #client: Database
    readonly #gate = new WriterGate()
    #savepointSequence = 0

    constructor(client: Database) {
        this.#client = client
    }

    /** True while an async transaction or gated statement owns the connection. */
    get busy(): boolean {
        return this.#gate.held
    }

    statement<Row, Params extends SqlParams = []>(text: string): SqlStatement<Row, Params> {
        let prepared: Statement<Row, SQLQueryBindings[]> | undefined
        const resolve = () => {
            prepared ??= this.#client.query<Row, SQLQueryBindings[]>(text)
            return prepared
        }
        const bindings = (params: Params) => params as unknown as SQLQueryBindings[]

        return {
            get: (...params) => this.#execute(() => resolve().get(...bindings(params)) ?? null),
            all: (...params) => this.#execute(() => resolve().all(...bindings(params))),
            run: (...params) =>
                this.#execute<SqlRunResult>(() => {
                    const result = resolve().run(...bindings(params))
                    return { changes: result.changes }
                }),
            values: (...params) =>
                this.#execute(() => resolve().values(...bindings(params)) as unknown[][]),
        }
    }

    exec(text: string): Promise<void> {
        return this.#execute(() => {
            this.#client.run(text)
        })
    }

    inTransaction(): boolean {
        return this.#currentFrame() !== undefined
    }

    transactionScope(): object | undefined {
        return this.#currentFrame()?.root
    }

    afterCommit(callback: () => void): void {
        const frame = this.#currentFrame()
        if (frame === undefined) callback()
        else frame.root.afterCommit.push(callback)
    }

    async transaction<T>(
        operation: () => Promise<T>,
        mode: SqlTransactionMode = 'deferred'
    ): Promise<T> {
        const frame = this.#currentFrame()
        if (frame !== undefined) return this.#savepoint(frame, operation)

        await this.#gate.acquire()
        const owned: TransactionRoot = { owner: this, closed: false, afterCommit: [] }
        let result: T
        try {
            this.#client.run(`begin ${mode}`)
            try {
                result = await transactionContext.run(
                    { root: owned, childActive: false },
                    operation
                )
                this.#client.run('commit')
            } catch (error) {
                if (this.#client.inTransaction) this.#client.run('rollback')
                throw error
            }
        } finally {
            owned.closed = true
            this.#gate.release()
        }

        for (const callback of owned.afterCommit) callback()
        return result
    }

    #currentFrame(): TransactionFrame | undefined {
        const frame = transactionContext.getStore()
        return frame !== undefined && frame.root.owner === this && !frame.root.closed
            ? frame
            : undefined
    }

    async #savepoint<T>(frame: TransactionFrame, operation: () => Promise<T>): Promise<T> {
        if (frame.childActive) {
            // Sibling nested transactions running concurrently would interleave
            // their savepoints on the single connection.
            throw new Error('Concurrent nested transactions are not supported')
        }
        const name = `postdot_sp_${++this.#savepointSequence}`
        const { root } = frame
        const callbacks = root.afterCommit.length
        frame.childActive = true
        try {
            this.#client.run(`savepoint ${name}`)
            try {
                const result = await transactionContext.run({ root, childActive: false }, operation)
                this.#client.run(`release ${name}`)
                return result
            } catch (error) {
                this.#client.run(`rollback to ${name}`)
                this.#client.run(`release ${name}`)
                // Callbacks registered by the rolled-back scope must not run.
                root.afterCommit.length = callbacks
                throw error
            }
        } finally {
            frame.childActive = false
        }
    }

    #execute<T>(operation: () => T): Promise<T> {
        if (this.#currentFrame() !== undefined) {
            try {
                return Promise.resolve(operation())
            } catch (error) {
                return Promise.reject(error)
            }
        }
        if (this.#gate.tryAcquire()) {
            try {
                return Promise.resolve(operation())
            } catch (error) {
                return Promise.reject(error)
            } finally {
                this.#gate.release()
            }
        }
        return this.#gate.acquire().then(() => {
            try {
                return operation()
            } finally {
                this.#gate.release()
            }
        })
    }
}
