import { createHash } from 'node:crypto'

import {
    adaptSourceContentToProfile,
    assessChannelProfileChange,
    ChannelProfileCompiler,
    DomainInvariantError,
    createJob,
    createPost,
    createPublication,
    extractTargetMediaReferences,
    requireNonBlank,
    requireTimestamp,
    transitionPublication,
    type Actor,
    type Channel,
    type ChannelProfileImpactAssessment,
    type ChannelProfileDefinition,
    type ChannelProfileVersionState,
    type DeliveryMode,
    type MediaFieldCapability,
    type MediaRepresentation,
    type Post,
    type Publication,
    type Publisher,
    type PublicationReviewState,
    type SourceContent,
    type TargetContent,
    type TargetMediaReference,
    type Timestamp,
    type ValidationIssue,
    validateSourceContent,
} from '@herald/core'

import type { HeraldDatabase } from './client'
import { toChannel, toProject } from './manual-store/project-channel-mappers'
import { createProjectChannelStore } from './manual-store/project-channel-store'
import type {
    ActorRow,
    AuditEventRow,
    DuePublicationRow,
    PostRow,
    PostSourceRow,
    ProfileImpactTargetRow,
    ProfileImpactWorkingDraftRow,
    ProfileRow,
    PublicationChannelRow,
    PublicationRow,
    PublicationSummaryRow,
    ResolvedTargetMedia,
    TargetRevisionMediaRow,
    TargetRevisionRow,
    WorkingDraftRow,
    ProjectRow,
} from './manual-store/rows'
import type { MediaAssetStore } from './media-asset-store'

export type {
    CreateChannelInput,
    CreateProjectInput,
    CreatedProject,
} from './manual-store/project-channel-store'

export interface ManualStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
    readonly media?: Pick<MediaAssetStore, 'getAsset'>
    readonly publicMediaUrlAvailable?: boolean
}

export interface CreateChannelProfileDraftInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly profile: ChannelProfileDefinition
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
}

export interface CreatePostInput {
    readonly projectId: string
    readonly subjectId: string
    readonly title?: string | null
    readonly sourceContent: SourceContent
    readonly publications: readonly CreatePostPublicationInput[]
}

export interface SavePublicationDraftInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedRevision: number
    readonly sourceContent?: SourceContent
    readonly targetContent?: TargetContent
}

export interface RebasePublicationDraftInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedRevision: number
}

export interface PromotePublicationDraftInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedRevision: number
    readonly scheduledAt?: Timestamp | null
}

export interface PublishManualPublicationInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly externalId?: string
    readonly externalUrl?: string
}

export interface ReconcileAmbiguousPublicationInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly resolution: 'published' | 'failed'
    readonly externalId?: string
    readonly externalUrl?: string
    readonly errorMessage?: string
}

export interface CreatedPost {
    readonly post: Post
    readonly publications: readonly Publication[]
}

export type ReconcileAmbiguousPublicationResult =
    | { readonly kind: 'reconciled'; readonly publication: Publication }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_ambiguous' }

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
    readonly channelName: string
    readonly draftRevision: number
    readonly draftReviewState: PublicationReviewState
    readonly draftDiffersFromTarget: boolean
}

export interface PublicationEditorState {
    readonly publication: Publication
    readonly post: Post
    readonly channel: Channel
    readonly profile: ChannelProfileVersion
    readonly draft: PublicationWorkingDraft
    readonly selectedTarget: PublicationTargetRevision | null
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

const publicationColumns = `
    publications.id,
    publications.project_id as projectId,
    publications.post_id as postId,
    publications.channel_id as channelId,
    publications.target_revision_id as targetRevisionId,
    publications.delivery_mode as deliveryMode,
    publications.review_state as reviewState,
    publications.state,
    publications.scheduled_at as scheduledAt,
    publications.published_at as publishedAt,
    publications.external_id as externalId,
    publications.external_url as externalUrl,
    publications.error_message as errorMessage,
    publications.created_by_actor_id as createdByActorId,
    publications.scheduled_by_actor_id as scheduledByActorId,
    publications.state_changed_by_actor_id as stateChangedByActorId,
    publications.published_by_actor_id as publishedByActorId,
    publications.last_assessed_profile_version_id as lastAssessedProfileVersionId,
    publications.profile_assessment_issues_json as profileAssessmentIssuesJson,
    publications.created_at as createdAt,
    publications.updated_at as updatedAt
`

export function createManualStore(database: HeraldDatabase, options: ManualStoreOptions = {}) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const profileCompiler = new ChannelProfileCompiler()
    const media = options.media
    const publicMediaUrlAvailable = options.publicMediaUrlAvailable ?? false
    const projectChannelStore = createProjectChannelStore(database, { now, createId })

