import type { Database, SQLQueryBindings, Statement } from 'bun:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'

import { normalizeStatementSql } from './dialect'
import type {
    SqlCommitScope,
    SqlDatabase,
    SqlParams,
    SqlRunResult,
    SqlStatement,
    SqlTransactionMode,
} from './port'

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
    readonly afterCommit: { readonly callback: () => void; readonly durable: boolean }[]
}

/** One frame per transaction or savepoint scope in the current async context. */
interface TransactionFrame {
    readonly root: TransactionRoot
    /** Set while a nested savepoint opened from this frame is running. */
    childActive: boolean
    readonly children: Set<Promise<unknown>>
}

const transactionContext = new AsyncLocalStorage<TransactionFrame>()

class WriterGate {
    #held = false
    readonly #waiters: (() => void)[] = []

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

    statement<Row = unknown, Params extends SqlParams = SqlParams>(
        text: string
    ): SqlStatement<Row, Params> {
        const normalizedText = normalizeStatementSql(text, 'sqlite')
        let prepared: Statement<Row, SQLQueryBindings[]> | undefined
        const resolve = () => {
            prepared ??= this.#client.query<Row, SQLQueryBindings[]>(normalizedText)
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
            iterate: (...params) => this.#iterate(() => resolve().iterate(...bindings(params))),
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

    afterCommit(callback: () => void, scope: SqlCommitScope = 'savepoint'): void {
        const frame = this.#currentFrame()
        if (frame === undefined) callback()
        else frame.root.afterCommit.push({ callback, durable: scope === 'transaction' })
    }

    async transaction<T>(
        operation: () => Promise<T>,
        mode: SqlTransactionMode = 'deferred'
    ): Promise<T> {
        const frame = this.#currentFrame()
        if (frame !== undefined) {
            const child = this.#savepoint(frame, operation)
            frame.children.add(child)
            void child.then(
                () => frame.children.delete(child),
                () => frame.children.delete(child)
            )
            return child
        }

        await this.#gate.acquire()
        const owned: TransactionRoot = { owner: this, closed: false, afterCommit: [] }
        const ownedFrame: TransactionFrame = {
            root: owned,
            childActive: false,
            children: new Set(),
        }
        let result: T
        try {
            this.#client.run(`begin ${mode}`)
            try {
                result = await transactionContext.run(ownedFrame, operation)
                await this.#drainChildren(ownedFrame)
                this.#client.run('commit')
            } catch (error) {
                // Promise.all can reject while a sibling savepoint is still
                // running. Keep ownership until it settles, so its writes
                // cannot escape the rollback into autocommit.
                await this.#drainChildren(ownedFrame)
                if (this.#client.inTransaction) this.#client.run('rollback')
                throw error
            }
        } finally {
            owned.closed = true
            this.#gate.release()
        }

        for (const { callback } of owned.afterCommit) callback()
        return result
    }

    #currentFrame(): TransactionFrame | undefined {
        const frame = transactionContext.getStore()
        return frame !== undefined && frame.root.owner === this && !frame.root.closed
            ? frame
            : undefined
    }

    async #drainChildren(frame: TransactionFrame): Promise<void> {
        while (frame.children.size > 0) await Promise.allSettled(frame.children)
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
        const childFrame: TransactionFrame = { root, childActive: false, children: new Set() }
        try {
            this.#client.run(`savepoint ${name}`)
            try {
                const result = await transactionContext.run(childFrame, operation)
                await this.#drainChildren(childFrame)
                this.#client.run(`release ${name}`)
                return result
            } catch (error) {
                await this.#drainChildren(childFrame)
                this.#client.run(`rollback to ${name}`)
                this.#client.run(`release ${name}`)
                // Callbacks registered by the rolled-back scope must not run,
                // unless they were bound to the whole transaction.
                const kept = root.afterCommit.slice(callbacks).filter(entry => entry.durable)
                root.afterCommit.length = callbacks
                root.afterCommit.push(...kept)
                throw error
            }
        } finally {
            frame.childActive = false
        }
    }

    async *#iterate<Row>(open: () => IterableIterator<Row>): AsyncGenerator<Row> {
        if (this.#currentFrame() !== undefined) {
            yield* open()
            return
        }
        await this.#gate.acquire()
        try {
            yield* open()
        } finally {
            this.#gate.release()
        }
    }

    /**
     * Runs synchronous native work (Drizzle query builder on the shared
     * connection) under the writer gate, or directly inside the transaction
     * bound to the current async context. Transitional for the SQLite
     * profile (ADR-097, DB-609); engine-neutral code uses statements.
     */
    runNative<T>(operation: () => T): Promise<T> {
        return this.#execute(operation)
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
