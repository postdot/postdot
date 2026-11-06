import type { DatabaseHandle } from '../client'

/**
 * Engine-neutral description of a migrated schema (ADR-097 §6). The parity
 * tests compare these descriptions across engines and against the historical
 * SQLite chain; future adoption of an existing database relies on the same
 * comparison.
 */
export interface SchemaDescription {
    readonly tables: Record<string, TableDescription>
    readonly views: Record<string, readonly string[]>
    readonly triggers: readonly string[]
}

export interface TableDescription {
    readonly columns: Record<string, ColumnDescription>
    readonly primaryKey: readonly string[]
    readonly indexes: Record<string, IndexDescription>
    readonly foreignKeys: readonly string[]
    readonly checks: number
}

export interface ColumnDescription {
    readonly type: 'integer' | 'text' | 'blob' | 'real' | 'numeric'
    readonly notNull: boolean
    readonly hasDefault: boolean
}

export interface IndexDescription {
    readonly unique: boolean
    readonly partial: boolean
    readonly columns: readonly string[]
}

/** PostgreSQL truncates identifiers to 63 bytes. */
export const identifierLimit = 63
const identifier = (name: string) => name.slice(0, identifierLimit)

function typeClass(declared: string): ColumnDescription['type'] {
    const type = declared.toLowerCase()
    if (/int/.test(type)) return 'integer'
    if (/char|clob|text/.test(type)) return 'text'
    if (/blob|bytea/.test(type)) return 'blob'
    if (/real|floa|doub/.test(type)) return 'real'
    return 'numeric'
}

export async function describeSchema(database: DatabaseHandle): Promise<SchemaDescription> {
    return database.sql.dialect === 'postgres'
        ? describePostgres(database)
        : describeSqlite(database)
}

const ignoredTables = new Set(['postdot_migrations', '__drizzle_migrations'])

