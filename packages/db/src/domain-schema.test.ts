import { describe, expect, it } from 'bun:test'

import type { HeraldDatabase } from './client'
import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'
import { actors, channels, jobs, posts, projects, publications, publishers } from './schema'

function seedProject(database: HeraldDatabase, suffix: string) {
    const projectId = `project-${suffix}`
    const actorId = `actor-${suffix}`
    const channelId = `channel-${suffix}`
    const postId = `post-${suffix}`

    database
        .insert(projects)
        .values({ id: projectId, name: `Project ${suffix}` })
        .run()
    database
        .insert(actors)
        .values({
            id: actorId,
            projectId,
            kind: 'human',
            displayName: `Editor ${suffix}`,
        })
        .run()
    database
        .insert(channels)
        .values({ id: channelId, projectId, name: `Channel ${suffix}` })
        .run()
    database
        .insert(posts)
        .values({
            id: postId,
            projectId,
            content: `Post ${suffix}`,
            createdByActorId: actorId,
        })
        .run()

    return { projectId, actorId, channelId, postId }
}

describe('domain schema', () => {
    it('enforces project ownership with composite foreign keys', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const first = seedProject(database, 'first')
            const second = seedProject(database, 'second')

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        id: 'cross-project-publication',
                        projectId: first.projectId,
                        postId: first.postId,
                        channelId: second.channelId,
                        content: 'Impossible relation',
                        state: 'draft',
                        createdByActorId: first.actorId,
                        stateChangedByActorId: first.actorId,
                    })
                    .run()
            ).toThrow()

            database
                .insert(publications)
                .values({
                    id: 'first-publication',
                    projectId: first.projectId,
                    postId: first.postId,
                    channelId: first.channelId,
                    content: 'Valid relation',
                    state: 'ready',
                    createdByActorId: first.actorId,
                    stateChangedByActorId: first.actorId,
                })
                .run()

            expect(() =>
                database
                    .insert(jobs)
                    .values({
                        id: 'cross-project-job',
                        projectId: second.projectId,
                        publicationId: 'first-publication',
                        state: 'pending',
                        runAt: 1_800_000_000_000,
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(posts)
                    .values({
                        id: 'cross-project-post',
                        projectId: first.projectId,
                        content: 'Impossible attribution',
                        createdByActorId: second.actorId,
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('allows manual channels and limits each channel to one publisher', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedProject(database, 'manual')

            expect(database.select().from(publishers).all()).toEqual([])

            database
                .insert(publishers)
                .values({
                    id: 'publisher-one',
                    projectId: fixture.projectId,
                    channelId: fixture.channelId,
                    kind: 'mastodon',
                })
                .run()

            expect(() =>
                database
                    .insert(publishers)
                    .values({
                        id: 'publisher-two',
                        projectId: fixture.projectId,
                        channelId: fixture.channelId,
                        kind: 'bluesky',
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects invalid and incomplete publication states', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedProject(database, 'states')
            const basePublication = {
                projectId: fixture.projectId,
                postId: fixture.postId,
                channelId: fixture.channelId,
                content: 'Publication content',
                createdByActorId: fixture.actorId,
                stateChangedByActorId: fixture.actorId,
            }

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        ...basePublication,
                        id: 'invalid-state',
                        state: 'unknown' as 'draft',
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        ...basePublication,
                        id: 'incomplete-publication',
                        state: 'published',
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        ...basePublication,
                        id: 'missing-error',
                        state: 'ambiguous',
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        ...basePublication,
                        id: 'unexpected-error',
                        state: 'ready',
                        errorMessage: 'Stale failure',
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects job rows that contradict their lifecycle state', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedProject(database, 'jobs')
            database
                .insert(publications)
                .values({
                    id: 'ready-publication',
                    projectId: fixture.projectId,
                    postId: fixture.postId,
                    channelId: fixture.channelId,
                    content: 'Ready publication',
                    state: 'ready',
                    createdByActorId: fixture.actorId,
                    stateChangedByActorId: fixture.actorId,
                })
                .run()

            const baseJob = {
                projectId: fixture.projectId,
                publicationId: 'ready-publication',
                runAt: 1_800_000_000_000,
            }

            expect(() =>
                database
                    .insert(jobs)
                    .values({
                        ...baseJob,
                        id: 'dirty-pending-job',
                        state: 'pending',
                        completedAt: 1_800_000_000_001,
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(jobs)
                    .values({
                        ...baseJob,
                        id: 'unstarted-failed-job',
                        state: 'failed',
                        completedAt: 1_800_000_000_001,
                        errorMessage: 'Connection refused',
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('commits scheduler indexes and leaves no foreign-key violations', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            seedProject(database, 'integrity')

            const publicationIndexes = database.$client
                .query<{ name: string }, []>('pragma index_list(publications)')
                .all()
                .map(index => index.name)
            const jobIndexes = database.$client
                .query<{ name: string }, []>('pragma index_list(jobs)')
                .all()
                .map(index => index.name)

            expect(publicationIndexes).toContain('publications_state_scheduled_at_idx')
            expect(jobIndexes).toContain('jobs_state_run_at_idx')
            expect(jobIndexes).toContain('jobs_state_lease_expires_at_idx')
            expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })
})
