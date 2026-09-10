import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { defaultMigrationsFolder, runMigrations } from './migrations'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'
import { createPublisherCredentialStore } from './publisher-credential-store'
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

function revertProviderApplicationMigration(database: ReturnType<typeof createDatabase>) {
    database.$client.exec(`
        PRAGMA foreign_keys=OFF;
        ALTER TABLE oauth_authorization_attempts DROP COLUMN provider_application_id;
        ALTER TABLE publisher_credentials DROP COLUMN provider_application_id;
        DROP TABLE provider_application_configurations;
        PRAGMA foreign_keys=ON;
    `)
}

function revertNotificationMigration(database: ReturnType<typeof createDatabase>) {
    database.$client.exec(`
        DROP TABLE notification_user_preferences;
        DROP TABLE notification_deliveries;
        DROP TABLE notification_delivery_projection_cursors;
        DROP TABLE notification_subscriptions;
        DROP TABLE notification_destination_secrets;
        DROP TABLE notification_destinations;
    `)
    database.$client.exec(`
        DROP TABLE notifications;
        DROP TABLE notification_projection_cursors;
        DROP TABLE notification_preferences;
        DROP INDEX audit_events_project_id_id_uidx;
    `)
}

function revertUserNotificationMigration(database: ReturnType<typeof createDatabase>) {
    database.$client.exec(`
        PRAGMA foreign_keys=OFF;
        DROP TABLE notification_user_preferences;
        CREATE TABLE herald_legacy_notifications (
            id text PRIMARY KEY NOT NULL,
            project_id text NOT NULL,
            recipient_actor_id text NOT NULL,
            source_event_id text NOT NULL,
            kind text NOT NULL,
            severity text NOT NULL,
            subject_type text NOT NULL,
            subject_id text NOT NULL,
            title text NOT NULL,
            body text NOT NULL,
            read_at integer,
            archived_at integer,
            created_at integer NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE cascade,
            FOREIGN KEY (project_id, recipient_actor_id)
                REFERENCES actors(project_id, id) ON DELETE cascade,
            FOREIGN KEY (project_id, source_event_id)
                REFERENCES audit_events(project_id, id) ON DELETE cascade
        );
        INSERT INTO herald_legacy_notifications (
            id, project_id, recipient_actor_id, source_event_id, kind, severity,
            subject_type, subject_id, title, body, read_at, archived_at, created_at
        )
        SELECT id, project_id, recipient_actor_id, source_event_id, kind, severity,
            subject_type, subject_id, title, body, read_at, archived_at, created_at
        FROM notifications;
        DROP TABLE notifications;
        ALTER TABLE herald_legacy_notifications RENAME TO notifications;
        CREATE UNIQUE INDEX notifications_recipient_source_event_uidx
            ON notifications (project_id, recipient_actor_id, source_event_id);
        CREATE INDEX notifications_recipient_inbox_idx
            ON notifications (project_id, recipient_actor_id, archived_at, created_at);
        CREATE INDEX notifications_recipient_unread_idx
            ON notifications (project_id, recipient_actor_id, read_at, archived_at);
        PRAGMA foreign_keys=ON;
    `)
}

