import { AsyncLocalStorage } from 'node:async_hooks'

import type { SQL, TransactionSQL } from 'bun'

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
 * PostgreSQL profile of the persistence port (ADR-097), on Bun's built-in
 * `Bun.SQL` client.
 *
 * Every transaction runs at SERIALIZABLE isolation. SQLite serializes all
 * writers, and Postdot's stores were written against that guarantee
 * (read-then-write checks, claims, revision fences). Serializable isolation
 * keeps the same outcome on PostgreSQL; a transaction that loses a
 * serialization race is rolled back and replayed. Replaying is safe because
 * transactions perform no external I/O (port contract).
 *
 * Result rows are normalized to the SQLite profile's shape:
 * - `bigint` (int8) values become JavaScript numbers (integer milliseconds,
 *   sequences); a value beyond 2^53 is rejected rather than rounded;
 * - unquoted `as camelCase` aliases, folded to lowercase by PostgreSQL, are
 *   restored from the statement text.
 */

type Executor = Pick<SQL, 'unsafe'>

interface TransactionRoot {
    readonly owner: PostgresSqlDatabase
    closed: boolean
    readonly afterCommit: { readonly callback: () => void; readonly durable: boolean }[]
}

interface TransactionFrame {
    readonly root: TransactionRoot
    readonly executor: TransactionSQL
    childActive: boolean
}

const transactionContext = new AsyncLocalStorage<TransactionFrame>()

const serializationFailures = new Set(['40001', '40P01'])

export interface PostgresSqlDatabaseOptions {
    /** Attempts for a transaction that loses a serialization race (default 8). */
    readonly maxTransactionAttempts?: number
}

export class PostgresSqlDatabase implements SqlDatabase {
    readonly dialect = 'postgres' as const
    readonly #client: SQL
    readonly #maxAttempts: number
    #savepointSequence = 0

    constructor(client: SQL, options: PostgresSqlDatabaseOptions = {}) {
        this.#client = client
        this.#maxAttempts = options.maxTransactionAttempts ?? 8
    }

    statement<Row = unknown, Params extends SqlParams = SqlParams>(
        text: string
    ): SqlStatement<Row, Params> {
        const normalized = normalizeStatementSql(text, 'postgres')
        const aliases = camelCaseAliases(normalized)
        const query = (params: Params) =>
            this.#executor().unsafe(normalized, params as unknown as unknown[])
        const rows = async (params: Params): Promise<Row[]> => {
            const result = (await query(params)) as Record<string, unknown>[]
            return result.map(row => normalizeRow(row, aliases) as Row)
        }

        return {
            get: async (...params) => (await rows(params))[0] ?? null,
            all: (...params) => rows(params),
            run: async (...params): Promise<SqlRunResult> => {
                const result = (await query(params)) as unknown as { count?: number | null }
                return { changes: result.count ?? 0 }
            },
            values: async (...params) => {
                const result = (await query(params).values()) as unknown[][]
                return result.map(row => row.map(normalizeValue))
            },
            // Bun.SQL exposes no cursor yet: the result is materialized before
            // being yielded. Consumers keep the streaming contract unchanged.
            iterate: (...params) => yieldRows(rows(params)),
        }
    }

    async exec(text: string): Promise<void> {
        await this.#executor().unsafe(text)
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
        // Modes express SQLite lock acquisition; serializable isolation
        // already gives every mode the same outcome here.
        _mode: SqlTransactionMode = 'deferred'
    ): Promise<T> {
        const frame = this.#currentFrame()
        if (frame !== undefined) return this.#savepoint(frame, operation)

        for (let attempt = 1; ; attempt++) {
            const root: TransactionRoot = { owner: this, closed: false, afterCommit: [] }
            try {
                const result = await this.#client.begin('isolation level serializable', tx =>
                    transactionContext.run({ root, executor: tx, childActive: false }, operation)
                )
                root.closed = true
                for (const { callback } of root.afterCommit) callback()
                return result as T
            } catch (error) {
                root.closed = true
                if (attempt >= this.#maxAttempts || !isSerializationFailure(error)) throw error
                // Small jittered backoff before replaying the whole transaction.
                await Bun.sleep(Math.min(100, 2 ** attempt) * Math.random())
            }
        }
    }

    async close(): Promise<void> {
        await this.#client.close()
    }

    #executor(): Executor {
        return this.#currentFrame()?.executor ?? this.#client
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
            // their savepoints on the transaction's single connection.
            throw new Error('Concurrent nested transactions are not supported')
        }
        const { root, executor } = frame
        const name = `postdot_sp_${++this.#savepointSequence}`
        const callbacks = root.afterCommit.length
        frame.childActive = true
        try {
            await executor.unsafe(`savepoint ${name}`)
            try {
                const result = await transactionContext.run(
                    { root, executor, childActive: false },
                    operation
                )
                await executor.unsafe(`release savepoint ${name}`)
                return result
            } catch (error) {
                await executor.unsafe(`rollback to savepoint ${name}`)
                await executor.unsafe(`release savepoint ${name}`)
                const kept = root.afterCommit.slice(callbacks).filter(entry => entry.durable)
                root.afterCommit.length = callbacks
                root.afterCommit.push(...kept)
                throw error
            }
        } finally {
            frame.childActive = false
        }
    }
}

function isSerializationFailure(error: unknown): boolean {
    const errno = (error as { readonly errno?: unknown } | null)?.errno
    return typeof errno === 'string' && serializationFailures.has(errno)
}

async function* yieldRows<Row>(rows: Promise<Row[]>): AsyncGenerator<Row> {
    yield* await rows
}

function normalizeValue(value: unknown): unknown {
    if (typeof value !== 'bigint') return value
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new RangeError(`Integer ${value} exceeds the safe JavaScript range`)
    }
    return Number(value)
}

function normalizeRow(
    row: Record<string, unknown>,
    aliases: ReadonlyMap<string, string>
): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
        normalized[aliases.get(key) ?? key] = normalizeValue(value)
    }
    return normalized
}

/**
 * Maps lowercase result keys to the camelCase aliases written in the
 * statement (`as projectId` -> `projectid` -> `projectId`). Quoted aliases
 * keep their case in PostgreSQL and need no mapping.
 */
export function camelCaseAliases(text: string): ReadonlyMap<string, string> {
    const aliases = new Map<string, string>()
    const unquoted = text.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, ' ')
    for (const match of unquoted.matchAll(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
        const alias = match[1]!
        if (alias !== alias.toLowerCase()) {
            const existing = aliases.get(alias.toLowerCase())
            if (existing !== undefined && existing !== alias) {
                throw new Error(`Ambiguous result aliases "${existing}" and "${alias}"`)
            }
            aliases.set(alias.toLowerCase(), alias)
        }
    }
    return aliases
}
