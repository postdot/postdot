import { describe, expect, it } from 'bun:test'

import type { ChannelProfileDefinition, MediaFamily } from '@postdot/core'

import { type DatabaseHandle } from './client'
import { createManualStore } from './manual-store'
import type { MediaAssetReference } from './media-asset-store'
import { createTaxonomyStore } from './taxonomy-store'
import {
    closeTestDatabase,
    dropRejectingTrigger,
    fromDbRow,
    insertRow,
    installRejectingTrigger,
    openTestDatabase,
    seedTestWorkspace,
    type TestRow,
    workspaceOf,
} from './testing'

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

async function createApprovalDraft(
    database: DatabaseHandle,
    store: ReturnType<typeof createManualStore>,
    projectId: string,
    suffix: string
) {
    const channel = await store.createChannel({
        projectId,
        subjectId: 'user-1',
        name: `Approval Channel ${suffix}`,
        profile: automaticTestProfile,
    })
    if (channel === null) throw new Error('The approval channel was not created')

    await database.sql
        .statement(
            'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
        )
        .run(
            `approval-publisher-${suffix}`,
            await workspaceOf(database, projectId),
            channel.id,
            'future-provider'
        )

    const created = await store.createPost({
        projectId,
        subjectId: 'user-1',
        sourceContent: sourceContent(`Approval source ${suffix}`),
        publications: [
            {
                channelId: channel.id,
                deliveryMode: 'automatic',
                targetContent: { body: `Approval target ${suffix}` },
            },
        ],
    })
    const publication = created?.publications[0]
    if (publication === undefined) throw new Error('The approval draft was not created')
    return publication
}

async function activateApprovalProfileLimit(
    store: ReturnType<typeof createManualStore>,
    projectId: string,
    channelId: string,
    maxLength: number
) {
    const profile = {
        ...automaticTestProfile,
        profileHash: `sha256:approval-limit-${maxLength}`,
        schemaHash: `sha256:approval-schema-${maxLength}`,
        contentSchema: {
            type: 'object',
            properties: { body: { type: 'string', minLength: 1, maxLength } },
            required: ['body'],
            additionalProperties: false,
        },
        capabilities: {
            ...automaticTestProfile.capabilities,
            revision: `approval-limit-${maxLength}`,
            textFields: automaticTestProfile.capabilities.textFields.map(field => ({
                ...field,
                maxLength,
            })),
        },
    }
    const draft = await store.createChannelProfileDraft({
        projectId,
        channelId,
        subjectId: 'user-1',
        profile,
    })
    if (draft === null) throw new Error('The approval profile draft is missing')
    return store.activateChannelProfile({
        projectId,
        channelId,
        subjectId: 'user-1',
        profileVersionId: draft.id,
        expectedRevision: 1,
    })
}