async function describeSqlite(database: DatabaseHandle): Promise<SchemaDescription> {
    const { sql } = database
    const objects = await sql
        .statement<{ type: string; name: string; tableName: string; sql: string }>(
            `select type, name, tbl_name as tableName, sql from sqlite_master
             where name not like 'sqlite_%' and sql is not null order by name`
        )
        .all()
    const tables: Record<string, TableDescription> = {}
    for (const object of objects.filter(o => o.type === 'table' && !ignoredTables.has(o.name))) {
        const columns = await sql
            .statement<{
                name: string
                type: string
                notnull: number
                dflt_value: string | null
                pk: number
            }>(
                `select name, type, "notnull", dflt_value, pk from pragma_table_info('${object.name}')`
            )
            .all()
        const indexList = await sql
            .statement<{ name: string; unique: number; origin: string; partial: number }>(
                `select name, "unique", origin, partial from pragma_index_list('${object.name}')`
            )
            .all()
        const indexes: Record<string, IndexDescription> = {}
        for (const index of indexList.filter(i => i.origin === 'c')) {
            const parts = await sql
                .statement<{ name: string | null; key: number }>(
                    `select name, key from pragma_index_xinfo('${index.name}') where key = 1 order by seqno`
                )
                .all()
            indexes[identifier(index.name)] = {
                unique: index.unique === 1,
                partial: index.partial === 1,
                columns: parts.map(part => part.name ?? '<expression>'),
            }
        }
        const foreignKeys = await sql
            .statement<{ id: number; table: string; from: string; to: string; on_delete: string }>(
                `select id, "table", "from", "to", on_delete from pragma_foreign_key_list('${object.name}') order by id, seq`
            )
            .all()
        tables[object.name] = {
            columns: Object.fromEntries(
                columns.map(column => [
                    column.name,
                    {
                        type: typeClass(column.type),
                        notNull: column.notnull === 1 || column.pk > 0,
                        hasDefault: column.dflt_value !== null,
                    },
                ])
            ),
            primaryKey: columns
                .filter(column => column.pk > 0)
                .sort((a, b) => a.pk - b.pk)
                .map(column => column.name),
            indexes,
            foreignKeys: groupForeignKeys(foreignKeys),
            checks: (object.sql.match(/\bcheck\s*\(/gi) ?? []).length,
        }
    }
    const views: Record<string, readonly string[]> = {}
    for (const view of objects.filter(o => o.type === 'view')) {
        views[view.name] = (
            await sql
                .statement<{ name: string }>(`select name from pragma_table_info('${view.name}')`)
                .all()
        ).map(column => column.name)
    }
    return {
        tables,
        views,
        triggers: objects
            .filter(o => o.type === 'trigger')
            .map(o => o.name)
            .sort(),
    }
}

function groupForeignKeys(
    rows: readonly { id: number; table: string; from: string; to: string; on_delete: string }[]
): string[] {
    const groups = new Map<
        number,
        { table: string; from: string[]; to: string[]; onDelete: string }
    >()
    for (const row of rows) {
        const group = groups.get(row.id) ?? {
            table: row.table,
            from: [],
            to: [],
            onDelete: row.on_delete.toLowerCase(),
        }
        group.from.push(row.from)
        group.to.push(row.to)
        groups.set(row.id, group)
    }
    return [...groups.values()]
        .map(g => `(${g.from.join(',')})->${g.table}(${g.to.join(',')}) on delete ${g.onDelete}`)
        .sort()
}

async function describePostgres(database: DatabaseHandle): Promise<SchemaDescription> {
    const { sql } = database
    const tableRows = await sql
        .statement<{ name: string; kind: string }>(
            `select c.relname as name, c.relkind as kind from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = current_schema() and c.relkind in ('r', 'v') order by c.relname`
        )
        .all()
    const tables: Record<string, TableDescription> = {}
    const views: Record<string, readonly string[]> = {}
    for (const table of tableRows) {
        if (ignoredTables.has(table.name)) continue
        const columns = await sql
            .statement<
                {
                    name: string
                    type: string
                    notNull: number
                    hasDefault: number
                    identity: number
                },
                [string]
            >(
                `select a.attname as name,
                        format_type(coalesce(nullif(t.typbasetype, 0), a.atttypid), null) ||
                            case when t.typname = 'blob' then ' blob' else '' end as type,
                        a.attnotnull::int as notNull, a.atthasdef::int as hasDefault,
                        (a.attidentity <> '')::int as identity
                 from pg_attribute a join pg_class c on c.oid = a.attrelid
                 join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
                 join pg_type t on t.oid = a.atttypid
                 where c.relname = ?1 and a.attnum > 0 and not a.attisdropped
                 order by a.attnum`
            )
            .all(table.name)
        if (table.kind === 'v') {
            views[table.name] = columns.map(column => column.name)
            continue
        }
        const constraints = await sql
            .statement<{ name: string; type: string; definition: string }, [string]>(
                `select con.conname as name, con.contype as type, pg_get_constraintdef(con.oid) as definition
                 from pg_constraint con join pg_class c on c.oid = con.conrelid
                 join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
                 where c.relname = ?1`
            )
            .all(table.name)
        const primary = constraints.find(c => c.type === 'p')
        const indexRows = await sql
            .statement<
                { name: string; unique: number; partial: number; definition: string },
                [string]
            >(
                `select i.relname as name, x.indisunique::int as unique,
                        (x.indpred is not null)::int as partial, pg_get_indexdef(x.indexrelid) as definition
                 from pg_index x join pg_class i on i.oid = x.indexrelid
                 join pg_class c on c.oid = x.indrelid
                 join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
                 where c.relname = ?1 and not x.indisprimary`
            )
            .all(table.name)
        const indexes: Record<string, IndexDescription> = {}
        for (const index of indexRows) {
            const list = firstParenthesized(index.definition)
            indexes[index.name] = {
                unique: index.unique === 1,
                partial: index.partial === 1,
                columns: splitTopLevel(list).map(part =>
                    /^"?\w+"?$/.test(part.trim()) ? part.trim().replaceAll('"', '') : '<expression>'
                ),
            }
        }
        tables[table.name] = {
            columns: Object.fromEntries(
                columns.map(column => [
                    column.name,
                    {
                        type: typeClass(column.type.endsWith(' blob') ? 'blob' : column.type),
                        notNull: column.notNull === 1,
                        // An identity column matches SQLite AUTOINCREMENT, which has no default.
                        hasDefault: column.hasDefault === 1 && column.identity === 0,
                    },
                ])
            ),
            primaryKey: primary === undefined ? [] : columnList(primary.definition),
            indexes,
            foreignKeys: constraints
                .filter(c => c.type === 'f')
                .map(c => {
                    const match = /FOREIGN KEY \((.*?)\) REFERENCES "?(\w+)"?\((.*?)\)(.*)$/s.exec(
                        c.definition
                    )!
                    const onDelete =
                        /ON DELETE (CASCADE|SET NULL|RESTRICT|SET DEFAULT)/i
                            .exec(match[4]!)?.[1]
                            ?.toLowerCase() ?? 'no action'
                    return `(${strip(match[1]!)})->${match[2]}(${strip(match[3]!)}) on delete ${onDelete}`
                })
                .sort(),
            checks: constraints.filter(c => c.type === 'c').length,
        }
    }
    const triggers = (
        await sql
            .statement<{ name: string }>(
                `select t.tgname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid
                 join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
                 where not t.tgisinternal order by t.tgname`
            )
            .all()
    ).map(row => row.name)
    return { tables, views, triggers }
}

function strip(list: string): string {
    return list.replaceAll('"', '').replaceAll(' ', '')
}

function columnList(definition: string): string[] {
    return strip(/\((.*)\)/.exec(definition)![1]!).split(',')
}

/** Contents of the first top-level parenthesized group (the index key list). */
function firstParenthesized(definition: string): string {
    const start = definition.indexOf('(')
    let depth = 0
    for (let index = start; index < definition.length; index++) {
        if (definition[index] === '(') depth++
        if (definition[index] === ')' && --depth === 0) return definition.slice(start + 1, index)
    }
    return ''
}

function splitTopLevel(list: string): string[] {
    const parts: string[] = []
    let depth = 0
    let current = ''
    for (const ch of list) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (ch === ',' && depth === 0) {
            parts.push(current)
            current = ''
        } else current += ch
    }
    if (current.trim()) parts.push(current)
    return parts
}
