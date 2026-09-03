import {
    ChannelProfileCompiler,
    DomainInvariantError,
    createJob,
    extractTargetMediaReferences,
    requireNonBlank,
    type Channel,
    type ChannelProfileImpactAssessment,
    type ChannelProfileDefinition,
    type ChannelProfileVersionState,
    type DeliveryMode,
    type MediaFieldCapability,
    type MediaRepresentation,
    type Post,
    type Publication,
    type PublicationReviewState,
    type SourceContent,
    type TargetContent,
    type TargetMediaReference,
    type Timestamp,
    type ValidationIssue,
} from '@herald/core'

import type { HeraldDatabase } from './client'
import { createChannelProfileStore } from './manual-store/channel-profile-store'
import { isRecord, parseProfile } from './manual-store/content-codec'
import { toAuditEvent, toProfileVersion, toPublication, toPublisher } from './manual-store/mappers'
import { createProjectChannelStore } from './manual-store/project-channel-store'
import { createPublicationAuthoringStore } from './manual-store/publication-authoring-store'
import { createPublicationCreationStore } from './manual-store/publication-creation-store'
import { createPublicationOutcomeStore } from './manual-store/publication-outcome-store'
import type {
    ActorRow,
    AuditEventRow,
    PostSourceRow,
    ProfileRow,
    PublicationChannelRow,
    PublicationRow,
    ResolvedTargetMedia,
    TargetRevisionMediaRow,
} from './manual-store/rows'
import { publicationColumns } from './manual-store/sql-fragments'
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

export function createManualStore(database: HeraldDatabase, options: ManualStoreOptions = {}) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const profileCompiler = new ChannelProfileCompiler()
    const media = options.media
    const publicMediaUrlAvailable = options.publicMediaUrlAvailable ?? false
    const projectChannelStore = createProjectChannelStore(database, { now, createId })

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
    const loadPublicationByIdStatement = client.query<
        PublicationRow,
        [projectId: string, publicationId: string]
    >(`
        select ${publicationColumns}
        from publications
        where project_id = ?1
          and id = ?2
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

    const channelProfileStore = createChannelProfileStore(database, {
        now,
        createId,
        profileCompiler,
        loadActor: (projectId, subjectId) => loadActorStatement.get(projectId, subjectId),
        loadChannel: (projectId, channelId) => loadChannelStatement.get(projectId, channelId),
        loadProfile: (projectId, profileId) => loadProfileStatement.get(projectId, profileId),
        parseProfile,
        toProfileVersion,
        validateWorkingDraftMedia: (profile, content, projectId, subjectId) =>
            assessWorkingDraftMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        validatePinnedTargetMedia: (profile, content, projectId, subjectId, pinnedMedia) =>
            assessPinnedTargetMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                pinnedMedia,
                publicMediaUrlAvailable
            ),
        updateWorkingDraftAssessment: input =>
            updateWorkingDraftAssessmentStatement.run(
                input.reviewState,
                input.issuesJson,
                input.profileVersionId,
                input.updatedByActorId,
                input.updatedAt,
                input.projectId,
                input.publicationId
            ).changes === 1,
        updatePublicationAssessment: input =>
            updatePublicationAssessmentStatement.run(
                input.reviewState,
                input.issuesJson,
                input.profileVersionId,
                input.updatedAt,
                input.actorId,
                input.projectId,
                input.publicationId
            ).changes === 1,
        loadActiveJob: (projectId, publicationId) =>
            loadActiveJobStatement.get(projectId, publicationId),
        cancelPendingJob: (projectId, jobId, completedAt) =>
            cancelPendingJobStatement.run(completedAt, projectId, jobId).changes === 1,
        ensureAutomaticJob: ({ projectId, publicationId, channel, timestamp }) => {
            const publicationRow = loadPublicationByIdStatement.get(projectId, publicationId)
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
            insertJobStatement.run(job.id, job.projectId, job.publicationId, job.runAt, timestamp)
        },
        insertAuditEvent: input =>
            insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            ),
    })

    const publicationAuthoringStore = createPublicationAuthoringStore(database, {
        now,
        createId,
        profileCompiler,
        loadActor: (projectId, subjectId) => loadActorStatement.get(projectId, subjectId),
        loadPublication: (projectId, publicationId) =>
            loadPublicationByIdStatement.get(projectId, publicationId),
        loadPostSource: (projectId, postId) => loadPostSourceStatement.get(projectId, postId),
        loadChannel: (projectId, channelId) => loadChannelStatement.get(projectId, channelId),
        loadProfile: (projectId, profileId) => loadProfileStatement.get(projectId, profileId),
        loadActiveJob: (projectId, publicationId) =>
            loadActiveJobStatement.get(projectId, publicationId),
        assessWorkingDraftMedia: (profile, content, projectId, subjectId) =>
            assessWorkingDraftMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        resolveTargetMedia: (profile, content, projectId, subjectId) =>
            resolveTargetMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        updatePendingJob: (projectId, jobId, runAt, updatedAt) =>
            updatePendingJobStatement.run(runAt, updatedAt, projectId, jobId).changes === 1,
        cancelPendingJob: (projectId, jobId, completedAt) =>
            cancelPendingJobStatement.run(completedAt, projectId, jobId).changes === 1,
        insertTargetRevision: input =>
            insertTargetRevisionStatement.run(
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
        insertTargetRevisionMedia: input =>
            insertTargetRevisionMediaStatement.run(
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
        insertJob: input =>
            insertJobStatement.run(
                input.id,
                input.projectId,
                input.publicationId,
                input.runAt,
                input.createdAt
            ),
        insertAuditEvent: input =>
            insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            ),
    })

    const publicationOutcomeStore = createPublicationOutcomeStore(database, {
        now,
        createId,
        loadActor: (projectId, subjectId) => loadActorStatement.get(projectId, subjectId),
        loadPublication: (projectId, publicationId) =>
            loadPublicationByIdStatement.get(projectId, publicationId),
        insertAuditEvent: input =>
            insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            ),
    })

    const publicationCreationStore = createPublicationCreationStore(database, {
        now,
        createId,
        profileCompiler,
        loadActor: (projectId, subjectId) => loadActorStatement.get(projectId, subjectId),
        loadChannel: (projectId, channelId) => loadChannelStatement.get(projectId, channelId),
        loadProfile: (projectId, profileId) => loadProfileStatement.get(projectId, profileId),
        assessWorkingDraftMedia: (profile, content, projectId, subjectId) =>
            assessWorkingDraftMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        resolveTargetMedia: (profile, content, projectId, subjectId) =>
            resolveTargetMedia(
                profile,
                content,
                projectId,
                subjectId,
                media,
                publicMediaUrlAvailable
            ),
        insertJob: input =>
            insertJobStatement.run(
                input.id,
                input.projectId,
                input.publicationId,
                input.runAt,
                input.createdAt
            ),
        insertAuditEvent: input =>
            insertAuditEventStatement.run(
                input.id,
                input.projectId,
                input.actorId,
                input.action,
                input.entityType,
                input.entityId,
                input.metadataJson,
                input.createdAt
            ),
    })

    return {
        ...projectChannelStore,
        ...channelProfileStore,
        ...publicationCreationStore,
        ...publicationAuthoringStore,
        ...publicationOutcomeStore,

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
