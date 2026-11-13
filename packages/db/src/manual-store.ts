import {
    ChannelProfileCompiler,
    DomainInvariantError,
    createJob,
    requireNonBlank,
    type Channel,
    type ChannelProfileImpactAssessment,
    type ChannelProfileDefinition,
    type ChannelProfileDraftDefinition,
    type ChannelProfileVersionState,
    type DeliveryMode,
    type Post,
    type Publication,
    type PublicationReviewState,
    type SourceContent,
    type TargetContent,
    type Timestamp,
} from '@postdot/core'

import { createChannelCadenceStore } from './channel-cadence'
import { recordDatabaseCommitProject, type DatabaseHandle } from './client'
import { createChannelLifecycleStore } from './manual-store/channel-lifecycle-store'
import { createChannelProfileStore } from './manual-store/channel-profile-store'
import { parseProfile } from './manual-store/content-codec'
import { toAuditEvent, toProfileVersion, toPublication, toPublisher } from './manual-store/mappers'
import { createProjectChannelStore } from './manual-store/project-channel-store'
import { createPublicationAuthoringStore } from './manual-store/publication-authoring-store'
import { createPublicationCancellationStore } from './manual-store/publication-cancellation-store'
import { createPublicationComposerDraftStore } from './manual-store/publication-composer-draft-store'
import { createPublicationCreationStore } from './manual-store/publication-creation-store'
import { createPublicationDraftLifecycleStore } from './manual-store/publication-draft-lifecycle-store'
import {
    assessPinnedTargetMedia,
    assessWorkingDraftMedia,
    resolveTargetMedia,
} from './manual-store/publication-media'
import { createPublicationMoveStore } from './manual-store/publication-move-store'
import { createPublicationOutcomeStore } from './manual-store/publication-outcome-store'
import { createPublicationRetryStore } from './manual-store/publication-retry-store'
import { createPublicationSchedulingStore } from './manual-store/publication-scheduling-store'
import type {
    ActorRow,
    AuditEventRow,
    PostSourceRow,
    ProfileRow,
    PublicationChannelRow,
    PublicationRow,
} from './manual-store/rows'
import { createSearchStore } from './manual-store/search-store'
import { publicationColumns } from './manual-store/sql-fragments'
import type { MediaAssetStore } from './media-asset-store'
import { createPublicationDestinationStore } from './publication-destination-store'
import type { PublicationMovement } from './publication-move-state'
import type {
    PublicationThreadMessage,
    ThreadReceiptValidationInput,
} from './publication-thread-store'
import { createWorkspaceChannelStore } from './workspace-channel-store'

export type {
    ArchiveChannelInput,
    ChannelLifecycleBlockerCode,
    ChannelLifecycleUpdateResult,
    DeleteChannelInput,
    DeleteChannelResult,
    RenameChannelInput,
    RestoreChannelInput,
} from './manual-store/channel-lifecycle-store'
export type {
    PublicationListState,
    PublicationListSort,
    PublicationSummaryCounts,
    PublicationSummaryPage,
    PublicationSummaryPageOptions,
} from './manual-store/publication-read-store'
export type {
    ChannelListItem,
    CreateChannelInput,
    CreateProjectInput,
    CreatedProject,
    UpdateProjectTimeZoneInput,
} from './manual-store/project-channel-store'
export type {
    DeletePublicationComposerDraftInput,
    PublicationComposerDraft,
    PublicationComposerDraftContent,
    SavePublicationComposerDraftInput,
} from './manual-store/publication-composer-draft-store'
export type {
    DeleteDraftPublicationInput,
    DeleteDraftPublicationResult,
    DuplicateDraftPublicationInput,
    DuplicateDraftPublicationResult,
} from './manual-store/publication-draft-lifecycle-store'

export interface ManualStoreOptions {
    readonly validateThreadReceipt?: (input: ThreadReceiptValidationInput) => boolean
    readonly now?: () => number
    readonly createId?: () => string
    readonly media?: Pick<MediaAssetStore, 'getAsset'>
    readonly publicMediaUrlAvailable?: boolean
    readonly profileCompiler?: ChannelProfileCompiler
}

export interface CreateChannelProfileDraftInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly profile: ChannelProfileDraftDefinition
    readonly expectedRevision?: number
}

