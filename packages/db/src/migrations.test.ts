import { describe, expect, it } from 'bun:test'

import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'
import { actors, channels, posts, projects, publications, session, user } from './schema'

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
                'channels',
                'jobs',
                'oauth_authorization_attempts',
                'posts',
                'projects',
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

            expect(migrationCount?.count).toBe(8)
        } finally {
            closeDatabase(database)
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

    it('refuses to replace legacy account-backed publisher connections implicitly', async () => {
        const database = createDatabase(':memory:')

        try {
            for (const filename of legacyMigrationFiles) {
                const migration = await Bun.file(
                    new URL(`../drizzle/${filename}`, import.meta.url)
                ).text()
                database.$client.exec(migration.replaceAll('--> statement-breakpoint', ''))
            }

            database.$client.exec(`
                insert into projects (id, name) values ('legacy-project', 'Legacy project');
                insert into actors (id, project_id, kind, subject_id, display_name)
                values ('legacy-actor', 'legacy-project', 'human', 'legacy-user', 'Legacy operator');
                insert into channels (id, project_id, name)
                values ('legacy-channel', 'legacy-project', 'Legacy channel');
                insert into publishers (id, project_id, channel_id, kind)
                values ('legacy-publisher', 'legacy-project', 'legacy-channel', 'linkedin');
                insert into user (id, name, email)
                values ('legacy-user', 'Legacy operator', 'legacy@herald.local');
                insert into account (id, issuer, account_id, provider_id, user_id, updated_at)
                values ('legacy-account', 'https://www.linkedin.com', 'member-legacy', 'linkedin', 'legacy-user', 1800000000000);
                insert into publisher_connections (
                    id, project_id, publisher_id, account_id, connected_by_actor_id
                ) values (
                    'legacy-connection', 'legacy-project', 'legacy-publisher', 'legacy-account', 'legacy-actor'
                );
            `)

            const migration = await Bun.file(
                new URL('../drizzle/0007_fearless_hydra.sql', import.meta.url)
            ).text()
            let migrationError: unknown
            database.$client.exec('BEGIN')
            try {
                for (const statement of migration.split('--> statement-breakpoint')) {
                    const trimmedStatement = statement.trim()
                    if (trimmedStatement !== '') database.$client.exec(trimmedStatement)
                }
                database.$client.exec('COMMIT')
            } catch (error) {
                migrationError = error
                database.$client.exec('ROLLBACK')
            }

            expect(migrationError).toBeDefined()
            expect(String(migrationError)).toContain(
                'Legacy publisher connections require an explicit reconnect before migration'
            )
            expect(
                database.$client
                    .query<{ name: string }, []>(
                        `select name from pragma_table_info('publisher_connections')`
                    )
                    .all()
                    .map(row => row.name)
            ).toContain('account_id')
            expect(
                database.$client
                    .query<{ count: number }, []>(
                        `select count(*) as count from publisher_connections`
                    )
                    .get()?.count
            ).toBe(1)
        } finally {
            closeDatabase(database)
        }
    })

    it('preserves pending jobs and safely closes legacy running jobs', async () => {
        const database = createDatabase(':memory:')

        try {
            const legacyMigration = await Bun.file(
                new URL('../drizzle/0001_smiling_justin_hammer.sql', import.meta.url)
            ).text()
            database.$client.exec(legacyMigration.replaceAll('--> statement-breakpoint', ''))

            database.insert(projects).values({ id: 'project', name: 'Project' }).run()
            database
                .insert(actors)
                .values({
                    id: 'actor',
                    projectId: 'project',
                    kind: 'system',
                    displayName: 'Worker',
                })
                .run()
            database
                .insert(channels)
                .values({ id: 'channel', projectId: 'project', name: 'Channel' })
                .run()
            database
                .insert(posts)
                .values({
                    id: 'post',
                    projectId: 'project',
                    content: 'Post',
                    createdByActorId: 'actor',
                })
                .run()
            database
                .insert(publications)
                .values({
                    id: 'publication',
                    projectId: 'project',
                    postId: 'post',
                    channelId: 'channel',
                    content: 'Publication',
                    state: 'ready',
                    createdByActorId: 'actor',
                    stateChangedByActorId: 'actor',
                })
                .run()

            database.$client.run(`
                insert into jobs (
                    id, project_id, publication_id, state, run_at, attempts, started_at
                ) values
                    ('pending-job', 'project', 'publication', 'pending', 1800000000000, 0, null),
                    ('running-job', 'project', 'publication', 'running', 1800000000000, 1, 1800000000001)
            `)

            const claimMigration = await Bun.file(
                new URL('../drizzle/0002_abnormal_nighthawk.sql', import.meta.url)
            ).text()
            database.$client.exec(claimMigration.replaceAll('--> statement-breakpoint', ''))

            const migratedJobs = database.$client
                .query<{ id: string; state: string; errorMessage: string | null }, []>(`
                    select id, state, error_message as errorMessage
                    from jobs
                    order by id
                `)
                .all()

            expect(migratedJobs).toEqual([
                { id: 'pending-job', state: 'pending', errorMessage: null },
                {
                    id: 'running-job',
                    state: 'failed',
                    errorMessage: 'Migration recovered a legacy running job without claim metadata',
                },
            ])
            expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })
})

const legacyMigrationFiles = [
    '0000_spicy_quasimodo.sql',
    '0001_smiling_justin_hammer.sql',
    '0002_abnormal_nighthawk.sql',
    '0003_yielding_norman_osborn.sql',
    '0004_furry_vin_gonzales.sql',
    '0005_fuzzy_namor.sql',
    '0006_quick_silver_centurion.sql',
] as const