    const loadProjectStatement = client.query<ProjectRow, [projectId: string]>(`
        select id, name, created_at as createdAt, updated_at as updatedAt
        from projects
        where id = ?1
    `)
    const loadActorStatement = client.query<ActorRow, [projectId: string, subjectId: string]>(`
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
          and kind = 'human'
        order by created_at, id
        limit 1
    `)
    const loadChannelStatement = client.query<
        PublicationChannelRow,
        [projectId: string, channelId: string]
    >(`
        select channels.id,
               channels.project_id as projectId,
               channels.name,
               channel_profiles.profile_id as profileId,
               channels.profile_version_id as profileVersionId,
               channels.created_at as createdAt,
               channels.updated_at as updatedAt,
               publishers.id as publisherId,
               publishers.kind as publisherKind,
               publishers.created_at as publisherCreatedAt,
               publishers.updated_at as publisherUpdatedAt
        from channels
        inner join channel_profile_versions as channel_profiles
            on channel_profiles.project_id = channels.project_id
           and channel_profiles.channel_id = channels.id
           and channel_profiles.id = channels.profile_version_id
        left join publishers
            on publishers.project_id = channels.project_id
           and publishers.channel_id = channels.id
        where channels.project_id = ?1
          and channels.id = ?2
    `)
    const loadProfileStatement = client.query<ProfileRow, [projectId: string, profileId: string]>(`
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
        from channel_profile_versions
        where project_id = ?1
          and id = ?2
          and state <> 'disabled'
    `)
    const loadDraftProfileStatement = client.query<
        ProfileRow,
        [projectId: string, channelId: string]
    >(`
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
        from channel_profile_versions
        where project_id = ?1
          and channel_id = ?2
          and state = 'draft'
    `)
    const loadPostSourceStatement = client.query<
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
    const listProfileImpactWorkingDraftsStatement = client.query<
        ProfileImpactWorkingDraftRow,
        [projectId: string, channelId: string]
    >(`
        select drafts.id,
               drafts.publication_id as publicationId,
               drafts.content_json as contentJson,
               publications.delivery_mode as deliveryMode,
               drafts.revision
        from publication_working_drafts as drafts
        inner join publications
            on publications.project_id = drafts.project_id
           and publications.id = drafts.publication_id
        where drafts.project_id = ?1
          and publications.channel_id = ?2
          and publications.state in ('draft', 'scheduled', 'failed')
        order by drafts.id
    `)
    const listProfileImpactTargetsStatement = client.query<
        ProfileImpactTargetRow,
        [projectId: string, channelId: string]
    >(`
        select publications.id,
               publications.id as publicationId,
               publications.target_revision_id as targetRevisionId,
               target_revisions.content_json as contentJson,
               publications.delivery_mode as deliveryMode,
               publications.scheduled_at as scheduledAt,
               publications.state
        from publications
        inner join publication_target_revisions as target_revisions
            on target_revisions.project_id = publications.project_id
           and target_revisions.id = publications.target_revision_id
           and target_revisions.publication_id = publications.id
        where publications.project_id = ?1
          and publications.channel_id = ?2
          and publications.target_revision_id is not null
          and publications.state in ('scheduled', 'ready')
          and not exists (
              select 1
              from jobs
              where jobs.project_id = publications.project_id
                and jobs.publication_id = publications.id
                and jobs.state = 'running'
          )
        order by publications.scheduled_at, publications.id
    `)
    const listTargetRevisionMediaStatement = client.query<
        TargetRevisionMediaRow,
        [projectId: string, targetRevisionId: string]
    >(`
        select id,
               project_id as projectId,
               target_revision_id as targetRevisionId,
               asset_id as assetId,
               representation_id as representationId,
               position,
               content_path as contentPath,
               role,
               accessibility_text as accessibilityText
        from publication_revision_media
        where project_id = ?1
          and target_revision_id = ?2
        order by position, id
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
    const loadActiveJobStatement = client.query<
        { id: string; state: 'pending' | 'running' },
        [projectId: string, publicationId: string]
    >(`
        select id, state
        from jobs
        where project_id = ?1
          and publication_id = ?2
          and state in ('pending', 'running')
        limit 1
    `)
    const loadPublicationStatement = client.query<
        PublicationRow,
        [projectId: string, publicationId: string, now: number]
    >(`
        select ${publicationColumns}
        from publications
        inner join publication_target_revisions as target_revisions
            on target_revisions.project_id = publications.project_id
           and target_revisions.id = publications.target_revision_id
           and target_revisions.publication_id = publications.id
        where publications.project_id = ?1
          and publications.id = ?2
          and publications.state = 'scheduled'
          and publications.delivery_mode = 'manual'
          and publications.review_state = 'compatible'
          and publications.scheduled_at <= ?3
    `)
    const loadPublicationByIdStatement = client.query<
        PublicationRow,
        [projectId: string, publicationId: string]
    >(`
        select ${publicationColumns}
        from publications
        where project_id = ?1
          and id = ?2
    `)

    const insertProfileStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            channelId: string,
            profileId: string,
            version: number,
            origin: ChannelProfileDefinition['origin'],
            state: ChannelProfileVersionState,
            revision: number,
            profileJson: string,
            profileHash: string,
            schemaHash: string,
            actorId: string,
            now: number,
        ]
    >(`
        insert into channel_profile_versions (
            id,
            project_id,
            channel_id,
            profile_id,
            version,
            origin,
            state,
            revision,
            profile_json,
            profile_hash,
            schema_hash,
            created_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
    `)
    const updateProfileDraftStatement = client.query<
        { changes: number },
        [
            profileJson: string,
            profileHash: string,
            schemaHash: string,
            updatedAt: number,
            projectId: string,
            channelId: string,
            profileVersionId: string,
            expectedRevision: number,
        ]
    >(`
        update channel_profile_versions
        set profile_json = ?1,
            profile_hash = ?2,
            schema_hash = ?3,
            revision = revision + 1,
            updated_at = ?4
        where project_id = ?5
          and channel_id = ?6
          and id = ?7
          and state = 'draft'
          and revision = ?8
    `)
    const updateProfileStateStatement = client.query<
        { changes: number },
        [
            state: ChannelProfileVersionState,
            updatedAt: number,
            projectId: string,
            profileVersionId: string,
        ]
    >(`
        update channel_profile_versions
        set state = ?1,
            updated_at = ?2
        where project_id = ?3
          and id = ?4
    `)
    const updateChannelProfileStatement = client.query<
        { changes: number },
        [
            profileVersionId: string,
            updatedAt: number,
            projectId: string,
            channelId: string,
            expectedProfileVersionId: string,
        ]
    >(`
        update channels
        set profile_version_id = ?1,
            updated_at = ?2
        where project_id = ?3
          and id = ?4
          and profile_version_id = ?5
    `)
    const insertPostStatement = client.query<
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
    const insertPublicationStatement = client.query<
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
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
    `)
    const insertWorkingDraftStatement = client.query<
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
    const insertTargetRevisionStatement = client.query<
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
    const insertTargetRevisionMediaStatement = client.query<
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
    const updatePublicationAssessmentStatement = client.query<
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
    const updateWorkingDraftAssessmentStatement = client.query<
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
    const updatePendingJobStatement = client.query<
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
    const cancelPendingJobStatement = client.query<
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
    const insertJobStatement = client.query<
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
    const insertAuditEventStatement = client.query<
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
    const publishPublicationStatement = client.query<
        void,
        [
            publicationId: string,
            projectId: string,
            publishedAt: number,
            actorId: string,
            externalId: string | null,
            externalUrl: string | null,
        ]
    >(`
        update publications
        set state = 'published',
            published_at = ?3,
            published_by_actor_id = ?4,
            external_id = ?5,
            external_url = ?6,
            error_message = null,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'scheduled'
    `)
    const reconcilePublishedPublicationStatement = client.query<
        { changes: number },
        [
            publicationId: string,
            projectId: string,
            publishedAt: number,
            actorId: string,
            externalId: string,
            externalUrl: string | null,
        ]
    >(`
        update publications
        set state = 'published',
            published_at = ?3,
            published_by_actor_id = ?4,
            external_id = ?5,
            external_url = ?6,
            error_message = null,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'ambiguous'
    `)
    const reconcileFailedPublicationStatement = client.query<
        { changes: number },
        [
            publicationId: string,
            projectId: string,
            updatedAt: number,
            actorId: string,
            errorMessage: string,
        ]
    >(`
        update publications
        set state = 'failed',
            error_message = ?5,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'ambiguous'
    `)
    const listDuePublicationsStatement = client.query<
        DuePublicationRow,
        [projectId: string, now: number]
    >(`
        select ${publicationColumns},
               posts.title as postTitle,
               channels.name as channelName,
               target_revisions.content_json as targetContentJson
        from publications
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        inner join publication_target_revisions as target_revisions
            on target_revisions.project_id = publications.project_id
           and target_revisions.id = publications.target_revision_id
           and target_revisions.publication_id = publications.id
        where publications.project_id = ?1
          and publications.state = 'scheduled'
          and publications.delivery_mode = 'manual'
          and publications.review_state = 'compatible'
          and publications.scheduled_at <= ?2
        order by publications.scheduled_at, publications.id
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
    const listAuditEventsStatement = client.query<
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
        order by created_at desc, id desc
        limit ?2
    `)

    const assessChannelProfileImpact = (
        projectId: string,
        channelId: string,
        currentProfileRow: ProfileRow,
        proposedProfileRow: ProfileRow,
        subjectId: string
    ) => {
        const workingDraftRows = listProfileImpactWorkingDraftsStatement.all(projectId, channelId)
        const targetRows = listProfileImpactTargetsStatement.all(projectId, channelId)
        const targetMediaByPublicationId = new Map<string, readonly TargetRevisionMediaRow[]>()

        for (const target of targetRows) {
            targetMediaByPublicationId.set(
                target.publicationId,
                listTargetRevisionMediaStatement.all(projectId, target.targetRevisionId)
            )
        }

        const assessmentResult = assessChannelProfileChange({
            currentProfile: parseProfile(currentProfileRow.profileJson),
            proposedProfile: parseProfile(proposedProfileRow.profileJson),
            workingDrafts: workingDraftRows.map(row => ({
                id: row.publicationId,
                kind: 'working_draft' as const,
                content: parseJsonObject(row.contentJson, 'publication working draft content'),
                deliveryMode: row.deliveryMode,
            })),
            pendingTargets: targetRows.map(row => ({
                id: row.publicationId,
                kind: 'pending_target' as const,
                content: parseJsonObject(row.contentJson, 'publication target content'),
                deliveryMode: row.deliveryMode,
            })),
            validateMedia: (candidate, profile) => {
                if (candidate.kind === 'working_draft') {
                    return assessWorkingDraftMedia(
                        profile,
                        candidate.content,
                        projectId,
                        subjectId,
                        media,
                        publicMediaUrlAvailable
                    )
                }

                const target = targetRows.find(row => row.publicationId === candidate.id)
                if (target === undefined) {
                    return [
                        profileAssessmentIssue(
                            'profile.target_missing',
                            'The pending target could not be loaded during profile assessment'
                        ),
                    ]
                }

                return assessPinnedTargetMedia(
                    profile,
                    candidate.content,
                    projectId,
                    subjectId,
                    media,
                    targetMediaByPublicationId.get(target.publicationId) ?? [],
                    publicMediaUrlAvailable
                )
            },
        })
        if (!assessmentResult.ok) throw invalidProfileError(assessmentResult.issues)

        return {
            assessment: assessmentResult.value,
            workingDraftRows,
            targetRows,
            targetMediaByPublicationId,
        }
    }

    const getChannelProfileState = (
        projectId: string,
        channelId: string,
        subjectId: string
    ): ChannelProfileState | null => {
        if (loadActorStatement.get(projectId, subjectId) === null) return null

        const channelRow = loadChannelStatement.get(projectId, channelId)
        if (channelRow === null) return null

        const activeRow = loadProfileStatement.get(projectId, channelRow.profileVersionId)
        if (activeRow === null || activeRow.state !== 'active') {
            throw new DomainInvariantError(
                'invalid_input',
                `Channel ${channelId} has no active profile`
            )
        }

        const draftRow = loadDraftProfileStatement.get(projectId, channelId)
        return {
            channel: toChannel(channelRow),
            active: toProfileVersion(activeRow),
            draft: draftRow === null ? null : toProfileVersion(draftRow),
        }
    }

    const createChannelProfileDraftTransaction = client.transaction(
        (input: CreateChannelProfileDraftInput): ChannelProfileVersion | null => {
            const actor = loadActorStatement.get(input.projectId, input.subjectId)
            const channelRow = loadChannelStatement.get(input.projectId, input.channelId)
            if (actor === null || channelRow === null) return null

            const activeRow = loadProfileStatement.get(input.projectId, channelRow.profileVersionId)
            if (activeRow === null || activeRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Channel ${input.channelId} has no active profile`
                )
            }

            const expectedRevision = normalizeOptionalProfileRevision(input.expectedRevision)
            const draftProfile = profileForDraft(input.profile, activeRow)
            const profileResult = profileCompiler.compile(draftProfile)
            if (!profileResult.ok) throw invalidProfileError(profileResult.issues)

            const profile = profileResult.value.profile
            const timestamp = requireTimestamp(now(), 'now')
            const existingDraft = loadDraftProfileStatement.get(input.projectId, input.channelId)

            if (existingDraft !== null) {
                if (expectedRevision === undefined || expectedRevision !== existingDraft.revision) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        `Channel profile draft ${input.channelId} changed after revision ${expectedRevision ?? 'unknown'}`
                    )
                }

                const updated = updateProfileDraftStatement.run(
                    JSON.stringify(profile),
                    profile.profileHash,
                    profile.schemaHash,
                    timestamp,
                    input.projectId,
                    input.channelId,
                    existingDraft.id,
                    expectedRevision
                )
                if (updated.changes !== 1) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        `Channel profile draft ${input.channelId} changed before it could be saved`
                    )
                }

                insertAuditEventStatement.run(
                    createId(),
                    input.projectId,
                    actor.id,
                    'channel.profile_draft.updated',
                    'channel_profile_version',
                    existingDraft.id,
                    JSON.stringify({
                        channelId: input.channelId,
                        profileId: profile.id,
                        version: profile.version,
                        revision: existingDraft.revision + 1,
                    }),
                    timestamp
                )

                const saved = loadProfileStatement.get(input.projectId, existingDraft.id)
                if (saved === null)
                    throw new DomainInvariantError('invalid_input', 'Draft disappeared')
                return toProfileVersion(saved)
            }

            if (expectedRevision !== undefined && expectedRevision !== 0) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Channel profile ${input.channelId} has no draft at revision ${expectedRevision}`
                )
            }

            const profileVersionId = createId()
            insertProfileStatement.run(
                profileVersionId,
                input.projectId,
                input.channelId,
                profile.id,
                profile.version,
                profile.origin,
                'draft',
                1,
                JSON.stringify(profile),
                profile.profileHash,
                profile.schemaHash,
                actor.id,
                timestamp
            )
            insertAuditEventStatement.run(
                createId(),
                input.projectId,
                actor.id,
                'channel.profile_draft.created',
                'channel_profile_version',
                profileVersionId,
                JSON.stringify({
                    channelId: input.channelId,
                    profileId: profile.id,
                    version: profile.version,
                    revision: 1,
                }),
                timestamp
            )

            const created = loadProfileStatement.get(input.projectId, profileVersionId)
            if (created === null)
                throw new DomainInvariantError('invalid_input', 'Draft disappeared')
            return toProfileVersion(created)
        }
    )

