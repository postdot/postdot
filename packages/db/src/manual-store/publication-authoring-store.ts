import {
    adaptSourceContentToProfile,
    createJob,
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    validateSourceContent,
    type ChannelProfileDefinition,
    type ChannelProfileCompiler,
    type DeliveryMode,
    type Publication,
    type PublicationReviewState,
    type ValidationIssue,
} from '@herald/core'

import type { HeraldDatabase } from '../client'
import type {
    PublicationEditorState,
    PublicationSummary,
    PublicationWorkingDraft,
    PromotePublicationDraftInput,
    RebasePublicationDraftInput,
    SavePublicationDraftInput,
} from '../manual-store'
import {
    canonicalJson,
    contentHash,
    invalidProfileError,
    invalidSourceContentError,
    invalidTargetContentError,
    isRecord,
    parseJsonObject,
    parseProfile,
    parseSourceContent,
    requirePositiveRevision,
} from './content-codec'
import {
    toPost,
    toProfileVersion,
    toPublication,
    toPublicationSummary,
    toPublisher,
    toTargetRevision,
    toWorkingDraft,
} from './mappers'
import { toChannel } from './project-channel-mappers'
import type {
    ActorRow,
    PostRow,
    PostSourceRow,
    ProfileRow,
    PublicationChannelRow,
    PublicationRow,
    PublicationSummaryRow,
    ResolvedTargetMedia,
    TargetRevisionRow,
    WorkingDraftRow,
} from './rows'
import { publicationColumns } from './sql-fragments'

interface ActiveJobRow {
    readonly id: string
    readonly state: 'pending' | 'running'
}

interface TargetRevisionInsert {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly sequence: number
    readonly profileVersionId: string
    readonly sourceRevision: number
    readonly deliveryMode: DeliveryMode
    readonly mediaReferenceCount: number
    readonly contentJson: string
    readonly contentHash: string
    readonly profileHash: string
    readonly schemaHash: string
    readonly validationIssuesJson: string
    readonly createdByActorId: string
    readonly createdAt: number
}

interface TargetRevisionMediaInsert {
    readonly id: string
    readonly projectId: string
    readonly targetRevisionId: string
    readonly assetId: string
    readonly representationId: string
    readonly position: number
    readonly contentPath: string
    readonly role: string | null
    readonly accessibilityText: string | null
    readonly createdAt: number
}

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

export interface PublicationAuthoringStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly profileCompiler: ChannelProfileCompiler
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly loadPublication: (projectId: string, publicationId: string) => PublicationRow | null
    readonly loadPostSource: (projectId: string, postId: string) => PostSourceRow | null
    readonly loadChannel: (projectId: string, channelId: string) => PublicationChannelRow | null
    readonly loadProfile: (projectId: string, profileId: string) => ProfileRow | null
    readonly loadActiveJob: (projectId: string, publicationId: string) => ActiveJobRow | null
    readonly assessWorkingDraftMedia: (
        profile: ChannelProfileDefinition,
        content: unknown,
        projectId: string,
        subjectId: string
    ) => readonly ValidationIssue[]
    readonly resolveTargetMedia: (
        profile: ChannelProfileDefinition,
        content: Record<string, unknown>,
        projectId: string,
        subjectId: string
    ) => readonly ResolvedTargetMedia[]
    readonly updatePendingJob: (
        projectId: string,
        jobId: string,
        runAt: number,
        updatedAt: number
    ) => boolean
    readonly cancelPendingJob: (projectId: string, jobId: string, completedAt: number) => boolean
    readonly insertTargetRevision: (input: TargetRevisionInsert) => void
    readonly insertTargetRevisionMedia: (input: TargetRevisionMediaInsert) => void
    readonly insertJob: (input: JobInsert) => void
    readonly insertAuditEvent: (input: AuditEventInsert) => void
}

