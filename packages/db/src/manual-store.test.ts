import { describe, expect, it } from 'bun:test'

import type { ChannelProfileDefinition, MediaFamily } from '@herald/core'
import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import type { MediaAssetReference } from './media-asset-store'
import { runMigrations } from './migrations'
import {
    auditEvents,
    channelProfileVersions,
    jobs,
    mediaAssets,
    mediaRepresentations,
    posts,
    publicationRevisionMedia,
    publicationTargetRevisions,
    publicationWorkingDrafts,
    publications,
    publishers,
} from './schema'
import { createTaxonomyStore } from './taxonomy-store'

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

function createMediaProfile(
    version: number,
    families: readonly MediaFamily[],
    mimeTypes: readonly string[]
): ChannelProfileDefinition {
    return {
        id: 'media-provider',
        version,
        profileHash: `sha256:media-provider-profile-v${version}`,
        schemaHash: `sha256:media-provider-schema-v${version}`,
        origin: 'built_in',
        contentSchema: {
            type: 'object',
            properties: {
                body: { type: 'string', minLength: 1, maxLength: 1_000 },
                media: {
                    type: 'array',
                    maxItems: 1,
                    items: {
                        type: 'object',
                        properties: { assetId: { type: 'string', minLength: 1 } },
                        required: ['assetId'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['body', 'media'],
            additionalProperties: false,
        },
        fieldBindings: [
            { id: 'body', semantic: 'primary_text', path: '/body' },
            {
                id: 'media',
                semantic: 'ordered_media',
                path: '/media',
                item: { assetIdPath: '/assetId' },
            },
        ],
        capabilities: {
            revision: `media-provider-v${version}`,
            textFields: [
                {
                    bindingId: 'body',
                    acceptedSourceFormats: ['plain_text'],
                    maxLength: 1_000,
                },
            ],
            mediaFields: [
                {
                    bindingId: 'media',
                    families,
                    mimeTypes,
                    maxItems: 1,
                },
            ],
            relations: [],
        },
        execution: { kind: 'built_in', contractId: 'media-provider', revision: 'v1' },
    }
}

function createReadyMedia(
    projectId: string,
    now: number,
    createdByActorId = 'user-1'
): MediaAssetReference {
    return {
        asset: {
            id: 'asset-1',
            projectId,
            originalFilename: 'image.jpg',
            defaultAccessibilityText: null,
            state: 'ready',
            archivedAt: null,
            deletionRequestedAt: null,
            deletedAt: null,
            failureCode: null,
            failureMessage: null,
            createdByActorId,
            createdAt: now,
            updatedAt: now,
        },
        representations: [
            {
                id: 'representation-1',
                projectId,
                assetId: 'asset-1',
                kind: 'original',
                sourceRepresentationId: null,
                state: 'ready',
                storeId: 'local',
                objectKey: 'asset-1/original',
                declaredContentType: 'image/jpeg',
                detectedContentType: 'image/jpeg',
                detectedFormat: 'jpeg',
                family: 'image',
                byteSize: 100,
                sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                width: 100,
                height: 100,
                durationMs: null,
                pageCount: null,
                isAnimated: false,
                processorId: null,
                processorVersion: null,
                recipeJson: null,
                failureCode: null,
                failureMessage: null,
                createdAt: now,
                updatedAt: now,
            },
        ],
    }
}

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

    it('filters publication summaries by all selected project-scoped tag IDs', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => now })
            const taxonomy = createTaxonomyStore(database, { now: () => now })
            const project = store.createProject({
                name: 'Queue Filter Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const firstChannel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'First destination',
            })
            const secondChannel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Second destination',
            })
            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                title: 'Queue filter source',
                sourceContent: sourceContent('Queue filter source'),
                publications: [
                    {
                        channelId: firstChannel?.id ?? '',
                        targetContent: { body: 'First destination', media: [] },
                    },
                    {
                        channelId: secondChannel?.id ?? '',
                        targetContent: { body: 'Second destination', media: [] },
                    },
                ],
            })
            const firstPublication = created?.publications[0]
            const secondPublication = created?.publications[1]
            expect(firstPublication).toBeDefined()
            expect(secondPublication).toBeDefined()

            const alpha = taxonomy.createTag({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Alpha',
            })
            const beta = taxonomy.createTag({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Beta',
            })
            expect(alpha).not.toBeNull()
            expect(beta).not.toBeNull()
            taxonomy.replacePublicationTags({
                projectId: project.project.id,
                publicationId: firstPublication?.id ?? '',
                subjectId: 'user-1',
                tagIds: [beta?.id ?? '', alpha?.id ?? ''],
            })
            taxonomy.replacePublicationTags({
                projectId: project.project.id,
                publicationId: secondPublication?.id ?? '',
                subjectId: 'user-1',
                tagIds: [alpha?.id ?? ''],
            })

            const otherProject = store.createProject({
                name: 'Other Queue Filter Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const foreignTag = taxonomy.createTag({
                projectId: otherProject.project.id,
                subjectId: 'user-1',
                name: 'Foreign',
            })

            expect(
                store
                    .listPublicationSummaries(project.project.id, 'user-1')
                    ?.map(publication => ({ id: publication.id, tagIds: publication.tagIds }))
            ).toEqual(
                expect.arrayContaining([
                    { id: firstPublication?.id, tagIds: [alpha?.id, beta?.id] },
                    { id: secondPublication?.id, tagIds: [alpha?.id] },
                ])
            )
            expect(
                store
                    .listPublicationSummaries(project.project.id, 'user-1', {
                        tagIds: [beta?.id ?? '', alpha?.id ?? ''],
                    })
                    ?.map(publication => publication.id)
            ).toEqual([firstPublication?.id ?? ''])
            expect(
                store.listPublicationSummaries(project.project.id, 'user-1', {
                    tagIds: [foreignTag?.id ?? ''],
                })
            ).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })

    it('rolls back publication outcomes when their audit persistence fails', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000
        let triggerInstalled = false

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => now })
            const project = store.createProject({
                name: 'Outcome Rollback Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Manual Channel',
            })
            if (channel === null) throw new Error('The outcome rollback channel was not created')

            const manualPublication = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('The manual publication must remain due'),
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const manualPublicationId = manualPublication?.publications[0]?.id
            if (manualPublicationId === undefined)
                throw new Error('The manual outcome publication is missing')

            database.$client.run(`
                create temp trigger fail_publication_outcome_audit
                before insert on audit_events
                when NEW.action in ('publication.ready', 'publication.reconciled')
                begin
                    select raise(abort, 'forced publication outcome failure');
                end
            `)
            triggerInstalled = true

            expect(() =>
                store.publishManualPublication({
                    projectId: project.project.id,
                    publicationId: manualPublicationId,
                    subjectId: 'user-1',
                    externalId: 'manual-outcome-1',
                })
            ).toThrow('forced publication outcome failure')
            expect(
                database
                    .select({
                        state: publications.state,
                        publishedAt: publications.publishedAt,
                        externalId: publications.externalId,
                    })
                    .from(publications)
                    .where(eq(publications.id, manualPublicationId))
                    .all()
            ).toEqual([{ state: 'scheduled', publishedAt: null, externalId: null }])
            expect(
                database
                    .select()
                    .from(auditEvents)
                    .where(eq(auditEvents.action, 'publication.ready'))
                    .all()
            ).toHaveLength(0)

            const ambiguousPublication = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('The ambiguous publication must remain unresolved'),
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const ambiguousPublicationId = ambiguousPublication?.publications[0]?.id
            if (ambiguousPublicationId === undefined)
                throw new Error('The ambiguous outcome publication is missing')
            database
                .update(publications)
                .set({ state: 'ambiguous', errorMessage: 'The provider response was lost' })
                .where(eq(publications.id, ambiguousPublicationId))
                .run()

            expect(() =>
                store.reconcileAmbiguousPublication({
                    projectId: project.project.id,
                    publicationId: ambiguousPublicationId,
                    subjectId: 'user-1',
                    resolution: 'published',
                    externalId: 'ambiguous-outcome-1',
                })
            ).toThrow('forced publication outcome failure')
            expect(
                database
                    .select({
                        state: publications.state,
                        errorMessage: publications.errorMessage,
                        externalId: publications.externalId,
                    })
                    .from(publications)
                    .where(eq(publications.id, ambiguousPublicationId))
                    .all()
            ).toEqual([
                {
                    state: 'ambiguous',
                    errorMessage: 'The provider response was lost',
                    externalId: null,
                },
            ])
            expect(
                database
                    .select()
                    .from(auditEvents)
                    .where(eq(auditEvents.action, 'publication.reconciled'))
                    .all()
            ).toHaveLength(0)
        } finally {
            if (triggerInstalled)
                database.$client.run('drop trigger fail_publication_outcome_audit')
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

    it('rolls back all creation records when a late persistence effect fails', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000
        let triggerInstalled = false

        try {
            runMigrations(database)
            const media = {
                getAsset(
                    currentProjectId: string,
                    assetId: string,
                    _subjectId: string
                ): MediaAssetReference | null {
                    return assetId === 'asset-1' ? createReadyMedia(currentProjectId, now) : null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const project = store.createProject({
                name: 'Creation Rollback Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Media Channel',
                profile: createMediaProfile(1, ['image'], ['image/jpeg']),
            })
            if (channel === null) throw new Error('The creation rollback channel was not created')

            const readyMedia = createReadyMedia(project.project.id, now, project.actor.id)
            database.insert(mediaAssets).values(readyMedia.asset).run()
            const readyRepresentation = readyMedia.representations[0]
            if (readyRepresentation === undefined) {
                throw new Error('The creation rollback media representation is missing')
            }
            database
                .insert(mediaRepresentations)
                .values({ ...readyRepresentation, recipeJson: null })
                .run()
            database
                .insert(publishers)
                .values({
                    id: 'creation-rollback-publisher',
                    projectId: project.project.id,
                    channelId: channel.id,
                    kind: 'media-provider',
                })
                .run()

            database.$client.run(`
                create temp trigger fail_publication_creation_audit
                before insert on audit_events
                when NEW.action = 'publication.created'
                begin
                    select raise(abort, 'forced publication creation failure');
                end
            `)
            triggerInstalled = true

            expect(() =>
                store.createPost({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    sourceContent: {
                        body: { text: 'Creation rollback source', format: 'plain_text' },
                        media: [{ assetId: 'asset-1' }],
                    },
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: 'automatic',
                            targetContent: {
                                body: 'Creation rollback target',
                                media: [{ assetId: 'asset-1' }],
                            },
                            scheduledAt: now + 60_000,
                        },
                    ],
                })
            ).toThrow('forced publication creation failure')

            expect(database.select().from(posts).all()).toHaveLength(0)
            expect(database.select().from(publications).all()).toHaveLength(0)
            expect(database.select().from(publicationWorkingDrafts).all()).toHaveLength(0)
            expect(database.select().from(publicationTargetRevisions).all()).toHaveLength(0)
            expect(database.select().from(publicationRevisionMedia).all()).toHaveLength(0)
            expect(database.select().from(jobs).all()).toHaveLength(0)
            expect(
                database
                    .select()
                    .from(auditEvents)
                    .where(eq(auditEvents.action, 'post.created'))
                    .all()
            ).toHaveLength(0)
            expect(
                database
                    .select()
                    .from(auditEvents)
                    .where(eq(auditEvents.action, 'publication.created'))
                    .all()
            ).toHaveLength(0)
        } finally {
            if (triggerInstalled)
                database.$client.run('drop trigger fail_publication_creation_audit')
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
                    expectedRevision: 2,
                })
            ).toThrow('must include sourceContent or targetContent')

            const editor = store.getPublicationEditorState(
                project.project.id,
                publication.id,
                'user-1'
            )
            expect(editor).toMatchObject({
                post: { sourceRevision: 2, sourceContent: sourceContent('Edited revision') },
                channel: { id: channel.id },
                profile: { id: channel.profileVersionId, state: 'active' },
                draft: { revision: 2, sourceRevision: 2, content: { body: 'Edited target' } },
                selectedTarget: {
                    id: publication.targetRevisionId,
                    sourceRevision: 1,
                    content: { body: 'Initial revision' },
                },
            })
            expect(store.listPublicationSummaries(project.project.id, 'user-1')).toMatchObject([
                {
                    id: publication.id,
                    draftRevision: 2,
                    draftReviewState: 'compatible',
                    draftDiffersFromTarget: true,
                },
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
                expectedRevision: 2,
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
            expect(store.listPublicationSummaries(project.project.id, 'user-1')).toMatchObject([
                { id: publication.id, draftDiffersFromTarget: false },
            ])

            expect(() =>
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    scheduledAt: now + 180_000,
                })
            ).toThrow('changed after revision 1')
        } finally {
            closeDatabase(database)
        }
    })

    it('rolls back a promotion when a late persistence effect fails', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000
        let triggerInstalled = false

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => now })
            const project = store.createProject({
                name: 'Promotion Rollback Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The rollback test channel was not created')

            database
                .insert(publishers)
                .values({
                    id: 'promotion-rollback-publisher',
                    projectId: project.project.id,
                    channelId: channel.id,
                    kind: 'future-provider',
                })
                .run()

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Rollback source'),
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: now + 60_000,
                    },
                ],
            })
            if (created === null) throw new Error('The rollback test post was not created')
            const publication = created.publications[0]
            if (publication === undefined) throw new Error('The rollback publication is missing')

            database.$client.run(`
                create temp trigger fail_publication_promotion_audit
                before insert on audit_events
                when NEW.action = 'publication.target_promoted'
                begin
                    select raise(abort, 'forced publication promotion failure');
                end
            `)
            triggerInstalled = true

            expect(() =>
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    scheduledAt: now + 120_000,
                })
            ).toThrow('forced publication promotion failure')

            expect(
                database
                    .select({
                        targetRevisionId: publications.targetRevisionId,
                        state: publications.state,
                        scheduledAt: publications.scheduledAt,
                    })
                    .from(publications)
                    .where(eq(publications.id, publication.id))
                    .all()
            ).toEqual([
                {
                    targetRevisionId: publication.targetRevisionId,
                    state: 'scheduled',
                    scheduledAt: now + 60_000,
                },
            ])
            expect(
                database
                    .select()
                    .from(publicationTargetRevisions)
                    .where(eq(publicationTargetRevisions.publicationId, publication.id))
                    .all()
            ).toHaveLength(1)
            expect(
                database.select().from(jobs).where(eq(jobs.publicationId, publication.id)).all()
            ).toEqual([expect.objectContaining({ state: 'pending', runAt: now + 60_000 })])
            expect(
                database
                    .select()
                    .from(auditEvents)
                    .where(eq(auditEvents.action, 'publication.target_promoted'))
                    .all()
            ).toHaveLength(0)
        } finally {
            if (triggerInstalled)
                database.$client.run('drop trigger fail_publication_promotion_audit')
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
                    expectedRevision: 2,
                    scheduledAt: now + 60_000,
                })
            ).toThrow('Publication target content is invalid')
            expect(database.select().from(publicationTargetRevisions).all()).toHaveLength(0)
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects an invalid scheduled media target before persisting the publication', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const media = {
                getAsset(
                    _projectId: string,
                    _assetId: string,
                    _subjectId: string
                ): MediaAssetReference | null {
                    return null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const project = store.createProject({
                name: 'Scheduled Media Validation Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Scheduled Media Channel',
                profile: createMediaProfile(1, ['image'], ['image/jpeg']),
            })
            if (channel === null) throw new Error('The scheduled media channel was not created')

            database
                .insert(publishers)
                .values({
                    id: 'scheduled-media-publisher',
                    projectId: project.project.id,
                    channelId: channel.id,
                    kind: 'media-provider',
                })
                .run()

            expect(() =>
                store.createPost({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    sourceContent: sourceContent('Scheduled media source'),
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: 'automatic',
                            targetContent: {
                                body: 'Scheduled media target',
                                media: [{ assetId: 'missing-asset' }],
                            },
                            scheduledAt: now + 60_000,
                        },
                    ],
                })
            ).toThrow('Media asset missing-asset is not available for publication')

            expect(database.select().from(posts).all()).toEqual([])
            expect(database.select().from(publications).all()).toEqual([])
            expect(database.select().from(publicationTargetRevisions).all()).toEqual([])
            expect(database.select().from(jobs).all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })

    it('versions a channel profile and re-assesses persisted work on activation', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => now })
            const project = store.createProject({
                name: 'Profile Lifecycle Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Versioned Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The profile lifecycle channel was not created')

            database
                .insert(publishers)
                .values({
                    id: 'profile-lifecycle-publisher',
                    projectId: project.project.id,
                    channelId: channel.id,
                    kind: 'future-provider',
                })
                .run()

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Profile lifecycle source'),
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        targetContent: { body: 'short target' },
                        scheduledAt: now + 60_000,
                    },
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        targetContent: { body: 'this target becomes invalid' },
                        scheduledAt: now + 120_000,
                    },
                ],
            })
            if (created === null) throw new Error('The profile lifecycle post was not created')

            const nextSchema = structuredClone(automaticTestProfile.contentSchema) as Record<
                string,
                unknown
            >
            const nextProperties = nextSchema.properties as Record<string, Record<string, unknown>>
            ;(nextProperties.body as Record<string, unknown>).maxLength = 12
            const automaticTextField = automaticTestProfile.capabilities.textFields[0]
            if (automaticTextField === undefined) {
                throw new Error('The automatic test profile has no text field')
            }
            const nextProfile = {
                ...automaticTestProfile,
                profileHash: 'sha256:future-provider-profile-v2',
                schemaHash: 'sha256:future-provider-schema-v2',
                contentSchema: nextSchema,
                capabilities: {
                    ...automaticTestProfile.capabilities,
                    revision: 'future-provider-v2',
                    textFields: [
                        {
                            bindingId: automaticTextField.bindingId,
                            acceptedSourceFormats: automaticTextField.acceptedSourceFormats,
                            maxLength: 12,
                        },
                    ],
                },
            }

            const draft = store.createChannelProfileDraft({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                profile: nextProfile,
            })
            expect(draft).toMatchObject({ state: 'draft', version: 2, revision: 1 })
            if (draft === null) throw new Error('The profile draft was not created')

            const preview = store.previewChannelProfileActivation({
                projectId: project.project.id,
                channelId: channel.id,
                profileVersionId: draft.id,
                subjectId: 'user-1',
            })
            expect(preview?.pendingTargets).toEqual([
                expect.objectContaining({ state: 'compatible' }),
                expect.objectContaining({ state: 'review_required' }),
            ])
            expect(preview?.workingDrafts.map(candidate => candidate.state).sort()).toEqual([
                'compatible',
                'review_required',
            ])

            const activated = store.activateChannelProfile({
                projectId: project.project.id,
                channelId: channel.id,
                profileVersionId: draft.id,
                subjectId: 'user-1',
                expectedRevision: 1,
            })
            expect(activated).toMatchObject({
                channel: { profileVersionId: draft.id },
                profile: { id: draft.id, state: 'active', version: 2 },
            })
            expect(activated?.assessment.hasReviewRequired).toBe(true)

            const profileRows = database
                .select({ id: channelProfileVersions.id, state: channelProfileVersions.state })
                .from(channelProfileVersions)
                .all()
            expect(profileRows).toEqual([
                { id: channel.profileVersionId, state: 'superseded' },
                { id: draft.id, state: 'active' },
            ])

            const publicationRows = database
                .select({
                    id: publications.id,
                    reviewState: publications.reviewState,
                    targetRevisionId: publications.targetRevisionId,
                    lastAssessedProfileVersionId: publications.lastAssessedProfileVersionId,
                })
                .from(publications)
                .orderBy(publications.createdAt, publications.id)
                .all()
            const shortPublication = created.publications[0]
            const invalidPublication = created.publications[1]
            if (shortPublication === undefined || invalidPublication === undefined) {
                throw new Error('The profile lifecycle publications are missing')
            }
            expect(publicationRows.find(row => row.id === shortPublication.id)).toEqual(
                expect.objectContaining({
                    reviewState: 'compatible',
                    lastAssessedProfileVersionId: draft.id,
                    targetRevisionId: expect.any(String),
                })
            )
            expect(publicationRows.find(row => row.id === invalidPublication.id)).toEqual(
                expect.objectContaining({
                    reviewState: 'review_required',
                    lastAssessedProfileVersionId: draft.id,
                    targetRevisionId: expect.any(String),
                })
            )

            const workingDraftRows = database
                .select({
                    profileVersionId: publicationWorkingDrafts.profileVersionId,
                    lastAssessedProfileVersionId:
                        publicationWorkingDrafts.lastAssessedProfileVersionId,
                })
                .from(publicationWorkingDrafts)
                .all()
            expect(workingDraftRows).toEqual([
                expect.objectContaining({
                    profileVersionId: channel.profileVersionId,
                    lastAssessedProfileVersionId: draft.id,
                }),
                expect.objectContaining({
                    profileVersionId: channel.profileVersionId,
                    lastAssessedProfileVersionId: draft.id,
                }),
            ])

            expect(
                database
                    .select()
                    .from(jobs)
                    .all()
                    .map(job => job.state)
                    .sort()
            ).toEqual(['cancelled', 'pending'])
            expect(
                store.getChannelProfileState(project.project.id, channel.id, 'user-1')
            ).toMatchObject({
                active: { id: draft.id, state: 'active' },
                draft: null,
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('revalidates pinned media representations when a profile narrows media support', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const media = {
                getAsset(
                    currentProjectId: string,
                    assetId: string,
                    _subjectId: string
                ): MediaAssetReference | null {
                    return assetId === 'asset-1' ? createReadyMedia(currentProjectId, now) : null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const project = store.createProject({
                name: 'Media Profile Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const readyMedia = createReadyMedia(project.project.id, now, project.actor.id)
            database.insert(mediaAssets).values(readyMedia.asset).run()
            const readyRepresentation = readyMedia.representations[0]
            if (readyRepresentation === undefined) {
                throw new Error('The ready media representation is missing')
            }
            database
                .insert(mediaRepresentations)
                .values({ ...readyRepresentation, recipeJson: null })
                .run()
            const profile = createMediaProfile(1, ['image'], ['image/jpeg'])
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Media Channel',
                profile,
            })
            if (channel === null) throw new Error('The media profile channel was not created')

            database
                .insert(publishers)
                .values({
                    id: 'media-profile-publisher',
                    projectId: project.project.id,
                    channelId: channel.id,
                    kind: 'media-provider',
                })
                .run()

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Media profile source', format: 'plain_text' },
                    media: [{ assetId: 'asset-1' }],
                },
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        targetContent: {
                            body: 'Media target',
                            media: [{ assetId: 'asset-1' }],
                        },
                        scheduledAt: now + 60_000,
                    },
                ],
            })
            if (created === null) throw new Error('The media profile post was not created')
            const publication = created.publications[0]
            if (publication === undefined) throw new Error('The media publication is missing')

            const draft = store.createChannelProfileDraft({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                profile: createMediaProfile(2, ['video'], ['video/mp4']),
            })
            if (draft === null) throw new Error('The media profile draft was not created')

            const preview = store.previewChannelProfileActivation({
                projectId: project.project.id,
                channelId: channel.id,
                profileVersionId: draft.id,
                subjectId: 'user-1',
            })
            expect(preview?.pendingTargets[0]).toEqual(
                expect.objectContaining({
                    id: publication.id,
                    state: 'review_required',
                    issues: [
                        expect.objectContaining({
                            code: 'profile.media_representation_incompatible',
                        }),
                    ],
                })
            )

            store.activateChannelProfile({
                projectId: project.project.id,
                channelId: channel.id,
                profileVersionId: draft.id,
                subjectId: 'user-1',
            })
            expect(database.select().from(jobs).all()).toEqual([
                expect.objectContaining({ state: 'cancelled' }),
            ])
        } finally {
            closeDatabase(database)
        }
    })

    it('surfaces media capability issues while drafts are created and autosaved', () => {
        const database = createDatabase(':memory:')
        const now = 1_800_000_000_000

        try {
            runMigrations(database)
            const media = {
                getAsset(
                    _projectId: string,
                    _assetId: string,
                    _subjectId: string
                ): MediaAssetReference | null {
                    return null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const project = store.createProject({
                name: 'Draft Media Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Media Draft Channel',
                profile: createMediaProfile(1, ['image'], ['image/jpeg']),
            })
            if (channel === null) throw new Error('The media draft channel was not created')

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Draft media source', format: 'plain_text' },
                    media: [{ assetId: 'missing-asset' }],
                },
                publications: [
                    {
                        channelId: channel.id,
                        targetContent: {
                            body: 'Draft media target',
                            media: [{ assetId: 'missing-asset' }],
                        },
                    },
                ],
            })
            if (created === null) throw new Error('The draft media post was not created')
            const publication = created.publications[0]
            if (publication === undefined) throw new Error('The draft media publication is missing')

            expect(publication).toMatchObject({ reviewState: 'review_required' })
            expect(
                store.getPublicationWorkingDraft(project.project.id, publication.id, 'user-1')
            ).toMatchObject({
                reviewState: 'review_required',
                validationIssues: [expect.objectContaining({ code: 'profile.media_incompatible' })],
            })

            const saved = store.savePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: 1,
                targetContent: {
                    body: 'Updated draft media target',
                    media: [{ assetId: 'missing-asset' }],
                },
            })
            expect(saved).toMatchObject({
                revision: 2,
                reviewState: 'review_required',
                validationIssues: [expect.objectContaining({ code: 'profile.media_incompatible' })],
            })
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
            ).toMatchObject({
                revision: 1,
                sourceRevision: 1,
                baseSourceContent: sourceContent('Initial source'),
                content: { body: 'Initial source', media: [] },
            })

            const rebased = store.rebasePublicationDraft({
                projectId: project.project.id,
                publicationId: secondPublication.id,
                subjectId: 'user-1',
                expectedRevision: 1,
            })
            expect(rebased).toMatchObject({
                revision: 2,
                sourceRevision: 2,
                baseSourceContent: sourceContent('First editor source'),
                content: { body: 'Initial source', media: [] },
            })

            const idempotentRebase = store.rebasePublicationDraft({
                projectId: project.project.id,
                publicationId: secondPublication.id,
                subjectId: 'user-1',
                expectedRevision: 2,
            })
            expect(idempotentRebase).toMatchObject({ revision: 2, sourceRevision: 2 })
            expect(
                store
                    .listAuditEvents(project.project.id, 'user-1')
                    ?.filter(event => event.action === 'publication.draft.rebased')
            ).toHaveLength(1)
            expect(() =>
                store.savePublicationDraft({
                    projectId: project.project.id,
                    publicationId: secondPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    targetContent: { body: 'Stale copy', media: [] },
                })
            ).toThrow('changed after revision 1')
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