    const previewChannelProfileActivation = (
        input: PreviewChannelProfileActivationInput
    ): ChannelProfileImpactAssessment | null => {
        const actor = loadActorStatement.get(input.projectId, input.subjectId)
        const channelRow = loadChannelStatement.get(input.projectId, input.channelId)
        if (actor === null || channelRow === null) return null

        const activeRow = loadProfileStatement.get(input.projectId, channelRow.profileVersionId)
        const draftRow = loadProfileStatement.get(input.projectId, input.profileVersionId)
        if (activeRow === null || activeRow.state !== 'active') {
            throw new DomainInvariantError(
                'invalid_input',
                `Channel ${input.channelId} has no active profile`
            )
        }
        if (
            draftRow === null ||
            draftRow.channelId !== input.channelId ||
            draftRow.state !== 'draft'
        ) {
            throw new DomainInvariantError(
                'invalid_input',
                `Profile ${input.profileVersionId} is not a draft for channel ${input.channelId}`
            )
        }

        return assessChannelProfileImpact(
            input.projectId,
            input.channelId,
            activeRow,
            draftRow,
            input.subjectId
        ).assessment
    }

    const activateChannelProfileTransaction = client.transaction(
        (input: ActivateChannelProfileInput): ChannelProfileActivationResult | null => {
            const actor = loadActorStatement.get(input.projectId, input.subjectId)
            const channelRow = loadChannelStatement.get(input.projectId, input.channelId)
            if (actor === null || channelRow === null) return null

            const activeRow = loadProfileStatement.get(input.projectId, channelRow.profileVersionId)
            const draftRow = loadProfileStatement.get(input.projectId, input.profileVersionId)
            if (activeRow === null || activeRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Channel ${input.channelId} has no active profile`
                )
            }
            if (
                draftRow === null ||
                draftRow.channelId !== input.channelId ||
                draftRow.state !== 'draft'
            ) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Profile ${input.profileVersionId} is not a draft for channel ${input.channelId}`
                )
            }

            const expectedRevision = normalizeOptionalProfileRevision(input.expectedRevision)
            if (expectedRevision !== undefined && expectedRevision !== draftRow.revision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Channel profile draft ${input.profileVersionId} changed after revision ${expectedRevision}`
                )
            }

            const impact = assessChannelProfileImpact(
                input.projectId,
                input.channelId,
                activeRow,
                draftRow,
                input.subjectId
            )
            const timestamp = requireTimestamp(now(), 'now')

            if (
                updateProfileStateStatement.run(
                    'superseded',
                    timestamp,
                    input.projectId,
                    activeRow.id
                ).changes !== 1
            ) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not supersede profile ${activeRow.id}`
                )
            }
            if (
                updateProfileStateStatement.run('active', timestamp, input.projectId, draftRow.id)
                    .changes !== 1
            ) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not activate profile ${draftRow.id}`
                )
            }
            if (
                updateChannelProfileStatement.run(
                    draftRow.id,
                    timestamp,
                    input.projectId,
                    input.channelId,
                    activeRow.id
                ).changes !== 1
            ) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not attach profile ${draftRow.id} to channel ${input.channelId}`
                )
            }

            for (const workingDraft of impact.workingDraftRows) {
                const assessed = impact.assessment.workingDrafts.find(
                    candidate => candidate.id === workingDraft.publicationId
                )
                if (assessed === undefined) continue
                if (
                    updateWorkingDraftAssessmentStatement.run(
                        assessed.state,
                        JSON.stringify(assessed.issues),
                        draftRow.id,
                        actor.id,
                        timestamp,
                        input.projectId,
                        workingDraft.publicationId
                    ).changes !== 1
                ) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not assess working draft ${workingDraft.publicationId}`
                    )
                }
            }

            for (const target of impact.targetRows) {
                const assessed = impact.assessment.pendingTargets.find(
                    candidate => candidate.id === target.publicationId
                )
                if (assessed === undefined) continue
                const assessmentUpdate = updatePublicationAssessmentStatement.run(
                    assessed.state,
                    JSON.stringify(assessed.issues),
                    draftRow.id,
                    timestamp,
                    actor.id,
                    input.projectId,
                    target.publicationId
                )
                if (assessmentUpdate.changes !== 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not assess publication ${target.publicationId}`
                    )
                }

                const activeJob = loadActiveJobStatement.get(input.projectId, target.publicationId)
                if (assessed.state === 'review_required') {
                    if (activeJob?.state === 'pending') {
                        if (
                            cancelPendingJobStatement.run(timestamp, input.projectId, activeJob.id)
                                .changes !== 1
                        ) {
                            throw new DomainInvariantError(
                                'claim_mismatch',
                                `Could not cancel job ${activeJob.id}`
                            )
                        }
                    }
                    continue
                }

                if (
                    activeJob === null &&
                    target.deliveryMode === 'automatic' &&
                    channelRow.publisherId !== null
                ) {
                    const publicationRow = loadPublicationByIdStatement.get(
                        input.projectId,
                        target.publicationId
                    )
                    if (publicationRow === null) {
                        throw new DomainInvariantError(
                            'claim_mismatch',
                            `Publication ${target.publicationId} disappeared during activation`
                        )
                    }
                    const publication = toPublication(publicationRow)
                    const job = createJob({
                        id: createId(),
                        publication,
                        publisher: toPublisher(channelRow),
                        runAt: Math.max(publication.scheduledAt ?? timestamp, timestamp),
                        now: timestamp,
                    })
                    insertJobStatement.run(
                        job.id,
                        job.projectId,
                        job.publicationId,
                        job.runAt,
                        timestamp
                    )
                }
            }

            insertAuditEventStatement.run(
                createId(),
                input.projectId,
                actor.id,
                'channel.profile_activated',
                'channel',
                input.channelId,
                JSON.stringify({
                    previousProfileVersionId: activeRow.id,
                    profileVersionId: draftRow.id,
                    compatibleWorkingDraftIds: impact.assessment.workingDrafts
                        .filter(candidate => candidate.state === 'compatible')
                        .map(candidate => candidate.id),
                    reviewRequiredWorkingDraftIds: impact.assessment.workingDrafts
                        .filter(candidate => candidate.state === 'review_required')
                        .map(candidate => candidate.id),
                    compatibleTargetIds: impact.assessment.pendingTargets
                        .filter(candidate => candidate.state === 'compatible')
                        .map(candidate => candidate.id),
                    reviewRequiredTargetIds: impact.assessment.pendingTargets
                        .filter(candidate => candidate.state === 'review_required')
                        .map(candidate => candidate.id),
                }),
                timestamp
            )

            const updatedChannel = loadChannelStatement.get(input.projectId, input.channelId)
            const updatedProfile = loadProfileStatement.get(input.projectId, draftRow.id)
            if (updatedChannel === null || updatedProfile === null) {
                throw new DomainInvariantError('invalid_input', 'Activated profile disappeared')
            }

            return {
                channel: toChannel(updatedChannel),
                profile: toProfileVersion(updatedProfile),
                assessment: impact.assessment,
            }
        }
    )

    const createPostTransaction = client.transaction(
        (input: CreatePostInput): CreatedPost | null => {
            if (input.publications.length === 0) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'At least one publication is required'
                )
            }

            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const projectRow = loadProjectStatement.get(input.projectId)
            if (actorRow === null || projectRow === null) return null

            const timestamp = requireTimestamp(now(), 'now')
            const project = toProject(projectRow)
            const actor = toActor(actorRow)
            const post = createPost({
                id: createId(),
                project,
                createdBy: actor,
                title: input.title,
                sourceContent: input.sourceContent,
                now: timestamp,
            })

            const publicationEntries = input.publications.map(publicationInput => {
                const channelRow = loadChannelStatement.get(project.id, publicationInput.channelId)
                if (channelRow === null) {
                    throw new DomainInvariantError(
                        'project_mismatch',
                        `Channel ${publicationInput.channelId} does not belong to project`
                    )
                }

                const profileRow = loadProfileStatement.get(project.id, channelRow.profileVersionId)
                if (profileRow === null || profileRow.channelId !== channelRow.id) {
                    throw new DomainInvariantError(
                        'invalid_input',
                        `Channel ${channelRow.id} has no available profile`
                    )
                }
                const profileResult = profileCompiler.compile(parseProfile(profileRow.profileJson))
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
                        ? assessWorkingDraftMedia(
                              profile,
                              targetContent,
                              project.id,
                              input.subjectId,
                              media,
                              publicMediaUrlAvailable
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
                        : resolveTargetMedia(
                              profile,
                              targetContent,
                              project.id,
                              input.subjectId,
                              media,
                              publicMediaUrlAvailable
                          )
                const targetContentJson = canonicalJson(targetContent)
                const deliveryMode = publicationInput.deliveryMode ?? 'manual'
                if (deliveryMode === 'automatic' && profile.execution.kind === 'manual') {
                    throw new DomainInvariantError(
                        'invalid_input',
                        `Channel ${channelRow.id} has no automatic execution contract`
                    )
                }
                const targetRevisionId = publicationInput.scheduledAt == null ? null : createId()
                const publication = createPublication({
                    id: createId(),
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
                    workingDraftId: createId(),
                    targetRevisionId,
                    publisher: channelRow.publisherId === null ? null : toPublisher(channelRow),
                }
            })
            const publications = publicationEntries.map(entry => entry.publication)

            insertPostStatement.run(
                post.id,
                project.id,
                post.title,
                canonicalJson(post.sourceContent),
                post.sourceRevision,
                actor.id,
                timestamp
            )
            insertAuditEventStatement.run(
                createId(),
                project.id,
                actor.id,
                'post.created',
                'post',
                post.id,
                JSON.stringify({ title: post.title }),
                timestamp
            )

            for (const entry of publicationEntries) {
                const { publication } = entry
                insertPublicationStatement.run(
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
                insertWorkingDraftStatement.run(
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
                    insertTargetRevisionStatement.run(
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
                        insertTargetRevisionMediaStatement.run(
                            createId(),
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
                insertAuditEventStatement.run(
                    createId(),
                    project.id,
                    actor.id,
                    'publication.created',
                    'publication',
                    publication.id,
                    JSON.stringify({
                        channelId: publication.channelId,
                        scheduledAt: publication.scheduledAt,
                        state: publication.state,
                    }),
                    timestamp
                )

                if (
                    entry.publisher !== null &&
                    publication.deliveryMode === 'automatic' &&
                    publication.scheduledAt !== null
                ) {
                    const job = createJob({
                        id: createId(),
                        publication,
                        publisher: entry.publisher,
                        runAt: publication.scheduledAt,
                        now: timestamp,
                    })
                    insertJobStatement.run(
                        job.id,
                        job.projectId,
                        job.publicationId,
                        job.runAt,
                        timestamp
                    )
                }
            }

            return { post, publications }
        }
    )

    const savePublicationDraftTransaction = client.transaction(
        (input: SavePublicationDraftInput): PublicationWorkingDraft | null => {
            if (input.sourceContent === undefined && input.targetContent === undefined) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'A publication draft must include sourceContent or targetContent'
                )
            }

            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const publicationRow = loadPublicationByIdStatement.get(
                input.projectId,
                input.publicationId
            )
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
            const postRow = loadPostSourceStatement.get(input.projectId, publicationRow.postId)
            if (draftRow === null || postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has incomplete draft state`
                )
            }
            const channelRow = loadChannelStatement.get(input.projectId, publicationRow.channelId)
            const profileRow = loadProfileStatement.get(input.projectId, draftRow.profileVersionId)
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
            const profileResult = profileCompiler.compile(parseProfile(profileRow.profileJson))
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
            const mediaIssues = assessWorkingDraftMedia(
                profileResult.value.profile,
                targetContent,
                input.projectId,
                input.subjectId,
                media,
                publicMediaUrlAvailable
            )
            const validationIssues = [...validation.issues, ...mediaIssues]
            const reviewState: PublicationReviewState =
                validation.ok && mediaIssues.length === 0 ? 'compatible' : 'review_required'
            const timestamp = requireTimestamp(now(), 'now')
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
            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const publicationRow = loadPublicationByIdStatement.get(
                input.projectId,
                input.publicationId
            )
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

            const postRow = loadPostSourceStatement.get(input.projectId, publicationRow.postId)
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

            const timestamp = requireTimestamp(now(), 'now')
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
            insertAuditEventStatement.run(
                createId(),
                input.projectId,
                actorRow.id,
                'publication.draft.rebased',
                'publication',
                input.publicationId,
                JSON.stringify({
                    fromSourceRevision: draftRow.sourceRevision,
                    toSourceRevision: postRow.sourceRevision,
                    targetPreserved: true,
                }),
                timestamp
            )

            const rebased = loadWorkingDraftStatement.get(input.projectId, input.publicationId)
            if (rebased === null) {
                throw new DomainInvariantError('invalid_input', 'Draft disappeared after rebase')
            }
            return toWorkingDraft(rebased)
        }
    )

    const promotePublicationDraftTransaction = client.transaction(
        (input: PromotePublicationDraftInput): Publication | null => {
            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const publicationRow = loadPublicationByIdStatement.get(
                input.projectId,
                input.publicationId
            )
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

            const postRow = loadPostSourceStatement.get(input.projectId, publicationRow.postId)
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

            const profileRow = loadProfileStatement.get(input.projectId, draftRow.profileVersionId)
            const channelRow = loadChannelStatement.get(input.projectId, publicationRow.channelId)
            if (
                channelRow === null ||
                profileRow === null ||
                profileRow.channelId !== channelRow.id
            ) {
                throw new DomainInvariantError('invalid_input', 'Profile unavailable')
            }
            const profileResult = profileCompiler.compile(parseProfile(profileRow.profileJson))
            if (!profileResult.ok) throw invalidProfileError(profileResult.issues)
            const content = parseJsonObject(draftRow.contentJson, 'publication draft content')
            const validation = profileResult.value.validate(content)
            if (!validation.ok) throw invalidTargetContentError(validation.issues)
            const targetMedia = resolveTargetMedia(
                profileResult.value.profile,
                content,
                input.projectId,
                input.subjectId,
                media,
                publicMediaUrlAvailable
            )

            const timestamp = requireTimestamp(now(), 'now')
            const contentJson = canonicalJson(content)
            const activeJob = loadActiveJobStatement.get(input.projectId, input.publicationId)
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
            const targetRevisionId = createId()
            const sequence =
                (nextTargetRevisionSequenceStatement.get(input.projectId, input.publicationId)
                    ?.sequence ?? 0) + 1
            insertTargetRevisionStatement.run(
                targetRevisionId,
                input.projectId,
                input.publicationId,
                sequence,
                draftRow.profileVersionId,
                draftRow.sourceRevision,
                publicationRow.deliveryMode,
                targetMedia.length,
                contentJson,
                contentHash(content),
                profileResult.value.profile.profileHash,
                profileResult.value.profile.schemaHash,
                JSON.stringify(validation.issues),
                actorRow.id,
                timestamp
            )
            for (const [position, mediaReference] of targetMedia.entries()) {
                insertTargetRevisionMediaStatement.run(
                    createId(),
                    input.projectId,
                    targetRevisionId,
                    mediaReference.reference.assetId,
                    mediaReference.representation.id,
                    position,
                    mediaReference.reference.contentPath,
                    mediaReference.reference.role,
                    mediaReference.accessibilityText,
                    timestamp
                )
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
                    const updatedJob = updatePendingJobStatement.run(
                        scheduledAt as number,
                        timestamp,
                        input.projectId,
                        activeJob.id
                    )
                    if (updatedJob.changes !== 1) {
                        throw new DomainInvariantError(
                            'claim_mismatch',
                            `Could not reschedule job ${activeJob.id}`
                        )
                    }
                } else if (channelRow !== null && channelRow.publisherId !== null) {
                    const job = createJob({
                        id: createId(),
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
                    insertJobStatement.run(
                        job.id,
                        job.projectId,
                        job.publicationId,
                        job.runAt,
                        timestamp
                    )
                }
            } else if (activeJob !== null) {
                const cancelledJob = cancelPendingJobStatement.run(
                    timestamp,
                    input.projectId,
                    activeJob.id
                )
                if (cancelledJob.changes !== 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not cancel job ${activeJob.id}`
                    )
                }
            }

            insertAuditEventStatement.run(
                createId(),
                input.projectId,
                actorRow.id,
                'publication.target_promoted',
                'publication',
                input.publicationId,
                JSON.stringify({ targetRevisionId, sequence, scheduledAt }),
                timestamp
            )
            const updated = loadPublicationByIdStatement.get(input.projectId, input.publicationId)
            return updated === null ? null : toPublication(updated)
        }
    )

    const publishManualPublicationTransaction = client.transaction(
        (input: PublishManualPublicationInput): Publication | null => {
            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            if (actorRow === null) return null

            const timestamp = requireTimestamp(now(), 'now')
            const row = loadPublicationStatement.get(
                input.projectId,
                input.publicationId,
                timestamp
            )
            if (row === null) return null

            const publication = toPublication(row)
            const actor = toActor(actorRow)
            const ready = transitionPublication({
                publication,
                to: 'ready',
                actor,
                now: timestamp,
            })
            const published = transitionPublication({
                publication: ready,
                to: 'published',
                actor,
                now: timestamp,
                externalId: input.externalId,
                externalUrl: input.externalUrl,
            })

            const result = publishPublicationStatement.run(
                published.id,
                published.projectId,
                published.publishedAt as number,
                published.publishedByActorId as string,
                published.externalId,
                published.externalUrl
            )
            if (result.changes !== 1) return null

            insertAuditEventStatement.run(
                createId(),
                published.projectId,
                actor.id,
                'publication.ready',
                'publication',
                published.id,
                JSON.stringify({ fromState: publication.state, toState: ready.state }),
                timestamp
            )
            insertAuditEventStatement.run(
                createId(),
                published.projectId,
                actor.id,
                'publication.published',
                'publication',
                published.id,
                JSON.stringify({
                    fromState: ready.state,
                    toState: published.state,
                    externalId: published.externalId,
                    externalUrl: published.externalUrl,
                }),
                timestamp
            )

            return published
        }
    )
    const reconcileAmbiguousPublicationTransaction = client.transaction(
        (input: ReconcileAmbiguousPublicationInput): ReconcileAmbiguousPublicationResult => {
            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const row = loadPublicationByIdStatement.get(input.projectId, input.publicationId)
            if (actorRow === null || row === null) return { kind: 'not_found' }
            if (row.state !== 'ambiguous') return { kind: 'not_ambiguous' }

            const timestamp = requireTimestamp(now(), 'now')
            const publication = toPublication(row)
            const actor = toActor(actorRow)
            const reconciled =
                input.resolution === 'published'
                    ? transitionPublication({
                          publication,
                          to: 'published',
                          actor,
                          now: timestamp,
                          externalId: requireNonBlank(input.externalId ?? '', 'externalId'),
                          externalUrl:
                              input.externalUrl === undefined
                                  ? undefined
                                  : requireNonBlank(input.externalUrl, 'externalUrl'),
                      })
                    : transitionPublication({
                          publication,
                          to: 'failed',
                          actor,
                          now: timestamp,
                          errorMessage: requireNonBlank(input.errorMessage ?? '', 'errorMessage'),
                      })

            const result =
                reconciled.state === 'published'
                    ? reconcilePublishedPublicationStatement.run(
                          reconciled.id,
                          reconciled.projectId,
                          reconciled.publishedAt as number,
                          reconciled.publishedByActorId as string,
                          reconciled.externalId as string,
                          reconciled.externalUrl
                      )
                    : reconcileFailedPublicationStatement.run(
                          reconciled.id,
                          reconciled.projectId,
                          reconciled.updatedAt,
                          reconciled.stateChangedByActorId,
                          reconciled.errorMessage as string
                      )

            if (result.changes !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not reconcile publication ${reconciled.id}`
                )
            }

            insertAuditEventStatement.run(
                createId(),
                reconciled.projectId,
                actor.id,
                'publication.reconciled',
                'publication',
                reconciled.id,
                JSON.stringify({
                    fromState: publication.state,
                    toState: reconciled.state,
                    externalId: reconciled.externalId,
                    externalUrl: reconciled.externalUrl,
                    errorMessage: reconciled.errorMessage,
                }),
                timestamp
            )

            return { kind: 'reconciled', publication: reconciled }
        }
    )

    return {
        ...projectChannelStore,

        getChannelProfileState(
            projectId: string,
            channelId: string,
            subjectId: string
        ): ChannelProfileState | null {
            return getChannelProfileState(
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(channelId, 'channelId'),
                requireNonBlank(subjectId, 'subjectId')
            )
        },

        createChannelProfileDraft(
            input: CreateChannelProfileDraftInput
        ): ChannelProfileVersion | null {
            return createChannelProfileDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        previewChannelProfileActivation(
            input: PreviewChannelProfileActivationInput
        ): ChannelProfileImpactAssessment | null {
            return previewChannelProfileActivation({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                profileVersionId: requireNonBlank(input.profileVersionId, 'profileVersionId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        activateChannelProfile(
            input: ActivateChannelProfileInput
        ): ChannelProfileActivationResult | null {
            return activateChannelProfileTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                profileVersionId: requireNonBlank(input.profileVersionId, 'profileVersionId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        createPost(input: CreatePostInput): CreatedPost | null {
            return createPostTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        getPublicationWorkingDraft(
            projectId: string,
            publicationId: string,
            subjectId: string
        ): PublicationWorkingDraft | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedPublicationId = requireNonBlank(publicationId, 'publicationId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
            if (loadActorStatement.get(normalizedProjectId, normalizedSubjectId) === null) {
                return null
            }

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
            if (loadActorStatement.get(normalizedProjectId, normalizedSubjectId) === null) {
                return null
            }

            const publicationRow = loadPublicationByIdStatement.get(
                normalizedProjectId,
                normalizedPublicationId
            )
            const draftRow = loadWorkingDraftStatement.get(
                normalizedProjectId,
                normalizedPublicationId
            )
            if (publicationRow === null || draftRow === null) return null

            const postRow = loadPostStatement.get(normalizedProjectId, publicationRow.postId)
            const channelRow = loadChannelStatement.get(
                normalizedProjectId,
                publicationRow.channelId
            )
            const profileRow = loadProfileStatement.get(
                normalizedProjectId,
                draftRow.profileVersionId
            )
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
                loadActorStatement.get(
                    normalizedProjectId,
                    requireNonBlank(subjectId, 'subjectId')
                ) === null
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

        listDueManualPublications(
            projectId: string,
            subjectId: string,
            at?: number
        ): DueManualPublication[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const actor = loadActorStatement.get(
                normalizedProjectId,
                requireNonBlank(subjectId, 'subjectId')
            )
            if (actor === null) return null

            const timestamp = requireTimestamp(at ?? now(), 'now')
            return listDuePublicationsStatement.all(normalizedProjectId, timestamp).map(row => ({
                ...toPublication(row),
                postTitle: row.postTitle,
                channelName: row.channelName,
                targetContent: parseJsonObject(row.targetContentJson, 'publication target content'),
            }))
        },

        publishManualPublication(input: PublishManualPublicationInput): Publication | null {
            return publishManualPublicationTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                externalId:
                    input.externalId === undefined
                        ? undefined
                        : requireNonBlank(input.externalId, 'externalId'),
                externalUrl:
                    input.externalUrl === undefined
                        ? undefined
                        : requireNonBlank(input.externalUrl, 'externalUrl'),
            })
        },

        reconcileAmbiguousPublication(
            input: ReconcileAmbiguousPublicationInput
        ): ReconcileAmbiguousPublicationResult {
            return reconcileAmbiguousPublicationTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                externalId:
                    input.externalId === undefined
                        ? undefined
                        : requireNonBlank(input.externalId, 'externalId'),
                externalUrl:
                    input.externalUrl === undefined
                        ? undefined
                        : requireNonBlank(input.externalUrl, 'externalUrl'),
                errorMessage:
                    input.errorMessage === undefined
                        ? undefined
                        : requireNonBlank(input.errorMessage, 'errorMessage'),
            })
        },

        listAuditEvents(projectId: string, subjectId: string, limit = 100): AuditEvent[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const actor = loadActorStatement.get(
                normalizedProjectId,
                requireNonBlank(subjectId, 'subjectId')
            )
            if (actor === null) return null

            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
                throw new DomainInvariantError('invalid_input', 'limit must be between 1 and 100')
            }

            return listAuditEventsStatement.all(normalizedProjectId, limit).map(toAuditEvent)
        },
    }
}

function toActor(row: ActorRow): Actor {
    return {
        id: row.id,
        projectId: row.projectId,
        kind: row.kind,
        subjectId: row.subjectId,
        displayName: row.displayName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toProfileVersion(row: ProfileRow): ChannelProfileVersion {
    const profile = parseProfile(row.profileJson)
    if (
        profile.id !== row.profileId ||
        profile.version !== row.version ||
        profile.origin !== row.origin ||
        profile.profileHash !== row.profileHash ||
        profile.schemaHash !== row.schemaHash
    ) {
        throw new DomainInvariantError(
            'invalid_content',
            `Stored channel profile ${row.id} metadata does not match its definition`
        )
    }

    return {
        id: row.id,
        projectId: row.projectId,
        channelId: row.channelId,
        profileId: row.profileId,
        version: row.version,
        origin: row.origin,
        state: row.state,
        revision: row.revision,
        profile,
        createdByActorId: row.createdByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function profileForDraft(
    profile: ChannelProfileDefinition,
    activeRow: ProfileRow
): ChannelProfileDefinition {
    if (profile.id !== activeRow.profileId) {
        throw new DomainInvariantError(
            'invalid_input',
            `A channel profile draft cannot change profile identity from ${activeRow.profileId}`
        )
    }
    if (profile.origin !== activeRow.origin) {
        throw new DomainInvariantError(
            'invalid_input',
            `A channel profile draft cannot change profile origin from ${activeRow.origin}`
        )
    }

    return {
        ...profile,
        id: activeRow.profileId,
        version: activeRow.version + 1,
        origin: activeRow.origin,
    }
}

function normalizeOptionalProfileRevision(value: number | undefined): number | undefined {
    if (value === undefined) return undefined
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DomainInvariantError(
            'invalid_input',
            'Profile expectedRevision must be a non-negative safe integer'
        )
    }
    return value
}

function profileAssessmentIssue(code: string, message: string, path = '/media'): ValidationIssue {
    return { path, code, message, severity: 'error', source: 'capability' }
}

function assessWorkingDraftMedia(
    profile: ChannelProfileDefinition,
    content: unknown,
    projectId: string,
    subjectId: string,
    media: Pick<MediaAssetStore, 'getAsset'> | undefined,
    publicMediaUrlAvailable: boolean
): readonly ValidationIssue[] {
    if (!isRecord(content)) {
        return [
            profileAssessmentIssue(
                'profile.content_not_object',
                'The working draft content is not a JSON object',
                ''
            ),
        ]
    }

    try {
        resolveTargetMedia(profile, content, projectId, subjectId, media, publicMediaUrlAvailable)
        return []
    } catch (error) {
        return [
            profileAssessmentIssue(
                'profile.media_incompatible',
                error instanceof Error ? error.message : 'Media is incompatible with the profile'
            ),
        ]
    }
}

function assessPinnedTargetMedia(
    profile: ChannelProfileDefinition,
    content: unknown,
    projectId: string,
    subjectId: string,
    media: Pick<MediaAssetStore, 'getAsset'> | undefined,
    pinnedMedia: readonly TargetRevisionMediaRow[],
    publicMediaUrlAvailable: boolean
): readonly ValidationIssue[] {
    if (!isRecord(content)) {
        return [
            profileAssessmentIssue(
                'profile.content_not_object',
                'The pending target content is not a JSON object',
                ''
            ),
        ]
    }

    let references: readonly TargetMediaReference[]
    try {
        references = extractTargetMediaReferences(profile, content)
    } catch (error) {
        return [
            profileAssessmentIssue(
                'profile.media_reference_invalid',
                error instanceof Error ? error.message : 'Media references are invalid'
            ),
        ]
    }

    const issues: ValidationIssue[] = []
    const referencesByBinding = new Map<string, TargetMediaReference[]>()
    for (const reference of references) {
        const bindingReferences = referencesByBinding.get(reference.bindingId) ?? []
        bindingReferences.push(reference)
        referencesByBinding.set(reference.bindingId, bindingReferences)
    }

    for (const capability of profile.capabilities.mediaFields) {
        const bindingReferences = referencesByBinding.get(capability.bindingId) ?? []
        if (bindingReferences.length < (capability.minItems ?? 0)) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_required',
                    `Media field ${capability.bindingId} requires at least ${capability.minItems} item(s)`,
                    `/capabilities/${capability.bindingId}`
                )
            )
        }
        if (bindingReferences.length > capability.maxItems) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_limit_exceeded',
                    `Media field ${capability.bindingId} accepts at most ${capability.maxItems} item(s)`,
                    `/capabilities/${capability.bindingId}`
                )
            )
        }
    }

    if (references.length === 0) {
        return issues
    }

    if (media === undefined) {
        return [
            profileAssessmentIssue(
                'profile.media_service_unavailable',
                'Media lifecycle service is required to assess pinned media'
            ),
        ]
    }

    if (pinnedMedia.length !== references.length) {
        issues.push(
            profileAssessmentIssue(
                'profile.media_snapshot_mismatch',
                'The persisted target media snapshot does not match its content'
            )
        )
    }

    const totalBytesByBinding = new Map<string, number>()
    for (const [position, reference] of references.entries()) {
        const pinned = pinnedMedia[position]
        if (pinned === undefined) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_snapshot_missing',
                    `No persisted media snapshot exists for ${reference.contentPath}`,
                    reference.contentPath
                )
            )
            continue
        }
        if (
            pinned.position !== position ||
            pinned.assetId !== reference.assetId ||
            pinned.contentPath !== reference.contentPath ||
            pinned.role !== reference.role
        ) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_snapshot_mismatch',
                    `The persisted media snapshot does not match ${reference.contentPath}`,
                    reference.contentPath
                )
            )
            continue
        }

        const asset = media.getAsset(projectId, reference.assetId, subjectId)
        if (asset === null || asset.asset.state !== 'ready') {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_asset_unavailable',
                    `Media asset ${reference.assetId} is not available for publication`,
                    reference.contentPath
                )
            )
            continue
        }

        const expectedAccessibilityText =
            reference.accessibilityText ?? asset.asset.defaultAccessibilityText
        if (pinned.accessibilityText !== expectedAccessibilityText) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_snapshot_mismatch',
                    `The persisted accessibility text does not match ${reference.contentPath}`,
                    reference.contentPath
                )
            )
            continue
        }

        const representation = asset.representations.find(
            candidate => candidate.id === pinned.representationId && candidate.state === 'ready'
        )
        if (representation === undefined) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_representation_unavailable',
                    `Media representation ${pinned.representationId} is not ready`,
                    reference.contentPath
                )
            )
            continue
        }

        const capability = profile.capabilities.mediaFields.find(
            candidate => candidate.bindingId === reference.bindingId
        )
        if (capability !== undefined && !supportsMediaCapability(representation, capability)) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_representation_incompatible',
                    `Media representation ${pinned.representationId} is incompatible with field ${reference.bindingId}`,
                    reference.contentPath
                )
            )
        }
        if (capability?.accessibilityTextRequired && pinned.accessibilityText === null) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_accessibility_required',
                    `Media field ${reference.bindingId} requires accessibility text`,
                    reference.contentPath
                )
            )
        }
        if (capability?.publicUrlRequired && !publicMediaUrlAvailable) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_public_url_required',
                    `Media field ${reference.bindingId} requires public media delivery, which is not configured`,
                    reference.contentPath
                )
            )
        }

        const totalBytes = totalBytesByBinding.get(reference.bindingId) ?? 0
        const nextTotalBytes = totalBytes + (representation.byteSize ?? 0)
        if (capability?.maxTotalBytes !== undefined && nextTotalBytes > capability.maxTotalBytes) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_total_size_exceeded',
                    `Media field ${reference.bindingId} exceeds its total byte limit`,
                    reference.contentPath
                )
            )
        }
        totalBytesByBinding.set(reference.bindingId, nextTotalBytes)
    }

    return issues
}

function toPublisher(row: PublicationChannelRow): Publisher {
    if (
        row.publisherId === null ||
        row.publisherKind === null ||
        row.publisherCreatedAt === null ||
        row.publisherUpdatedAt === null
    ) {
        throw new DomainInvariantError(
            'invalid_input',
            'A publisher row is incomplete for an automated publication'
        )
    }

    return {
        id: row.publisherId,
        projectId: row.projectId,
        channelId: row.id,
        kind: row.publisherKind,
        createdAt: row.publisherCreatedAt,
        updatedAt: row.publisherUpdatedAt,
    }
}

function toPublication(row: PublicationRow): Publication {
    return {
        id: row.id,
        projectId: row.projectId,
        postId: row.postId,
        channelId: row.channelId,
        targetRevisionId: row.targetRevisionId,
        deliveryMode: row.deliveryMode,
        reviewState: row.reviewState,
        state: row.state,
        scheduledAt: row.scheduledAt,
        publishedAt: row.publishedAt,
        externalId: row.externalId,
        externalUrl: row.externalUrl,
        errorMessage: row.errorMessage,
        createdByActorId: row.createdByActorId,
        scheduledByActorId: row.scheduledByActorId,
        stateChangedByActorId: row.stateChangedByActorId,
        publishedByActorId: row.publishedByActorId,
        lastAssessedProfileVersionId: row.lastAssessedProfileVersionId,
        profileAssessmentIssues: [
            ...parseJsonArray(
                row.profileAssessmentIssuesJson,
                'publication profile assessment issues'
            ),
        ],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toPost(row: PostRow): Post {
    return {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        sourceContent: parseSourceContent(row.sourceContentJson),
        sourceRevision: row.sourceRevision,
        createdByActorId: row.createdByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toTargetRevision(row: TargetRevisionRow): PublicationTargetRevision {
    return {
        id: row.id,
        projectId: row.projectId,
        publicationId: row.publicationId,
        sequence: row.sequence,
        profileVersionId: row.profileVersionId,
        sourceRevision: row.sourceRevision,
        deliveryMode: row.deliveryMode,
        mediaReferenceCount: row.mediaReferenceCount,
        content: parseJsonObject(row.contentJson, 'publication target content'),
        contentHash: row.contentHash,
        profileHash: row.profileHash,
        schemaHash: row.schemaHash,
        validationIssues: parseJsonArray(
            row.validationIssuesJson,
            'publication target validation issues'
        ),
        createdByActorId: row.createdByActorId,
        createdAt: row.createdAt,
    }
}

function toPublicationSummary(row: PublicationSummaryRow): PublicationSummary {
    return {
        ...toPublication(row),
        postTitle: row.postTitle,
        channelName: row.channelName,
        draftRevision: row.draftRevision,
        draftReviewState: row.draftReviewState,
        draftDiffersFromTarget:
            row.targetContentJson === null ||
            row.draftSourceRevision !== row.targetSourceRevision ||
            row.draftContentJson !== row.targetContentJson,
    }
}

function toWorkingDraft(row: WorkingDraftRow): PublicationWorkingDraft {
    return {
        id: row.id,
        projectId: row.projectId,
        publicationId: row.publicationId,
        profileVersionId: row.profileVersionId,
        sourceRevision: row.sourceRevision,
        baseSourceContent: parseSourceContent(row.baseSourceContentJson),
        content: parseJsonObject(row.contentJson, 'publication draft content'),
        reviewState: row.reviewState,
        validationIssues: parseJsonArray(row.validationIssuesJson, 'publication validation issues'),
        lastAssessedProfileVersionId: row.lastAssessedProfileVersionId,
        revision: row.revision,
        updatedByActorId: row.updatedByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
    return {
        id: row.id,
        projectId: row.projectId,
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadataJson: row.metadataJson,
        createdAt: row.createdAt,
    }
}

function parseProfile(value: string): ChannelProfileDefinition {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError(
            'invalid_content',
            'Stored channel profile is not valid JSON'
        )
    }
    if (!isRecord(parsed)) {
        throw new DomainInvariantError('invalid_content', 'Stored channel profile is not an object')
    }
    return parsed as unknown as ChannelProfileDefinition
}

function parseSourceContent(value: string): SourceContent {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError('invalid_content', 'Stored source content is not valid JSON')
    }
    return parsed as SourceContent
}

function parseJsonObject(value: string, label: string): TargetContent {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError('invalid_content', `${label} is not valid JSON`)
    }
    if (!isRecord(parsed)) {
        throw new DomainInvariantError('invalid_content', `${label} must be a JSON object`)
    }
    return parsed
}

function parseJsonArray(value: string, label: string): readonly Record<string, unknown>[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError('invalid_content', `${label} is not valid JSON`)
    }
    if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
        throw new DomainInvariantError('invalid_content', `${label} must be an array of objects`)
    }
    return parsed
}

function invalidProfileError(issues: readonly ValidationIssue[]): DomainInvariantError {
    return new DomainInvariantError(
        'invalid_content',
        `Channel profile is invalid: ${issues.map(issue => issue.message).join('; ')}`
    )
}

function invalidSourceContentError(issues: readonly ValidationIssue[]): DomainInvariantError {
    return new DomainInvariantError(
        'invalid_content',
        `Source content is invalid: ${issues.map(issue => issue.message).join('; ')}`
    )
}

function invalidTargetContentError(issues: readonly ValidationIssue[]): DomainInvariantError {
    return new DomainInvariantError(
        'invalid_content',
        `Publication target content is invalid: ${issues.map(issue => issue.message).join('; ')}`
    )
}

function resolveTargetMedia(
    profile: ChannelProfileDefinition,
    content: TargetContent,
    projectId: string,
    subjectId: string,
    media: Pick<MediaAssetStore, 'getAsset'> | undefined,
    publicMediaUrlAvailable: boolean
): readonly ResolvedTargetMedia[] {
    const references = extractTargetMediaReferences(profile, content)
    if (references.length === 0) {
        for (const capability of profile.capabilities.mediaFields) {
            if ((capability.minItems ?? 0) > 0) {
                throw mediaContentError(
                    `Media field ${capability.bindingId} requires at least ${capability.minItems} item(s)`
                )
            }
        }
        return []
    }
    if (media === undefined) {
        throw mediaContentError('Media lifecycle service is required for media publications')
    }

    const referencesByBinding = new Map<string, TargetMediaReference[]>()
    for (const reference of references) {
        const bindingReferences = referencesByBinding.get(reference.bindingId) ?? []
        bindingReferences.push(reference)
        referencesByBinding.set(reference.bindingId, bindingReferences)
    }

    for (const capability of profile.capabilities.mediaFields) {
        const bindingReferences = referencesByBinding.get(capability.bindingId) ?? []
        if (bindingReferences.length < (capability.minItems ?? 0)) {
            throw mediaContentError(
                `Media field ${capability.bindingId} requires at least ${capability.minItems} item(s)`
            )
        }
        if (bindingReferences.length > capability.maxItems) {
            throw mediaContentError(
                `Media field ${capability.bindingId} accepts at most ${capability.maxItems} item(s)`
            )
        }
    }

    const resolved: ResolvedTargetMedia[] = []
    const totalBytesByBinding = new Map<string, number>()
    for (const reference of references) {
        const capability = profile.capabilities.mediaFields.find(
            candidate => candidate.bindingId === reference.bindingId
        )
        const asset = media.getAsset(projectId, reference.assetId, subjectId)
        if (asset === null || asset.asset.state !== 'ready') {
            throw mediaContentError(
                `Media asset ${reference.assetId} is not available for publication`
            )
        }

        const candidates = asset.representations
            .filter(representation => representation.state === 'ready')
            .sort(
                (left, right) =>
                    Number(right.kind === 'original') - Number(left.kind === 'original')
            )
        const representation = candidates.find(candidate =>
            capability === undefined ? true : supportsMediaCapability(candidate, capability)
        )
        if (representation === undefined) {
            throw mediaContentError(
                `Media asset ${reference.assetId} has no ready representation compatible with field ${reference.bindingId}`
            )
        }

        const accessibilityText =
            reference.accessibilityText ?? asset.asset.defaultAccessibilityText
        if (capability?.accessibilityTextRequired && accessibilityText === null) {
            throw mediaContentError(
                `Media field ${reference.bindingId} requires accessibility text for asset ${reference.assetId}`
            )
        }
        if (capability?.publicUrlRequired && !publicMediaUrlAvailable) {
            throw mediaContentError(
                `Media field ${reference.bindingId} requires public media delivery, which is not configured`
            )
        }

        const totalBytes = totalBytesByBinding.get(reference.bindingId) ?? 0
        const nextTotalBytes = totalBytes + (representation.byteSize ?? 0)
        if (capability?.maxTotalBytes !== undefined && nextTotalBytes > capability.maxTotalBytes) {
            throw mediaContentError(
                `Media field ${reference.bindingId} exceeds its total byte limit`
            )
        }
        totalBytesByBinding.set(reference.bindingId, nextTotalBytes)

        resolved.push({ reference, representation, accessibilityText })
    }

    return resolved
}

function supportsMediaCapability(
    representation: MediaRepresentation,
    capability: MediaFieldCapability
): boolean {
    if (
        representation.family === null ||
        representation.detectedContentType === null ||
        representation.byteSize === null ||
        !capability.families.includes(representation.family) ||
        !capability.mimeTypes.some(pattern =>
            matchesMimeType(representation.detectedContentType!, pattern)
        )
    ) {
        return false
    }
    if (
        capability.maxBytesPerItem !== undefined &&
        representation.byteSize > capability.maxBytesPerItem
    ) {
        return false
    }
    if (
        capability.dimensions?.minWidth !== undefined &&
        (representation.width === null || representation.width < capability.dimensions.minWidth)
    ) {
        return false
    }
    if (
        capability.dimensions?.maxWidth !== undefined &&
        (representation.width === null || representation.width > capability.dimensions.maxWidth)
    ) {
        return false
    }
    if (
        capability.dimensions?.minHeight !== undefined &&
        (representation.height === null || representation.height < capability.dimensions.minHeight)
    ) {
        return false
    }
    if (
        capability.dimensions?.maxHeight !== undefined &&
        (representation.height === null || representation.height > capability.dimensions.maxHeight)
    ) {
        return false
    }
    if (
        capability.duration?.minMilliseconds !== undefined &&
        (representation.durationMs === null ||
            representation.durationMs < capability.duration.minMilliseconds)
    ) {
        return false
    }
    if (
        capability.duration?.maxMilliseconds !== undefined &&
        (representation.durationMs === null ||
            representation.durationMs > capability.duration.maxMilliseconds)
    ) {
        return false
    }
    return true
}

function matchesMimeType(contentType: string, pattern: string): boolean {
    const normalizedContentType = contentType.toLowerCase()
    const normalizedPattern = pattern.toLowerCase()
    return normalizedPattern.endsWith('/*')
        ? normalizedContentType.startsWith(normalizedPattern.slice(0, -1))
        : normalizedContentType === normalizedPattern
}

function mediaContentError(message: string): DomainInvariantError {
    return new DomainInvariantError('invalid_content', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function contentHash(value: TargetContent): string {
    return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function canonicalJson(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value)
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
    if (value !== null && typeof value === 'object') {
        if (seen.has(value)) {
            throw new DomainInvariantError('invalid_content', 'Content must not contain cycles')
        }
        seen.add(value)
    }
    if (Array.isArray(value)) {
        const serialized = `[${value.map(item => canonicalJson(item, seen)).join(',')}]`
        seen.delete(value)
        return serialized
    }
    if (isRecord(value)) {
        const serialized = `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`)
            .join(',')}}`
        seen.delete(value)
        return serialized
    }
    throw new DomainInvariantError('invalid_content', 'Content must contain only JSON values')
}

function requirePositiveRevision(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new DomainInvariantError(
            'invalid_input',
            'expectedRevision must be a positive safe integer'
        )
    }
    return value
}
