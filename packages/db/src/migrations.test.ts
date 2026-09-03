import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { defaultMigrationsFolder, runMigrations } from './migrations'
import { session, user } from './schema'

interface MigrationJournal {
    readonly entries: readonly {
        readonly tag: string
        readonly when: number
    }[]
}

function unapplyMigrations(database: ReturnType<typeof createDatabase>, tags: readonly string[]) {
    const journal = JSON.parse(
        readFileSync(join(defaultMigrationsFolder, 'meta/_journal.json'), 'utf8')
    ) as MigrationJournal

    for (const tag of tags) {
        const entry = journal.entries.find(candidate => candidate.tag === tag)
        if (entry === undefined) throw new Error(`Migration ${tag} is missing from the journal`)

        database.$client
            .query('DELETE FROM __drizzle_migrations WHERE created_at = ?1')
            .run(entry.when)
    }
}

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
                'project_access_tokens',
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

            expect(migrationCount?.count).toBe(9)
        } finally {
            closeDatabase(database)
        }
    })

    it('backfills source snapshots and refuses unrecoverable stale legacy drafts', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = store.createProject({
                name: 'Migration fixture',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Migration channel',
            })
            if (channel === null) throw new Error('The migration fixture channel is missing')
            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Legacy source', format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id }],
            })
            if (created === null) throw new Error('The migration fixture post is missing')

            database.$client.exec(
                'ALTER TABLE publication_working_drafts DROP COLUMN base_source_content'
            )
            database.$client.exec('DROP TABLE project_access_tokens')
            unapplyMigrations(database, ['0007_yellow_bastion', '0008_daffy_marvel_boy'])
            runMigrations(database)

            const migrated = database.$client
                .query<{ base_source_content: string }, []>(
                    'SELECT base_source_content FROM publication_working_drafts'
                )
                .get()
            expect(JSON.parse(migrated?.base_source_content ?? 'null')).toEqual({
                body: { text: 'Legacy source', format: 'plain_text' },
                media: [],
            })
        } finally {
            closeDatabase(database)
        }

        const staleDatabase = createDatabase(':memory:')
        try {
            runMigrations(staleDatabase)
            const store = createManualStore(staleDatabase, { now: () => 1_800_000_000_000 })
            const project = store.createProject({
                name: 'Stale migration fixture',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Stale migration channel',
            })
            if (channel === null) throw new Error('The stale migration channel is missing')
            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Stale source', format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id }],
            })
            if (created === null) throw new Error('The stale migration post is missing')
            staleDatabase.$client
                .query('UPDATE posts SET source_revision = 2 WHERE id = ?1')
                .run(created.post.id)
            staleDatabase.$client.exec(
                'ALTER TABLE publication_working_drafts DROP COLUMN base_source_content'
            )
            staleDatabase.$client.exec('DROP TABLE project_access_tokens')
            unapplyMigrations(staleDatabase, ['0007_yellow_bastion', '0008_daffy_marvel_boy'])

            expect(() => runMigrations(staleDatabase)).toThrow()
        } finally {
            closeDatabase(staleDatabase)
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
