import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { DatabaseHandle } from '../client'
import { defaultMigrationsFolder, runMigrations } from '../migrations'
import { loadPortableMigrations } from '../sql/migrator'
import type { SqlDatabase, SqlValue } from '../sql/port'
import { describeSchema, type ColumnDescription } from '../sql/schema-introspection'

/**
 * Offline transfer of a Postdot database between engines (ADR-097 §8).
 *
 * An export is a directory: `manifest.json` and one `tables/<name>.ndjson`
 * file per table, each line a JSON array of the row's values in the manifest's
 * column order. Values are encoded from the declared column type, rows are
 * ordered by primary key in byte order, so the same data exports to the same
 * bytes from SQLite and from PostgreSQL. An import refuses a target that is
 * not empty or not at the export's schema, and verifies before committing
 * that the target re-exports to exactly the manifest's checksums.
 */
export const transferFormat = 'postdot-database-transfer'
export const transferFormatVersion = 1

const manifestFilename = 'manifest.json'

export type TransferColumnType = ColumnDescription['type']

export interface TransferManifest {
    readonly format: typeof transferFormat
    readonly version: typeof transferFormatVersion
    readonly createdAt: number
    readonly sourceEngine: SqlDatabase['dialect']
    /** The schema version: every applied migration, in order. */
    readonly migrations: readonly TransferMigration[]
    readonly tables: readonly TransferTable[]
    /** High-water marks of generated keys (journal sequence), by table. */
    readonly sequences: Readonly<Record<string, number>>
}

export interface TransferMigration {
    readonly id: number
    readonly name: string
    readonly checksum: string
}

export interface TransferTable {
    readonly name: string
    readonly columns: readonly { readonly name: string; readonly type: TransferColumnType }[]
    readonly file: string
    readonly rows: number
    readonly sha256: string
}

export interface ExportDatabaseOptions {
    readonly migrationsFolder?: string
    readonly now?: () => number
}

export interface ImportDatabaseOptions {
    readonly migrationsFolder?: string
}

/** Rows that migrations seed into an empty database; an import replaces them. */
const seededRows: Readonly<Record<string, string>> = {
    instance_state: `select count(*) as count from instance_state
                     where not (id = 'default' and state = 'claimable')`,
}

interface TableShape {
    readonly name: string
    readonly columns: readonly { readonly name: string; readonly type: TransferColumnType }[]
    readonly primaryKey: readonly string[]
    /** Tables this one references, for insertion order. */
    readonly references: readonly string[]
}

/** Writes an export of `database` to `directory`, which must not exist. */
export async function exportDatabase(
    database: DatabaseHandle,
    directory: string,
    options: ExportDatabaseOptions = {}
): Promise<TransferManifest> {
    const destination = resolve(directory)
    if (existsSync(destination))
        throw new Error(`Export destination already exists: ${destination}`)
    const migrations = await appliedMigrations(database.sql)
    assertCurrentMigrations(migrations, options.migrationsFolder)
    const temporary = `${destination}.${randomUUID()}.export`
    await mkdir(dirname(destination), { recursive: true })
    try {
        await mkdir(join(temporary, 'tables'), { recursive: true, mode: 0o700 })
        // One snapshot for every table: the export is consistent even if read twice.
        const { tables, sequences } = await database.sql.transaction(async () => {
            const shapes = await tableShapes(database)
            const tables: TransferTable[] = []
            for (const shape of shapes) {
                const file = `tables/${shape.name}.ndjson`
                const encoded = await encodeTable(database.sql, shape)
                await writeFile(join(temporary, file), encoded.text, { mode: 0o600 })
                tables.push({
                    name: shape.name,
                    columns: shape.columns,
                    file,
                    rows: encoded.rows,
                    sha256: encoded.sha256,
                })
            }
            return { tables, sequences: await readSequences(database.sql, shapes) }
        }, 'deferred')
        const manifest: TransferManifest = {
            format: transferFormat,
            version: transferFormatVersion,
            createdAt: (options.now ?? Date.now)(),
            sourceEngine: database.sql.dialect,
            migrations,
            tables,
            sequences,
        }
        await writeFile(
            join(temporary, manifestFilename),
            `${JSON.stringify(manifest, null, 2)}\n`,
            { mode: 0o600 }
        )
        await rename(temporary, destination)
        return manifest
    } catch (error) {
        await rm(temporary, { recursive: true, force: true })
        throw error
    }
}

