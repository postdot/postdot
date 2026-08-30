import { describe, expect, it } from 'bun:test'

import type { ChannelProfileDefinition } from '@herald/core'
import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { jobs, posts, publicationTargetRevisions, publications, publishers } from './schema'

const automaticTestProfile: ChannelProfileDefinition = {
    id: 'future-provider',
    version: 1,
    profileHash: 'sha256:future-provider-profile-v1',
    schemaHash: 'sha256:future-provider-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: { body: { type: 'string', minLength: 1 } },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
    capabilities: {
        revision: 'future-provider-v1',
        textFields: [
            {
                bindingId: 'body',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: 1_000_000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'future-provider', revision: 'v1' },
}

const sourceContent = (text: string) => ({
    body: { text, format: 'plain_text' as const },
    media: [],
})

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
                sourceContent: sourceContent('A source post with channel-specific publications.'),
                publications: [
                    {
                        channelId: manualChannel?.id ?? '',
                        targetContent: {
                            body: 'Manual channel copy',
                            media: [],
                        },
                        scheduledAt: now,
                    },
                    {
                        channelId: secondChannel?.id ?? '',
                        targetContent: {
                            body: 'Secondary channel copy',
                            media: [],
                        },
                    },
                ],
            })

            expect(createdPost?.publications.map(publication => publication.state)).toEqual([
                'scheduled',
                'draft',
            ])
            expect(createdPost?.publications[0]?.targetRevisionId).not.toBeNull()
            expect(store.listProjects('user-1')).toHaveLength(1)
            expect(store.listProjects('other-user')).toEqual([])
            expect(store.listChannels(createdProject.project.id, 'other-user')).toBeNull()

            const due = store.listDueManualPublications(createdProject.project.id, 'user-1', now)
            expect(due).toHaveLength(1)
            expect(due?.[0]).toMatchObject({
                channelName: 'Custom Manual Destination',
                targetContent: {
                    body: 'Manual channel copy',
                    media: [],
                },
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
                    sourceContent: sourceContent('This must not persist'),
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
                profile: automaticTestProfile,
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
                sourceContent: sourceContent('This belongs to PUB-09'),
                publications: [
                    {
                        channelId: channel?.id ?? '',
                        deliveryMode: 'automatic',
                        scheduledAt: 1_800_000_000_000,
                    },
                ],
            })
            expect(created?.publications[0]?.state).toBe('scheduled')
            expect(database.select().from(jobs).all()).toHaveLength(1)
        } finally {
            closeDatabase(database)
        }
    })

    it('keeps the selected target stable until a draft is promoted', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => now })
            const project = store.createProject({
                name: 'Revision Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The revision test channel was not created')

            database
                .insert(publishers)
                .values({
                    id: 'revision-publisher',
                    projectId: project.project.id,
                    channelId: channel.id,
                    kind: 'future-provider',
                })
                .run()

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Initial revision'),
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: now + 60_000,
                    },
                ],
            })
            if (created === null) throw new Error('The revision test post was not created')
            const publication = created.publications[0]
            if (publication === undefined || publication.targetRevisionId === null) {
                throw new Error('The initial target revision is missing')
            }

            const initialJob = database.select().from(jobs).all()[0]
            if (initialJob === undefined) throw new Error('The initial job is missing')

            const saved = store.savePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: 1,
                sourceContent: sourceContent('Edited revision'),
                targetContent: { body: 'Edited target' },
            })
            expect(saved).toMatchObject({
                revision: 2,
                sourceRevision: 2,
                content: { body: 'Edited target' },
                reviewState: 'compatible',
            })
            expect(
                database
                    .select({ targetRevisionId: publications.targetRevisionId })
                    .from(publications)
                    .all()
            ).toEqual([{ targetRevisionId: publication.targetRevisionId }])
            expect(database.select().from(publicationTargetRevisions).all()).toHaveLength(1)
            expect(database.select().from(jobs).all()).toMatchObject([
                { id: initialJob.id, state: 'pending', runAt: now + 60_000 },
            ])

            expect(() =>
                store.savePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    targetContent: { body: 'Stale editor write' },
                })
            ).toThrow('changed after revision 1')
            expect(
                store.getPublicationWorkingDraft(project.project.id, publication.id, 'user-1')
            ).toMatchObject({
                revision: 2,
                content: { body: 'Edited target' },
            })

            const promoted = store.promotePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                scheduledAt: now + 120_000,
            })
            expect(promoted).toMatchObject({ state: 'scheduled', scheduledAt: now + 120_000 })
            expect(promoted?.targetRevisionId).not.toBe(publication.targetRevisionId)
            expect(database.select().from(publicationTargetRevisions).all()).toHaveLength(2)
            expect(database.select().from(jobs).all()).toEqual([
                expect.objectContaining({
                    id: initialJob.id,
                    state: 'pending',
                    runAt: now + 120_000,
                }),
            ])
        } finally {
            closeDatabase(database)
        }
    })

    it('keeps invalid drafts editable but blocks their promotion', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => now })
            const project = store.createProject({
                name: 'Review Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The review test channel was not created')

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Reviewable content'),
                publications: [{ channelId: channel.id, deliveryMode: 'automatic' }],
            })
            if (created === null) throw new Error('The review test post was not created')
            const publication = created.publications[0]
            if (publication === undefined) throw new Error('The review publication is missing')

            const saved = store.savePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: 1,
                targetContent: {},
            })
            expect(saved?.reviewState).toBe('review_required')
            expect(saved?.validationIssues.length).toBeGreaterThan(0)
            expect(() =>
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    scheduledAt: now + 60_000,
                })
            ).toThrow('Publication target content is invalid')
            expect(database.select().from(publicationTargetRevisions).all()).toHaveLength(0)
        } finally {
            closeDatabase(database)
        }
    })

    it('fences concurrent source edits across publication drafts', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => now })
            const project = store.createProject({
                name: 'Shared Source Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const firstChannel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'First Channel',
            })
            const secondChannel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Second Channel',
            })
            if (firstChannel === null || secondChannel === null) {
                throw new Error('The shared source channels were not created')
            }

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Initial source'),
                publications: [{ channelId: firstChannel.id }, { channelId: secondChannel.id }],
            })
            if (created === null) throw new Error('The shared source post was not created')
            const firstPublication = created.publications[0]
            const secondPublication = created.publications[1]
            if (firstPublication === undefined || secondPublication === undefined) {
                throw new Error('The shared source publications are missing')
            }

            expect(
                store.savePublicationDraft({
                    projectId: project.project.id,
                    publicationId: firstPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    sourceContent: sourceContent('First editor source'),
                    targetContent: { body: 'First editor target', media: [] },
                })?.sourceRevision
            ).toBe(2)

            expect(() =>
                store.savePublicationDraft({
                    projectId: project.project.id,
                    publicationId: secondPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    sourceContent: sourceContent('Stale second editor source'),
                    targetContent: { body: 'Second editor target', media: [] },
                })
            ).toThrow('changed after this publication draft was loaded')

            expect(database.select().from(posts).all()).toMatchObject([
                {
                    sourceRevision: 2,
                    sourceContent: sourceContent('First editor source'),
                },
            ])
            expect(
                store.getPublicationWorkingDraft(project.project.id, secondPublication.id, 'user-1')
            ).toMatchObject({ revision: 1, sourceRevision: 1 })
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
                sourceContent: sourceContent('The provider may have accepted this post'),
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
                sourceContent: sourceContent('The provider did not publish this post'),
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
