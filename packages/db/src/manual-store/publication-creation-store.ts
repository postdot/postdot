import {
    adaptSourceContentToProfile,
    createJob,
    createPost,
    createPublication,
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    validateSourceContent,
    type ChannelProfileDefinition,
    type ChannelProfileCompiler,
    type DeliveryMode,
    type Publication,
    type Post,
    type PublicationReviewState,
    type ProjectTag,
    type ValidationIssue,
} from '@postdot/core'

import { createChannelCadenceStore } from '../channel-cadence'
import { defineTransaction, type DatabaseHandle } from '../client'
import type {
    AddPostDestinationsInput,
    CreatePostInput,
    CreatedPost,
    SavePostSourceInput,
} from '../manual-store'
import { mapSequential } from '../sql/sequential'
import {
    canonicalJson,
    contentHash,
    invalidProfileError,
    invalidSourceContentError,
    invalidTargetContentError,
    isRecord,
    parseProfile,
} from './content-codec'
import { toActor, toPost, toPublisher } from './mappers'
import { toChannel, toProject } from './project-channel-mappers'
import type {
    ActorRow,
    ProfileRow,
    PostRow,
    PublicationChannelRow,
    ProjectRow,
    ResolvedTargetMedia,
} from './rows'

interface JobInsert {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly runAt: number
    readonly createdAt: number
}

interface AuditEventInsert {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly action: string
    readonly entityType: string
    readonly entityId: string
    readonly metadataJson: string | null
    readonly createdAt: number
}

export interface PublicationCreationStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly profileCompiler: ChannelProfileCompiler
    readonly loadActor: (projectId: string, subjectId: string) => Promise<ActorRow | null>
    readonly loadChannel: (
        projectId: string,
        channelId: string
    ) => Promise<PublicationChannelRow | null>
    readonly loadProfile: (projectId: string, profileId: string) => Promise<ProfileRow | null>
    readonly assessWorkingDraftMedia: (
        profile: ChannelProfileDefinition,
        content: unknown,
        projectId: string,
        subjectId: string
    ) => Promise<readonly ValidationIssue[]>
    readonly resolveTargetMedia: (
        profile: ChannelProfileDefinition,
        content: Record<string, unknown>,
        projectId: string,
        subjectId: string
    ) => Promise<readonly ResolvedTargetMedia[]>
    readonly insertJob: (input: JobInsert) => Promise<unknown>
    readonly insertAuditEvent: (input: AuditEventInsert) => Promise<unknown>
}