/** Reads and verifies an export: manifest shape, file checksums and row counts. */
export async function readTransfer(directory: string): Promise<{
    readonly manifest: TransferManifest
    readonly rows: (table: TransferTable) => unknown[][]
}> {
    const source = resolve(directory)
    const manifest = parseManifest(
        JSON.parse(await readFile(join(source, manifestFilename), 'utf8')) as unknown
    )
    const contents = new Map<string, string>()
    for (const table of manifest.tables) {
        const text = await readFile(join(source, table.file), 'utf8')
        if (sha256(text) !== table.sha256) {
            throw new Error(`Export file ${table.file} does not match its manifest checksum`)
        }
        const lines = text.length === 0 ? 0 : text.split('\n').length - 1
        if (lines !== table.rows) {
            throw new Error(`Export file ${table.file} has ${lines} rows, not ${table.rows}`)
        }
        contents.set(table.name, text)
    }
    return {
        manifest,
        rows: table =>
            contents
                .get(table.name)!
                .split('\n')
                .filter(line => line.length > 0)
                .map(line => JSON.parse(line) as unknown[]),
    }
}

/**
 * Imports an export into an empty database: no tables at all, or only what
 * this release's migrations create. The database ends at the export's schema
 * with exactly its rows, or is left unchanged.
 */
export async function importDatabase(
    database: DatabaseHandle,
    directory: string,
    options: ImportDatabaseOptions = {}
): Promise<TransferManifest> {
    const { sql } = database
    const { manifest, rows } = await readTransfer(directory)
    assertCurrentMigrations(manifest.migrations, options.migrationsFolder)
    if (!(await hasMigrationHistory(sql)) && (await userTables(sql)).length > 0) {
        throw new Error('The target database is not empty; import needs an empty database')
    }
    await runMigrations(database, options.migrationsFolder ?? defaultMigrationsFolder)
    const target = await appliedMigrations(sql)
    if (JSON.stringify(target) !== JSON.stringify(manifest.migrations)) {
        throw new Error('The target database is not at the export schema version')
    }
    const shapes = await tableShapes(database)
    assertSameTables(shapes, manifest)
    await assertEmpty(sql, shapes)

    const foreignKeysWereEnabled =
        sql.dialect === 'sqlite' &&
        (await sql.statement<{ foreign_keys: number }>('pragma foreign_keys').get())
            ?.foreign_keys === 1
    // SQLite checks foreign keys explicitly before commit; PostgreSQL defers them.
    if (sql.dialect === 'sqlite') await sql.exec('pragma foreign_keys = off')
    try {
        await sql.transaction(async () => {
            const restoreTriggers = await suspendTriggers(sql, shapes)
            if (sql.dialect === 'postgres') await sql.exec('set constraints all deferred')
            for (const table of Object.keys(seededRows)) {
                await sql.exec(`delete from ${quote(table)}`)
            }
            const byName = new Map(manifest.tables.map(table => [table.name, table]))
            for (const shape of insertionOrder(shapes)) {
                const table = byName.get(shape.name)!
                await insertRows(sql, shape, table, rows(table))
            }
            await writeSequences(sql, manifest.sequences)
            // PostgreSQL cannot alter a table with pending deferred checks: run them first.
            if (sql.dialect === 'postgres') await sql.exec('set constraints all immediate')
            await restoreTriggers()
            if (sql.dialect === 'sqlite') {
                const violations = await sql.statement('pragma foreign_key_check').all()
                if (violations.length > 0) {
                    throw new Error(
                        `The export would leave foreign-key violations: ${JSON.stringify(violations.slice(0, 5))}`
                    )
                }
            }
            await verifyImport(sql, shapes, manifest)
        }, 'immediate')
    } finally {
        if (sql.dialect === 'sqlite') {
            await sql.exec(`pragma foreign_keys = ${foreignKeysWereEnabled ? 'on' : 'off'}`)
        }
    }
    return manifest
}