export interface ChannelProfileVersion {
    readonly id: string
    readonly projectId: string
    readonly channelId: string
    readonly profileId: string
    readonly version: number
    readonly origin: ChannelProfileDefinition['origin']
    readonly state: ChannelProfileVersionState
    readonly revision: number
    readonly profile: ChannelProfileDefinition
    readonly createdByActorId: string
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

export interface ChannelProfileState {
    readonly channel: Channel
    readonly active: ChannelProfileVersion
    readonly draft: ChannelProfileVersion | null
}

export interface PreviewChannelProfileActivationInput {
    readonly projectId: string
    readonly channelId: string
    readonly profileVersionId: string
    readonly subjectId: string
}

export interface ActivateChannelProfileInput extends PreviewChannelProfileActivationInput {
    readonly expectedRevision?: number
}

export interface ChannelProfileActivationResult {
    readonly channel: Channel
    readonly profile: ChannelProfileVersion
    readonly assessment: ChannelProfileImpactAssessment
}

export interface CreatePostPublicationInput {
    readonly channelId: string
    readonly targetContent?: TargetContent
    readonly deliveryMode?: DeliveryMode
    readonly scheduledAt?: Timestamp | null
    readonly tagIds?: readonly string[]
}

export interface CreatePostInput {
    readonly cadenceConfirmation?: string
    readonly projectId: string
    readonly subjectId: string
    readonly title?: string | null
    readonly sourceContent: SourceContent
    readonly publications: readonly CreatePostPublicationInput[]
}

export interface AddPostDestinationsInput {
    readonly projectId: string
    readonly postId: string
    readonly subjectId: string
    readonly expectedSourceRevision: number
    readonly confirmExistingChannels?: boolean
    readonly publications: readonly Pick<CreatePostPublicationInput, 'channelId' | 'deliveryMode'>[]
}

export interface SavePostSourceInput {
    readonly projectId: string
    readonly postId: string
    readonly subjectId: string
    readonly expectedSourceRevision: number
    readonly sourceContent: SourceContent
}

export interface SavePublicationDraftInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedRevision: number
    readonly sourceContent?: SourceContent
    readonly targetContent?: TargetContent
}

export interface AdoptPublicationDraftProfileInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedRevision: number
    readonly expectedSourceRevision: number
    readonly expectedProfileVersionId: string
    readonly activeProfileVersionId: string
    readonly targetContent: TargetContent
    readonly previousLocalContent?: TargetContent
}

export interface RebasePublicationDraftInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedRevision: number
    readonly expectedSourceRevision?: number
    readonly replaceContent?: boolean
}

export interface PromotePublicationDraftInput {
    readonly cadenceConfirmation?: string
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedRevision: number
    readonly scheduledAt?: Timestamp | null
    readonly publishNow?: boolean
    readonly approvalRequestId?: string
    readonly approvalRequest?: {
        readonly id: string
        readonly proposedScheduledAt: Timestamp
    }
}

export interface ReschedulePublicationsInput {
    readonly cadenceConfirmation?: string
    readonly projectId: string
    readonly publicationIds: readonly string[]
    readonly subjectId: string
    readonly scheduledAt: Timestamp
}

export interface CancelPublicationsInput {
    readonly projectId: string
    readonly publicationIds: readonly string[]
    readonly subjectId: string
}

export interface PublishManualPublicationInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly externalId?: string
    readonly externalUrl?: string
}

export interface ReconcileAmbiguousPublicationInput {
    readonly threadMessagePosition?: number
    readonly externalCid?: string
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly resolution: 'published' | 'failed'
    readonly externalId?: string
    readonly externalUrl?: string
    readonly errorMessage?: string
}

export interface RetryFailedPublicationInput {
    readonly cadenceConfirmation?: string
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
}

export interface CreatedPost {
    readonly post: Post
    readonly publications: readonly Publication[]
}

export type ReconcileAmbiguousPublicationResult =
    | { readonly kind: 'reconciled'; readonly publication: Publication }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_ambiguous' }

export type RetryFailedPublicationResult =
    | { readonly kind: 'retried'; readonly publication: Publication }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_retryable' }

