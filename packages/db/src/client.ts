import { Database } from 'bun:sqlite'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from './schema'

export function createDatabase(filename: string) {
    const client = new Database(filename)
    client.run('PRAGMA foreign_keys = ON')

    return drizzle({ client, schema })
}

export type HeraldDatabase = ReturnType<typeof createDatabase>

export function closeDatabase(database: HeraldDatabase) {
    database.$client.close()
}
