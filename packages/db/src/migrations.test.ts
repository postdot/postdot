import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from './client'
import { defaultMigrationsFolder, runMigrations } from './migrations'

function listTables(database: ReturnType<typeof createDatabase>): string[] {
    return database.$client
        .query<{ readonly name: string }, []>(
            `select name from sqlite_master where type = 'table' order by name`
        )
        .all()
        .map(row => row.name)
}

describe('database migrations', () => {
    it('creates the current schema and seeds a claimable instance', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const tables = listTables(database)

            expect(tables).toContain('instance_state')
            expect(tables).toContain('instance_access_invitations')
            expect(tables).toContain('organization')
            expect(tables).toContain('member')
            expect(tables).toContain('team')
            expect(tables).toContain('team_member')
            expect(tables).toContain('workspaces')
            expect(tables).toContain('apikey')
            expect(tables).toContain('publication_approval_requests')
            expect(tables).not.toContain('project_memberships')
            expect(tables).not.toContain('access_invitations')
            expect(tables).not.toContain('project_access_tokens')
            expect(tables).not.toContain('access_legacy_retirement')

            const accountColumns = database.$client
                .query<{ readonly name: string; readonly notnull: number }, []>(
                    'PRAGMA table_info(account)'
                )
                .all()
            expect(accountColumns.find(column => column.name === 'issuer')?.notnull).toBe(0)

            expect(
                database.$client
                    .query<{ readonly state: string; readonly bootstrapBlocked: number }, []>(
                        `select state, bootstrap_blocked as bootstrapBlocked
                         from instance_state where id = 'default'`
                    )
                    .get()
            ).toEqual({ state: 'claimable', bootstrapBlocked: 0 })
            expect(
                database.$client
                    .query<{ readonly count: number }, []>(
                        'select count(*) as count from __drizzle_migrations'
                    )
                    .get()
            ).toEqual({ count: 9 })
        } finally {
            closeDatabase(database)
        }
    })

    it('is idempotent and preserves the connection foreign-key setting', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            runMigrations(database)

            expect(
                database.$client
                    .query<{ readonly foreign_keys: number }, []>('PRAGMA foreign_keys')
                    .get()
            ).toEqual({ foreign_keys: 1 })
            expect(
                database.$client
                    .query<{ readonly count: number }, []>(
                        'select count(*) as count from __drizzle_migrations'
                    )
                    .get()
            ).toEqual({ count: 9 })
        } finally {
            closeDatabase(database)
        }
    })

    it('keeps the committed migration folder in generated order', () => {
        const files = [...new Bun.Glob('*.sql').scanSync({ cwd: defaultMigrationsFolder })].sort()
        expect(files).toHaveLength(9)
        expect(files[0]).toMatch(/^0000_.+\.sql$/)
        expect(files[1]).toMatch(/^0001_.+\.sql$/)
        expect(files[2]).toMatch(/^0002_.+\.sql$/)
    })
})