export function createPublicationAuthoringStore(
    database: HeraldDatabase,
    options: PublicationAuthoringStoreOptions
) {
    const client = database.$client

    const loadPostStatement = client.query<PostRow, [projectId: string, postId: string]>(`
        select id,
               project_id as projectId,
               title,
               source_content as sourceContentJson,
               source_revision as sourceRevision,
               created_by_actor_id as createdByActorId,
               created_at as createdAt,
               updated_at as updatedAt
        from posts
        where project_id = ?1
          and id = ?2
    `)
    const loadWorkingDraftStatement = client.query<
        WorkingDraftRow,
        [projectId: string, publicationId: string]
    >(`
        select id,
               project_id as projectId,
               publication_id as publicationId,
               profile_version_id as profileVersionId,
               source_revision as sourceRevision,
               base_source_content as baseSourceContentJson,
               content_json as contentJson,
               review_state as reviewState,
               validation_issues_json as validationIssuesJson,
               last_assessed_profile_version_id as lastAssessedProfileVersionId,
               revision,
               updated_by_actor_id as updatedByActorId,
               created_at as createdAt,
               updated_at as updatedAt
        from publication_working_drafts
        where project_id = ?1
          and publication_id = ?2
    `)
    const loadTargetRevisionStatement = client.query<
        TargetRevisionRow,
        [projectId: string, targetRevisionId: string, publicationId: string]
    >(`
        select id,
               project_id as projectId,
               publication_id as publicationId,
               sequence,
               profile_version_id as profileVersionId,
               source_revision as sourceRevision,
               delivery_mode as deliveryMode,
               media_reference_count as mediaReferenceCount,
               content_json as contentJson,
               content_hash as contentHash,
               profile_hash as profileHash,
               schema_hash as schemaHash,
               validation_issues_json as validationIssuesJson,
               created_by_actor_id as createdByActorId,
               created_at as createdAt
        from publication_target_revisions
        where project_id = ?1
          and id = ?2
          and publication_id = ?3
    `)
    const nextTargetRevisionSequenceStatement = client.query<
        { sequence: number | null },
        [projectId: string, publicationId: string]
    >(`
        select max(sequence) as sequence
        from publication_target_revisions
        where project_id = ?1
          and publication_id = ?2
    `)
    const updatePostSourceStatement = client.query<
        { changes: number },
        [
            sourceContentJson: string,
            sourceRevision: number,
            updatedAt: number,
            projectId: string,
            postId: string,
        ]
    >(`
        update posts
        set source_content = ?1,
            source_revision = ?2,
            updated_at = ?3
        where project_id = ?4
          and id = ?5
    `)
    const updateWorkingDraftStatement = client.query<
        { changes: number },
        [
            sourceRevision: number,
            baseSourceContentJson: string,
            contentJson: string,
            reviewState: PublicationReviewState,
            validationIssuesJson: string,
            lastAssessedProfileVersionId: string | null,
            updatedByActorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
            expectedRevision: number,
        ]
    >(`
        update publication_working_drafts
        set source_revision = ?1,
            base_source_content = ?2,
            content_json = ?3,
            review_state = ?4,
            validation_issues_json = ?5,
            last_assessed_profile_version_id = ?6,
            revision = revision + 1,
            updated_by_actor_id = ?7,
            updated_at = ?8
        where project_id = ?9
          and publication_id = ?10
          and revision = ?11
    `)
    const rebaseWorkingDraftStatement = client.query<
        { changes: number },
        [
            sourceRevision: number,
            baseSourceContentJson: string,
            updatedByActorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
            expectedRevision: number,
        ]
    >(`
        update publication_working_drafts
        set source_revision = ?1,
            base_source_content = ?2,
            revision = revision + 1,
            updated_by_actor_id = ?3,
            updated_at = ?4
        where project_id = ?5
          and publication_id = ?6
          and revision = ?7
    `)
    const promotePublicationStatement = client.query<
        { changes: number },
        [
            targetRevisionId: string,
            state: 'draft' | 'scheduled',
            scheduledAt: number | null,
            scheduledByActorId: string | null,
            actorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
        ]
    >(`
        update publications
        set target_revision_id = ?1,
            state = ?2,
            review_state = 'compatible',
            profile_assessment_issues_json = '[]',
            last_assessed_profile_version_id = (
                select profile_version_id
                from publication_working_drafts
                where publication_working_drafts.project_id = publications.project_id
                  and publication_working_drafts.publication_id = publications.id
            ),
            scheduled_at = ?3,
            scheduled_by_actor_id = ?4,
            error_message = null,
            state_changed_by_actor_id = ?5,
            updated_at = ?6
        where project_id = ?7
          and id = ?8
          and state in ('draft', 'scheduled', 'failed')
    `)
    const listPublicationSummariesStatement = client.query<
        PublicationSummaryRow,
        [projectId: string, limit: number]
    >(`
        select ${publicationColumns},
               posts.title as postTitle,
               channels.name as channelName,
               working_drafts.revision as draftRevision,
               working_drafts.review_state as draftReviewState,
               working_drafts.source_revision as draftSourceRevision,
               working_drafts.content_json as draftContentJson,
               target_revisions.source_revision as targetSourceRevision,
               target_revisions.content_json as targetContentJson
        from publications
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        inner join publication_working_drafts as working_drafts
            on working_drafts.project_id = publications.project_id
           and working_drafts.publication_id = publications.id
        left join publication_target_revisions as target_revisions
            on target_revisions.project_id = publications.project_id
           and target_revisions.id = publications.target_revision_id
           and target_revisions.publication_id = publications.id
        where publications.project_id = ?1
        order by
            case when publications.scheduled_at is null then 1 else 0 end,
            publications.scheduled_at,
            publications.updated_at desc,
            publications.id
        limit ?2
    `)

    const savePublicationDraftTransaction = client.transaction(
        (input: SavePublicationDraftInput): PublicationWorkingDraft | null => {
            if (input.sourceContent === undefined && input.targetContent === undefined) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'A publication draft must include sourceContent or targetContent'
                )
            }

            const actorRow = options.loadActor(input.projectId, input.subjectId)
            const publicationRow = options.loadPublication(input.projectId, input.publicationId)
            if (actorRow === null || publicationRow === null) return null
            if (
                ['ready', 'publishing', 'published', 'ambiguous', 'cancelled'].includes(
                    publicationRow.state
                )
            ) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot edit a ${publicationRow.state} publication`
                )
            }

            const draftRow = loadWorkingDraftStatement.get(input.projectId, input.publicationId)
            const postRow = options.loadPostSource(input.projectId, publicationRow.postId)
            if (draftRow === null || postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has incomplete draft state`
                )
            }
            const channelRow = options.loadChannel(input.projectId, publicationRow.channelId)
            const profileRow = options.loadProfile(input.projectId, draftRow.profileVersionId)
            if (
                channelRow === null ||
                profileRow === null ||
                profileRow.channelId !== channelRow.id
            ) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has no available profile`
                )
            }
            if (input.expectedRevision !== draftRow.revision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed after revision ${input.expectedRevision}`
                )
            }
            if (postRow.sourceRevision !== draftRow.sourceRevision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Source post ${postRow.id} changed after this publication draft was loaded`
                )
            }
            const profileResult = options.profileCompiler.compile(
                parseProfile(profileRow.profileJson)
            )
            if (!profileResult.ok) throw invalidProfileError(profileResult.issues)

            const sourceContent =
                input.sourceContent ?? parseSourceContent(postRow.sourceContentJson)
            const sourceResult = validateSourceContent(sourceContent)
            if (!sourceResult.ok) throw invalidSourceContentError(sourceResult.issues)
            const targetContent =
                input.targetContent ??
                adaptSourceContentToProfile(sourceResult.value, profileResult.value.profile)
            if (!isRecord(targetContent)) {
                throw new DomainInvariantError(
                    'invalid_content',
                    'Publication target content must be a JSON object'
                )
            }
            const validation = profileResult.value.validate(targetContent)
            const mediaIssues = options.assessWorkingDraftMedia(
                profileResult.value.profile,
                targetContent,
                input.projectId,
                input.subjectId
            )
            const validationIssues = [...validation.issues, ...mediaIssues]
            const reviewState: PublicationReviewState =
                validation.ok && mediaIssues.length === 0 ? 'compatible' : 'review_required'
            const timestamp = requireTimestamp(options.now(), 'now')
            const sourceContentJson = canonicalJson(sourceResult.value)
            const storedSourceContentJson = canonicalJson(
                parseSourceContent(postRow.sourceContentJson)
            )
            const sourceChanged =
                input.sourceContent !== undefined && sourceContentJson !== storedSourceContentJson
            const sourceRevision = sourceChanged
                ? postRow.sourceRevision + 1
                : postRow.sourceRevision
            const targetContentJson = canonicalJson(targetContent)

            if (sourceChanged) {
                const sourceUpdate = updatePostSourceStatement.run(
                    sourceContentJson,
                    sourceRevision,
                    timestamp,
                    input.projectId,
                    publicationRow.postId
                )
                if (sourceUpdate.changes !== 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not update source post ${publicationRow.postId}`
                    )
                }
            }

            const draftUpdate = updateWorkingDraftStatement.run(
                sourceRevision,
                sourceChanged ? sourceContentJson : draftRow.baseSourceContentJson,
                targetContentJson,
                reviewState,
                JSON.stringify(validationIssues),
                draftRow.profileVersionId,
                actorRow.id,
                timestamp,
                input.projectId,
                input.publicationId,
                input.expectedRevision
            )
            if (draftUpdate.changes !== 1) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed before it could be saved`
                )
            }

            const updated = loadWorkingDraftStatement.get(input.projectId, input.publicationId)
            if (updated === null)
                throw new DomainInvariantError('invalid_input', 'Draft disappeared')
            return toWorkingDraft(updated)
        }
    )

    const rebasePublicationDraftTransaction = client.transaction(
        (input: RebasePublicationDraftInput): PublicationWorkingDraft | null => {
            const actorRow = options.loadActor(input.projectId, input.subjectId)
            const publicationRow = options.loadPublication(input.projectId, input.publicationId)
            const draftRow = loadWorkingDraftStatement.get(input.projectId, input.publicationId)
            if (actorRow === null || publicationRow === null || draftRow === null) return null
            if (
                ['ready', 'publishing', 'published', 'ambiguous', 'cancelled'].includes(
                    publicationRow.state
                )
            ) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot rebase a ${publicationRow.state} publication`
                )
            }
            if (input.expectedRevision !== draftRow.revision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed after revision ${input.expectedRevision}`
                )
            }

            const postRow = options.loadPostSource(input.projectId, publicationRow.postId)
            if (postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has no source post`
                )
            }
            if (postRow.sourceRevision < draftRow.sourceRevision) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has a source revision newer than its post`
                )
            }
            if (postRow.sourceRevision === draftRow.sourceRevision) {
                return toWorkingDraft(draftRow)
            }

            const timestamp = requireTimestamp(options.now(), 'now')
            const update = rebaseWorkingDraftStatement.run(
                postRow.sourceRevision,
                postRow.sourceContentJson,
                actorRow.id,
                timestamp,
                input.projectId,
                input.publicationId,
                input.expectedRevision
            )
            if (update.changes !== 1) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed before it could be rebased`
                )
            }
            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actorRow.id,
                action: 'publication.draft.rebased',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({
                    fromSourceRevision: draftRow.sourceRevision,
                    toSourceRevision: postRow.sourceRevision,
                    targetPreserved: true,
                }),
                createdAt: timestamp,
            })

            const rebased = loadWorkingDraftStatement.get(input.projectId, input.publicationId)
            if (rebased === null) {
                throw new DomainInvariantError('invalid_input', 'Draft disappeared after rebase')
            }
            return toWorkingDraft(rebased)
        }
    )

    const promotePublicationDraftTransaction = client.transaction(
        (input: PromotePublicationDraftInput): Publication | null => {
            const actorRow = options.loadActor(input.projectId, input.subjectId)
            const publicationRow = options.loadPublication(input.projectId, input.publicationId)
            const draftRow = loadWorkingDraftStatement.get(input.projectId, input.publicationId)
            if (actorRow === null || publicationRow === null || draftRow === null) return null
            if (input.expectedRevision !== draftRow.revision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed after revision ${input.expectedRevision}`
                )
            }
            if (
                ['ready', 'publishing', 'published', 'ambiguous', 'cancelled'].includes(
                    publicationRow.state
                )
            ) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot promote a ${publicationRow.state} publication`
                )
            }

            const postRow = options.loadPostSource(input.projectId, publicationRow.postId)
            if (postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has no source post`
                )
            }
            if (postRow.sourceRevision !== draftRow.sourceRevision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Source post ${postRow.id} changed after this publication draft was loaded`
                )
            }

            const profileRow = options.loadProfile(input.projectId, draftRow.profileVersionId)
            const channelRow = options.loadChannel(input.projectId, publicationRow.channelId)
            if (
                channelRow === null ||
                profileRow === null ||
                profileRow.channelId !== channelRow.id
            ) {
                throw new DomainInvariantError('invalid_input', 'Profile unavailable')
            }
            const profileResult = options.profileCompiler.compile(
                parseProfile(profileRow.profileJson)
            )
            if (!profileResult.ok) throw invalidProfileError(profileResult.issues)
            const content = parseJsonObject(draftRow.contentJson, 'publication draft content')
            const validation = profileResult.value.validate(content)
            if (!validation.ok) throw invalidTargetContentError(validation.issues)
            const targetMedia = options.resolveTargetMedia(
                profileResult.value.profile,
                content,
                input.projectId,
                input.subjectId
            )

            const timestamp = requireTimestamp(options.now(), 'now')
            const contentJson = canonicalJson(content)
            const activeJob = options.loadActiveJob(input.projectId, input.publicationId)
            if (activeJob?.state === 'running') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot promote publication ${input.publicationId} while its job is running`
                )
            }
            const scheduledAt =
                input.scheduledAt === undefined
                    ? publicationRow.scheduledAt
                    : input.scheduledAt === null
                      ? null
                      : requireTimestamp(input.scheduledAt, 'scheduledAt')
            if (scheduledAt !== null && scheduledAt < timestamp) {
                throw new DomainInvariantError('invalid_time', 'scheduledAt must not be before now')
            }
            const nextState: 'draft' | 'scheduled' = scheduledAt === null ? 'draft' : 'scheduled'
            const targetRevisionId = options.createId()
            const sequence =
                (nextTargetRevisionSequenceStatement.get(input.projectId, input.publicationId)
                    ?.sequence ?? 0) + 1
            options.insertTargetRevision({
                id: targetRevisionId,
                projectId: input.projectId,
                publicationId: input.publicationId,
                sequence,
                profileVersionId: draftRow.profileVersionId,
                sourceRevision: draftRow.sourceRevision,
                deliveryMode: publicationRow.deliveryMode,
                mediaReferenceCount: targetMedia.length,
                contentJson,
                contentHash: contentHash(content),
                profileHash: profileResult.value.profile.profileHash,
                schemaHash: profileResult.value.profile.schemaHash,
                validationIssuesJson: JSON.stringify(validation.issues),
                createdByActorId: actorRow.id,
                createdAt: timestamp,
            })
            for (const [position, mediaReference] of targetMedia.entries()) {
                options.insertTargetRevisionMedia({
                    id: options.createId(),
                    projectId: input.projectId,
                    targetRevisionId,
                    assetId: mediaReference.reference.assetId,
                    representationId: mediaReference.representation.id,
                    position,
                    contentPath: mediaReference.reference.contentPath,
                    role: mediaReference.reference.role,
                    accessibilityText: mediaReference.accessibilityText,
                    createdAt: timestamp,
                })
            }

            const promoted = promotePublicationStatement.run(
                targetRevisionId,
                nextState,
                scheduledAt,
                scheduledAt === null ? null : actorRow.id,
                actorRow.id,
                timestamp,
                input.projectId,
                input.publicationId
            )
            if (promoted.changes !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not promote publication ${input.publicationId}`
                )
            }

            if (nextState === 'scheduled' && publicationRow.deliveryMode === 'automatic') {
                if (activeJob !== null) {
                    if (
                        !options.updatePendingJob(
                            input.projectId,
                            activeJob.id,
                            scheduledAt as number,
                            timestamp
                        )
                    ) {
                        throw new DomainInvariantError(
                            'claim_mismatch',
                            `Could not reschedule job ${activeJob.id}`
                        )
                    }
                } else if (channelRow.publisherId !== null) {
                    const job = createJob({
                        id: options.createId(),
                        publication: {
                            ...toPublication({
                                ...publicationRow,
                                targetRevisionId,
                                reviewState: 'compatible',
                                state: nextState,
                            }),
                        },
                        publisher: toPublisher(channelRow),
                        runAt: scheduledAt as number,
                        now: timestamp,
                    })
                    options.insertJob({
                        id: job.id,
                        projectId: job.projectId,
                        publicationId: job.publicationId,
                        runAt: job.runAt,
                        createdAt: timestamp,
                    })
                }
            } else if (activeJob !== null) {
                if (!options.cancelPendingJob(input.projectId, activeJob.id, timestamp)) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not cancel job ${activeJob.id}`
                    )
                }
            }

            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actorRow.id,
                action: 'publication.target_promoted',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({ targetRevisionId, sequence, scheduledAt }),
                createdAt: timestamp,
            })
            const updated = options.loadPublication(input.projectId, input.publicationId)
            return updated === null ? null : toPublication(updated)
        }
    )

    return {
        getPublicationWorkingDraft(
            projectId: string,
            publicationId: string,
            subjectId: string
        ): PublicationWorkingDraft | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedPublicationId = requireNonBlank(publicationId, 'publicationId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
            if (options.loadActor(normalizedProjectId, normalizedSubjectId) === null) return null

            const draft = loadWorkingDraftStatement.get(
                normalizedProjectId,
                normalizedPublicationId
            )
            return draft === null ? null : toWorkingDraft(draft)
        },

        getPublicationEditorState(
            projectId: string,
            publicationId: string,
            subjectId: string
        ): PublicationEditorState | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedPublicationId = requireNonBlank(publicationId, 'publicationId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
            if (options.loadActor(normalizedProjectId, normalizedSubjectId) === null) {
                return null
            }

            const publicationRow = options.loadPublication(
                normalizedProjectId,
                normalizedPublicationId
            )
            const draftRow = loadWorkingDraftStatement.get(
                normalizedProjectId,
                normalizedPublicationId
            )
            if (publicationRow === null || draftRow === null) return null

            const postRow = loadPostStatement.get(normalizedProjectId, publicationRow.postId)
            const channelRow = options.loadChannel(normalizedProjectId, publicationRow.channelId)
            const profileRow = options.loadProfile(normalizedProjectId, draftRow.profileVersionId)
            if (
                postRow === null ||
                channelRow === null ||
                profileRow === null ||
                profileRow.channelId !== channelRow.id
            ) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${normalizedPublicationId} has incomplete editor state`
                )
            }

            const selectedTarget =
                publicationRow.targetRevisionId === null
                    ? null
                    : loadTargetRevisionStatement.get(
                          normalizedProjectId,
                          publicationRow.targetRevisionId,
                          normalizedPublicationId
                      )
            if (publicationRow.targetRevisionId !== null && selectedTarget === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${normalizedPublicationId} points to a missing target revision`
                )
            }

            return {
                publication: toPublication(publicationRow),
                post: toPost(postRow),
                channel: toChannel(channelRow),
                profile: toProfileVersion(profileRow),
                draft: toWorkingDraft(draftRow),
                selectedTarget: selectedTarget === null ? null : toTargetRevision(selectedTarget),
            }
        },

        listPublicationSummaries(
            projectId: string,
            subjectId: string
        ): PublicationSummary[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            if (
                options.loadActor(normalizedProjectId, requireNonBlank(subjectId, 'subjectId')) ===
                null
            ) {
                return null
            }

            return listPublicationSummariesStatement
                .all(normalizedProjectId, 100)
                .map(toPublicationSummary)
        },

        savePublicationDraft(input: SavePublicationDraftInput): PublicationWorkingDraft | null {
            return savePublicationDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requirePositiveRevision(input.expectedRevision),
            })
        },

        rebasePublicationDraft(input: RebasePublicationDraftInput): PublicationWorkingDraft | null {
            return rebasePublicationDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requirePositiveRevision(input.expectedRevision),
            })
        },

        promotePublicationDraft(input: PromotePublicationDraftInput): Publication | null {
            return promotePublicationDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requirePositiveRevision(input.expectedRevision),
            })
        },
    }
}
