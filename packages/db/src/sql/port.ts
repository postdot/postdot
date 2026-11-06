/**
 * Engine-neutral persistence port (ADR-097).
 *
 * Stores declare typed statements once and execute them asynchronously. A
 * statement runs inside the transaction that is open in the current async
 * context, if any; otherwise it runs as an isolated autocommit statement. No
 * store receives or threads a transaction handle.
 */

export type SqlValue = string | number | bigint | boolean | null | Uint8Array

export type SqlParams = readonly SqlValue[]

export type SqlDialect = 'sqlite'

export interface SqlRunResult {
    readonly changes: number
}

export interface SqlStatement<Row, Params extends SqlParams = SqlParams> {
    /** First row, or `null` when the statement produced none. */
    get(...params: Params): Promise<Row | null>
    all(...params: Params): Promise<Row[]>
    run(...params: Params): Promise<SqlRunResult>
    /** Rows as positional arrays, in select-list order. */
    values(...params: Params): Promise<unknown[][]>
    /**
     * Streams rows one at a time. The SQLite profile holds the connection
     * until iteration ends, so consumers must not perform external I/O
     * while iterating.
     */
    iterate(...params: Params): AsyncIterable<Row>
}

/**
 * `immediate` takes the write reservation when the transaction begins. In the
 * SQLite profile every transaction is already serialized by the writer gate,
 * so the modes keep SQLite's lock-acquisition semantics without adding
 * concurrency.
 */
export type SqlTransactionMode = 'deferred' | 'immediate' | 'exclusive'

export type SqlCommitScope = 'savepoint' | 'transaction'

export interface SqlDatabase {
    readonly dialect: SqlDialect
    statement<Row = unknown, Params extends SqlParams = SqlParams>(
        text: string
    ): SqlStatement<Row, Params>
    /** Runs one or more statements without results (DDL, pragmas). */
    exec(text: string): Promise<void>
    /**
     * Runs `operation` in a transaction bound to the current async context.
     * Nested calls create savepoints. Commit observers run after the
     * outermost commit only. The operation must not perform external I/O.
     */
    transaction<T>(operation: () => Promise<T>, mode?: SqlTransactionMode): Promise<T>
    /** Whether the current async context runs inside a transaction of this database. */
    inTransaction(): boolean
    /**
     * Identity of the outermost transaction open in the current async context,
     * stable across its savepoints, or `undefined` outside a transaction.
     */
    transactionScope(): object | undefined
    /**
     * Registers a callback run once after the outermost transaction of the
     * current context commits. Outside a transaction it runs immediately.
     * With the default `savepoint` scope the callback is discarded when the
     * enclosing savepoint rolls back; `transaction` binds it to the outermost
     * transaction instead.
     */
    afterCommit(callback: () => void, scope?: SqlCommitScope): void
}
