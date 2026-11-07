import { describe, expect, test } from 'bun:test'

import { closeDatabase, createDatabase } from '../client'
import { applyLegacyChain } from './legacy-chain'
import { loadPortableMigrations, runPortableMigrations } from './migrator'
import { describeSchema, type SchemaDescription } from './schema-introspection'
import { postgresTestUrl, testEngines } from './test-engines'

async function portableSchema(
    engine: (typeof testEngines)[number],
    migrations = loadPortableMigrations()
): Promise<SchemaDescription> {
    const opened = await engine.open()
    try {
        await runPortableMigrations(opened.database, migrations)
        return await describeSchema(opened.database)
    } finally {
        await opened.close()
    }
}

describe('portable schema parity (ADR-097 §6)', () => {
    test('the portable baseline reproduces the frozen legacy chain exactly', async () => {
        const legacy = createDatabase(':memory:')
        try {
            applyLegacyChain(legacy.$client)
            const expected = await describeSchema(legacy)
            const baseline = loadPortableMigrations().slice(0, 1)
            expect(await portableSchema(testEngines[0]!, baseline)).toEqual(expected)
        } finally {
            closeDatabase(legacy)
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