export function createPublicationCreationStore(
    database: DatabaseHandle,
    options: PublicationCreationStoreOptions
) {
    const cadence = createChannelCadenceStore(database)
    const sql = database.sql

    const loadProjectStatement = sql.statement<ProjectRow, [projectId: string]>(`
        select id,
               name,
               time_zone as timeZone,
               primary_category_id as primaryCategoryId,
               created_at as createdAt,
               updated_at as updatedAt
        from projects
        where id = ?1
    `)
    const loadPostStatement = sql.statement<PostRow, [string, string]>(`
        select id, project_id as projectId, title, source_content as sourceContentJson,
               source_revision as sourceRevision, created_by_actor_id as createdByActorId,
               created_at as createdAt, updated_at as updatedAt
        from posts where project_id = ?1 and id = ?2
    `)

    const insertPostStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            title: string | null,
            sourceContentJson: string,
            sourceRevision: number,
            actorId: string,
            now: number,
        ]
    >(`
        insert into posts (
            id,
            project_id,
            title,
            source_content,
            source_revision,
            created_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    `)
    const insertPublicationStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            postId: string,
            channelId: string,
            targetRevisionId: string | null,
            deliveryMode: DeliveryMode,
            reviewState: PublicationReviewState,
            state: Publication['state'],
            scheduledAt: number | null,
            createdByActorId: string,
            scheduledByActorId: string | null,
            stateChangedByActorId: string,
            lastAssessedProfileVersionId: string | null,
            profileAssessmentIssuesJson: string,
            now: number,
        ]
    >(`
        insert into publications (
            id,
            project_id,
            post_id,
            channel_id,
            confirmed_destination_revision,
            target_revision_id,
            delivery_mode,
            review_state,
            state,
            scheduled_at,
            created_by_actor_id,
            scheduled_by_actor_id,
            state_changed_by_actor_id,
            last_assessed_profile_version_id,
            profile_assessment_issues_json,
            created_at,
            updated_at
        )
        values (?1, ?2, ?3, ?4, (select destination_revision from project_channel_contexts as channels where project_id = ?2 and id = ?4), ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
    `)
    const insertWorkingDraftStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            publicationId: string,
            profileVersionId: string,
            sourceRevision: number,
            baseSourceContentJson: string,
            contentJson: string,
            reviewState: PublicationReviewState,
            validationIssuesJson: string,
            lastAssessedProfileVersionId: string | null,
            updatedByActorId: string,
            now: number,
        ]
    >(`
        insert into publication_working_drafts (
            id,
            project_id,
            publication_id,
            profile_version_id,
            source_revision,
            base_source_content,
            content_json,
            review_state,
            validation_issues_json,
            last_assessed_profile_version_id,
            revision,
            updated_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12, ?12)
    `)
    const insertTargetRevisionStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            publicationId: string,
            sequence: number,
            profileVersionId: string,
            sourceRevision: number,
            deliveryMode: DeliveryMode,
            mediaReferenceCount: number,
            contentJson: string,
            contentHash: string,
            profileHash: string,
            schemaHash: string,
            validationIssuesJson: string,
            createdByActorId: string,
            now: number,
        ]
    >(`
        insert into publication_target_revisions (
            id,
            project_id,
            publication_id,
            sequence,
            profile_version_id,
            source_revision,
            delivery_mode,
            media_reference_count,
            content_json,
            content_hash,
            profile_hash,
            schema_hash,
            validation_issues_json,
            created_by_actor_id,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
    `)
    const insertTargetRevisionMediaStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            targetRevisionId: string,
            assetId: string,
            representationId: string,
            position: number,
            contentPath: string,
            role: string | null,
            accessibilityText: string | null,
            createdAt: number,
        ]
    >(`
        insert into publication_revision_media (
            id,
            project_id,
            target_revision_id,
            asset_id,
            representation_id,
            position,
            content_path,
            role,
            accessibility_text,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `)
    const loadProjectTagStatement = sql.statement<
        { readonly id: string; readonly state: ProjectTag['state'] },
        [projectId: string, tagId: string]
    >(`
        select id, state
        from project_tags
        where project_id = ?1
          and id = ?2
    `)
    const insertPublicationTagStatement = sql.statement<
        void,
        [projectId: string, publicationId: string, tagId: string, createdAt: number]
    >(`
        insert into publication_tags (
            project_id,
            publication_id,
            tag_id,
            created_at
        ) values (?1, ?2, ?3, ?4)
    `)

    const createPostTransaction = defineTransaction(
        database,
        async (input: CreatePostInput, existingPost?: Post): Promise<CreatedPost | null> => {
            if (input.publications.length === 0) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'At least one publication is required'
                )
            }

            const actorRow = await options.loadActor(input.projectId, input.subjectId)
            const projectRow = await loadProjectStatement.get(input.projectId)
            if (actorRow === null || projectRow === null) return null

            const timestamp = requireTimestamp(options.now(), 'now')
            const project = toProject(projectRow)
            const actor = toActor(actorRow)
            const post =
                existingPost ??
                createPost({
                    id: options.createId(),
                    project,
                    createdBy: actor,
                    title: input.title,
                    sourceContent: input.sourceContent,
                    now: timestamp,
                })

            const publicationEntries = await mapSequential(
                input.publications,
                async publicationInput => {
                    const channelRow = await options.loadChannel(
                        project.id,
                        publicationInput.channelId
                    )
                    if (channelRow === null) {
                        throw new DomainInvariantError(
                            'project_mismatch',
                            `Channel ${publicationInput.channelId} does not belong to project`
                        )
                    }
                    if (channelRow.state !== 'active') {
                        throw new DomainInvariantError(
                            'invalid_transition',
                            `Cannot create a publication for an ${channelRow.state} channel`
                        )
                    }

                    const tagIds =
                        publicationInput.tagIds === undefined
                            ? []
                            : [
                                  ...new Set(
                                      publicationInput.tagIds.map(tagId =>
                                          requireNonBlank(tagId, 'tagId')
                                      )
                                  ),
                              ]
                    for (const tagId of tagIds) {
                        const tag = await loadProjectTagStatement.get(input.projectId, tagId)
                        if (tag === null) {
                            throw new DomainInvariantError(
                                'invalid_input',
                                'Every publication tag must belong to the project'
                            )
                        }
                        if (tag.state === 'archived') {
                            throw new DomainInvariantError(
                                'invalid_transition',
                                'Archived tags cannot be newly assigned to a publication'
                            )
                        }
                    }

                    const profileRow = await options.loadProfile(
                        project.id,
                        channelRow.profileVersionId
                    )
                    if (profileRow === null || profileRow.channelId !== channelRow.id) {
                        throw new DomainInvariantError(
                            'invalid_input',
                            `Channel ${channelRow.id} has no available profile`
                        )
                    }
                    const profileResult = options.profileCompiler.compile(
                        parseProfile(profileRow.profileJson)
                    )
                    if (!profileResult.ok) throw invalidProfileError(profileResult.issues)
                    const profile = profileResult.value.profile
                    const targetContent =
                        publicationInput.targetContent ??
                        adaptSourceContentToProfile(post.sourceContent, profile)
                    if (!isRecord(targetContent)) {
                        throw new DomainInvariantError(
                            'invalid_content',
                            'Publication target content must be a JSON object'
                        )
                    }
                    const validation = profileResult.value.validate(targetContent)
                    const mediaIssues =
                        publicationInput.scheduledAt == null
                            ? await options.assessWorkingDraftMedia(
                                  profile,
                                  targetContent,
                                  project.id,
                                  input.subjectId
                              )
                            : []
                    const validationIssues = [...validation.issues, ...mediaIssues]
                    const reviewState: PublicationReviewState =
                        validation.ok && mediaIssues.length === 0 ? 'compatible' : 'review_required'
                    if (
                        publicationInput.scheduledAt != null &&
                        (!validation.ok || mediaIssues.length > 0)
                    ) {
                        throw invalidTargetContentError(validationIssues)
                    }
                    const targetMedia =
                        publicationInput.scheduledAt == null
                            ? []
                            : await options.resolveTargetMedia(
                                  profile,
                                  targetContent,
                                  project.id,
                                  input.subjectId
                              )
                    const targetContentJson = canonicalJson(targetContent)
                    const deliveryMode = publicationInput.deliveryMode ?? 'manual'
                    if (deliveryMode === 'automatic' && profile.execution.kind === 'manual') {
                        throw new DomainInvariantError(
                            'invalid_input',
                            `Channel ${channelRow.id} has no automatic execution contract`
                        )
                    }
                    const targetRevisionId =
                        publicationInput.scheduledAt == null ? null : options.createId()
                    const publication = createPublication({
                        id: options.createId(),
                        project,
                        post,
                        channel: toChannel(channelRow),
                        createdBy: actor,
                        targetRevisionId,
                        deliveryMode,
                        reviewState,
                        scheduledAt: publicationInput.scheduledAt,
                        now: timestamp,
                    })
                    return {
                        publication,
                        profile,
                        profileVersionId: channelRow.profileVersionId,
                        targetContent,
                        targetContentJson,
                        targetMedia,
                        validationIssues,
                        tagIds,
                        workingDraftId: options.createId(),
                        targetRevisionId,
                        publisher: channelRow.publisherId === null ? null : toPublisher(channelRow),
                    }
                }
            )
            const publications = publicationEntries.map(entry => entry.publication)
            await cadence.check({
                projectId: input.projectId,
                actorId: actor.id,
                now: timestamp,
                confirmation: input.cadenceConfirmation,
                candidates: publicationEntries.map((entry, index) => ({
                    id: `new:${index}`,
                    actualId: entry.publication.id,
                    channelId: entry.publication.channelId,
                    at: entry.publication.scheduledAt,
                })),
            })

            if (existingPost === undefined) {
                await insertPostStatement.run(
                    post.id,
                    project.id,
                    post.title,
                    canonicalJson(post.sourceContent),
                    post.sourceRevision,
                    actor.id,
                    timestamp
                )
                await options.insertAuditEvent({
                    id: options.createId(),
                    projectId: project.id,
                    actorId: actor.id,
                    action: 'post.created',
                    entityType: 'post',
                    entityId: post.id,
                    metadataJson: JSON.stringify({ title: post.title }),
                    createdAt: timestamp,
                })
            }

            for (const entry of publicationEntries) {
                const { publication } = entry
                await insertPublicationStatement.run(
                    publication.id,
                    project.id,
                    post.id,
                    publication.channelId,
                    entry.targetRevisionId,
                    publication.deliveryMode,
                    publication.reviewState,
                    publication.state,
                    publication.scheduledAt,
                    publication.createdByActorId,
                    publication.scheduledByActorId,
                    publication.stateChangedByActorId,
                    entry.profileVersionId,
                    JSON.stringify(entry.validationIssues),
                    timestamp
                )
                await insertWorkingDraftStatement.run(
                    entry.workingDraftId,
                    project.id,
                    publication.id,
                    entry.profileVersionId,
                    post.sourceRevision,
                    canonicalJson(post.sourceContent),
                    entry.targetContentJson,
                    publication.reviewState,
                    JSON.stringify(entry.validationIssues),
                    entry.profileVersionId,
                    actor.id,
                    timestamp
                )
                if (entry.targetRevisionId !== null) {
                    await insertTargetRevisionStatement.run(
                        entry.targetRevisionId,
                        project.id,
                        publication.id,
                        1,
                        entry.profileVersionId,
                        post.sourceRevision,
                        publication.deliveryMode,
                        entry.targetMedia.length,
                        entry.targetContentJson,
                        contentHash(entry.targetContent),
                        entry.profile.profileHash,
                        entry.profile.schemaHash,
                        JSON.stringify(entry.validationIssues),
                        actor.id,
                        timestamp
                    )
                    for (const [position, targetMedia] of entry.targetMedia.entries()) {
                        await insertTargetRevisionMediaStatement.run(
                            options.createId(),
                            project.id,
                            entry.targetRevisionId,
                            targetMedia.reference.assetId,
                            targetMedia.representation.id,
                            position,
                            targetMedia.reference.contentPath,
                            targetMedia.reference.role,
                            targetMedia.accessibilityText,
                            timestamp
                        )
                    }
                }
                for (const tagId of entry.tagIds) {
                    await insertPublicationTagStatement.run(
                        project.id,
                        publication.id,
                        tagId,
                        timestamp
                    )
                }
                await options.insertAuditEvent({
                    id: options.createId(),
                    projectId: project.id,
                    actorId: actor.id,
                    action: 'publication.created',
                    entityType: 'publication',
                    entityId: publication.id,
                    metadataJson: JSON.stringify({
                        channelId: publication.channelId,
                        scheduledAt: publication.scheduledAt,
                        state: publication.state,
                        deliveryMode: publication.deliveryMode,
                        tagIds: entry.tagIds,
                        provider:
                            publication.deliveryMode === 'manual'
                                ? 'manual'
                                : (entry.publisher?.kind ?? null),
                    }),
                    createdAt: timestamp,
                })

                if (
                    entry.publisher !== null &&
                    publication.deliveryMode === 'automatic' &&
                    publication.scheduledAt !== null
                ) {
                    const job = createJob({
                        id: options.createId(),
                        publication,
                        publisher: entry.publisher,
                        runAt: publication.scheduledAt,
                        now: timestamp,
                    })
                    await options.insertJob({
                        id: job.id,
                        projectId: job.projectId,
                        publicationId: job.publicationId,
                        runAt: job.runAt,
                        createdAt: timestamp,
                    })
                }
            }

            return { post, publications }
        }
    )

    return {
        async getPost(projectId: string, postId: string, subjectId: string): Promise<Post | null> {
            return database.sql.transaction(async () => {
                if ((await options.loadActor(projectId, subjectId)) === null) return null
                const row = await loadPostStatement.get(projectId, postId)
                return row === null ? null : toPost(row)
            }, 'deferred')
        },
        async savePostSource(input: SavePostSourceInput): Promise<Post | null> {
            return database.sql.transaction(async () => {
                return defineTransaction(database, async () => {
                    const actor = await options.loadActor(input.projectId, input.subjectId)
                    const row = await loadPostStatement.get(input.projectId, input.postId)
                    if (actor === null || row === null) return null
                    if (row.sourceRevision !== input.expectedSourceRevision) {
                        throw new DomainInvariantError(
                            'write_conflict',
                            'The source post changed before it could be saved'
                        )
                    }
                    const validation = validateSourceContent(input.sourceContent)
                    if (!validation.ok) throw invalidSourceContentError(validation.issues)
                    for (const media of validation.value.media) {
                        const asset = await sql
                            .statement(
                                'select id from media_assets where project_id = ?1 and id = ?2 and state = ?3 and deleted_at is null and deletion_requested_at is null'
                            )
                            .get(input.projectId, media.assetId, 'ready')
                        if (asset === null)
                            throw new DomainInvariantError(
                                'invalid_content',
                                'Source media must be available in this project'
                            )
                    }
                    const content = canonicalJson(validation.value)
                    if (content === canonicalJson(toPost(row).sourceContent)) return toPost(row)
                    const timestamp = requireTimestamp(options.now(), 'now')
                    const result = await sql
                        .statement(
                            `update posts set source_content = ?1, source_revision = source_revision + 1, updated_at = ?2 where project_id = ?3 and id = ?4 and source_revision = ?5`
                        )
                        .run(
                            content,
                            timestamp,
                            input.projectId,
                            input.postId,
                            input.expectedSourceRevision
                        )
                    if (result.changes !== 1)
                        throw new DomainInvariantError(
                            'write_conflict',
                            'The source post changed before it could be saved'
                        )
                    await options.insertAuditEvent({
                        id: options.createId(),
                        projectId: input.projectId,
                        actorId: actor.id,
                        action: 'post.source.updated',
                        entityType: 'post',
                        entityId: input.postId,
                        metadataJson: JSON.stringify({
                            fromSourceRevision: row.sourceRevision,
                            toSourceRevision: row.sourceRevision + 1,
                        }),
                        createdAt: timestamp,
                    })
                    return toPost((await loadPostStatement.get(input.projectId, input.postId))!)
                }).immediate()
            }, 'immediate')
        },
        async addPostDestinations(input: AddPostDestinationsInput): Promise<CreatedPost | null> {
            return defineTransaction(database, async () => {
                if ((await options.loadActor(input.projectId, input.subjectId)) === null)
                    return null
                const row = await loadPostStatement.get(input.projectId, input.postId)
                if (row === null) return null
                if (row.sourceRevision !== input.expectedSourceRevision) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        'The source post changed before destinations were added'
                    )
                }
                const existingChannels = new Set(
                    (
                        await sql
                            .statement<{ channelId: string }, [string, string]>(
                                'select channel_id as channelId from publications where project_id = ?1 and post_id = ?2'
                            )
                            .all(input.projectId, input.postId)
                    ).map(item => item.channelId)
                )
                const newChannels = new Set<string>()
                for (const item of input.publications) {
                    if (
                        (existingChannels.has(item.channelId) || newChannels.has(item.channelId)) &&
                        !input.confirmExistingChannels
                    ) {
                        throw new DomainInvariantError(
                            'invalid_transition',
                            'Adding another publication for an existing channel requires confirmation'
                        )
                    }
                    newChannels.add(item.channelId)
                }
                const post = toPost(row)
                return createPostTransaction.immediate(
                    {
                        projectId: input.projectId,
                        subjectId: input.subjectId,
                        title: post.title,
                        sourceContent: post.sourceContent,
                        publications: input.publications.map(item => ({
                            channelId: item.channelId,
                            deliveryMode: item.deliveryMode,
                            scheduledAt: null,
                        })),
                    },
                    post
                )
            }).immediate()
        },
        /** Internal same-post creation; callers own source/profile concurrency and authorization. */
        async createPublicationsForPost(
            input: CreatePostInput,
            post: Post
        ): Promise<CreatedPost | null> {
            return createPostTransaction.immediate(input, post)
        },
        async createPost(input: CreatePostInput): Promise<CreatedPost | null> {
            return createPostTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}