async function snapshotApprovalState(database: DatabaseHandle) {
    return {
        publications: (
            await database.sql
                .statement<TestRow>(
                    'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications"'
                )
                .all()
        ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' })),
        drafts: (
            await database.sql
                .statement<TestRow>(
                    'select "publication_working_drafts"."id" as "id", "publication_working_drafts"."project_id" as "projectId", "publication_working_drafts"."publication_id" as "publicationId", "publication_working_drafts"."profile_version_id" as "profileVersionId", "publication_working_drafts"."source_revision" as "sourceRevision", "publication_working_drafts"."base_source_content" as "baseSourceContent", "publication_working_drafts"."content_json" as "contentJson", "publication_working_drafts"."review_state" as "reviewState", "publication_working_drafts"."validation_issues_json" as "validationIssuesJson", "publication_working_drafts"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publication_working_drafts"."revision" as "revision", "publication_working_drafts"."updated_by_actor_id" as "updatedByActorId", "publication_working_drafts"."created_at" as "createdAt", "publication_working_drafts"."updated_at" as "updatedAt" from "publication_working_drafts"'
                )
                .all()
        ).map(row =>
            fromDbRow<TestRow>(row, {
                baseSourceContent: 'json',
                contentJson: 'json',
                validationIssuesJson: 'json',
            })
        ),
        targets: (
            await database.sql
                .statement<TestRow>(
                    'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions"'
                )
                .all()
        ).map(row =>
            fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
        ),
        requests: await database.sql
            .statement<TestRow>(
                'select "publication_approval_requests"."id" as "id", "publication_approval_requests"."project_id" as "projectId", "publication_approval_requests"."publication_id" as "publicationId", "publication_approval_requests"."target_revision_id" as "targetRevisionId", "publication_approval_requests"."draft_revision" as "draftRevision", "publication_approval_requests"."proposed_scheduled_at" as "proposedScheduledAt", "publication_approval_requests"."state" as "state", "publication_approval_requests"."requested_by_actor_id" as "requestedByActorId", "publication_approval_requests"."decided_by_actor_id" as "decidedByActorId", "publication_approval_requests"."decided_at" as "decidedAt", "publication_approval_requests"."scheduled_at" as "scheduledAt", "publication_approval_requests"."rejection_reason" as "rejectionReason", "publication_approval_requests"."created_at" as "createdAt", "publication_approval_requests"."updated_at" as "updatedAt" from "publication_approval_requests"'
            )
            .all(),
        jobs: await database.sql
            .statement<TestRow>(
                'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
            )
            .all(),
        audit: await database.sql
            .statement<TestRow>(
                'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events"'
            )
            .all(),
    }
}

describe('manual workflow store', () => {
    it('creates a project, tracks manual publications, and records attribution', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, {
                now: () => now,
                createId: (() => {
                    let sequence = 0
                    return () => `generated-${++sequence}`
                })(),
            })

            const createdProject = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Postdot Launch',
                subjectId: 'user-1',
                displayName: 'Postdot Operator',
            })
            const manualChannel = await store.createChannel({
                projectId: createdProject.project.id,
                subjectId: 'user-1',
                name: 'Custom Manual Destination',
            })
            const secondChannel = await store.createChannel({
                projectId: createdProject.project.id,
                subjectId: 'user-1',
                name: 'Secondary Destination',
            })

            expect(manualChannel).not.toBeNull()
            expect(secondChannel).not.toBeNull()

            const createdPost = await store.createPost({
                projectId: createdProject.project.id,
                subjectId: 'user-1',
                title: 'Postdot is ready',
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
            expect(await store.listProjects('user-1')).toHaveLength(1)
            expect(await store.listProjects('other-user')).toEqual([])
            expect(await store.listChannels(createdProject.project.id, 'other-user')).toBeNull()

            const due = await store.listDueManualPublications(
                createdProject.project.id,
                'user-1',
                now
            )
            expect(due).toHaveLength(1)
            expect(due?.[0]).toMatchObject({
                channelName: 'Custom Manual Destination',
                targetContent: {
                    body: 'Manual channel copy',
                    media: [],
                },
                postTitle: 'Postdot is ready',
                state: 'scheduled',
            })

            const published = await store.publishManualPublication({
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
                await store.listDueManualPublications(createdProject.project.id, 'user-1', now)
            ).toEqual([])

            expect(
                (await store.listAuditEvents(createdProject.project.id, 'user-1'))
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
            await closeTestDatabase(database)
        }
    })

    it('filters publication summaries by all selected project-scoped tag IDs', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const taxonomy = createTaxonomyStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Queue Filter Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const firstChannel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'First destination',
            })
            const secondChannel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Second destination',
            })
            const created = await store.createPost({
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

            const alpha = await taxonomy.createTag({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Alpha',
            })
            const beta = await taxonomy.createTag({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Beta',
            })
            expect(alpha).not.toBeNull()
            expect(beta).not.toBeNull()
            await taxonomy.replacePublicationTags({
                projectId: project.project.id,
                publicationId: firstPublication?.id ?? '',
                subjectId: 'user-1',
                tagIds: [beta?.id ?? '', alpha?.id ?? ''],
            })
            await taxonomy.replacePublicationTags({
                projectId: project.project.id,
                publicationId: secondPublication?.id ?? '',
                subjectId: 'user-1',
                tagIds: [alpha?.id ?? ''],
            })

            const otherProject = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Other Queue Filter Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const foreignTag = await taxonomy.createTag({
                projectId: otherProject.project.id,
                subjectId: 'user-1',
                name: 'Foreign',
            })

            expect(
                (await store.listPublicationSummaries(project.project.id, 'user-1'))?.map(
                    publication => ({ id: publication.id, tagIds: publication.tagIds })
                )
            ).toEqual(
                expect.arrayContaining([
                    { id: firstPublication?.id, tagIds: [alpha?.id, beta?.id] },
                    { id: secondPublication?.id, tagIds: [alpha?.id] },
                ])
            )
            expect(
                (
                    await store.listPublicationSummaries(project.project.id, 'user-1', {
                        tagIds: [beta?.id ?? '', alpha?.id ?? ''],
                    })
                )?.map(publication => publication.id)
            ).toEqual([firstPublication?.id ?? ''])
            expect(
                (
                    await store.listPublicationSummaryPage(project.project.id, 'user-1', {
                        filter: { tagIds: [beta?.id ?? '', alpha?.id ?? ''] },
                    })
                )?.summary
            ).toEqual({ total: 1, manual: 1, automatic: 0, scheduled: 0, draft: 1 })
            expect(
                await store.listPublicationSummaries(project.project.id, 'user-1', {
                    tagIds: [foreignTag?.id ?? ''],
                })
            ).toEqual([])
            expect(
                (
                    await store.listPublicationSummaryPage(project.project.id, 'user-1', {
                        filter: { tagIds: [foreignTag?.id ?? ''] },
                    })
                )?.summary
            ).toEqual({ total: 0, manual: 0, automatic: 0, scheduled: 0, draft: 0 })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('pages publication summaries without dropping the tail and supports scheduled ranges', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Publication Pagination Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Pagination destination',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The pagination channel was not created')

            for (let index = 0; index < 100; index += 1) {
                await store.createPost({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    title: `Scheduled ${index}`,
                    sourceContent: sourceContent(`Scheduled ${index}`),
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: index === 0 ? 'automatic' : 'manual',
                            scheduledAt: now + index * 60_000,
                        },
                    ],
                })
            }
            const unscheduled = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                title: 'Unscheduled tail',
                sourceContent: sourceContent('Unscheduled tail'),
                publications: [
                    {
                        channelId: channel.id,
                    },
                ],
            })
            const firstPage = await store.listPublicationSummaryPage(project.project.id, 'user-1', {
                limit: 100,
            })
            expect(firstPage?.publications).toHaveLength(100)
            expect(firstPage?.nextCursor).not.toBeNull()
            expect(firstPage?.summary).toEqual({
                total: 101,
                manual: 100,
                automatic: 1,
                scheduled: 100,
                draft: 1,
            })

            const secondPage = await store.listPublicationSummaryPage(
                project.project.id,
                'user-1',
                {
                    cursor: firstPage?.nextCursor,
                    limit: 100,
                }
            )
            expect(secondPage?.publications.map(publication => publication.id)).toEqual([
                unscheduled?.publications[0]?.id ?? '',
            ])
            expect(secondPage?.nextCursor).toBeNull()
            expect(secondPage?.summary).toEqual(firstPage?.summary)
            expect(await store.listPublicationSummaries(project.project.id, 'user-1')).toHaveLength(
                101
            )

            const range = await store.listPublicationSummaryPage(project.project.id, 'user-1', {
                from: now + 10 * 60_000,
                to: now + 11 * 60_000,
                limit: 1,
            })
            expect(range?.publications.map(publication => publication.postTitle)).toEqual([
                'Scheduled 10',
            ])
            expect(range?.nextCursor).toBeNull()
            expect(range?.summary).toEqual({
                total: 1,
                manual: 1,
                automatic: 0,
                scheduled: 1,
                draft: 0,
            })

            const drafts = await store.listPublicationSummaryPage(project.project.id, 'user-1', {
                state: 'draft',
                sort: 'updated_desc',
            })
            expect(drafts?.publications.map(publication => publication.postTitle)).toEqual([
                'Unscheduled tail',
            ])
            expect(drafts?.summary.draft).toBe(1)

            const soonest = await store.listPublicationSummaryPage(project.project.id, 'user-1', {
                limit: 1,
                sort: 'scheduled_asc',
            })
            expect(soonest?.publications[0]?.postTitle).toBe('Scheduled 0')
            const latest = await store.listPublicationSummaryPage(project.project.id, 'user-1', {
                limit: 1,
                sort: 'scheduled_desc',
            })
            expect(latest?.publications[0]?.postTitle).toBe('Scheduled 99')

            await expect(
                store.listPublicationSummaryPage(project.project.id, 'user-1', {
                    cursor: 'publication-v1:invalid',
                })
            ).rejects.toThrow('publication cursor is invalid')
            await expect(
                store.listPublicationSummaryPage(project.project.id, 'user-1', {
                    from: now + 1,
                    to: now,
                })
            ).rejects.toThrow('publication list range')
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rolls back publication outcomes when their audit persistence fails', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000
        let triggerInstalled = false

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Outcome Rollback Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Manual Channel',
            })
            if (channel === null) throw new Error('The outcome rollback channel was not created')

            const manualPublication = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('The manual publication must remain due'),
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const manualPublicationId = manualPublication?.publications[0]?.id
            if (manualPublicationId === undefined)
                throw new Error('The manual outcome publication is missing')

            await installRejectingTrigger(database, {
                name: 'fail_publication_outcome_audit',
                table: 'audit_events',
                timing: 'before',
                event: 'insert',
                when: "NEW.action in ('publication.ready', 'publication.reconciled')",
                message: 'forced publication outcome failure',
            })
            triggerInstalled = true

            await expect(
                store.publishManualPublication({
                    projectId: project.project.id,
                    publicationId: manualPublicationId,
                    subjectId: 'user-1',
                    externalId: 'manual-outcome-1',
                })
            ).rejects.toThrow('forced publication outcome failure')
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."state" as "state", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId" from "publications" where "publications"."id" = ?1'
                    )
                    .all(manualPublicationId)
            ).toEqual([{ state: 'scheduled', publishedAt: null, externalId: null }])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events" where "audit_events"."action" = ?1'
                    )
                    .all('publication.ready')
            ).toHaveLength(0)

            const ambiguousPublication = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('The ambiguous publication must remain unresolved'),
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const ambiguousPublicationId = ambiguousPublication?.publications[0]?.id
            if (ambiguousPublicationId === undefined)
                throw new Error('The ambiguous outcome publication is missing')
            await database.sql
                .statement(
                    'update "publications" set "state" = ?1, "error_message" = ?2 where "publications"."id" = ?3'
                )
                .run('ambiguous', 'The provider response was lost', ambiguousPublicationId)

            await expect(
                store.reconcileAmbiguousPublication({
                    projectId: project.project.id,
                    publicationId: ambiguousPublicationId,
                    subjectId: 'user-1',
                    resolution: 'published',
                    externalId: 'ambiguous-outcome-1',
                })
            ).rejects.toThrow('forced publication outcome failure')
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."state" as "state", "publications"."error_message" as "errorMessage", "publications"."external_id" as "externalId" from "publications" where "publications"."id" = ?1'
                    )
                    .all(ambiguousPublicationId)
            ).toEqual([
                {
                    state: 'ambiguous',
                    errorMessage: 'The provider response was lost',
                    externalId: null,
                },
            ])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events" where "audit_events"."action" = ?1'
                    )
                    .all('publication.reconciled')
            ).toHaveLength(0)
        } finally {
            if (triggerInstalled)
                await dropRejectingTrigger(database, 'fail_publication_outcome_audit')
            await closeTestDatabase(database)
        }
    })

    it('rolls back an invalid post instead of leaving partial records', async () => {
        const database = (await openTestDatabase()).database

        try {
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Rollback Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })

            await expect(
                store.createPost({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    sourceContent: sourceContent('This must not persist'),
                    publications: [{ channelId: 'missing-channel' }],
                })
            ).rejects.toThrow('does not belong to project')
            expect(
                await database.sql.statement('select count(*) as count from posts').get()
            ).toEqual({
                count: 0,
            })
            expect(
                await database.sql.statement('select count(*) as count from audit_events').get()
            ).toEqual({
                count: 1,
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rolls back all creation records when a late persistence effect fails', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000
        let triggerInstalled = false

        try {
            const media = {
                async getAsset(
                    currentProjectId: string,
                    assetId: string,
                    _subjectId: string
                ): Promise<MediaAssetReference | null> {
                    return assetId === 'asset-1' ? createReadyMedia(currentProjectId, now) : null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Creation Rollback Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Media Channel',
                profile: createMediaProfile(1, ['image'], ['image/jpeg']),
            })
            if (channel === null) throw new Error('The creation rollback channel was not created')

            const readyMedia = createReadyMedia(project.project.id, now, project.actor.id)
            await insertRow(database, 'media_assets', readyMedia.asset)
            const readyRepresentation = readyMedia.representations[0]
            if (readyRepresentation === undefined) {
                throw new Error('The creation rollback media representation is missing')
            }
            await insertRow(database, 'media_representations', {
                ...readyRepresentation,
                recipeJson: null,
            })
            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'creation-rollback-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'media-provider'
                )

            await installRejectingTrigger(database, {
                name: 'fail_publication_creation_audit',
                table: 'audit_events',
                timing: 'before',
                event: 'insert',
                when: "NEW.action = 'publication.created'",
                message: 'forced publication creation failure',
            })
            triggerInstalled = true

            await expect(
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
            ).rejects.toThrow('forced publication creation failure')

            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "posts"."id" as "id", "posts"."project_id" as "projectId", "posts"."title" as "title", "posts"."source_content" as "sourceContent", "posts"."source_revision" as "sourceRevision", "posts"."created_by_actor_id" as "createdByActorId", "posts"."created_at" as "createdAt", "posts"."updated_at" as "updatedAt" from "posts"'
                        )
                        .all()
                ).map(row => fromDbRow<TestRow>(row, { sourceContent: 'json' }))
            ).toHaveLength(0)
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications"'
                        )
                        .all()
                ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            ).toHaveLength(0)
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_working_drafts"."id" as "id", "publication_working_drafts"."project_id" as "projectId", "publication_working_drafts"."publication_id" as "publicationId", "publication_working_drafts"."profile_version_id" as "profileVersionId", "publication_working_drafts"."source_revision" as "sourceRevision", "publication_working_drafts"."base_source_content" as "baseSourceContent", "publication_working_drafts"."content_json" as "contentJson", "publication_working_drafts"."review_state" as "reviewState", "publication_working_drafts"."validation_issues_json" as "validationIssuesJson", "publication_working_drafts"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publication_working_drafts"."revision" as "revision", "publication_working_drafts"."updated_by_actor_id" as "updatedByActorId", "publication_working_drafts"."created_at" as "createdAt", "publication_working_drafts"."updated_at" as "updatedAt" from "publication_working_drafts"'
                        )
                        .all()
                ).map(row =>
                    fromDbRow<TestRow>(row, {
                        baseSourceContent: 'json',
                        contentJson: 'json',
                        validationIssuesJson: 'json',
                    })
                )
            ).toHaveLength(0)
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions"'
                        )
                        .all()
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toHaveLength(0)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "publication_revision_media"."id" as "id", "publication_revision_media"."project_id" as "projectId", "publication_revision_media"."target_revision_id" as "targetRevisionId", "publication_revision_media"."asset_id" as "assetId", "publication_revision_media"."representation_id" as "representationId", "publication_revision_media"."position" as "position", "publication_revision_media"."content_path" as "contentPath", "publication_revision_media"."role" as "role", "publication_revision_media"."accessibility_text" as "accessibilityText", "publication_revision_media"."created_at" as "createdAt" from "publication_revision_media"'
                    )
                    .all()
            ).toHaveLength(0)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toHaveLength(0)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events" where "audit_events"."action" = ?1'
                    )
                    .all('post.created')
            ).toHaveLength(0)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events" where "audit_events"."action" = ?1'
                    )
                    .all('publication.created')
            ).toHaveLength(0)
        } finally {
            if (triggerInstalled)
                await dropRejectingTrigger(database, 'fail_publication_creation_audit')
            await closeTestDatabase(database)
        }
    })

    it('creates durable work for an automated channel', async () => {
        const database = (await openTestDatabase()).database

        try {
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Automatic Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
                profile: automaticTestProfile,
            })

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'publisher-1',
                    await workspaceOf(database, project.project.id),
                    channel?.id ?? '',
                    'future-provider'
                )

            const created = await store.createPost({
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
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toHaveLength(1)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('requeues a failed automatic publication without changing its target', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Retry Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The retry test channel was not created')

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'retry-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'future-provider'
                )

            const created = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Retry this publication'),
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: now,
                    },
                ],
            })
            if (created === null) throw new Error('The retry test post was not created')
            const publication = created.publications[0]
            const job = (
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            )[0]
            if (publication === undefined || publication.targetRevisionId === null) {
                throw new Error('The retry test publication is missing its target')
            }
            if (job === undefined) throw new Error('The retry test job is missing')

            await database.sql
                .statement(
                    'update "publications" set "state" = ?1, "error_message" = ?2, "state_changed_by_actor_id" = ?3, "updated_at" = ?4 where "publications"."id" = ?5'
                )
                .run(
                    'failed',
                    'Provider rejected the payload',
                    project.actor.id,
                    now,
                    publication.id
                )
            await database.sql
                .statement(
                    'update "jobs" set "state" = ?1, "attempts" = ?2, "claimed_at" = ?3, "effect_started_at" = ?4, "started_at" = ?5, "completed_at" = ?6, "error_message" = ?7, "updated_at" = ?8 where "jobs"."id" = ?9'
                )
                .run('failed', 2, now, now, now, now, 'Provider rejected the payload', now, job.id)

            const retried = await store.retryFailedPublication({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
            })
            expect(retried).toMatchObject({
                kind: 'retried',
                publication: {
                    id: publication.id,
                    state: 'ready',
                    errorMessage: null,
                    targetRevisionId: publication.targetRevisionId,
                },
            })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toMatchObject([
                {
                    id: job.id,
                    state: 'pending',
                    attempts: 2,
                    runAt: now,
                    claimToken: null,
                    claimedByActorId: null,
                    claimedAt: null,
                    leaseExpiresAt: null,
                    effectStartedAt: null,
                    startedAt: null,
                    completedAt: null,
                    errorMessage: null,
                },
            ])
            const retryEvent = (
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events"'
                    )
                    .all()
            ).find(event => event.action === 'publication.retry_requested')
            expect(retryEvent).toMatchObject({
                entityId: publication.id,
                actorId: project.actor.id,
            })
            expect(JSON.parse(retryEvent?.metadataJson ?? '{}')).toEqual(
                expect.objectContaining({
                    fromState: 'failed',
                    toState: 'ready',
                    targetRevisionId: publication.targetRevisionId,
                    jobId: job.id,
                    previousAttempts: 2,
                    retryAt: now,
                })
            )

            expect(
                await store.retryFailedPublication({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                })
            ).toEqual({ kind: 'not_retryable' })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('reschedules and cancels a publication group atomically with automatic jobs', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Bulk scheduling project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const firstChannel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'First channel',
                profile: automaticTestProfile,
            })
            const secondChannel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Second channel',
                profile: automaticTestProfile,
            })
            const draftChannel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Draft channel',
                profile: automaticTestProfile,
            })
            if (firstChannel === null || secondChannel === null || draftChannel === null) {
                throw new Error('The bulk scheduling channels were not created')
            }

            await insertRow(database, 'publishers', [
                {
                    id: 'bulk-scheduling-publisher-1',
                    workspaceId: await workspaceOf(database, project.project.id),
                    channelId: firstChannel.id,
                    kind: 'future-provider',
                },
                {
                    id: 'bulk-scheduling-publisher-2',
                    workspaceId: await workspaceOf(database, project.project.id),
                    channelId: secondChannel.id,
                    kind: 'future-provider',
                },
                {
                    id: 'bulk-scheduling-publisher-3',
                    workspaceId: await workspaceOf(database, project.project.id),
                    channelId: draftChannel.id,
                    kind: 'future-provider',
                },
            ])

            const created = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Bulk scheduling source'),
                publications: [
                    {
                        channelId: firstChannel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: now + 60_000,
                    },
                    {
                        channelId: secondChannel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: now + 60_000,
                    },
                    { channelId: draftChannel.id, deliveryMode: 'automatic' },
                ],
            })
            if (created === null) throw new Error('The bulk scheduling post was not created')
            const [firstPublication, secondPublication, draftPublication] = created.publications
            if (
                firstPublication === undefined ||
                secondPublication === undefined ||
                draftPublication === undefined
            ) {
                throw new Error('The bulk scheduling publications are missing')
            }

            const rescheduled = await store.reschedulePublications({
                projectId: project.project.id,
                publicationIds: [firstPublication.id, secondPublication.id],
                scheduledAt: now + 120_000,
                subjectId: 'user-1',
            })
            expect(rescheduled).toMatchObject([
                { id: firstPublication.id, state: 'scheduled', scheduledAt: now + 120_000 },
                { id: secondPublication.id, state: 'scheduled', scheduledAt: now + 120_000 },
            ])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toMatchObject([
                { publicationId: firstPublication.id, runAt: now + 120_000 },
                { publicationId: secondPublication.id, runAt: now + 120_000 },
            ])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."action" as "action", "audit_events"."entity_id" as "entityId" from "audit_events" where "audit_events"."action" = ?1'
                    )
                    .all('publication.rescheduled')
            ).toEqual([
                { action: 'publication.rescheduled', entityId: firstPublication.id },
                { action: 'publication.rescheduled', entityId: secondPublication.id },
            ])

            await expect(
                store.reschedulePublications({
                    projectId: project.project.id,
                    publicationIds: [firstPublication.id, draftPublication.id],
                    scheduledAt: now + 180_000,
                    subjectId: 'user-1',
                })
            ).rejects.toThrow('Cannot reschedule a draft publication')
            expect(await store.listPublicationSummaries(project.project.id, 'user-1')).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: firstPublication.id,
                        scheduledAt: now + 120_000,
                    }),
                    expect.objectContaining({
                        id: secondPublication.id,
                        scheduledAt: now + 120_000,
                    }),
                    expect.objectContaining({
                        id: draftPublication.id,
                        state: 'draft',
                        scheduledAt: null,
                    }),
                ])
            )
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."action" as "action" from "audit_events" where "audit_events"."action" = ?1'
                    )
                    .all('publication.rescheduled')
            ).toHaveLength(2)

            const firstJob = (
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).find(job => job.publicationId === firstPublication.id)
            if (firstJob === undefined) throw new Error('The first bulk scheduling job is missing')
            await database.sql
                .statement(
                    'update "jobs" set "state" = ?1, "claim_token" = ?2, "claimed_by_actor_id" = ?3, "claimed_at" = ?4, "lease_expires_at" = ?5, "started_at" = ?6 where "jobs"."id" = ?7'
                )
                .run(
                    'running',
                    'bulk-cancel-claim',
                    project.actor.id,
                    now,
                    now + 60_000,
                    now,
                    firstJob.id
                )
            await expect(
                store.cancelPublications({
                    projectId: project.project.id,
                    publicationIds: [firstPublication.id, secondPublication.id],
                    subjectId: 'user-1',
                })
            ).rejects.toThrow('while its job is running')
            expect(await store.listPublicationSummaries(project.project.id, 'user-1')).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: firstPublication.id, state: 'scheduled' }),
                    expect.objectContaining({ id: secondPublication.id, state: 'scheduled' }),
                ])
            )
            await database.sql
                .statement(
                    'update "jobs" set "state" = ?1, "claim_token" = ?2, "claimed_by_actor_id" = ?3, "claimed_at" = ?4, "lease_expires_at" = ?5, "effect_started_at" = ?6, "started_at" = ?7, "completed_at" = ?8, "error_message" = ?9, "updated_at" = ?10 where "jobs"."id" = ?11'
                )
                .run('pending', null, null, null, null, null, null, null, null, now, firstJob.id)

            const cancelled = await store.cancelPublications({
                projectId: project.project.id,
                publicationIds: [firstPublication.id, secondPublication.id],
                subjectId: 'user-1',
            })
            expect(cancelled).toMatchObject([
                { id: firstPublication.id, state: 'cancelled' },
                { id: secondPublication.id, state: 'cancelled' },
            ])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toMatchObject([
                { publicationId: firstPublication.id, state: 'cancelled', completedAt: now },
                { publicationId: secondPublication.id, state: 'cancelled', completedAt: now },
            ])
            const cancellationAudits = (
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."action" as "action", "audit_events"."entity_id" as "entityId" from "audit_events"'
                    )
                    .all()
            ).filter(
                event =>
                    event.action === 'publication.cancelled' ||
                    event.action === 'publication.execution.cancelled'
            )
            expect(cancellationAudits).toHaveLength(4)
            expect(cancellationAudits).toEqual(
                expect.arrayContaining([
                    { action: 'publication.cancelled', entityId: firstPublication.id },
                    { action: 'publication.cancelled', entityId: secondPublication.id },
                    {
                        action: 'publication.execution.cancelled',
                        entityId: firstPublication.id,
                    },
                    {
                        action: 'publication.execution.cancelled',
                        entityId: secondPublication.id,
                    },
                ])
            )
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('keeps the selected target stable until a draft is promoted', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Revision Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The revision test channel was not created')

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'revision-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'future-provider'
                )

            const created = await store.createPost({
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

            const initialJob = (
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            )[0]
            if (initialJob === undefined) throw new Error('The initial job is missing')

            const saved = await store.savePublicationDraft({
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
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."target_revision_id" as "targetRevisionId" from "publications"'
                    )
                    .all()
            ).toEqual([{ targetRevisionId: publication.targetRevisionId }])
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions"'
                        )
                        .all()
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toHaveLength(1)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toMatchObject([{ id: initialJob.id, state: 'pending', runAt: now + 60_000 }])

            await expect(
                store.savePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                })
            ).rejects.toThrow('must include sourceContent or targetContent')

            const editor = await store.getPublicationEditorState(
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
            expect(
                await store.listPublicationSummaries(project.project.id, 'user-1')
            ).toMatchObject([
                {
                    id: publication.id,
                    draftRevision: 2,
                    draftReviewState: 'compatible',
                    draftDiffersFromTarget: true,
                },
            ])

            await expect(
                store.savePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    targetContent: { body: 'Stale editor write' },
                })
            ).rejects.toThrow('changed after revision 1')
            expect(
                await store.getPublicationWorkingDraft(project.project.id, publication.id, 'user-1')
            ).toMatchObject({
                revision: 2,
                content: { body: 'Edited target' },
            })

            const promoted = await store.promotePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: 2,
                scheduledAt: now + 120_000,
            })
            expect(promoted).toMatchObject({ state: 'scheduled', scheduledAt: now + 120_000 })
            expect(promoted?.targetRevisionId).not.toBe(publication.targetRevisionId)
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions"'
                        )
                        .all()
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toHaveLength(2)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([
                expect.objectContaining({
                    id: initialJob.id,
                    state: 'pending',
                    runAt: now + 120_000,
                }),
            ])
            expect(
                await store.listPublicationSummaries(project.project.id, 'user-1')
            ).toMatchObject([{ id: publication.id, draftDiffersFromTarget: false }])

            await expect(
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    scheduledAt: now + 180_000,
                })
            ).rejects.toThrow('changed after revision 1')
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rolls back a promotion when a late persistence effect fails', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000
        let triggerInstalled = false

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Promotion Rollback Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The rollback test channel was not created')

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'promotion-rollback-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'future-provider'
                )

            const created = await store.createPost({
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

            await installRejectingTrigger(database, {
                name: 'fail_publication_promotion_audit',
                table: 'audit_events',
                timing: 'before',
                event: 'insert',
                when: "NEW.action = 'publication.target_promoted'",
                message: 'forced publication promotion failure',
            })
            triggerInstalled = true

            await expect(
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    scheduledAt: now + 120_000,
                })
            ).rejects.toThrow('forced publication promotion failure')

            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."target_revision_id" as "targetRevisionId", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(publication.id)
            ).toEqual([
                {
                    targetRevisionId: publication.targetRevisionId,
                    state: 'scheduled',
                    scheduledAt: now + 60_000,
                },
            ])
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                        )
                        .all(publication.id)
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toHaveLength(1)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."publication_id" = ?1'
                    )
                    .all(publication.id)
            ).toEqual([expect.objectContaining({ state: 'pending', runAt: now + 60_000 })])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events" where "audit_events"."action" = ?1'
                    )
                    .all('publication.target_promoted')
            ).toHaveLength(0)
        } finally {
            if (triggerInstalled)
                await dropRejectingTrigger(database, 'fail_publication_promotion_audit')
            await closeTestDatabase(database)
        }
    })

    it('keeps invalid drafts editable but blocks their promotion', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Review Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The review test channel was not created')

            const created = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Reviewable content'),
                publications: [{ channelId: channel.id, deliveryMode: 'automatic' }],
            })
            if (created === null) throw new Error('The review test post was not created')
            const publication = created.publications[0]
            if (publication === undefined) throw new Error('The review publication is missing')

            const saved = await store.savePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: 1,
                targetContent: {},
            })
            expect(saved?.reviewState).toBe('review_required')
            expect(saved?.validationIssues.length).toBeGreaterThan(0)
            await expect(
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                    scheduledAt: now + 60_000,
                })
            ).rejects.toThrow('Publication target content is invalid')
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions"'
                        )
                        .all()
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toHaveLength(0)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('blocks an ordinary promotion that satisfies only the superseded profile', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Superseded Profile Promotion Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Versioned Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The profile promotion channel was not created')
            const originalProfileVersionId = channel.profileVersionId

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'superseded-profile-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'future-provider'
                )

            const created = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Superseded profile source'),
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
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        targetContent: { body: 'short target' },
                    },
                ],
            })
            if (created === null) throw new Error('The profile promotion post was not created')
            const compatiblePublication = created.publications[0]
            const invalidPublication = created.publications[1]
            const unscheduledCompatiblePublication = created.publications[2]
            if (
                compatiblePublication === undefined ||
                invalidPublication === undefined ||
                unscheduledCompatiblePublication === undefined
            ) {
                throw new Error('The profile promotion publications are missing')
            }

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
            const activeProfile = {
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
            const profileDraft = await store.createChannelProfileDraft({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                profile: activeProfile,
            })
            if (profileDraft === null) throw new Error('The active profile draft was not created')

            const activated = await store.activateChannelProfile({
                projectId: project.project.id,
                channelId: channel.id,
                profileVersionId: profileDraft.id,
                subjectId: 'user-1',
                expectedRevision: 1,
            })
            if (activated === null) throw new Error('The active profile was not activated')

            const initialCompatibleTarget = (
                await database.sql
                    .statement<TestRow>(
                        'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                    )
                    .all(compatiblePublication.id)
            ).map(row =>
                fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
            )
            const initialInvalidTarget = (
                await database.sql
                    .statement<TestRow>(
                        'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                    )
                    .all(invalidPublication.id)
            ).map(row =>
                fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
            )
            if (initialCompatibleTarget.length !== 1 || initialInvalidTarget.length !== 1) {
                throw new Error('The initial target revisions are missing')
            }

            const compatibleJob = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."publication_id" = ?1'
                )
                .all(compatiblePublication.id)
            const invalidJob = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."publication_id" = ?1'
                )
                .all(invalidPublication.id)
            expect(compatibleJob).toEqual([expect.objectContaining({ state: 'pending' })])
            expect(invalidJob).toEqual([expect.objectContaining({ state: 'cancelled' })])

            const rescuedInvalidContent = { body: 'this target remains too long for v2' }
            const savedInvalidDraft = await store.savePublicationDraft({
                projectId: project.project.id,
                publicationId: invalidPublication.id,
                subjectId: 'user-1',
                expectedRevision: 2,
                targetContent: rescuedInvalidContent,
            })
            expect(savedInvalidDraft).toMatchObject({
                revision: 3,
                profileVersionId: originalProfileVersionId,
                lastAssessedProfileVersionId: originalProfileVersionId,
                reviewState: 'compatible',
                content: rescuedInvalidContent,
            })

            await expect(
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: invalidPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 3,
                    scheduledAt: now + 180_000,
                })
            ).rejects.toThrow(
                'Publication target content is incompatible with the active channel profile'
            )

            const invalidPublicationRow = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(invalidPublication.id)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))[0]
            if (invalidPublicationRow === undefined) {
                throw new Error('The invalid publication disappeared')
            }
            expect(invalidPublicationRow).toMatchObject({
                state: 'scheduled',
                reviewState: 'review_required',
                targetRevisionId: initialInvalidTarget[0]?.id,
                lastAssessedProfileVersionId: profileDraft.id,
            })
            expect(
                await store.getPublicationWorkingDraft(
                    project.project.id,
                    invalidPublication.id,
                    'user-1'
                )
            ).toMatchObject({
                revision: 3,
                profileVersionId: originalProfileVersionId,
                lastAssessedProfileVersionId: originalProfileVersionId,
                reviewState: 'compatible',
                content: rescuedInvalidContent,
            })
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                        )
                        .all(invalidPublication.id)
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toEqual(initialInvalidTarget)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."publication_id" = ?1'
                    )
                    .all(invalidPublication.id)
            ).toEqual(invalidJob)

            const promoted = await store.promotePublicationDraft({
                projectId: project.project.id,
                publicationId: unscheduledCompatiblePublication.id,
                subjectId: 'user-1',
                expectedRevision: 2,
                scheduledAt: now + 180_000,
            })
            expect(promoted).toMatchObject({
                state: 'scheduled',
                reviewState: 'compatible',
                targetRevisionId: expect.any(String),
                lastAssessedProfileVersionId: originalProfileVersionId,
            })
            const promotedTargets = (
                await database.sql
                    .statement<TestRow>(
                        'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                    )
                    .all(unscheduledCompatiblePublication.id)
            ).map(row =>
                fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
            )
            expect(promotedTargets).toHaveLength(1)
            expect(promotedTargets[0]).toMatchObject({ profileVersionId: originalProfileVersionId })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."publication_id" = ?1'
                    )
                    .all(unscheduledCompatiblePublication.id)
            ).toEqual([expect.objectContaining({ state: 'pending' })])
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                        )
                        .all(compatiblePublication.id)
                ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))[0]
            ).toMatchObject({ targetRevisionId: initialCompatibleTarget[0]?.id })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."publication_id" = ?1'
                    )
                    .all(compatiblePublication.id)
            ).toEqual(compatibleJob)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('blocks ordinary promotion when the active profile narrows media support', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const setupStore = createManualStore(database, { now: () => now })
            const project = await setupStore.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Active Media Promotion Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const readyMedia = createReadyMedia(project.project.id, now, project.actor.id)
            await insertRow(database, 'media_assets', readyMedia.asset)
            const readyRepresentation = readyMedia.representations[0]
            if (readyRepresentation === undefined) {
                throw new Error('The ready media representation is missing')
            }
            await insertRow(database, 'media_representations', {
                ...readyRepresentation,
                recipeJson: null,
            })
            const media = {
                async getAsset(
                    currentProjectId: string,
                    assetId: string,
                    _subjectId: string
                ): Promise<MediaAssetReference | null> {
                    return assetId === 'asset-1'
                        ? createReadyMedia(currentProjectId, now, project.actor.id)
                        : null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Media Channel',
                profile: createMediaProfile(1, ['image'], ['image/jpeg']),
            })
            if (channel === null) throw new Error('The active media channel was not created')
            const originalProfileVersionId = channel.profileVersionId

            const targetContent = {
                body: 'Media target',
                media: [{ assetId: 'asset-1' }],
            }
            const created = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Active media source'),
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'manual',
                        targetContent,
                        scheduledAt: now + 60_000,
                    },
                ],
            })
            if (created === null) throw new Error('The active media post was not created')
            const publication = created.publications[0]
            if (publication === undefined)
                throw new Error('The active media publication is missing')
            const initialTargets = (
                await database.sql
                    .statement<TestRow>(
                        'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                    )
                    .all(publication.id)
            ).map(row =>
                fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
            )
            if (initialTargets.length !== 1) {
                throw new Error('The initial media target revision is missing')
            }

            const profileDraft = await store.createChannelProfileDraft({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                profile: createMediaProfile(2, ['video'], ['video/mp4']),
            })
            if (profileDraft === null) throw new Error('The active media draft was not created')
            const activated = await store.activateChannelProfile({
                projectId: project.project.id,
                channelId: channel.id,
                profileVersionId: profileDraft.id,
                subjectId: 'user-1',
                expectedRevision: 1,
            })
            if (activated === null) throw new Error('The active media profile was not activated')

            const saved = await store.savePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: 2,
                targetContent,
            })
            expect(saved).toMatchObject({
                revision: 3,
                profileVersionId: originalProfileVersionId,
                reviewState: 'compatible',
                content: targetContent,
            })
            await expect(
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 3,
                    scheduledAt: now + 120_000,
                })
            ).rejects.toThrow(
                'Publication target content is incompatible with the active channel profile'
            )
            expect(
                await store.getPublicationWorkingDraft(project.project.id, publication.id, 'user-1')
            ).toMatchObject({
                revision: 3,
                profileVersionId: originalProfileVersionId,
                reviewState: 'compatible',
                content: targetContent,
            })
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                        )
                        .all(publication.id)
                ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))[0]
            ).toMatchObject({
                state: 'scheduled',
                reviewState: 'review_required',
                targetRevisionId: initialTargets[0]?.id,
                lastAssessedProfileVersionId: profileDraft.id,
            })
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                        )
                        .all(publication.id)
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toEqual(initialTargets)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('blocks ordinary automatic promotion when the execution contract changes', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Execution Contract Promotion Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Versioned Automatic Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) {
                throw new Error('The execution contract channel was not created')
            }
            const originalProfileVersionId = channel.profileVersionId

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'execution-contract-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'future-provider'
                )

            const targetContent = { body: 'short target' }
            const created = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Execution contract source'),
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        targetContent,
                        scheduledAt: now + 60_000,
                    },
                ],
            })
            if (created === null) throw new Error('The execution contract post was not created')
            const publication = created.publications[0]
            if (publication === undefined) {
                throw new Error('The execution contract publication is missing')
            }
            const initialTargets = (
                await database.sql
                    .statement<TestRow>(
                        'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                    )
                    .all(publication.id)
            ).map(row =>
                fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
            )
            if (initialTargets.length !== 1) {
                throw new Error('The initial execution target revision is missing')
            }

            const profileDraft = await store.createChannelProfileDraft({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                profile: {
                    ...automaticTestProfile,
                    profileHash: 'sha256:future-provider-profile-v2',
                    schemaHash: 'sha256:future-provider-schema-v2',
                    execution: {
                        kind: 'built_in',
                        contractId: 'future-provider',
                        revision: 'v2',
                    },
                },
            })
            if (profileDraft === null) {
                throw new Error('The execution contract draft was not created')
            }
            const activated = await store.activateChannelProfile({
                projectId: project.project.id,
                channelId: channel.id,
                profileVersionId: profileDraft.id,
                subjectId: 'user-1',
                expectedRevision: 1,
            })
            if (activated === null) {
                throw new Error('The execution contract profile was not activated')
            }
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."publication_id" = ?1'
                    )
                    .all(publication.id)
            ).toEqual([expect.objectContaining({ state: 'cancelled' })])

            const saved = await store.savePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: 2,
                targetContent,
            })
            expect(saved).toMatchObject({
                revision: 3,
                profileVersionId: originalProfileVersionId,
                reviewState: 'compatible',
                content: targetContent,
            })
            await expect(
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 3,
                    scheduledAt: now + 120_000,
                })
            ).rejects.toThrow(
                'Publication target content is incompatible with the active channel profile'
            )
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                        )
                        .all(publication.id)
                ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))[0]
            ).toMatchObject({
                state: 'scheduled',
                reviewState: 'review_required',
                targetRevisionId: initialTargets[0]?.id,
                lastAssessedProfileVersionId: profileDraft.id,
            })
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions" where "publication_target_revisions"."publication_id" = ?1'
                        )
                        .all(publication.id)
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toEqual(initialTargets)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."publication_id" = ?1'
                    )
                    .all(publication.id)
            ).toEqual([expect.objectContaining({ state: 'cancelled' })])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rejects an invalid scheduled media target before persisting the publication', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const media = {
                async getAsset(
                    _projectId: string,
                    _assetId: string,
                    _subjectId: string
                ): Promise<MediaAssetReference | null> {
                    return null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Scheduled Media Validation Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Scheduled Media Channel',
                profile: createMediaProfile(1, ['image'], ['image/jpeg']),
            })
            if (channel === null) throw new Error('The scheduled media channel was not created')

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'scheduled-media-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'media-provider'
                )

            await expect(
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
            ).rejects.toThrow('Media asset missing-asset is not available for publication')

            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "posts"."id" as "id", "posts"."project_id" as "projectId", "posts"."title" as "title", "posts"."source_content" as "sourceContent", "posts"."source_revision" as "sourceRevision", "posts"."created_by_actor_id" as "createdByActorId", "posts"."created_at" as "createdAt", "posts"."updated_at" as "updatedAt" from "posts"'
                        )
                        .all()
                ).map(row => fromDbRow<TestRow>(row, { sourceContent: 'json' }))
            ).toEqual([])
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications"'
                        )
                        .all()
                ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            ).toEqual([])
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions"'
                        )
                        .all()
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toEqual([])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('versions a channel profile and re-assesses persisted work on activation', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Profile Lifecycle Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Versioned Channel',
                profile: automaticTestProfile,
            })
            if (channel === null) throw new Error('The profile lifecycle channel was not created')

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'profile-lifecycle-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'future-provider'
                )

            const created = await store.createPost({
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

            const draft = await store.createChannelProfileDraft({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                profile: nextProfile,
            })
            expect(draft).toMatchObject({ state: 'draft', version: 2, revision: 1 })
            if (draft === null) throw new Error('The profile draft was not created')

            const preview = await store.previewChannelProfileActivation({
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

            const activated = await store.activateChannelProfile({
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

            const profileRows = await database.sql
                .statement<TestRow>(
                    'select "channel_profile_versions"."id" as "id", "channel_profile_versions"."state" as "state" from "channel_profile_versions"'
                )
                .all()
            expect(profileRows).toEqual([
                { id: channel.profileVersionId, state: 'superseded' },
                { id: draft.id, state: 'active' },
            ])

            const publicationRows = await database.sql
                .statement<TestRow>(
                    'select id, review_state as "reviewState", target_revision_id as "targetRevisionId", last_assessed_profile_version_id as "lastAssessedProfileVersionId" from publications order by created_at, id'
                )
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

            const workingDraftRows = await database.sql
                .statement<TestRow>(
                    'select "publication_working_drafts"."profile_version_id" as "profileVersionId", "publication_working_drafts"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId" from "publication_working_drafts"'
                )
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
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                        )
                        .all()
                )
                    .map(job => job.state)
                    .sort()
            ).toEqual(['cancelled', 'pending'])
            expect(
                await store.getChannelProfileState(project.project.id, channel.id, 'user-1')
            ).toMatchObject({
                active: { id: draft.id, state: 'active' },
                draft: null,
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('revalidates pinned media representations when a profile narrows media support', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const media = {
                async getAsset(
                    currentProjectId: string,
                    assetId: string,
                    _subjectId: string
                ): Promise<MediaAssetReference | null> {
                    return assetId === 'asset-1' ? createReadyMedia(currentProjectId, now) : null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Media Profile Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const readyMedia = createReadyMedia(project.project.id, now, project.actor.id)
            await insertRow(database, 'media_assets', readyMedia.asset)
            const readyRepresentation = readyMedia.representations[0]
            if (readyRepresentation === undefined) {
                throw new Error('The ready media representation is missing')
            }
            await insertRow(database, 'media_representations', {
                ...readyRepresentation,
                recipeJson: null,
            })
            const profile = createMediaProfile(1, ['image'], ['image/jpeg'])
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Media Channel',
                profile,
            })
            if (channel === null) throw new Error('The media profile channel was not created')

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'media-profile-publisher',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'media-provider'
                )

            const created = await store.createPost({
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

            const draft = await store.createChannelProfileDraft({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                profile: createMediaProfile(2, ['video'], ['video/mp4']),
            })
            if (draft === null) throw new Error('The media profile draft was not created')

            const preview = await store.previewChannelProfileActivation({
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

            await store.activateChannelProfile({
                projectId: project.project.id,
                channelId: channel.id,
                profileVersionId: draft.id,
                subjectId: 'user-1',
            })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([expect.objectContaining({ state: 'cancelled' })])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('surfaces media capability issues while drafts are created and autosaved', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const media = {
                async getAsset(
                    _projectId: string,
                    _assetId: string,
                    _subjectId: string
                ): Promise<MediaAssetReference | null> {
                    return null
                },
            }
            const store = createManualStore(database, { now: () => now, media })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Draft Media Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Media Draft Channel',
                profile: createMediaProfile(1, ['image'], ['image/jpeg']),
            })
            if (channel === null) throw new Error('The media draft channel was not created')

            const created = await store.createPost({
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
                await store.getPublicationWorkingDraft(project.project.id, publication.id, 'user-1')
            ).toMatchObject({
                reviewState: 'review_required',
                validationIssues: [expect.objectContaining({ code: 'profile.media_incompatible' })],
            })

            const saved = await store.savePublicationDraft({
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
            await closeTestDatabase(database)
        }
    })

    it('fences concurrent source edits across publication drafts', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Shared Source Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const firstChannel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'First Channel',
            })
            const secondChannel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Second Channel',
            })
            if (firstChannel === null || secondChannel === null) {
                throw new Error('The shared source channels were not created')
            }

            const created = await store.createPost({
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
                (
                    await store.savePublicationDraft({
                        projectId: project.project.id,
                        publicationId: firstPublication.id,
                        subjectId: 'user-1',
                        expectedRevision: 1,
                        sourceContent: sourceContent('First editor source'),
                        targetContent: { body: 'First editor target', media: [] },
                    })
                )?.sourceRevision
            ).toBe(2)

            await expect(
                store.savePublicationDraft({
                    projectId: project.project.id,
                    publicationId: secondPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    targetContent: { body: 'Second editor target', media: [] },
                })
            ).rejects.toThrow('changed after this publication draft was loaded')

            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "posts"."id" as "id", "posts"."project_id" as "projectId", "posts"."title" as "title", "posts"."source_content" as "sourceContent", "posts"."source_revision" as "sourceRevision", "posts"."created_by_actor_id" as "createdByActorId", "posts"."created_at" as "createdAt", "posts"."updated_at" as "updatedAt" from "posts"'
                        )
                        .all()
                ).map(row => fromDbRow<TestRow>(row, { sourceContent: 'json' }))
            ).toMatchObject([
                {
                    sourceRevision: 2,
                    sourceContent: sourceContent('First editor source'),
                },
            ])
            expect(
                await store.getPublicationWorkingDraft(
                    project.project.id,
                    secondPublication.id,
                    'user-1'
                )
            ).toMatchObject({
                revision: 1,
                sourceRevision: 1,
                baseSourceContent: sourceContent('Initial source'),
                content: { body: 'Initial source', media: [] },
            })

            const rebased = await store.rebasePublicationDraft({
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

            const idempotentRebase = await store.rebasePublicationDraft({
                projectId: project.project.id,
                publicationId: secondPublication.id,
                subjectId: 'user-1',
                expectedRevision: 2,
            })
            expect(idempotentRebase).toMatchObject({ revision: 2, sourceRevision: 2 })
            expect(
                (await store.listAuditEvents(project.project.id, 'user-1'))?.filter(
                    event => event.action === 'publication.draft.rebased'
                )
            ).toHaveLength(1)
            await expect(
                store.savePublicationDraft({
                    projectId: project.project.id,
                    publicationId: secondPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    targetContent: { body: 'Stale copy', media: [] },
                })
            ).rejects.toThrow('changed after revision 1')
            const before = await store.getPublicationEditorState(
                project.project.id,
                secondPublication.id,
                'user-1'
            )
            await expect(
                store.rebasePublicationDraft({
                    projectId: project.project.id,
                    publicationId: secondPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                    expectedSourceRevision: 1,
                    replaceContent: true,
                })
            ).rejects.toThrow('source changed during destination review')
            expect(
                await store.getPublicationEditorState(
                    project.project.id,
                    secondPublication.id,
                    'user-1'
                )
            ).toEqual(before)
            await expect(
                store.rebasePublicationDraft({
                    projectId: project.project.id,
                    publicationId: secondPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                    replaceContent: true,
                })
            ).rejects.toThrow('requires its expected revision')
            const applied = await store.rebasePublicationDraft({
                projectId: project.project.id,
                publicationId: secondPublication.id,
                subjectId: 'user-1',
                expectedRevision: 2,
                expectedSourceRevision: 2,
                replaceContent: true,
            })
            expect(applied).toMatchObject({
                revision: 3,
                sourceRevision: 2,
                content: { body: 'First editor source', media: [] },
                reviewState: 'compatible',
            })
            const after = await store.getPublicationEditorState(
                project.project.id,
                secondPublication.id,
                'user-1'
            )
            expect(after?.publication).toEqual(before?.publication)
            expect(after?.selectedTarget).toEqual(before?.selectedTarget)
            await expect(
                store.rebasePublicationDraft({
                    projectId: project.project.id,
                    publicationId: secondPublication.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                    expectedSourceRevision: 2,
                    replaceContent: true,
                })
            ).rejects.toThrow('changed after revision 2')
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('reconciles an ambiguous publication with explicit operator attribution', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Reconciliation Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = await store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Manual Channel',
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The test channel was not created')

            const publishedCandidate = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('The provider may have accepted this post'),
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const publishedCandidateId = publishedCandidate?.publications[0]?.id
            if (publishedCandidateId === undefined)
                throw new Error('The test publication is missing')
            await database.sql
                .statement(
                    'update "publications" set "state" = ?1, "error_message" = ?2 where "publications"."id" = ?3'
                )
                .run('ambiguous', 'The provider response was lost', publishedCandidateId)

            const reconciledPublished = await store.reconcileAmbiguousPublication({
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

            const failedCandidate = await store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('The provider did not publish this post'),
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const failedCandidateId = failedCandidate?.publications[0]?.id
            if (failedCandidateId === undefined) throw new Error('The test publication is missing')
            await database.sql
                .statement(
                    'update "publications" set "state" = ?1, "error_message" = ?2 where "publications"."id" = ?3'
                )
                .run('ambiguous', 'The provider response was lost', failedCandidateId)

            const reconciledFailed = await store.reconcileAmbiguousPublication({
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
                await store.reconcileAmbiguousPublication({
                    projectId: project.project.id,
                    publicationId: failedCandidateId,
                    subjectId: 'user-1',
                    resolution: 'failed',
                    errorMessage: 'Duplicate resolution must be rejected',
                })
            ).toEqual({ kind: 'not_ambiguous' })
            expect(
                (await store.listAuditEvents(project.project.id, 'user-1'))?.filter(
                    event => event.action === 'publication.reconciled'
                )
            ).toHaveLength(2)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it.each(['submission', 'approval'] as const)(
        'refuses incompatible ordinary %s without changing persisted work',
        async operation => {
            const database = (await openTestDatabase()).database
            const now = 1_800_000_000_000
            try {
                const store = createManualStore(database, { now: () => now })
                const { project } = await store.createProject({
                    workspaceId: await seedTestWorkspace(database),
                    name: 'Active Profile Approval',
                    subjectId: 'user-1',
                    displayName: 'Operator',
                })
                const projectId = project.id
                const publication = await createApprovalDraft(database, store, projectId, operation)
                const oldRequest =
                    operation === 'approval'
                        ? await store.submitPublicationForApproval({
                              projectId,
                              publicationId: publication.id,
                              subjectId: 'user-1',
                              expectedDraftRevision: 1,
                              proposedScheduledAt: now + 60_000,
                          })
                        : null
                const requestRow =
                    (await database.sql
                        .statement<TestRow>(
                            'select "publication_approval_requests"."id" as "id", "publication_approval_requests"."project_id" as "projectId", "publication_approval_requests"."publication_id" as "publicationId", "publication_approval_requests"."target_revision_id" as "targetRevisionId", "publication_approval_requests"."draft_revision" as "draftRevision", "publication_approval_requests"."proposed_scheduled_at" as "proposedScheduledAt", "publication_approval_requests"."state" as "state", "publication_approval_requests"."requested_by_actor_id" as "requestedByActorId", "publication_approval_requests"."decided_by_actor_id" as "decidedByActorId", "publication_approval_requests"."decided_at" as "decidedAt", "publication_approval_requests"."scheduled_at" as "scheduledAt", "publication_approval_requests"."rejection_reason" as "rejectionReason", "publication_approval_requests"."created_at" as "createdAt", "publication_approval_requests"."updated_at" as "updatedAt" from "publication_approval_requests"'
                        )
                        .get()) ?? undefined
                await activateApprovalProfileLimit(store, projectId, publication.channelId, 10)
                const saved = await store.savePublicationDraft({
                    projectId,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                    targetContent: { body: `Approval target ${operation}` },
                })
                if (saved === null) throw new Error('The saved approval draft is missing')
                expect(saved.reviewState).toBe('compatible')

                if (operation === 'approval') {
                    if (oldRequest === null || requestRow === undefined)
                        throw new Error('The legacy approval request is missing')
                    // Model a fresh incompatible request accepted by the previous server
                    // version after activation. Normal activation supersedes old requests.
                    await database.sql
                        .statement(
                            `update publication_approval_requests set target_revision_id = ?1, draft_revision = ?2,
                             proposed_scheduled_at = ?3, state = ?4, requested_by_actor_id = ?5, decided_by_actor_id = ?6,
                             decided_at = ?7, scheduled_at = ?8, rejection_reason = ?9, created_at = ?10, updated_at = ?11
                             where id = ?12`
                        )
                        .run(
                            requestRow.targetRevisionId,
                            saved.revision,
                            requestRow.proposedScheduledAt,
                            requestRow.state,
                            requestRow.requestedByActorId,
                            requestRow.decidedByActorId,
                            requestRow.decidedAt,
                            requestRow.scheduledAt,
                            requestRow.rejectionReason,
                            requestRow.createdAt,
                            requestRow.updatedAt,
                            oldRequest.id
                        )
                }
                const before = await snapshotApprovalState(database)
                const submit = () =>
                    store.submitPublicationForApproval({
                        projectId,
                        publicationId: publication.id,
                        subjectId: 'user-1',
                        expectedDraftRevision: saved.revision,
                        proposedScheduledAt: now + 60_000,
                    })
                const approve = (publishNow?: boolean) => {
                    if (oldRequest === null) throw new Error('The legacy request is missing')
                    return store.approvePublicationApprovalRequest({
                        projectId,
                        publicationId: publication.id,
                        subjectId: 'user-1',
                        requestId: oldRequest.id,
                        ...(publishNow ? { publishNow } : {}),
                    })
                }
                await expect(operation === 'submission' ? submit() : approve()).rejects.toThrow(
                    'Publication target content is incompatible with the active channel profile'
                )
                if (operation === 'approval') {
                    await expect(approve(true)).rejects.toThrow(
                        'Publication target content is incompatible with the active channel profile'
                    )
                }
                expect(await snapshotApprovalState(database)).toEqual(before)
            } finally {
                await closeTestDatabase(database)
            }
        }
    )

    it('supersedes pre-activation approval but accepts a fresh compatible old-profile request', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000
        try {
            const store = createManualStore(database, { now: () => now })
            const { project } = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Compatible Profile Approval',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const projectId = project.id
            const publication = await createApprovalDraft(database, store, projectId, 'compatible')
            const input = { projectId, publicationId: publication.id, subjectId: 'user-1' }
            const oldProfile = (
                await store.getPublicationWorkingDraft(projectId, publication.id, 'user-1')
            )?.profileVersionId
            const old = await store.submitPublicationForApproval({
                ...input,
                expectedDraftRevision: 1,
                proposedScheduledAt: now + 60_000,
            })
            if (old === null) throw new Error('The original approval request is missing')
            await activateApprovalProfileLimit(store, projectId, publication.channelId, 100)
            expect(await store.listPendingPublicationApprovalRequests(projectId, 'user-1')).toEqual(
                []
            )
            await expect(
                store.approvePublicationApprovalRequest({ ...input, requestId: old.id })
            ).rejects.toThrow('superseded')
            const fresh = await store.submitPublicationForApproval({
                ...input,
                expectedDraftRevision: 2,
                proposedScheduledAt: now + 60_000,
            })
            if (fresh === null) throw new Error('The fresh approval request is missing')
            expect(
                await store.approvePublicationApprovalRequest({ ...input, requestId: fresh.id })
            ).toMatchObject({ state: 'scheduled', reviewState: 'compatible' })
            expect(
                (await store.getPublicationEditorState(projectId, publication.id, 'user-1'))
                    ?.selectedTarget
            ).toMatchObject({ profileVersionId: oldProfile })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([expect.objectContaining({ state: 'pending' })])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('holds a proposed schedule as a draft until an approver confirms it', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Approval Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const publication = await createApprovalDraft(
                database,
                store,
                project.project.id,
                'first'
            )
            const proposedScheduledAt = now + 60_000
            const request = await store.submitPublicationForApproval({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedDraftRevision: 1,
                proposedScheduledAt,
            })
            if (request === null) throw new Error('The approval request was not created')

            expect(request).toMatchObject({
                publicationId: publication.id,
                proposedScheduledAt,
                state: 'pending',
                draftRevision: 1,
            })
            expect(
                (await database.sql
                    .statement<TestRow>(
                        'select "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt" from "publications" where "publications"."id" = ?1'
                    )
                    .get(publication.id)) ?? undefined
            ).toEqual({ state: 'draft', scheduledAt: null })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "publication_approval_requests"."id" as "id", "publication_approval_requests"."project_id" as "projectId", "publication_approval_requests"."publication_id" as "publicationId", "publication_approval_requests"."target_revision_id" as "targetRevisionId", "publication_approval_requests"."draft_revision" as "draftRevision", "publication_approval_requests"."proposed_scheduled_at" as "proposedScheduledAt", "publication_approval_requests"."state" as "state", "publication_approval_requests"."requested_by_actor_id" as "requestedByActorId", "publication_approval_requests"."decided_by_actor_id" as "decidedByActorId", "publication_approval_requests"."decided_at" as "decidedAt", "publication_approval_requests"."scheduled_at" as "scheduledAt", "publication_approval_requests"."rejection_reason" as "rejectionReason", "publication_approval_requests"."created_at" as "createdAt", "publication_approval_requests"."updated_at" as "updatedAt" from "publication_approval_requests"'
                    )
                    .all()
            ).toHaveLength(1)
            await expect(
                store.promotePublicationDraft({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    scheduledAt: proposedScheduledAt,
                })
            ).rejects.toThrow('awaiting approval')
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])

            const approved = await store.approvePublicationApprovalRequest({
                projectId: project.project.id,
                publicationId: publication.id,
                requestId: request.id,
                subjectId: 'user-1',
            })
            expect(approved).toMatchObject({ state: 'scheduled', scheduledAt: proposedScheduledAt })
            expect(approved?.targetRevisionId).toBe(request.targetRevisionId)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([
                expect.objectContaining({
                    publicationId: publication.id,
                    state: 'pending',
                    runAt: proposedScheduledAt,
                }),
            ])
            expect(
                (await database.sql
                    .statement<TestRow>(
                        'select "publication_approval_requests"."state" as "state" from "publication_approval_requests" where "publication_approval_requests"."id" = ?1'
                    )
                    .get(request.id)) ?? undefined
            ).toEqual({ state: 'approved' })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('requires a new time or explicit immediate approval after a proposal expires', async () => {
        const database = (await openTestDatabase()).database
        let now = 1_800_000_000_000
        let advanceClock = false

        try {
            const store = createManualStore(database, {
                now: () => (advanceClock ? now++ : now),
            })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Overdue Approval Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const publication = await createApprovalDraft(
                database,
                store,
                project.project.id,
                'overdue'
            )
            const proposedScheduledAt = now + 60_000
            const request = await store.submitPublicationForApproval({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedDraftRevision: 1,
                proposedScheduledAt,
            })
            if (request === null) throw new Error('The approval request was not created')
            now = proposedScheduledAt + 1

            await expect(
                store.approvePublicationApprovalRequest({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    requestId: request.id,
                    subjectId: 'user-1',
                })
            ).rejects.toThrow('choose a new time or explicitly publish now')
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])

            await expect(
                store.approvePublicationApprovalRequest({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    requestId: request.id,
                    subjectId: 'user-1',
                    publishNow: true,
                    scheduledAt: now,
                })
            ).rejects.toThrow('Choose either an explicit schedule or publish now, not both')
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])

            advanceClock = true
            const executionTime = now + 1
            const approvedNow = await store.approvePublicationApprovalRequest({
                projectId: project.project.id,
                publicationId: publication.id,
                requestId: request.id,
                subjectId: 'user-1',
                publishNow: true,
            })
            expect(approvedNow).toMatchObject({ state: 'scheduled', scheduledAt: executionTime })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([
                expect.objectContaining({ publicationId: publication.id, runAt: executionTime }),
            ])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('accepts an explicitly chosen new future time after a proposal expires', async () => {
        const database = (await openTestDatabase()).database
        let now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Overdue Reschedule Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const publication = await createApprovalDraft(
                database,
                store,
                project.project.id,
                'overdue-new-time'
            )
            const proposedScheduledAt = now + 60_000
            const request = await store.submitPublicationForApproval({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedDraftRevision: 1,
                proposedScheduledAt,
            })
            if (request === null) throw new Error('The approval request was not created')
            now = proposedScheduledAt + 1
            const newScheduledAt = now + 120_000

            const approved = await store.approvePublicationApprovalRequest({
                projectId: project.project.id,
                publicationId: publication.id,
                requestId: request.id,
                subjectId: 'user-1',
                scheduledAt: newScheduledAt,
            })
            expect(approved).toMatchObject({ state: 'scheduled', scheduledAt: newScheduledAt })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([
                expect.objectContaining({ publicationId: publication.id, runAt: newScheduledAt }),
            ])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('does not accept a second approval decision for a completed request', async () => {
        const database = (await openTestDatabase()).database
        let now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Repeated Approval Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const publication = await createApprovalDraft(
                database,
                store,
                project.project.id,
                'repeat'
            )
            const request = await store.submitPublicationForApproval({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedDraftRevision: 1,
                proposedScheduledAt: now + 60_000,
            })
            if (request === null) throw new Error('The approval request was not created')
            const approved = await store.approvePublicationApprovalRequest({
                projectId: project.project.id,
                publicationId: publication.id,
                requestId: request.id,
                subjectId: 'user-1',
            })
            expect(approved?.state).toBe('scheduled')
            now += 1
            await expect(
                store.approvePublicationApprovalRequest({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    requestId: request.id,
                    subjectId: 'user-1',
                    publishNow: true,
                })
            ).rejects.toThrow('Cannot approve an approval request in the approved state')
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('invalidates a pending approval when the submitted draft is edited', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Edited Approval Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const publication = await createApprovalDraft(
                database,
                store,
                project.project.id,
                'edited'
            )
            const request = await store.submitPublicationForApproval({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedDraftRevision: 1,
                proposedScheduledAt: now + 60_000,
            })
            if (request === null) throw new Error('The approval request was not created')

            await store.savePublicationDraft({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: 1,
                targetContent: { body: 'Changed after approval was requested' },
            })

            expect(
                (await database.sql
                    .statement<TestRow>(
                        'select "publication_approval_requests"."state" as "state" from "publication_approval_requests" where "publication_approval_requests"."id" = ?1'
                    )
                    .get(request.id)) ?? undefined
            ).toEqual({ state: 'superseded' })
            await expect(
                store.approvePublicationApprovalRequest({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    requestId: request.id,
                    subjectId: 'user-1',
                })
            ).rejects.toThrow('Cannot approve an approval request in the superseded state')
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('keeps rejection editable and rolls back failed approval-request persistence', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000
        let triggerInstalled = false

        try {
            const store = createManualStore(database, { now: () => now })
            const project = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Rejected Approval Project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const publication = await createApprovalDraft(
                database,
                store,
                project.project.id,
                'rejected'
            )

            await installRejectingTrigger(database, {
                name: 'fail_approval_request_audit',
                table: 'audit_events',
                timing: 'before',
                event: 'insert',
                when: "NEW.action = 'publication.approval_requested'",
                message: 'forced approval request failure',
            })
            triggerInstalled = true

            await expect(
                store.submitPublicationForApproval({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                    expectedDraftRevision: 1,
                    proposedScheduledAt: now + 60_000,
                })
            ).rejects.toThrow('forced approval request failure')
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_target_revisions"."id" as "id", "publication_target_revisions"."project_id" as "projectId", "publication_target_revisions"."publication_id" as "publicationId", "publication_target_revisions"."sequence" as "sequence", "publication_target_revisions"."profile_version_id" as "profileVersionId", "publication_target_revisions"."source_revision" as "sourceRevision", "publication_target_revisions"."delivery_mode" as "deliveryMode", "publication_target_revisions"."media_reference_count" as "mediaReferenceCount", "publication_target_revisions"."content_json" as "contentJson", "publication_target_revisions"."content_hash" as "contentHash", "publication_target_revisions"."profile_hash" as "profileHash", "publication_target_revisions"."schema_hash" as "schemaHash", "publication_target_revisions"."validation_issues_json" as "validationIssuesJson", "publication_target_revisions"."created_by_actor_id" as "createdByActorId", "publication_target_revisions"."created_at" as "createdAt" from "publication_target_revisions"'
                        )
                        .all()
                ).map(row =>
                    fromDbRow<TestRow>(row, { contentJson: 'json', validationIssuesJson: 'json' })
                )
            ).toHaveLength(0)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "publication_approval_requests"."id" as "id", "publication_approval_requests"."project_id" as "projectId", "publication_approval_requests"."publication_id" as "publicationId", "publication_approval_requests"."target_revision_id" as "targetRevisionId", "publication_approval_requests"."draft_revision" as "draftRevision", "publication_approval_requests"."proposed_scheduled_at" as "proposedScheduledAt", "publication_approval_requests"."state" as "state", "publication_approval_requests"."requested_by_actor_id" as "requestedByActorId", "publication_approval_requests"."decided_by_actor_id" as "decidedByActorId", "publication_approval_requests"."decided_at" as "decidedAt", "publication_approval_requests"."scheduled_at" as "scheduledAt", "publication_approval_requests"."rejection_reason" as "rejectionReason", "publication_approval_requests"."created_at" as "createdAt", "publication_approval_requests"."updated_at" as "updatedAt" from "publication_approval_requests"'
                    )
                    .all()
            ).toHaveLength(0)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])
            expect(
                (await database.sql
                    .statement<TestRow>(
                        'select "publications"."state" as "state", "publications"."target_revision_id" as "targetRevisionId" from "publications" where "publications"."id" = ?1'
                    )
                    .get(publication.id)) ?? undefined
            ).toEqual({ state: 'draft', targetRevisionId: null })

            await dropRejectingTrigger(database, 'fail_approval_request_audit')
            triggerInstalled = false
            const request = await store.submitPublicationForApproval({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedDraftRevision: 1,
                proposedScheduledAt: now + 60_000,
            })
            if (request === null) throw new Error('The approval request was not created')
            const rejected = await store.rejectPublicationApprovalRequest({
                projectId: project.project.id,
                publicationId: publication.id,
                requestId: request.id,
                subjectId: 'user-1',
                rejectionReason: 'Needs a factual correction',
            })
            expect(rejected).toMatchObject({
                state: 'rejected',
                rejectionReason: 'Needs a factual correction',
            })
            expect(
                (await database.sql
                    .statement<TestRow>(
                        'select "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt" from "publications" where "publications"."id" = ?1'
                    )
                    .get(publication.id)) ?? undefined
            ).toEqual({ state: 'draft', scheduledAt: null })
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs"'
                    )
                    .all()
            ).toEqual([])
            expect(
                (
                    await store.getPublicationWorkingDraft(
                        project.project.id,
                        publication.id,
                        'user-1'
                    )
                )?.revision
            ).toBe(1)
        } finally {
            if (triggerInstalled)
                await dropRejectingTrigger(database, 'fail_approval_request_audit')
            await closeTestDatabase(database)
        }
    })
})