async function verifyImport(
    sql: SqlDatabase,
    shapes: readonly TableShape[],
    manifest: TransferManifest
): Promise<void> {
    const byName = new Map(manifest.tables.map(table => [table.name, table]))
    for (const shape of shapes) {
        const encoded = await encodeTable(sql, shape)
        const expected = byName.get(shape.name)!
        if (encoded.sha256 !== expected.sha256 || encoded.rows !== expected.rows) {
            throw new Error(
                `Imported table ${shape.name} does not reproduce the export (${encoded.rows} rows); nothing was imported`
            )
        }
    }
    const sequences = await readSequences(sql, shapes)
    if (JSON.stringify(sequences) !== JSON.stringify(manifest.sequences)) {
        throw new Error('Imported key sequences do not reproduce the export; nothing was imported')
    }
}

function quote(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`
}

function sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex')
}

async function appliedMigrations(sql: SqlDatabase): Promise<TransferMigration[]> {
    if (!(await hasMigrationHistory(sql))) return []
    const rows = await sql
        .statement<{ id: number; name: string; checksum: string }>(
            'select id, name, checksum from postdot_migrations order by id'
        )
        .all()
    return rows.map(row => ({ id: Number(row.id), name: row.name, checksum: row.checksum }))
}

function assertCurrentMigrations(
    migrations: readonly TransferMigration[],
    folder: string | undefined
): void {
    const release = loadPortableMigrations(folder ?? defaultMigrationsFolder).map(migration => ({
        id: migration.id,
        name: migration.name,
        checksum: migration.checksum,
    }))
    if (JSON.stringify(release) !== JSON.stringify(migrations)) {
        throw new Error(
            'The database schema version differs from this release. Start this release on the ' +
                'source database once so it migrates, stop it, then transfer.'
        )
    }
}

async function hasMigrationHistory(sql: SqlDatabase): Promise<boolean> {
    return (await userTables(sql)).includes('postdot_migrations')
}

async function userTables(sql: SqlDatabase): Promise<string[]> {
    const rows =
        sql.dialect === 'sqlite'
            ? await sql
                  .statement<{ name: string }>(
                      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"
                  )
                  .all()
            : await sql
                  .statement<{ name: string }>(
                      `select table_name as name from information_schema.tables
                       where table_schema = current_schema() and table_type = 'BASE TABLE'`
                  )
                  .all()
    return rows.map(row => row.name)
}

async function tableShapes(database: DatabaseHandle): Promise<TableShape[]> {
    const schema = await describeSchema(database)
    return Object.entries(schema.tables)
        .map(([name, table]) => ({
            name,
            columns: Object.entries(table.columns)
                .map(([column, description]) => ({ name: column, type: description.type }))
                .sort((a, b) => compareBytes(a.name, b.name)),
            primaryKey: table.primaryKey,
            references: [
                ...new Set(
                    table.foreignKeys
                        .map(key => /->([^(]+)\(/.exec(key)?.[1])
                        .filter((parent): parent is string => parent !== undefined)
                ),
            ],
        }))
        .sort((a, b) => compareBytes(a.name, b.name))
}

function compareBytes(a: string, b: string): number {
    return Buffer.compare(Buffer.from(a), Buffer.from(b))
}

/**
 * Parents before children where the graph allows it: PostgreSQL cannot defer
 * the few foreign keys declared without DEFERRABLE. Cycles keep name order and
 * rely on deferred checks.
 */
function insertionOrder(shapes: readonly TableShape[]): TableShape[] {
    const remaining = new Map(shapes.map(shape => [shape.name, shape]))
    const ordered: TableShape[] = []
    while (remaining.size > 0) {
        const ready = [...remaining.values()].filter(shape =>
            shape.references.every(parent => parent === shape.name || !remaining.has(parent))
        )
        const next = ready.length > 0 ? ready : [[...remaining.values()][0]!]
        for (const shape of next) {
            ordered.push(shape)
            remaining.delete(shape.name)
        }
    }
    return ordered
}

function assertSameTables(shapes: readonly TableShape[], manifest: TransferManifest): void {
    const describe = (tables: readonly Pick<TableShape, 'name' | 'columns'>[]) =>
        JSON.stringify(tables.map(table => [table.name, table.columns]))
    if (describe(shapes) !== describe(manifest.tables)) {
        throw new Error('The target schema does not match the export tables and columns')
    }
}

async function assertEmpty(sql: SqlDatabase, shapes: readonly TableShape[]): Promise<void> {
    for (const shape of shapes) {
        const query = seededRows[shape.name] ?? `select count(*) as count from ${quote(shape.name)}`
        const row = await sql.statement<{ count: number }>(query).get()
        if (Number(row?.count ?? 0) > 0) {
            throw new Error(
                `The target database is not empty (table ${shape.name}); import needs an empty database`
            )
        }
    }
}

async function encodeTable(
    sql: SqlDatabase,
    shape: TableShape
): Promise<{ readonly text: string; readonly rows: number; readonly sha256: string }> {
    const textColumn = (name: string) =>
        shape.columns.find(column => column.name === name)?.type === 'text'
    const orderColumns =
        shape.primaryKey.length > 0 ? shape.primaryKey : shape.columns.map(c => c.name)
    // Byte order on both engines: SQLite compares text with memcmp, PostgreSQL
    // needs the C collation to do the same.
    const order = orderColumns
        .map(name =>
            sql.dialect === 'postgres' && textColumn(name)
                ? `${quote(name)} collate "C"`
                : quote(name)
        )
        .join(', ')
    const rows = await sql
        .statement<Record<string, unknown>>(
            `select ${shape.columns.map(column => quote(column.name)).join(', ')} from ${quote(shape.name)} order by ${order}`
        )
        .all()
    let text = ''
    for (const row of rows) {
        const values = shape.columns.map(column =>
            encodeValue(shape.name, column, row[column.name])
        )
        text += `${JSON.stringify(values)}\n`
    }
    return { text, rows: rows.length, sha256: sha256(text) }
}

function encodeValue(
    table: string,
    column: { readonly name: string; readonly type: TransferColumnType },
    value: unknown
): unknown {
    if (value === null || value === undefined) return null
    const fail = () =>
        new Error(
            `Column ${table}.${column.name} (${column.type}) holds an unsupported ${typeof value} value`
        )
    switch (column.type) {
        case 'integer':
            if (typeof value === 'number' && Number.isSafeInteger(value)) return value
            throw fail()
        case 'real':
        case 'numeric':
            if (typeof value === 'number' && Number.isFinite(value)) return value
            throw fail()
        case 'text':
            if (typeof value === 'string') return value
            throw fail()
        case 'blob':
            if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
            throw fail()
    }
}

function decodeValue(
    column: { readonly name: string; readonly type: TransferColumnType },
    value: unknown
): SqlValue {
    if (value === null) return null
    if (column.type === 'blob' && typeof value === 'string') {
        return new Uint8Array(Buffer.from(value, 'base64'))
    }
    if (typeof value === 'string' || typeof value === 'number') return value
    throw new Error(`Export value for column ${column.name} is not valid`)
}

async function insertRows(
    sql: SqlDatabase,
    shape: TableShape,
    table: TransferTable,
    rows: readonly unknown[][]
): Promise<void> {
    const columns = table.columns
    const batch = Math.max(1, Math.floor(900 / columns.length))
    const head = `insert into ${quote(shape.name)} (${columns.map(c => quote(c.name)).join(', ')}) values `
    const tuple = `(${columns.map(() => '?').join(', ')})`
    try {
        for (let start = 0; start < rows.length; start += batch) {
            const chunk = rows.slice(start, start + batch)
            const params = chunk.flatMap(row => {
                if (!Array.isArray(row) || row.length !== columns.length) {
                    throw new Error('A row does not match the manifest columns')
                }
                return row.map((value, index) => decodeValue(columns[index]!, value))
            })
            await sql.statement(head + chunk.map(() => tuple).join(', ')).run(...params)
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Importing table ${shape.name} failed: ${message}`, { cause: error })
    }
}