export interface DueManualPublication extends Publication {
    readonly postTitle: string | null
    readonly channelName: string
    readonly targetContent: TargetContent
}

export interface PublicationWorkingDraft {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly profileVersionId: string
    readonly sourceRevision: number
    readonly baseSourceContent: SourceContent
    readonly content: TargetContent
    readonly reviewState: PublicationReviewState
    readonly validationIssues: readonly Record<string, unknown>[]
    readonly lastAssessedProfileVersionId: string | null
    readonly revision: number
    readonly updatedByActorId: string
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

export interface PublicationTargetRevision {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly sequence: number
    readonly profileVersionId: string
    readonly sourceRevision: number
    readonly deliveryMode: DeliveryMode
    readonly mediaReferenceCount: number
    readonly content: TargetContent
    readonly contentHash: string
    readonly profileHash: string
    readonly schemaHash: string
    readonly validationIssues: readonly Record<string, unknown>[]
    readonly createdByActorId: string
    readonly createdAt: Timestamp
}

export interface PublicationSummary extends Publication {
    readonly postTitle: string | null
    readonly sourceExcerpt: string | null
    readonly mediaAssetIds: readonly string[]
    readonly mediaCount: number
    readonly lastEditedAt: number
    readonly channelName: string
    readonly draftRevision: number
    readonly draftReviewState: PublicationReviewState
    readonly draftDiffersFromTarget: boolean
    readonly tagIds: readonly string[]
}

export interface PublicationEditorState {
    readonly threadMessages?: readonly PublicationThreadMessage[]
    readonly movement?: PublicationMovement
    readonly publication: Publication
    readonly post: Post
    readonly channel: Channel
    readonly profile: ChannelProfileVersion
    readonly draft: PublicationWorkingDraft
    readonly selectedTarget: PublicationTargetRevision | null
    readonly selectedTargetProfile?: ChannelProfileVersion | null
    readonly adoptionCount?: number
}

export interface AuditEvent {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly action: string
    readonly entityType: string
    readonly entityId: string
    readonly metadataJson: string | null
    readonly createdAt: Timestamp
}

export function createManualStore(database: DatabaseHandle, options: ManualStoreOptions = {}) {
    const sql = database.sql
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const profileCompiler = options.profileCompiler ?? new ChannelProfileCompiler()
    const media = options.media
    const publicMediaUrlAvailable = options.publicMediaUrlAvailable ?? false
    const projectChannelStore = createProjectChannelStore(database, { now, createId })
    const channelLifecycleStore = createChannelLifecycleStore(database, { now, createId })
    const sharedChannels = createWorkspaceChannelStore(database, { now, createId })

    const loadActorStatement = sql.statement<ActorRow, [projectId: string, subjectId: string]>(`
        select id,
               project_id as projectId,
               kind,
               subject_id as subjectId,
               display_name as displayName,
               created_at as createdAt,
               updated_at as updatedAt
        from actors
        where project_id = ?1
          and subject_id = ?2
          and kind in ('human', 'agent', 'api_token')
        order by created_at, id
        limit 1
    `)
    const loadChannelStatement = sql.statement<
        PublicationChannelRow,
        [projectId: string, channelId: string]
    >(`
        select channels.id,
               channels.project_id as projectId,
               channels.name,
               channel_profiles.profile_id as profileId,
               channels.profile_version_id as profileVersionId,
               channels.state,
               channels.archived_at as archivedAt,
               channels.revision,
               channels.created_at as createdAt,
               channels.updated_at as updatedAt,
               publishers.id as publisherId,
               publishers.kind as publisherKind,
               publishers.created_at as publisherCreatedAt,
               publishers.updated_at as publisherUpdatedAt
        from project_channel_contexts as channels
        inner join project_channel_profile_contexts as channel_profiles
            on channel_profiles.project_id = channels.project_id
           and channel_profiles.channel_id = channels.id
           and channel_profiles.id = channels.profile_version_id
        left join project_publisher_contexts as publishers
            on publishers.project_id = channels.project_id
           and publishers.channel_id = channels.id
        where channels.project_id = ?1
          and channels.id = ?2
    `)
    const loadProfileStatement = sql.statement<ProfileRow, [projectId: string, profileId: string]>(`
        select id,
               project_id as projectId,
               channel_id as channelId,
               profile_id as profileId,
               version,
               origin,
               state,
               revision,
               profile_json as profileJson,
               profile_hash as profileHash,
               schema_hash as schemaHash,
               created_by_actor_id as createdByActorId,
               created_at as createdAt,
               updated_at as updatedAt
        from project_channel_profile_contexts as channel_profile_versions
        where project_id = ?1
          and id = ?2
          and state <> 'disabled'
    `)
    const loadPostSourceStatement = sql.statement<
        PostSourceRow,
        [projectId: string, postId: string]
    >(`
        select id,
               project_id as projectId,
               source_content as sourceContentJson,
               source_revision as sourceRevision
        from posts
        where project_id = ?1
          and id = ?2
    `)
    const loadActiveJobStatement = sql.statement<
        { id: string; state: 'pending' | 'running'; runAt: number; attempts: number },
        [projectId: string, publicationId: string]
    >(`
        select id,
               state,
               run_at as runAt,
               attempts
        from jobs
        where project_id = ?1
          and publication_id = ?2
          and state in ('pending', 'running')
        limit 1
    `)
    const loadPublicationByIdStatement = sql.statement<
        PublicationRow,
        [projectId: string, publicationId: string]
    >(`
        select ${publicationColumns}
        from publications
        where project_id = ?1
          and id = ?2
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

    const updatePublicationAssessmentStatement = sql.statement<
        { changes: number },
        [
            reviewState: PublicationReviewState,
            issuesJson: string,
            profileVersionId: string,
            updatedAt: number,
            actorId: string,
            projectId: string,
            publicationId: string,
        ]
    >(`
        update publications
        set review_state = ?1,
            profile_assessment_issues_json = ?2,
            last_assessed_profile_version_id = ?3,
            state_changed_by_actor_id = ?5,
            updated_at = ?4
        where project_id = ?6
          and id = ?7
          and state in ('draft', 'scheduled', 'ready', 'failed')
    `)
    const updateWorkingDraftAssessmentStatement = sql.statement<
        { changes: number },
        [
            reviewState: PublicationReviewState,
            issuesJson: string,
            profileVersionId: string,
            updatedByActorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
        ]
    >(`
        update publication_working_drafts
        set review_state = ?1,
            validation_issues_json = ?2,
            last_assessed_profile_version_id = ?3,
            revision = revision + 1,
            updated_by_actor_id = ?4,
            updated_at = ?5
        where project_id = ?6
          and publication_id = ?7
    `)
    const updatePendingJobStatement = sql.statement<
        { changes: number },
        [runAt: number, updatedAt: number, projectId: string, jobId: string]
    >(`
        update jobs
        set run_at = ?1,
            updated_at = ?2
        where project_id = ?3
          and id = ?4
          and state = 'pending'
    `)
    const cancelPendingJobStatement = sql.statement<
        { changes: number },
        [completedAt: number, projectId: string, jobId: string]
    >(`
        update jobs
        set state = 'cancelled',
            completed_at = ?1,
            updated_at = ?1
        where project_id = ?2
          and id = ?3
          and state = 'pending'
    `)
    const insertJobStatement = sql.statement<
        void,
        [id: string, projectId: string, publicationId: string, runAt: number, now: number]
    >(`
        insert into jobs (
            id,
            project_id,
            publication_id,
            state,
            run_at,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, 'pending', ?4, ?5, ?5)
    `)
    const insertAuditEventStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            action: string,
            entityType: string,
            entityId: string,
            metadataJson: string | null,
            createdAt: number,
        ]
    >(`
        insert into audit_events (
            id,
            project_id,
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata_json,
            created_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `)
    const listAuditEventsStatement = sql.statement<
        AuditEventRow,
        [projectId: string, limit: number]
    >(`
        select id,
               project_id as projectId,
               actor_id as actorId,
               action,
               entity_type as entityType,
               entity_id as entityId,
               metadata_json as metadataJson,
               created_at as createdAt
        from audit_events
        where project_id = ?1
        order by created_at desc, sequence desc
        limit ?2
    `)
    const supersedePendingApprovalRequestStatement = sql.statement<
        { changes: number },
        [
            decidedByActorId: string,
            decidedAt: number,
            updatedAt: number,
            projectId: string,
            publicationId: string,
        ]
    >(`
        update publication_approval_requests
        set state = 'superseded',
            decided_by_actor_id = ?1,
            decided_at = ?2,
            updated_at = ?3
        where project_id = ?4
          and publication_id = ?5
          and state = 'pending'
    `)

    const channelProfileStore = createChannelProfileStore(database, {
        now,
        createId,
        profileCompiler,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
        loadChannel: async (projectId, channelId) =>
            await loadChannelStatement.get(projectId, channelId),
        loadProfile: async (projectId, profileId) =>
            await loadProfileStatement.get(projectId, profileId),
        parseProfile,
        toProfileVersion,
        validateWorkingDraftMedia: async (profile, content, projectId, subjectId) =>
            await assessWorkingDraftMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        validatePinnedTargetMedia: async (profile, content, projectId, subjectId, pinnedMedia) =>
            await assessPinnedTargetMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                pinnedMedia,
                publicMediaUrlAvailable
            ),
        updateWorkingDraftAssessment: async input => {
            const updated = await updateWorkingDraftAssessmentStatement.run(
                input.reviewState,
                input.issuesJson,
                input.profileVersionId,
                input.updatedByActorId,
                input.updatedAt,
                input.projectId,
                input.publicationId
            )
            if (updated.changes !== 1) return false
            const superseded = await supersedePendingApprovalRequestStatement.run(
                input.updatedByActorId,
                input.updatedAt,
                input.updatedAt,
                input.projectId,
                input.publicationId
            )
            if (superseded.changes === 1) {
                recordDatabaseCommitProject(database, input.projectId)
                await insertAuditEventStatement.run(
                    createId(),
                    input.projectId,
                    input.updatedByActorId,
                    'publication.approval_superseded',
                    'publication',
                    input.publicationId,
                    JSON.stringify({ reason: 'profile_assessment_changed' }),
                    input.updatedAt
                )
            }
            return true
        },
        updatePublicationAssessment: async input =>
            (
                await updatePublicationAssessmentStatement.run(
                    input.reviewState,
                    input.issuesJson,
                    input.profileVersionId,
                    input.updatedAt,
                    input.actorId,
                    input.projectId,
                    input.publicationId
                )
            ).changes === 1,
        loadActiveJob: async (projectId, publicationId) =>
            await loadActiveJobStatement.get(projectId, publicationId),
        cancelPendingJob: async (projectId, jobId, completedAt) =>
            (await cancelPendingJobStatement.run(completedAt, projectId, jobId)).changes === 1,
        ensureAutomaticJob: async ({ projectId, publicationId, channel, timestamp }) => {
            const publicationRow = await loadPublicationByIdStatement.get(projectId, publicationId)
            if (publicationRow === null) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Publication ${publicationId} disappeared during activation`
                )
            }
            const publication = toPublication(publicationRow)
            const job = createJob({
                id: createId(),
                publication,
                publisher: toPublisher(channel),
                runAt: Math.max(publication.scheduledAt ?? timestamp, timestamp),
                now: timestamp,
            })
            await insertJobStatement.run(
                job.id,
                job.projectId,
                job.publicationId,
                job.runAt,
                timestamp
            )
        },
        insertAuditEvent: async input => {
            recordDatabaseCommitProject(database, input.projectId)
            return await insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            )
        },
    })

    const publicationAuthoringStore = createPublicationAuthoringStore(database, {
        now,
        createId,
        profileCompiler,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
        loadPublication: async (projectId, publicationId) =>
            await loadPublicationByIdStatement.get(projectId, publicationId),
        loadPostSource: async (projectId, postId) =>
            await loadPostSourceStatement.get(projectId, postId),
        loadChannel: async (projectId, channelId) =>
            await loadChannelStatement.get(projectId, channelId),
        loadProfile: async (projectId, profileId) =>
            await loadProfileStatement.get(projectId, profileId),
        loadActiveJob: async (projectId, publicationId) =>
            await loadActiveJobStatement.get(projectId, publicationId),
        assessWorkingDraftMedia: async (profile, content, projectId, subjectId) =>
            await assessWorkingDraftMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        assessActiveProfileMedia: async (profile, content, projectId, subjectId) =>
            await assessWorkingDraftMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        resolveTargetMedia: async (profile, content, projectId, subjectId) =>
            await resolveTargetMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        updatePendingJob: async (projectId, jobId, runAt, updatedAt) =>
            (await updatePendingJobStatement.run(runAt, updatedAt, projectId, jobId)).changes === 1,
        cancelPendingJob: async (projectId, jobId, completedAt) =>
            (await cancelPendingJobStatement.run(completedAt, projectId, jobId)).changes === 1,
        insertTargetRevision: async input =>
            await insertTargetRevisionStatement.run(
                input.id,
                input.projectId,
                input.publicationId,
                input.sequence,
                input.profileVersionId,
                input.sourceRevision,
                input.deliveryMode,
                input.mediaReferenceCount,
                input.contentJson,
                input.contentHash,
                input.profileHash,
                input.schemaHash,
                input.validationIssuesJson,
                input.createdByActorId,
                input.createdAt
            ),
        insertTargetRevisionMedia: async input =>
            await insertTargetRevisionMediaStatement.run(
                input.id,
                input.projectId,
                input.targetRevisionId,
                input.assetId,
                input.representationId,
                input.position,
                input.contentPath,
                input.role,
                input.accessibilityText,
                input.createdAt
            ),
        insertJob: async input =>
            await insertJobStatement.run(
                input.id,
                input.projectId,
                input.publicationId,
                input.runAt,
                input.createdAt
            ),
        insertAuditEvent: async input => {
            recordDatabaseCommitProject(database, input.projectId)
            return await insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            )
        },
    })

    const publicationSchedulingStore = createPublicationSchedulingStore(database, {
        now,
        createId,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
        loadPublication: async (projectId, publicationId) =>
            await loadPublicationByIdStatement.get(projectId, publicationId),
        loadActiveJob: async (projectId, publicationId) =>
            await loadActiveJobStatement.get(projectId, publicationId),
        updatePendingJob: async (projectId, jobId, runAt, updatedAt) =>
            (await updatePendingJobStatement.run(runAt, updatedAt, projectId, jobId)).changes === 1,
        insertAuditEvent: async input => {
            recordDatabaseCommitProject(database, input.projectId)
            return await insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            )
        },
    })

    const publicationCancellationStore = createPublicationCancellationStore(database, {
        now,
        createId,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
        loadPublication: async (projectId, publicationId) =>
            await loadPublicationByIdStatement.get(projectId, publicationId),
        loadActiveJob: async (projectId, publicationId) =>
            await loadActiveJobStatement.get(projectId, publicationId),
        loadProvider: async (projectId, channelId) =>
            (await loadChannelStatement.get(projectId, channelId))?.publisherKind ?? null,
        cancelPendingJob: async (projectId, jobId, completedAt) =>
            (await cancelPendingJobStatement.run(completedAt, projectId, jobId)).changes === 1,
        insertAuditEvent: async input => {
            recordDatabaseCommitProject(database, input.projectId)
            return await insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            )
        },
    })

    const publicationOutcomeStore = createPublicationOutcomeStore(database, {
        validateThreadReceipt: options.validateThreadReceipt,
        now,
        createId,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
        loadPublication: async (projectId, publicationId) =>
            await loadPublicationByIdStatement.get(projectId, publicationId),
        insertAuditEvent: async input => {
            recordDatabaseCommitProject(database, input.projectId)
            return await insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            )
        },
    })

    const publicationRetryStore = createPublicationRetryStore(database, {
        publicMediaUrlAvailable,
        now,
        createId,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
        loadPublication: async (projectId, publicationId) =>
            await loadPublicationByIdStatement.get(projectId, publicationId),
        insertAuditEvent: async input => {
            recordDatabaseCommitProject(database, input.projectId)
            return await insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            )
        },
    })

    const publicationCreationStore = createPublicationCreationStore(database, {
        now,
        createId,
        profileCompiler,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
        loadChannel: async (projectId, channelId) =>
            await loadChannelStatement.get(projectId, channelId),
        loadProfile: async (projectId, profileId) =>
            await loadProfileStatement.get(projectId, profileId),
        assessWorkingDraftMedia: async (profile, content, projectId, subjectId) =>
            await assessWorkingDraftMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        resolveTargetMedia: async (profile, content, projectId, subjectId) =>
            await resolveTargetMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        insertJob: async input =>
            await insertJobStatement.run(
                input.id,
                input.projectId,
                input.publicationId,
                input.runAt,
                input.createdAt
            ),
        insertAuditEvent: async input => {
            recordDatabaseCommitProject(database, input.projectId)
            return await insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            )
        },
    })

    const publicationComposerDraftStore = createPublicationComposerDraftStore(database, {
        now,
        createId,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
    })

    const publicationDraftLifecycleStore = createPublicationDraftLifecycleStore(database, {
        now,
        createId,
        loadActor: async (projectId, subjectId) =>
            await loadActorStatement.get(projectId, subjectId),
        loadPublication: async (projectId, publicationId) =>
            await loadPublicationByIdStatement.get(projectId, publicationId),
        getPublicationEditorState: (projectId, publicationId, subjectId) =>
            publicationAuthoringStore.getPublicationEditorState(
                projectId,
                publicationId,
                subjectId
            ),
        createPost: async input => await publicationCreationStore.createPost(input),
        insertAuditEvent: async input => {
            recordDatabaseCommitProject(database, input.projectId)
            await insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            )
        },
    })

    const cadence = createChannelCadenceStore(database)
    return {
        async getPublicationCadence(input: {
            projectId: string
            publicationId: string
            subjectId: string
        }) {
            if (!(await loadActorStatement.get(input.projectId, input.subjectId))) return null
            return cadence.timing(input.projectId, input.publicationId)
        },
        async overridePublicationCadence(input: {
            projectId: string
            publicationId: string
            subjectId: string
            confirmation: string
        }) {
            const actor = await loadActorStatement.get(input.projectId, input.subjectId)
            if (!actor) return null
            return cadence.override.immediate({ ...input, actorId: actor.id, now: now() })
        },
        ...createPublicationDestinationStore(database, {
            now,
            createId,
            loadActor: async (projectId, subjectId) =>
                await loadActorStatement.get(projectId, subjectId),
        }),
        ...projectChannelStore,
        /** Workspace-owned channel sharing; every call needs a request-bound access policy. */
        sharedChannels,
        ...createSearchStore(database),
        ...channelLifecycleStore,
        ...channelProfileStore,
        createPost: publicationCreationStore.createPost,
        getPost: publicationCreationStore.getPost,
        addPostDestinations: publicationCreationStore.addPostDestinations,
        savePostSource: publicationCreationStore.savePostSource,
        ...publicationAuthoringStore,
        ...publicationSchedulingStore,
        ...publicationCancellationStore,
        ...publicationOutcomeStore,
        ...publicationRetryStore,
        ...publicationComposerDraftStore,
        ...publicationDraftLifecycleStore,
        ...createPublicationMoveStore(database, {
            now,
            createId,
            profileCompiler,
            getEditor: publicationAuthoringStore.getPublicationEditorState,
            loadChannel: async (projectId, channelId) =>
                await loadChannelStatement.get(projectId, channelId),
            loadProfile: async (projectId, profileId) =>
                await loadProfileStatement.get(projectId, profileId),
            assessMedia: async (profile, content, projectId, subjectId) =>
                await assessWorkingDraftMedia(
                    profile,
                    content,
                    projectId,
                    subjectId,
                    media,
                    publicMediaUrlAvailable
                ),
            createForPost: publicationCreationStore.createPublicationsForPost,
        }),

        async listAuditEvents(
            projectId: string,
            subjectId: string,
            limit = 100
        ): Promise<AuditEvent[] | null> {
            return database.sql.transaction(async () => {
                const normalizedProjectId = requireNonBlank(projectId, 'projectId')
                const actor = await loadActorStatement.get(
                    normalizedProjectId,
                    requireNonBlank(subjectId, 'subjectId')
                )
                if (actor === null) return null

                if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
                    throw new DomainInvariantError(
                        'invalid_input',
                        'limit must be between 1 and 100'
                    )
                }

                return (await listAuditEventsStatement.all(normalizedProjectId, limit)).map(
                    toAuditEvent
                )
            }, 'deferred')
        },
    }
}
