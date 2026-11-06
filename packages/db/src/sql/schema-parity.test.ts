import { describe, expect, test } from 'bun:test'

import { closeDatabase, createDatabase } from '../client'
import { runMigrations } from '../migrations'
import { runPortableMigrations } from './migrator'
import { describeSchema, type SchemaDescription } from './schema-introspection'
import { postgresTestUrl, testEngines } from './test-engines'

async function portableSchema(engine: (typeof testEngines)[number]): Promise<SchemaDescription> {
    const opened = await engine.open()
    try {
        await runPortableMigrations(opened.database)
        return await describeSchema(opened.database)
    } finally {
        await opened.close()
    }
}

describe('portable schema parity (ADR-097 §6)', () => {
    test('the portable baseline reproduces the historical SQLite chain exactly', async () => {
        const historical = createDatabase(':memory:')
        try {
            runMigrations(historical)
            const expected = await describeSchema(historical)
            const actual = await portableSchema(testEngines[0]!)
            expect(actual).toEqual(expected)
        } finally {
            closeDatabase(historical)
        }
    })

    test.skipIf(postgresTestUrl === undefined)(
        'PostgreSQL and SQLite produce the same schema',
        async () => {
            const sqlite = await portableSchema(testEngines.find(e => e.name === 'sqlite')!)
            const postgres = await portableSchema(testEngines.find(e => e.name === 'postgres')!)
            expect(postgres).toEqual(sqlite)
        }
    )
})