/**
 * Turns off user triggers while rows are copied: they would reject rows of
 * retired resources or add derived rows that the export already contains.
 * SQLite has no switch, so its triggers are dropped and recreated from their
 * own definitions inside the transaction.
 */
async function suspendTriggers(
    sql: SqlDatabase,
    shapes: readonly TableShape[]
): Promise<() => Promise<void>> {
    if (sql.dialect === 'postgres') {
        for (const shape of shapes) {
            await sql.exec(`alter table ${quote(shape.name)} disable trigger user`)
        }
        return async () => {
            for (const shape of shapes) {
                await sql.exec(`alter table ${quote(shape.name)} enable trigger user`)
            }
        }
    }
    const triggers = await sql
        .statement<{ name: string; sql: string }>(
            "select name, sql from sqlite_master where type = 'trigger' order by name"
        )
        .all()
    for (const trigger of triggers) await sql.exec(`drop trigger ${quote(trigger.name)}`)
    return async () => {
        for (const trigger of triggers) await sql.exec(trigger.sql)
    }
}

/** Tables whose key is generated: AUTOINCREMENT on SQLite, identity on PostgreSQL. */
async function sequencedColumns(
    sql: SqlDatabase,
    shapes: readonly TableShape[]
): Promise<{ readonly table: string; readonly column: string }[]> {
    if (sql.dialect === 'postgres') {
        return sql
            .statement<{ table: string; column: string }>(
                `select table_name as "table", column_name as "column"
                 from information_schema.columns
                 where table_schema = current_schema() and is_identity = 'YES'
                 order by table_name`
            )
            .all()
    }
    const rows = await sql
        .statement<{ name: string; sql: string }>(
            "select name, sql from sqlite_master where type = 'table' order by name"
        )
        .all()
    return rows
        .filter(row => /\bautoincrement\b/i.test(row.sql))
        .map(row => ({
            table: row.name,
            column: shapes.find(shape => shape.name === row.name)?.primaryKey[0] ?? 'rowid',
        }))
}

