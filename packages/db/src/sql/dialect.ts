import type { SqlDialect } from './port'

const simpleJsonKeyPattern = /^[A-Za-z_]\w*$/

/**
 * Validates parameter placeholders in a raw SQL statement and translates them
 * to the target engine's placeholder syntax (`?1..?N` on SQLite, `$1..$N` on
 * PostgreSQL).
 *
 * Rules enforced at statement creation time:
 * - A statement may use either unnumbered `?` placeholders or numbered `?N`
 *   placeholders (`N >= 1`), never a mix of both.
 * - Numbered placeholders must form a contiguous `1..max` range with no gaps,
 *   because PostgreSQL rejects queries where `$1..$max` omits an index.
 * - Placeholders inside single-quoted literals, double-quoted identifiers,
 *   `--` line comments, and `/* ... *\/` block comments are ignored.
 */
export function normalizeStatementSql(text: string, dialect: SqlDialect): string {
    let mode: 'unnumbered' | 'numbered' | null = null
    let unnumberedIndex = 0
    const numberedIndices = new Set<number>()
    let out = ''
    let index = 0

    while (index < text.length) {
        const ch = text[index]!

        // Single-quoted string literal ('...' with '' escapes)
        if (ch === "'") {
            const start = index
            index += 1
            while (index < text.length) {
                if (text[index] === "'") {
                    index += 1
                    if (text[index] === "'") {
                        index += 1
                        continue
                    }
                    break
                }
                index += 1
            }
            out += text.slice(start, index)
            continue
        }

        // Double-quoted identifier ("..." with "" escapes)
        if (ch === '"') {
            const start = index
            index += 1
            while (index < text.length) {
                if (text[index] === '"') {
                    index += 1
                    if (text[index] === '"') {
                        index += 1
                        continue
                    }
                    break
                }
                index += 1
            }
            out += text.slice(start, index)
            continue
        }

        // Line comment (-- ...)
        if (ch === '-' && text[index + 1] === '-') {
            const start = index
            index += 2
            while (index < text.length && text[index] !== '\n') {
                index += 1
            }
            out += text.slice(start, index)
            continue
        }

        // Block comment (/* ... */)
        if (ch === '/' && text[index + 1] === '*') {
            const start = index
            index += 2
            while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
                index += 1
            }
            if (index < text.length) index += 2
            out += text.slice(start, index)
            continue
        }

        if (ch === '?') {
            let digitEnd = index + 1
            while (digitEnd < text.length) {
                const code = text.charCodeAt(digitEnd)
                if (code < 48 || code > 57) break
                digitEnd += 1
            }

            if (digitEnd > index + 1) {
                const digits = text.slice(index + 1, digitEnd)
                if (digits.startsWith('0')) {
                    throw new Error(
                        `Invalid SQL parameter placeholder "?${digits}": parameter numbers must start at 1`
                    )
                }
                if (mode === 'unnumbered') {
                    throw new Error(
                        `SQL statement cannot mix unnumbered (?) and numbered (?N) parameter placeholders in: ${text.replace(/\s+/g, ' ').trim().slice(0, 200)}`
                    )
                }
                mode = 'numbered'
                const paramNumber = Number(digits)
                numberedIndices.add(paramNumber)
                out += dialect === 'postgres' ? `$${paramNumber}` : `?${paramNumber}`
                index = digitEnd
                continue
            }

            if (mode === 'numbered') {
                throw new Error(
                    'SQL statement cannot mix unnumbered (?) and numbered (?N) parameter placeholders'
                )
            }
            mode = 'unnumbered'
            unnumberedIndex += 1
            out += dialect === 'postgres' ? `$${unnumberedIndex}` : `?${unnumberedIndex}`
            index += 1
            continue
        }

        out += ch
        index += 1
    }

    if (mode === 'numbered') {
        for (let expected = 1; expected <= numberedIndices.size; expected += 1) {
            if (!numberedIndices.has(expected)) {
                throw new Error(
                    `SQL statement parameter placeholders must be contiguous starting at ?1; missing ?${expected} in: ${text.replace(/\s+/g, ' ').trim().slice(0, 160)}`
                )
            }
        }
    }

    return out
}

function validateJsonPath(path: readonly [string, ...string[]]): void {
    for (const segment of path) {
        if (!simpleJsonKeyPattern.test(segment)) {
            throw new Error(`Unsupported JSON path segment "${segment}"`)
        }
    }
}

/**
 * Extracts a text scalar at `path` from a JSON object column (`null` when missing).
 */
export function jsonExtractTextSql(
    dialect: SqlDialect,
    columnSql: string,
    path: readonly [string, ...string[]]
): string {
    validateJsonPath(path)
    if (dialect === 'sqlite') {
        return `json_extract(${columnSql}, '$.${path.join('.')}')`
    }
    if (path.length === 1) {
        return `((${columnSql})::jsonb ->> '${path[0]}')`
    }
    return `((${columnSql})::jsonb #>> '{${path.join(',')}}')`
}

/**
 * Extracts an integer scalar at `path` from a JSON object column (`null` when missing).
 */
export function jsonExtractIntSql(
    dialect: SqlDialect,
    columnSql: string,
    path: readonly [string, ...string[]]
): string {
    validateJsonPath(path)
    if (dialect === 'sqlite') {
        return `json_extract(${columnSql}, '$.${path.join('.')}')`
    }
    return `(${jsonExtractTextSql('postgres', columnSql, path)}::integer)`
}

