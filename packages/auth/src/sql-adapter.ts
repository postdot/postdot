import type { DatabaseHandle } from '@postdot/db'
import type { BetterAuthOptions } from 'better-auth'
import {
    createAdapterFactory,
    type AdapterFactoryCustomizeAdapterCreator,
    type CleanedWhere,
    type DBAdapterInstance,
} from 'better-auth/adapters'

/**
 * Better Auth persistence on Postdot's SQL port (ADR-097).
 *
 * Every operation runs inside a port transaction, so Better Auth shares the
 * isolation boundary of Postdot stores: SQLite's writer gate, PostgreSQL's
 * serializable retries, and ambient transactions (a Better Auth hook calling a
 * Postdot store joins the same transaction). The SQL is engine-neutral; tables
 * and columns are the snake_case form of Better Auth's model and field names.
 *
 * Values: dates are epoch milliseconds, booleans 1/0, JSON and arrays text.
 */

type Row = Record<string, unknown>
type Model = { readonly table: string; readonly columns: ReadonlySet<string> }

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

export function snakeCase(name: string): string {
    return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

function camelCase(name: string): string {
    return name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
}

function quote(identifier: string): string {
    if (!identifierPattern.test(identifier)) {
        throw new Error(`Invalid SQL identifier: ${identifier}`)
    }
    return `"${identifier}"`
}

function rowToFields(row: Row | null | undefined): Row | null {
    if (row === null || row === undefined) return null
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelCase(key), value]))
}

/** Collects positional parameters as `?N` placeholders. */
class Parameters {
    readonly values: unknown[] = []
    add(value: unknown): string {
        this.values.push(value)
        return `?${this.values.length}`
    }
}