function revertTaxonomyMigration(database: ReturnType<typeof createDatabase>) {
    database.$client.exec(`
        PRAGMA foreign_keys=OFF;
        DROP TABLE publication_tags;
        DROP TABLE project_tags;
        ALTER TABLE projects DROP COLUMN primary_category_id;
        DROP TABLE project_categories;
        PRAGMA foreign_keys=ON;
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
                'notification_destination_secrets',
                'notification_destinations',
                'notification_preferences',
                'notification_projection_cursors',
                'notification_subscriptions',
                'notification_user_preferences',
                'notifications',
                'oauth_authorization_attempts',
                'posts',
                'project_access_tokens',
                'project_categories',
                'project_tags',
                'projects',
                'provider_analytics_observations',
                'provider_application_configurations',
                'provider_media_deliveries',
                'publication_execution_revision_media',
                'publication_execution_revisions',
                'publication_revision_media',
                'publication_tags',
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

            expect(migrationCount?.count).toBe(27)
        } finally {
            closeDatabase(database)
        }
    })

    it('preserves legacy notification rows while backfilling their user recipient', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = manualStore.createProject({
                name: 'Notification migration',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            database.$client
                .query(
                    `insert into audit_events (
                        id, project_id, actor_id, action, entity_type, entity_id,
                        event_version, created_at
                    ) values ('legacy-notification-event', ?1, ?2,
                        'publication.execution.failed', 'publication', 'publication-1', 1, ?3)`
                )
                .run(project.project.id, project.actor.id, 1_800_000_000_000)
            revertUserNotificationMigration(database)
            database.$client
                .query(
                    `insert into notifications (
                        id, project_id, recipient_actor_id, source_event_id, kind, severity,
                        subject_type, subject_id, title, body, created_at
                    ) values ('legacy-notification', ?1, ?2, 'legacy-notification-event',
                        'publication_failed', 'error', 'publication', 'publication-1',
                        'Legacy publication failed', 'The legacy publication needs attention.', ?3)`
                )
                .run(project.project.id, project.actor.id, 1_800_000_000_000)
            revertTaxonomyMigration(database)
            unapplyMigrations(database, ['0026_superb_red_ghost', '0025_acoustic_sentinel'])

            runMigrations(database)

            expect(
                database.$client
                    .query<{ recipientUserId: string; title: string; body: string }, []>(
                        `select recipient_user_id as recipientUserId, title, body
                         from notifications where id = 'legacy-notification'`
                    )
                    .get()
            ).toEqual({
                recipientUserId: 'user-1',
                title: 'Legacy publication failed',
                body: 'The legacy publication needs attention.',
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('refuses legacy notifications that cannot be mapped to a human user', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = manualStore.createProject({
                name: 'Unrecoverable notification migration',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            database.$client
                .query(
                    `insert into actors (
                        id, project_id, kind, subject_id, display_name, created_at, updated_at
                    ) values ('machine-recipient', ?1, 'system', null, 'System', ?2, ?2)`
                )
                .run(project.project.id, 1_800_000_000_000)
            database.$client
                .query(
                    `insert into audit_events (
                        id, project_id, actor_id, action, entity_type, entity_id,
                        event_version, created_at
                    ) values ('unrecoverable-notification-event', ?1, ?2,
                        'publication.execution.failed', 'publication', 'publication-2', 1, ?3)`
                )
                .run(project.project.id, project.actor.id, 1_800_000_000_000)
            revertUserNotificationMigration(database)
            database.$client
                .query(
                    `insert into notifications (
                        id, project_id, recipient_actor_id, source_event_id, kind, severity,
                        subject_type, subject_id, title, body, created_at
                    ) values ('unrecoverable-notification', ?1, 'machine-recipient',
                        'unrecoverable-notification-event', 'publication_failed', 'error',
                        'publication', 'publication-2', 'Unrecoverable notification',
                        'This row must not disappear.', ?2)`
                )
                .run(project.project.id, 1_800_000_000_000)
            revertTaxonomyMigration(database)
            unapplyMigrations(database, ['0026_superb_red_ghost', '0025_acoustic_sentinel'])

            expect(() => runMigrations(database)).toThrow()
            expect(
                database.$client
                    .query<{ recipientActorId: string }, []>(
                        `select recipient_actor_id as recipientActorId
                         from notifications where id = 'unrecoverable-notification'`
                    )
                    .get()
            ).toEqual({ recipientActorId: 'machine-recipient' })
        } finally {
            closeDatabase(database)
        }
    })

    it('normalizes orphan provider application references without losing credentials', async () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = manualStore.createProject({
                name: 'Provider application migration',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const credentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({
                    keyId: 'migration-test',
                    key: new Uint8Array(32).fill(1),
                }),
                now: () => 1_800_000_000_000,
                createId: () => 'credential-migration-test',
            })
            const created = await credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'bluesky',
                externalAccountId: 'did:plc:migration-test',
                accessToken: 'access-token',
                providerSession: 'provider-session',
            })
            expect(created.kind).toBe('created')

            database.$client.run('PRAGMA foreign_keys=OFF')
            database.$client
                .query(
                    `update publisher_credentials
                     set provider_application_id = 'legacy-missing-application'`
                )
                .run()
            database.$client.run('PRAGMA foreign_keys=ON')
            database.$client.exec('DROP TABLE notification_user_preferences')
            revertTaxonomyMigration(database)
            unapplyMigrations(database, [
                '0026_superb_red_ghost',
                '0025_acoustic_sentinel',
                '0024_sour_wolfsbane',
                '0023_normalize_orphan_provider_applications',
            ])

            runMigrations(database)

            const repaired = database.$client
                .query<
                    {
                        providerApplicationId: string | null
                        state: string
                        revision: number
                    },
                    []
                >(
                    `select provider_application_id as providerApplicationId, state, revision
                     from publisher_credentials`
                )
                .get()
            expect(repaired).toMatchObject({
                providerApplicationId: null,
                state: 'reconnect_required',
                revision: 2,
            })
            expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })

    it('preserves existing provider observations while widening availability states', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = store.createProject({
                name: 'Provider observation migration',
                subjectId: 'user-1',
                displayName: 'Operator',
            })

            database.$client.exec('DROP TABLE provider_analytics_observations')
            unapplyMigrations(database, ['0021_thankful_jack_power'])
            database.$client.exec(`
                CREATE TABLE provider_analytics_observations (
                    id text PRIMARY KEY NOT NULL,
                    project_id text NOT NULL,
                    provider text NOT NULL,
                    subject_type text NOT NULL,
                    provider_subject_id text NOT NULL,
                    provider_subject_label text,
                    provider_content_revision_id text,
                    herald_entity_type text,
                    herald_entity_id text,
                    metric_name text NOT NULL,
                    value real,
                    unit text NOT NULL,
                    aggregation text NOT NULL,
                    reporting_period_start integer,
                    reporting_period_end integer,
                    observed_at integer,
                    fetched_at integer NOT NULL,
                    availability text NOT NULL,
                    freshness text NOT NULL,
                    provenance text NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE cascade
                )
            `)
            database.$client
                .query(
                    `insert into provider_analytics_observations (
                        id, project_id, provider, subject_type, provider_subject_id,
                        provider_subject_label, provider_content_revision_id,
                        herald_entity_type, herald_entity_id, metric_name, value,
                        unit, aggregation, reporting_period_start, reporting_period_end,
                        observed_at, fetched_at, availability, freshness, provenance
                    ) values (?1, ?2, 'bluesky', 'account', 'did:plc:legacy',
                        'legacy.test', null, 'channel', 'channel-1', 'followersCount',
                        3, 'count', 'cumulative_snapshot', null, null, null,
                        ?3, 'measured', 'unknown', 'bluesky.public-api.v1')`
                )
                .run('legacy-observation', project.project.id, 1_800_000_000_000)

            runMigrations(database)

            expect(
                database.$client
                    .query<{ availability: string; value: number }, [string]>(
                        'select availability, value from provider_analytics_observations where id = ?1'
                    )
                    .get('legacy-observation')
            ).toEqual({ availability: 'measured', value: 3 })
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
            database.$client.exec('DROP TABLE provider_analytics_observations')
            revertChannelLifecycleMigration(database)
            revertNotificationMigration(database)
            revertEventJournalMigration(database)
            revertProviderApplicationMigration(database)
            revertTaxonomyMigration(database)
            unapplyMigrations(database, [
                '0026_superb_red_ghost',
                '0025_acoustic_sentinel',
                '0024_sour_wolfsbane',
                '0023_normalize_orphan_provider_applications',
                '0022_fresh_human_robot',
                '0021_thankful_jack_power',
                '0020_harsh_hairball',
                '0019_flawless_greymalkin',
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
                '0017_glossy_zuras',
                '0018_gigantic_bromley',
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
            staleDatabase.$client.exec('DROP TABLE provider_analytics_observations')
            revertChannelLifecycleMigration(staleDatabase)
            revertNotificationMigration(staleDatabase)
            revertEventJournalMigration(staleDatabase)
            revertProviderApplicationMigration(staleDatabase)
            revertTaxonomyMigration(staleDatabase)
            unapplyMigrations(staleDatabase, [
                '0026_superb_red_ghost',
                '0025_acoustic_sentinel',
                '0024_sour_wolfsbane',
                '0023_normalize_orphan_provider_applications',
                '0022_fresh_human_robot',
                '0021_thankful_jack_power',
                '0020_harsh_hairball',
                '0019_flawless_greymalkin',
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
                '0017_glossy_zuras',
                '0018_gigantic_bromley',
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