/**
 * Extracts a nested JSON value at `path` as serialized JSON text (`null` when missing).
 */
export function jsonExtractJsonTextSql(
    dialect: SqlDialect,
    columnSql: string,
    path: readonly [string, ...string[]]
): string {
    validateJsonPath(path)
    if (dialect === 'sqlite') {
        return `json_extract(${columnSql}, '$.${path.join('.')}')`
    }
    if (path.length === 1) {
        return `(((${columnSql})::jsonb -> '${path[0]}')::text)`
    }
    return `(((${columnSql})::jsonb #> '{${path.join(',')}}')::text)`
}

/**
 * Table-valued source yielding `(value)` text elements from a JSON string array parameter.
 */
export function jsonEachTextFromSql(
    dialect: SqlDialect,
    jsonArrayParamSql: string,
    alias = 'json_items'
): string {
    if (!simpleJsonKeyPattern.test(alias)) {
        throw new Error(`Invalid SQL alias "${alias}"`)
    }
    if (dialect === 'sqlite') {
        return `json_each(${jsonArrayParamSql}) as ${alias}`
    }
    return `jsonb_array_elements_text((${jsonArrayParamSql})::jsonb) as ${alias}(value)`
}

/**
 * Aggregates scalar text values into a serialized JSON array string.
 */
export function jsonGroupArrayTextSql(dialect: SqlDialect, valueSql: string): string {
    if (dialect === 'sqlite') {
        return `json_group_array(${valueSql})`
    }
    return `(jsonb_agg(${valueSql})::text)`
}

/**
 * Predicate testing whether a JSON document contains a string scalar leaf equal to `valueParamSql`.
 */
export function jsonContainsTextScalarSql(
    dialect: SqlDialect,
    columnSql: string,
    valueParamSql: string
): string {
    if (dialect === 'sqlite') {
        return `exists (select 1 from json_tree(${columnSql}) as content where content.type = 'text' and content.value = ${valueParamSql})`
    }
    return `jsonb_path_exists((${columnSql})::jsonb, '$.** ? (@.type() == "string" && @ == $val)', jsonb_build_object('val', (${valueParamSql})::text))`
}

/**
 * Case-insensitive substring match without `LIKE` wildcard interpretation.
 */
export function containsCaseInsensitiveSql(
    dialect: SqlDialect,
    haystackSql: string,
    needleSql: string
): string {
    if (dialect === 'sqlite') {
        return `instr(lower(${haystackSql}), lower(${needleSql})) > 0`
    }
    return `strpos(lower(${haystackSql}), lower(${needleSql})) > 0`
}

/**
 * Null-propagating scalar maximum across two or more expressions.
 *
 * SQLite's multi-argument `max(a, b, ...)` returns `NULL` if any argument is
 * `NULL`, whereas PostgreSQL's `greatest(a, b, ...)` ignores `NULL`s unless all
 * arguments are `NULL`. The PostgreSQL branch preserves SQLite's null-propagation
 * semantics.
 */
export function scalarMaxSql(
    dialect: SqlDialect,
    ...expressions: readonly [string, string, ...string[]]
): string {
    if (dialect === 'sqlite') {
        return `max(${expressions.join(', ')})`
    }
    const nullChecks = expressions.map(expr => `(${expr}) is null`).join(' or ')
    return `(case when ${nullChecks} then null else greatest(${expressions.join(', ')}) end)`
}

/**
 * Current UTC epoch timestamp in integer milliseconds.
 */
export function nowMillisSql(dialect: SqlDialect): string {
    if (dialect === 'sqlite') {
        return "cast(unixepoch('subsecond') * 1000 as integer)"
    }
    return '(floor(extract(epoch from clock_timestamp()) * 1000)::bigint)'
}

/**
 * Query returning the monotonic high-water mark of `audit_events.sequence`,
 * including sequences allocated to rows that were subsequently deleted.
 */
export function auditEventSequenceHighWaterSql(dialect: SqlDialect): string {
    if (dialect === 'sqlite') {
        return "select seq as sequence from sqlite_sequence where name = 'audit_events'"
    }
    return "select case when is_called then last_value else 0 end as sequence from pg_sequences where schemaname = current_schema() and sequencename = 'audit_events_sequence_seq'"
}

/**
 * Statement that defers foreign key constraint checks until the outermost transaction commits.
 */
export function deferForeignKeysSql(dialect: SqlDialect): string {
    if (dialect === 'sqlite') {
        return 'pragma defer_foreign_keys = on'
    }
    return 'set constraints all deferred'
}

/**
 * Classifies unique-constraint violations across SQLite (`bun:sqlite`) and PostgreSQL (`Bun.SQL`).
 */
export function isUniqueConstraintError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const code = (error as { readonly code?: unknown }).code
    if (
        code === '23505' ||
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    ) {
        return true
    }
    return /unique constraint failed|duplicate key value violates unique constraint/i.test(
        error.message
    )
}

/**
 * Classifies database trigger rejections raised when a workspace or project is read-only.
 */
export function isResourceReadOnlyTriggerError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.message === 'resource_read_only' || /\bresource_read_only\b/.test(error.message)
}
