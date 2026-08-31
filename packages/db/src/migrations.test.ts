import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'
import { session, user } from './schema'

describe('database migrations', () => {
    it('applies the committed migration exactly once', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            runMigrations(database)

            const tables = database.$client
                .query<{ name: string }, []>(
                    `SELECT name
                     FROM sqlite_master
                     WHERE type = 'table'
                     ORDER BY name`
                )
                .all()
                .map(({ name }) => name)

            expect(tables).toEqual([
                '__drizzle_migrations',
                'account',
                'actors',
                'audit_events',
                'channel_profile_versions',
                'channels',
                'jobs',
                'media_assets',
                'media_backup_fences',
                'media_representations',
                'media_upload_intents',
                'oauth_authorization_attempts',
                'posts',
                'projects',
                'provider_media_deliveries',
                'publication_execution_revision_media',
                'publication_execution_revisions',
                'publication_revision_media',
                'publication_target_revisions',
                'publication_working_drafts',
                'publications',
                'publisher_connections',
                'publisher_credentials',
                'publishers',
                'session',
                'user',
                'verification',
            ])

            const migrationCount = database.$client
                .query<{ count: number }, []>('SELECT count(*) AS count FROM __drizzle_migrations')
                .get()

            expect(migrationCount?.count).toBe(7)
        } finally {
            closeDatabase(database)
        }
    })

    it('explains an existing-schema conflict without weakening migration safety', async () => {
        const migrationsFolder = await mkdtemp('/tmp/herald-migration-conflict-')
        const database = createDatabase(':memory:')

        try {
            await mkdir(join(migrationsFolder, 'meta'))
            await writeFile(
                join(migrationsFolder, '0000_conflicting_schema.sql'),
                'CREATE TABLE `account` (`id` text PRIMARY KEY NOT NULL);\n'
            )
            await writeFile(
                join(migrationsFolder, 'meta/_journal.json'),
                JSON.stringify({
                    version: '7',
                    dialect: 'sqlite',
                    entries: [
                        {
                            idx: 0,
                            version: '6',
                            when: Date.now() + 86_400_000,
                            tag: '0000_conflicting_schema',
                            breakpoints: true,
                        },
                    ],
                })
            )

            runMigrations(database)

            expect(() => runMigrations(database, migrationsFolder)).toThrow(
                'The database schema conflicts with the committed migration history'
            )
        } finally {
            closeDatabase(database)
            await rm(migrationsFolder, { recursive: true, force: true })
        }
    })

    it('enforces SQLite foreign keys and cascading session deletion', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)

            database
                .insert(user)
                .values({
                    id: 'user-1',
                    name: 'Herald Tester',
                    email: 'tester@herald.local',
                })
                .run()
            database
                .insert(session)
                .values({
                    id: 'session-1',
                    token: 'session-token',
                    userId: 'user-1',
                    expiresAt: new Date(Date.now() + 60_000),
                    updatedAt: new Date(),
                })
                .run()

            database.delete(user).where(eq(user.id, 'user-1')).run()

            expect(database.select().from(session).all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })
})
