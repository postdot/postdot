import { createHash } from 'node:crypto'

import {
    adaptSourceContentToProfile,
    ChannelProfileCompiler,
    createManualChannelProfile,
    DomainInvariantError,
    createActor,
    createChannel,
    createJob,
    createPost,
    createProject,
    createPublication,
    requireNonBlank,
    requireTimestamp,
    transitionPublication,
    type Actor,
    type Channel,
    type ChannelProfileDefinition,
    type DeliveryMode,
    type Post,
    type Project,
    type Publication,
    type Publisher,
    type PublicationReviewState,
    type SourceContent,
    type TargetContent,
    type Timestamp,
    type ValidationIssue,
    validateSourceContent,
} from '@herald/core'

import type { HeraldDatabase } from './client'

export interface ManualStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
}

export interface CreateProjectInput {
    readonly name: string
    readonly subjectId: string
    readonly displayName: string
}

export interface CreateChannelInput {
    readonly projectId: string
    readonly subjectId: string
    readonly name: string
    readonly profile?: ChannelProfileDefinition
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

export interface PromotePublicationDraftInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
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

export interface CreatedProject {
    readonly project: Project
    readonly actor: Actor
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
    readonly content: TargetContent
    readonly reviewState: PublicationReviewState
    readonly validationIssues: readonly Record<string, unknown>[]
    readonly revision: number
    readonly updatedByActorId: string
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
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

interface ProjectRow {
    readonly id: string
    readonly name: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface ActorRow {
    readonly id: string
    readonly projectId: string
    readonly kind: Actor['kind']
    readonly subjectId: string | null
    readonly displayName: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface ChannelRow {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly profileId: string
    readonly profileVersionId: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface PublicationChannelRow extends ChannelRow {
    readonly publisherId: string | null
    readonly publisherKind: string | null
    readonly publisherCreatedAt: number | null
    readonly publisherUpdatedAt: number | null
}

interface PublicationRow {
    readonly id: string
    readonly projectId: string
    readonly postId: string
    readonly channelId: string
    readonly targetRevisionId: string | null
    readonly deliveryMode: DeliveryMode
    readonly reviewState: PublicationReviewState
    readonly state: Publication['state']
    readonly scheduledAt: number | null
    readonly publishedAt: number | null
    readonly externalId: string | null
    readonly externalUrl: string | null
    readonly errorMessage: string | null
    readonly createdByActorId: string
    readonly scheduledByActorId: string | null
    readonly stateChangedByActorId: string
    readonly publishedByActorId: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface ProfileRow {
    readonly id: string
    readonly projectId: string
    readonly channelId: string
    readonly profileJson: string
}

interface PostSourceRow {
    readonly id: string
    readonly projectId: string
    readonly sourceContentJson: string
    readonly sourceRevision: number
}

interface WorkingDraftRow {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly profileVersionId: string
    readonly sourceRevision: number
    readonly contentJson: string
    readonly reviewState: PublicationReviewState
    readonly validationIssuesJson: string
    readonly revision: number
    readonly updatedByActorId: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface DuePublicationRow extends PublicationRow {
    readonly postTitle: string | null
    readonly channelName: string
    readonly targetContentJson: string
}

interface AuditEventRow {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly action: string
    readonly entityType: string
    readonly entityId: string
    readonly metadataJson: string | null
    readonly createdAt: number
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
    publications.created_at as createdAt,
    publications.updated_at as updatedAt
`

export function createManualStore(database: HeraldDatabase, options: ManualStoreOptions = {}) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const profileCompiler = new ChannelProfileCompiler()

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
               profile_json as profileJson
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
    const loadWorkingDraftStatement = client.query<
        WorkingDraftRow,
        [projectId: string, publicationId: string]
    >(`
        select id,
               project_id as projectId,
               publication_id as publicationId,
               profile_version_id as profileVersionId,
               source_revision as sourceRevision,
               content_json as contentJson,
               review_state as reviewState,
               validation_issues_json as validationIssuesJson,
               revision,
               updated_by_actor_id as updatedByActorId,
               created_at as createdAt,
               updated_at as updatedAt
        from publication_working_drafts
        where project_id = ?1
          and publication_id = ?2
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

    const insertProjectStatement = client.query<void, [id: string, name: string, now: number]>(`
        insert into projects (id, name, created_at, updated_at)
        values (?1, ?2, ?3, ?3)
    `)
    const insertActorStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            kind: Actor['kind'],
            subjectId: string | null,
            displayName: string,
            now: number,
        ]
    >(`
        insert into actors (id, project_id, kind, subject_id, display_name, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `)
    const insertChannelStatement = client.query<
        void,
        [id: string, projectId: string, name: string, profileVersionId: string, now: number]
    >(`
        insert into channels (id, project_id, name, profile_version_id, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?5)
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
            profile_json,
            profile_hash,
            schema_hash,
            created_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?10, ?11, ?11)
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
            created_at,
            updated_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
    `)
    const insertWorkingDraftStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            publicationId: string,
            profileVersionId: string,
            sourceRevision: number,
            contentJson: string,
            reviewState: PublicationReviewState,
            validationIssuesJson: string,
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
            content_json,
            review_state,
            validation_issues_json,
            revision,
            updated_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?10)
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
            content_json,
            content_hash,
            profile_hash,
            schema_hash,
            validation_issues_json,
            created_by_actor_id,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
            contentJson: string,
            reviewState: PublicationReviewState,
            validationIssuesJson: string,
            updatedByActorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
            expectedRevision: number,
        ]
    >(`
        update publication_working_drafts
        set source_revision = ?1,
            content_json = ?2,
            review_state = ?3,
            validation_issues_json = ?4,
            revision = revision + 1,
            updated_by_actor_id = ?5,
            updated_at = ?6
        where project_id = ?7
          and publication_id = ?8
          and revision = ?9
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
    const listProjectsStatement = client.query<ProjectRow, [subjectId: string]>(`
        select distinct projects.id,
               projects.name,
               projects.created_at as createdAt,
               projects.updated_at as updatedAt
        from projects
        inner join actors
            on actors.project_id = projects.id
           and actors.kind = 'human'
           and actors.subject_id = ?1
        order by projects.created_at, projects.id
    `)
    const listChannelsStatement = client.query<ChannelRow, [projectId: string]>(`
        select channels.id,
               channels.project_id as projectId,
               channels.name,
               channel_profile_versions.profile_id as profileId,
               channels.profile_version_id as profileVersionId,
               channels.created_at as createdAt,
               channels.updated_at as updatedAt
        from channels
        inner join channel_profile_versions
            on channel_profile_versions.project_id = channels.project_id
           and channel_profile_versions.channel_id = channels.id
           and channel_profile_versions.id = channels.profile_version_id
        where channels.project_id = ?1
        order by channels.created_at, channels.id
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

    const createProjectTransaction = client.transaction(
        (input: CreateProjectInput): CreatedProject => {
            const timestamp = requireTimestamp(now(), 'now')
            const project = createProject({
                id: createId(),
                name: input.name,
                now: timestamp,
            })
            const actor = createActor({
                id: createId(),
                project,
                kind: 'human',
                subjectId: input.subjectId,
                displayName: input.displayName,
                now: timestamp,
            })
            const systemActor = createActor({
                id: `system:${project.id}`,
                project,
                kind: 'system',
                subjectId: null,
                displayName: 'Herald Worker',
                now: timestamp,
            })

            insertProjectStatement.run(project.id, project.name, timestamp)
            insertActorStatement.run(
                actor.id,
                project.id,
                actor.kind,
                actor.subjectId,
                actor.displayName,
                timestamp
            )
            insertActorStatement.run(
                systemActor.id,
                project.id,
                systemActor.kind,
                systemActor.subjectId,
                systemActor.displayName,
                timestamp
            )
            insertAuditEventStatement.run(
                createId(),
                project.id,
                actor.id,
                'project.created',
                'project',
                project.id,
                JSON.stringify({ name: project.name }),
                timestamp
            )

            return { project, actor }
        }
    )

    const createChannelTransaction = client.transaction(
        (input: CreateChannelInput): Channel | null => {
            const actor = loadActorStatement.get(input.projectId, input.subjectId)
            const projectRow = loadProjectStatement.get(input.projectId)
            if (actor === null || projectRow === null) return null

            const timestamp = requireTimestamp(now(), 'now')
            const project = toProject(projectRow)
            const profileResult = profileCompiler.compile(
                input.profile ?? createManualChannelProfile()
            )
            if (!profileResult.ok) {
                throw invalidProfileError(profileResult.issues)
            }
            const profile = profileResult.value.profile
            const profileVersionId = createId()
            const channel = createChannel({
                id: createId(),
                project,
                name: input.name,
                profileId: profile.id,
                profileVersionId,
                now: timestamp,
            })

            insertChannelStatement.run(
                channel.id,
                project.id,
                channel.name,
                channel.profileVersionId,
                timestamp
            )
            insertProfileStatement.run(
                profileVersionId,
                project.id,
                channel.id,
                profile.id,
                profile.version,
                profile.origin,
                JSON.stringify(profile),
                profile.profileHash,
                profile.schemaHash,
                actor.id,
                timestamp
            )
            insertAuditEventStatement.run(
                createId(),
                project.id,
                actor.id,
                'channel.created',
                'channel',
                channel.id,
                JSON.stringify({
                    name: channel.name,
                    profileId: profile.id,
                    profileVersion: profile.version,
                }),
                timestamp
            )

            return channel
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
                const reviewState: PublicationReviewState = validation.ok
                    ? 'compatible'
                    : 'review_required'
                if (publicationInput.scheduledAt != null && !validation.ok) {
                    throw invalidTargetContentError(validation.issues)
                }
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
                    validationIssues: validation.issues,
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
                    timestamp
                )
                insertWorkingDraftStatement.run(
                    entry.workingDraftId,
                    project.id,
                    publication.id,
                    entry.profileVersionId,
                    post.sourceRevision,
                    entry.targetContentJson,
                    publication.reviewState,
                    JSON.stringify(entry.validationIssues),
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
                        entry.targetContentJson,
                        contentHash(entry.targetContent),
                        entry.profile.profileHash,
                        entry.profile.schemaHash,
                        JSON.stringify(entry.validationIssues),
                        actor.id,
                        timestamp
                    )
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
            if (
                input.sourceContent !== undefined &&
                postRow.sourceRevision !== draftRow.sourceRevision
            ) {
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
            const reviewState: PublicationReviewState = validation.ok
                ? 'compatible'
                : 'review_required'
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
                targetContentJson,
                reviewState,
                JSON.stringify(validation.issues),
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

    const promotePublicationDraftTransaction = client.transaction(
        (input: PromotePublicationDraftInput): Publication | null => {
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
                    `Cannot promote a ${publicationRow.state} publication`
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
                contentJson,
                contentHash(content),
                profileResult.value.profile.profileHash,
                profileResult.value.profile.schemaHash,
                JSON.stringify(validation.issues),
                actorRow.id,
                timestamp
            )

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
        createProject(input: CreateProjectInput): CreatedProject {
            return createProjectTransaction.immediate({
                ...input,
                name: requireNonBlank(input.name, 'name'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                displayName: requireNonBlank(input.displayName, 'displayName'),
            })
        },

        listProjects(subjectId: string): Project[] {
            return listProjectsStatement.all(requireNonBlank(subjectId, 'subjectId')).map(toProject)
        },

        createChannel(input: CreateChannelInput): Channel | null {
            return createChannelTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                name: requireNonBlank(input.name, 'name'),
            })
        },

        listChannels(projectId: string, subjectId: string): Channel[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const actor = loadActorStatement.get(
                normalizedProjectId,
                requireNonBlank(subjectId, 'subjectId')
            )
            if (actor === null) return null

            return listChannelsStatement.all(normalizedProjectId).map(toChannel)
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

        savePublicationDraft(input: SavePublicationDraftInput): PublicationWorkingDraft | null {
            return savePublicationDraftTransaction.immediate({
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

function toProject(row: ProjectRow): Project {
    return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
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

function toChannel(row: ChannelRow): Channel {
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        profileId: row.profileId,
        profileVersionId: row.profileVersionId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
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
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toWorkingDraft(row: WorkingDraftRow): PublicationWorkingDraft {
    return {
        id: row.id,
        projectId: row.projectId,
        publicationId: row.publicationId,
        profileVersionId: row.profileVersionId,
        sourceRevision: row.sourceRevision,
        content: parseJsonObject(row.contentJson, 'publication draft content'),
        reviewState: row.reviewState,
        validationIssues: parseJsonArray(row.validationIssuesJson, 'publication validation issues'),
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
