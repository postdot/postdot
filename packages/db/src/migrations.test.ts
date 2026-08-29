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
                'posts',
                'projects',
                'publications',
                'publisher_connections',
                'publishers',
                'session',
                'user',
                'verification',
            ])

            const migrationCount = database.$client
                .query<{ count: number }, []>('SELECT count(*) AS count FROM __drizzle_migrations')
                .get()

            expect(migrationCount?.count).toBe(5)
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
