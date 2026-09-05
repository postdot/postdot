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

function revertChannelLifecycleMigration(database: ReturnType<typeof createDatabase>) {
    database.$client.exec(`
        PRAGMA foreign_keys=OFF;
        CREATE TABLE herald_legacy_channels (
            id text PRIMARY KEY NOT NULL,
            project_id text NOT NULL,
            name text NOT NULL,
            profile_version_id text NOT NULL,
            created_at integer NOT NULL,
            updated_at integer NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE cascade
        );
        INSERT INTO herald_legacy_channels (
            id, project_id, name, profile_version_id, created_at, updated_at
        )
        SELECT id, project_id, name, profile_version_id, created_at, updated_at
        FROM channels;
        DROP TABLE channels;
        ALTER TABLE herald_legacy_channels RENAME TO channels;
        CREATE UNIQUE INDEX channels_project_id_id_uidx ON channels (project_id, id);
        PRAGMA foreign_keys=ON;
    `)
}

function revertEventJournalMigration(database: ReturnType<typeof createDatabase>) {
    database.$client.exec(`
        PRAGMA foreign_keys=OFF;
        CREATE TABLE herald_legacy_audit_events (
            id text PRIMARY KEY NOT NULL,
            project_id text NOT NULL,
            actor_id text NOT NULL,
            action text NOT NULL,
            entity_type text NOT NULL,
            entity_id text NOT NULL,
            metadata_json text,
            created_at integer NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE cascade,
            FOREIGN KEY (project_id, actor_id) REFERENCES actors(project_id, id) ON DELETE restrict
        );
        INSERT INTO herald_legacy_audit_events (
            id, project_id, actor_id, action, entity_type, entity_id, metadata_json, created_at
        )
        SELECT id, project_id, actor_id, action, entity_type, entity_id, metadata_json, created_at
        FROM audit_events;
        DROP TABLE audit_events;
        ALTER TABLE herald_legacy_audit_events RENAME TO audit_events;
        CREATE INDEX audit_events_project_id_created_at_idx
            ON audit_events (project_id, created_at);
        CREATE INDEX audit_events_project_id_entity_idx
            ON audit_events (project_id, entity_type, entity_id);
        PRAGMA foreign_keys=ON;
    `)
}

function revertNotificationMigration(database: ReturnType<typeof createDatabase>) {
    database.$client.exec(`
        DROP TABLE notification_deliveries;
        DROP TABLE notification_delivery_projection_cursors;
        DROP TABLE notification_subscriptions;
        DROP TABLE notification_destinations;
    `)
    database.$client.exec(`
        DROP TABLE notifications;
        DROP TABLE notification_projection_cursors;
        DROP TABLE notification_preferences;
        DROP INDEX audit_events_project_id_id_uidx;
    `)
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
                'notification_deliveries',
                'notification_delivery_projection_cursors',
                'notification_destinations',
                'notification_preferences',
                'notification_projection_cursors',
                'notification_subscriptions',
                'notifications',
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
                'sqlite_sequence',
                'user',
                'verification',
            ])

            const migrationCount = database.$client
                .query<{ count: number }, []>('SELECT count(*) AS count FROM __drizzle_migrations')
                .get()

            expect(migrationCount?.count).toBe(17)
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
            database.$client.exec('ALTER TABLE projects DROP COLUMN time_zone')
            database.$client.exec('DROP TABLE project_access_tokens')
            revertChannelLifecycleMigration(database)
            revertNotificationMigration(database)
            revertEventJournalMigration(database)
            unapplyMigrations(database, [
                '0007_yellow_bastion',
                '0008_daffy_marvel_boy',
                '0009_legal_bucky',
                '0010_typical_zeigeist',
                '0011_deep_captain_britain',
                '0012_wet_typhoid_mary',
                '0013_vengeful_namor',
                '0014_parallel_synch',
                '0015_crazy_the_call',
                '0016_funny_rage',
            ])
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
            expect(
                database.$client
                    .query<{ event_version: number; correlation_id: string | null }, []>(
                        `select event_version, correlation_id
                         from audit_events
                         order by sequence
                         limit 1`
                    )
                    .get()
            ).toEqual({ event_version: 1, correlation_id: null })
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
            staleDatabase.$client.exec('ALTER TABLE projects DROP COLUMN time_zone')
            staleDatabase.$client.exec('DROP TABLE project_access_tokens')
            revertChannelLifecycleMigration(staleDatabase)
            revertNotificationMigration(staleDatabase)
            revertEventJournalMigration(staleDatabase)
            unapplyMigrations(staleDatabase, [
                '0007_yellow_bastion',
                '0008_daffy_marvel_boy',
                '0009_legal_bucky',
                '0010_typical_zeigeist',
                '0011_deep_captain_britain',
                '0012_wet_typhoid_mary',
                '0013_vengeful_namor',
                '0014_parallel_synch',
                '0015_crazy_the_call',
                '0016_funny_rage',
            ])

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