async function readSequences(
    sql: SqlDatabase,
    shapes: readonly TableShape[]
): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    for (const { table, column } of await sequencedColumns(sql, shapes)) {
        const used = await sql
            .statement<{ value: number | null }>(
                `select max(${quote(column)}) as value from ${quote(table)}`
            )
            .get()
        const mark =
            sql.dialect === 'postgres'
                ? await sql
                      .statement<{ value: number | null }, [string, string]>(
                          'select pg_sequence_last_value(pg_get_serial_sequence(?1, ?2)::regclass) as value'
                      )
                      .get(quote(table), column)
                : await sql
                      .statement<{ value: number | null }, [string]>(
                          'select seq as value from sqlite_sequence where name = ?1'
                      )
                      .get(table)
        result[table] = Math.max(Number(used?.value ?? 0), Number(mark?.value ?? 0))
    }
    return result
}

async function writeSequences(
    sql: SqlDatabase,
    sequences: Readonly<Record<string, number>>
): Promise<void> {
    const columns = new Map(
        (await sequencedColumns(sql, [])).map(entry => [entry.table, entry.column])
    )
    if (
        JSON.stringify([...columns.keys()].sort()) !== JSON.stringify(Object.keys(sequences).sort())
    ) {
        throw new Error('The target key sequences do not match the export')
    }
    for (const [table, value] of Object.entries(sequences)) {
        if (sql.dialect === 'postgres') {
            if (value === 0) continue
            await sql
                .statement<unknown, [string, string, number]>(
                    'select setval(pg_get_serial_sequence(?1, ?2), ?3, true)'
                )
                .get(quote(table), columns.get(table)!, value)
        } else {
            await sql
                .statement<never, [string]>('delete from sqlite_sequence where name = ?1')
                .run(table)
            if (value > 0) {
                await sql
                    .statement<never, [string, number]>(
                        'insert into sqlite_sequence (name, seq) values (?1, ?2)'
                    )
                    .run(table, value)
            }
        }
    }
}

function parseManifest(value: unknown): TransferManifest {
    const manifest = value as Partial<TransferManifest> | null
    if (
        manifest === null ||
        typeof manifest !== 'object' ||
        manifest.format !== transferFormat ||
        manifest.version !== transferFormatVersion ||
        !Array.isArray(manifest.migrations) ||
        !Array.isArray(manifest.tables) ||
        typeof manifest.sequences !== 'object' ||
        manifest.sequences === null
    ) {
        throw new Error('This directory does not hold a Postdot database export')
    }
    for (const table of manifest.tables) {
        if (
            typeof table.name !== 'string' ||
            table.file !== `tables/${table.name}.ndjson` ||
            !/^[a-z0-9_]+$/.test(table.name) ||
            !Array.isArray(table.columns) ||
            typeof table.sha256 !== 'string' ||
            !Number.isSafeInteger(table.rows)
        ) {
            throw new Error('The export manifest describes a table it cannot hold')
        }
    }
    return manifest as TransferManifest
}
