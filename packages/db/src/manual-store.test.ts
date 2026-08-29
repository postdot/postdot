import { describe, expect, it } from 'bun:test'

import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { jobs, publications, publishers } from './schema'

describe('manual workflow store', () => {
    it('creates a project, tracks manual publications, and records attribution', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const store = createManualStore(database, {
                now: () => now,
                createId: (() => {
                    let sequence = 0
                    return () => `generated-${++sequence}`
                })(),
            })

            const createdProject = store.createProject({
                name: 'Herald Launch',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const manualChannel = store.createChannel({
                projectId: createdProject.project.id,
                subjectId: 'user-1',
                name: 'Custom Manual Destination',
            })
            const secondChannel = store.createChannel({
                projectId: createdProject.project.id,
                subjectId: 'user-1',
                name: 'Secondary Destination',
            })

            expect(manualChannel).not.toBeNull()
            expect(secondChannel).not.toBeNull()

            const createdPost = store.createPost({
                projectId: createdProject.project.id,
                subjectId: 'user-1',
                title: 'Herald is ready',
                content: 'A source post with channel-specific publications.',
                publications: [
                    {
                        channelId: manualChannel?.id ?? '',
                        content: 'Manual channel copy',
                        scheduledAt: now,
                    },
                    {
                        channelId: secondChannel?.id ?? '',
                        content: 'Secondary channel copy',
                    },
                ],
            })

            expect(createdPost?.publications.map(publication => publication.state)).toEqual([
                'scheduled',
                'draft',
            ])
            expect(createdPost?.publications[0]?.content).toBe('Manual channel copy')
            expect(store.listProjects('user-1')).toHaveLength(1)
            expect(store.listProjects('other-user')).toEqual([])
            expect(store.listChannels(createdProject.project.id, 'other-user')).toBeNull()

            const due = store.listDueManualPublications(createdProject.project.id, 'user-1', now)
            expect(due).toHaveLength(1)
            expect(due?.[0]).toMatchObject({
                channelName: 'Custom Manual Destination',
                content: 'Manual channel copy',
                postTitle: 'Herald is ready',
                state: 'scheduled',
            })

            const published = store.publishManualPublication({
                projectId: createdProject.project.id,
                publicationId: due?.[0]?.id ?? '',
                subjectId: 'user-1',
                externalId: 'manual-1',
                externalUrl: 'https://example.test/manual-1',
            })
            expect(published).toMatchObject({
                externalId: 'manual-1',
                externalUrl: 'https://example.test/manual-1',
                publishedByActorId: createdProject.actor.id,
                state: 'published',
            })
            expect(
                store.listDueManualPublications(createdProject.project.id, 'user-1', now)
            ).toEqual([])

            expect(
                store
                    .listAuditEvents(createdProject.project.id, 'user-1')
                    ?.map(event => event.action)
                    .sort()
            ).toEqual([
                'channel.created',
                'channel.created',
                'post.created',
                'project.created',
                'publication.created',
                'publication.created',
                'publication.published',
                'publication.ready',
            ])
        } finally {
            closeDatabase(database)
        }
    })

    it('rolls back an invalid post instead of leaving partial records', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = store.createProject({
                name: 'Rollback Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })

            expect(() =>
                store.createPost({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    content: 'This must not persist',
                    publications: [{ channelId: 'missing-channel' }],
                })
            ).toThrow('does not belong to project')
            expect(database.$client.query('select count(*) as count from posts').get()).toEqual({
                count: 0,
            })
            expect(
                database.$client.query('select count(*) as count from audit_events').get()
            ).toEqual({
                count: 1,
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('creates durable work for an automated channel', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = store.createProject({
                name: 'Automatic Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
            })

            database
                .insert(publishers)
                .values({
                    id: 'publisher-1',
                    projectId: project.project.id,
                    channelId: channel?.id ?? '',
                    kind: 'future-provider',
                })
                .run()

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                content: 'This belongs to PUB-09',
                publications: [{ channelId: channel?.id ?? '', scheduledAt: 1_800_000_000_000 }],
            })
            expect(created?.publications[0]?.state).toBe('scheduled')
            expect(database.select().from(jobs).all()).toHaveLength(1)
        } finally {
            closeDatabase(database)
        }
    })

    it('reconciles an ambiguous publication with explicit operator attribution', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => now })
            const project = store.createProject({
                name: 'Reconciliation Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Manual Channel',
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The test channel was not created')

            const publishedCandidate = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                content: 'The provider may have accepted this post',
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const publishedCandidateId = publishedCandidate?.publications[0]?.id
            if (publishedCandidateId === undefined)
                throw new Error('The test publication is missing')
            database
                .update(publications)
                .set({ state: 'ambiguous', errorMessage: 'The provider response was lost' })
                .where(eq(publications.id, publishedCandidateId))
                .run()

            const reconciledPublished = store.reconcileAmbiguousPublication({
                projectId: project.project.id,
                publicationId: publishedCandidateId,
                subjectId: 'user-1',
                resolution: 'published',
                externalId: 'provider-post-1',
                externalUrl: 'https://example.test/provider-post-1',
            })
            expect(reconciledPublished).toMatchObject({
                kind: 'reconciled',
                publication: {
                    state: 'published',
                    externalId: 'provider-post-1',
                    publishedByActorId: project.actor.id,
                },
            })

            const failedCandidate = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                content: 'The provider did not publish this post',
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const failedCandidateId = failedCandidate?.publications[0]?.id
            if (failedCandidateId === undefined) throw new Error('The test publication is missing')
            database
                .update(publications)
                .set({ state: 'ambiguous', errorMessage: 'The provider response was lost' })
                .where(eq(publications.id, failedCandidateId))
                .run()

            const reconciledFailed = store.reconcileAmbiguousPublication({
                projectId: project.project.id,
                publicationId: failedCandidateId,
                subjectId: 'user-1',
                resolution: 'failed',
                errorMessage: 'Operator verified that no post exists remotely',
            })
            expect(reconciledFailed).toMatchObject({
                kind: 'reconciled',
                publication: {
                    state: 'failed',
                    errorMessage: 'Operator verified that no post exists remotely',
                },
            })
            expect(
                store.reconcileAmbiguousPublication({
                    projectId: project.project.id,
                    publicationId: failedCandidateId,
                    subjectId: 'user-1',
                    resolution: 'failed',
                    errorMessage: 'Duplicate resolution must be rejected',
                })
            ).toEqual({ kind: 'not_ambiguous' })
            expect(
                store
                    .listAuditEvents(project.project.id, 'user-1')
                    ?.filter(event => event.action === 'publication.reconciled')
            ).toHaveLength(2)
        } finally {
            closeDatabase(database)
        }
    })
})