export function postdotSqlAdapter(database: DatabaseHandle): DBAdapterInstance {
    const { sql } = database
    let lazyOptions: BetterAuthOptions | undefined

    const creator: AdapterFactoryCustomizeAdapterCreator = ({
        schema,
        getDefaultModelName,
        getFieldName,
    }) => {
        const models = new Map<string, Model>()
        function model(name: string): Model {
            const cached = models.get(name)
            if (cached) return cached
            const key = getDefaultModelName(name)
            const definition = schema[key]
            if (!definition) throw new Error(`Unknown Better Auth model: ${name}`)
            const columns = new Set(['id'])
            for (const field of Object.keys(definition.fields)) {
                columns.add(snakeCase(getFieldName({ model: key, field })))
            }
            const resolved = { table: quote(snakeCase(name)), columns }
            models.set(name, resolved)
            return resolved
        }

        function column(target: Model, field: string): string {
            const name = snakeCase(field)
            if (!target.columns.has(name)) {
                throw new Error(`Unknown Better Auth field ${field} on ${target.table}`)
            }
            return quote(name)
        }

        function condition(target: Model, where: CleanedWhere, parameters: Parameters): string {
            const insensitive =
                where.mode === 'insensitive' &&
                (typeof where.value === 'string' ||
                    (Array.isArray(where.value) &&
                        where.value.every(value => typeof value === 'string')))
            const raw = column(target, where.field)
            const left = insensitive ? `lower(${raw})` : raw
            const value = (input: unknown) => {
                const placeholder = parameters.add(input)
                return insensitive ? `lower(cast(${placeholder} as text))` : placeholder
            }
            const text = (input: unknown) => {
                const placeholder = `cast(${parameters.add(input)} as text)`
                return insensitive ? `lower(${placeholder})` : placeholder
            }
            switch (where.operator) {
                case 'in':
                case 'not_in': {
                    if (!Array.isArray(where.value)) {
                        throw new Error(
                            `Better Auth ${where.operator} needs an array for ${where.field}`
                        )
                    }
                    const negated = where.operator === 'not_in'
                    if (where.value.length === 0) return negated ? '1 = 1' : '1 = 0'
                    const list = (where.value as unknown[]).map(item => value(item)).join(', ')
                    return `${left} ${negated ? 'not in' : 'in'} (${list})`
                }
                case 'contains': {
                    const needle = text(where.value)
                    return sql.dialect === 'postgres'
                        ? `strpos(${left}, ${needle}) > 0`
                        : `instr(${left}, ${needle}) > 0`
                }
                case 'starts_with': {
                    const needle = text(where.value)
                    return `substr(${left}, 1, length(${needle})) = ${needle}`
                }
                case 'ends_with': {
                    const needle = text(where.value)
                    return `(length(${left}) >= length(${needle}) and substr(${left}, length(${left}) - length(${needle}) + 1) = ${needle})`
                }
                case 'lt':
                    return `${left} < ${value(where.value)}`
                case 'lte':
                    return `${left} <= ${value(where.value)}`
                case 'gt':
                    return `${left} > ${value(where.value)}`
                case 'gte':
                    return `${left} >= ${value(where.value)}`
                case 'ne':
                    return where.value === null
                        ? `${raw} is not null`
                        : `${left} <> ${value(where.value)}`
                default:
                    return where.value === null
                        ? `${raw} is null`
                        : `${left} = ${value(where.value)}`
            }
        }

        function whereSql(
            target: Model,
            where: readonly CleanedWhere[] | undefined,
            parameters: Parameters
        ): string {
            if (where === undefined || where.length === 0) return ''
            const all = where
                .filter(clause => clause.connector !== 'OR')
                .map(clause => condition(target, clause, parameters))
            const any = where
                .filter(clause => clause.connector === 'OR')
                .map(clause => condition(target, clause, parameters))
            const groups = [
                ...(all.length > 0 ? [`(${all.join(' and ')})`] : []),
                ...(any.length > 0 ? [`(${any.join(' or ')})`] : []),
            ]
            return ` where ${groups.join(' and ')}`
        }

        async function all(text: string, parameters: Parameters): Promise<Row[]> {
            return sql.statement<Row>(text).all(...(parameters.values as never[]))
        }

        async function one(text: string, parameters: Parameters): Promise<Row | null> {
            return rowToFields(
                await sql.statement<Row>(text).get(...(parameters.values as never[]))
            )
        }

        async function changes(text: string, parameters: Parameters): Promise<number> {
            return (await sql.statement(text).run(...(parameters.values as never[]))).changes
        }

        function assignments(target: Model, values: Row, parameters: Parameters): string {
            return Object.entries(values)
                .filter(([, value]) => value !== undefined)
                .map(([field, value]) => `${column(target, field)} = ${parameters.add(value)}`)
                .join(', ')
        }

        const atomic = <T>(operation: () => Promise<T>): Promise<T> => sql.transaction(operation)

        return {
            create: ({ model: name, data }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    const entries = Object.entries(data as Row).filter(
                        ([, value]) => value !== undefined
                    )
                    const columns = entries.map(([field]) => column(target, field)).join(', ')
                    const values = entries.map(([, value]) => parameters.add(value)).join(', ')
                    const row = await one(
                        `insert into ${target.table} (${columns}) values (${values}) returning *`,
                        parameters
                    )
                    return row as typeof data
                }),
            findOne: ({ model: name, where, select }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    return (await one(
                        `select ${selectColumns(target, select)} from ${target.table}${whereSql(target, where, parameters)} limit 1`,
                        parameters
                    )) as never
                }),
            findMany: ({ model: name, where, limit, select, sortBy, offset }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    let text = `select ${selectColumns(target, select)} from ${target.table}${whereSql(target, where, parameters)}`
                    if (sortBy !== undefined) {
                        text += ` order by ${column(target, sortBy.field)} ${sortBy.direction === 'desc' ? 'desc' : 'asc'}`
                    }
                    text += ` limit ${parameters.add(limit)}`
                    if (offset !== undefined) text += ` offset ${parameters.add(offset)}`
                    return (await all(text, parameters)).map(row => rowToFields(row)!) as never
                }),
            count: ({ model: name, where }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    const row = await sql
                        .statement<{ readonly total: number }>(
                            `select count(*) as total from ${target.table}${whereSql(target, where, parameters)}`
                        )
                        .get(...(parameters.values as never[]))
                    return Number(row?.total ?? 0)
                }),
            update: ({ model: name, where, update }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    const set = assignments(target, update as Row, parameters)
                    // Like the Drizzle adapter: every match is updated, the first is returned.
                    return (await one(
                        `update ${target.table} set ${set}${whereSql(target, where, parameters)} returning *`,
                        parameters
                    )) as never
                }),
            updateMany: ({ model: name, where, update }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    const set = assignments(target, update, parameters)
                    return changes(
                        `update ${target.table} set ${set}${whereSql(target, where, parameters)}`,
                        parameters
                    )
                }),
            delete: ({ model: name, where }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    await changes(
                        `delete from ${target.table}${whereSql(target, where, parameters)}`,
                        parameters
                    )
                }),
            deleteMany: ({ model: name, where }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    return changes(
                        `delete from ${target.table}${whereSql(target, where, parameters)}`,
                        parameters
                    )
                }),
            consumeOne: ({ model: name, where }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    return (await one(
                        `delete from ${target.table} where "id" in (select "id" from ${target.table}${whereSql(target, where, parameters)} limit 1) returning *`,
                        parameters
                    )) as never
                }),
            incrementOne: ({ model: name, where, increment, set }) =>
                atomic(async () => {
                    const target = model(name)
                    const parameters = new Parameters()
                    const updates = [
                        ...Object.entries(increment).map(([field, delta]) => {
                            const name = column(target, field)
                            return `${name} = ${name} + ${parameters.add(delta)}`
                        }),
                        ...(set === undefined ? [] : [assignments(target, set, parameters)]),
                    ].filter(part => part.length > 0)
                    return (await one(
                        `update ${target.table} set ${updates.join(', ')} where "id" in (select "id" from ${target.table}${whereSql(target, where, parameters)} limit 1) returning *`,
                        parameters
                    )) as never
                }),
        }

        function selectColumns(target: Model, select: readonly string[] | undefined): string {
            if (select === undefined || select.length === 0) return '*'
            return select.map(field => column(target, field)).join(', ')
        }
    }

    const config = {
        adapterId: 'postdot-sql',
        adapterName: 'Postdot SQL Adapter',
        usePlural: false,
        supportsJSON: false,
        supportsArrays: false,
        supportsBooleans: false,
        supportsDates: true,
        supportsUUIDs: false,
        supportsNumericIds: false,
        customTransformInput: ({ data }: { data: unknown }) =>
            data instanceof Date ? data.getTime() : data,
        customTransformOutput: ({
            data,
            fieldAttributes,
        }: {
            data: unknown
            fieldAttributes: { readonly type: unknown }
        }) => (fieldAttributes.type === 'date' && typeof data === 'number' ? new Date(data) : data),
    }

    const factory = createAdapterFactory({
        config: {
            ...config,
            transaction: callback =>
                sql.transaction(() =>
                    callback(
                        createAdapterFactory({
                            config: { ...config, transaction: false },
                            adapter: creator,
                        })(lazyOptions!)
                    )
                ),
        },
        adapter: creator,
    })

    return options => {
        lazyOptions = options
        return factory(options)
    }
}
