import {
    ChannelProfileCompiler,
    DomainInvariantError,
    extractTargetMediaReferences,
    requireNonBlank,
    requireTimestamp,
    type CompleteExternalEffectInput,
    type ExpiredClaimRecovery,
    type Job,
    type PersistedEffectOutcome,
    type TargetContent,
    type ChannelProfileDefinition,
    type PublicationState,
} from '@postdot/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostbotDatabase,
} from './client'
import {
    automaticExecutionAuditActions,
    serializeAutomaticExecutionAuditMetadata,
    type AutomaticExecutionAuditAction,
} from './execution-audit'

interface ClaimDueJobInput {
    readonly actorId: string
    readonly claimToken: string
    readonly leaseExpiresAt: number
    readonly now: number
}

interface RunningJobRow {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly runAt: number
    readonly attempts: number
    readonly claimToken: string
    readonly claimedByActorId: string
    readonly leaseExpiresAt: number
    readonly effectStartedAt: number | null
    readonly publicationState: PublicationState
}

interface CancellableJobRow {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly runAt: number
    readonly attempts: number
}

interface SystemActorRow {
    readonly id: string
}

interface ExecutionRevisionRow {
    readonly id: string
    readonly targetRevisionId: string
    readonly mediaReferenceCount: number
}

interface TargetRevisionMediaRow {
    readonly id: string
    readonly projectId: string
    readonly targetRevisionId: string
    readonly assetId: string
    readonly representationId: string
    readonly position: number
    readonly contentPath: string
    readonly role: string | null
    readonly accessibilityText: string | null
}

interface TargetRevisionContentRow {
    readonly profileJson: string
    readonly contentJson: string
}

const claimedJobColumns = `
    id,
    project_id as projectId,
    publication_id as publicationId,
    state,
    run_at as runAt,
    attempts,
    claim_token as claimToken,
    claimed_by_actor_id as claimedByActorId,
    claimed_at as claimedAt,
    lease_expires_at as leaseExpiresAt,
    effect_started_at as effectStartedAt,
    started_at as startedAt,
    completed_at as completedAt,
    error_message as errorMessage,
    created_at as createdAt,
    updated_at as updatedAt
`

export function createWorkflowStore(database: PostbotDatabase) {
    const client = database.$client
    const createId = () => crypto.randomUUID()
    const profileCompiler = new ChannelProfileCompiler()

    const listProjectIdsStatement = client.query<{ id: string }, []>(`
        select id
        from projects
        order by created_at, id
    `)
    const loadProjectStatement = client.query<{ id: string }, [projectId: string]>(`
        select id
        from projects
        where id = ?1
    `)
    const loadSystemActorStatement = client.query<SystemActorRow, [projectId: string]>(`
        select id
        from actors
        where project_id = ?1
          and kind = 'system'
        order by created_at, id
        limit 1
    `)
    const insertSystemActorStatement = client.query<
        void,
        [id: string, projectId: string, displayName: string, now: number]
    >(`
        insert into actors (id, project_id, kind, display_name, created_at, updated_at)
        values (?1, ?2, 'system', ?3, ?4, ?4)
        on conflict(id) do nothing
    `)
    const loadPublisherKindStatement = client.query<
        { readonly kind: string },
        [projectId: string, publicationId: string]
    >(`
        select publishers.kind
        from publications
        inner join publishers
            on publishers.project_id = publications.project_id
           and publishers.channel_id = publications.channel_id
        where publications.project_id = ?1
          and publications.id = ?2
        limit 1
    `)
    const insertExecutionAuditEventStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            action: AutomaticExecutionAuditAction,
            publicationId: string,
            metadataJson: string,
            correlationId: string,
            occurredAt: number,
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
            event_version,
            correlation_id,
            created_at
        ) values (?1, ?2, ?3, ?4, 'publication', ?5, ?6, 1, ?7, ?8)
    `)

    const insertExecutionAuditEvent = (input: {
        readonly id: string
        readonly projectId: string
        readonly actorId: string
        readonly action: AutomaticExecutionAuditAction
        readonly publicationId: string
        readonly jobId: string
        readonly attempt: number
        readonly occurredAt: number
        readonly details?: Readonly<Record<string, unknown>>
    }): void => {
        recordDatabaseCommitProject(database, input.projectId)
        insertExecutionAuditEventStatement.run(
            input.id,
            input.projectId,
            input.actorId,
            input.action,
            input.publicationId,
            serializeAutomaticExecutionAuditMetadata({
                ...input.details,
                deliveryMode: 'automatic',
                provider:
                    loadPublisherKindStatement.get(input.projectId, input.publicationId)?.kind ??
                    null,
                jobId: input.jobId,
                attempt: input.attempt,
                occurredAt: input.occurredAt,
            }),
            input.jobId,
            input.occurredAt
        )
    }

    const nextEventStatement = client.query<{ eventAt: number | null }, []>(`
        select min(event_at) as eventAt
        from (
            select jobs.run_at as event_at
            from jobs
            inner join publications
                on publications.project_id = jobs.project_id
               and publications.id = jobs.publication_id
            inner join publishers
                on publishers.project_id = publications.project_id
               and publishers.channel_id = publications.channel_id
            inner join publication_target_revisions as target_revisions
                on target_revisions.project_id = publications.project_id
               and target_revisions.id = publications.target_revision_id
               and target_revisions.publication_id = publications.id
            inner join channel_profile_versions as channel_profiles
                on channel_profiles.project_id = target_revisions.project_id
               and channel_profiles.id = target_revisions.profile_version_id
            where jobs.state = 'pending'
              and publications.delivery_mode = 'automatic'
              and publications.review_state = 'compatible'
              and publications.target_revision_id is not null
              and channel_profiles.state <> 'disabled'

            union all

            select jobs.lease_expires_at as event_at
            from jobs
            where jobs.state = 'running'
        )
    `)

    const claimNextDueStatement = client.query<
        Job,
        [claimToken: string, actorId: string, now: number, leaseExpiresAt: number]
    >(`
        update jobs
        set state = 'running',
            attempts = attempts + 1,
            claim_token = ?1,
            claimed_by_actor_id = ?2,
            claimed_at = ?3,
            lease_expires_at = ?4,
            effect_started_at = null,
            started_at = ?3,
            completed_at = null,
            error_message = null,
            updated_at = ?3
        where id = (
            select jobs.id
            from jobs
            inner join publications
                on publications.project_id = jobs.project_id
               and publications.id = jobs.publication_id
            inner join publishers
                on publishers.project_id = publications.project_id
               and publishers.channel_id = publications.channel_id
            inner join publication_target_revisions as target_revisions
                on target_revisions.project_id = publications.project_id
               and target_revisions.id = publications.target_revision_id
               and target_revisions.publication_id = publications.id
            inner join channel_profile_versions as channel_profiles
                on channel_profiles.project_id = target_revisions.project_id
               and channel_profiles.id = target_revisions.profile_version_id
            inner join actors
                on actors.project_id = jobs.project_id
               and actors.id = ?2
               and actors.kind = 'system'
            where jobs.state = 'pending'
              and jobs.run_at <= ?3
              and publications.state in ('scheduled', 'ready')
              and publications.delivery_mode = 'automatic'
              and publications.review_state = 'compatible'
              and publications.target_revision_id is not null
              and channel_profiles.state <> 'disabled'
            order by jobs.run_at, jobs.id
            limit 1
        )
          and state = 'pending'
        returning ${claimedJobColumns}
    `)

    const claimNextDueTransaction = createDatabaseTransaction(
        database,
        (input: ClaimDueJobInput): Job | null => {
            const claimed = claimNextDueStatement.get(
                input.claimToken,
                input.actorId,
                input.now,
                input.leaseExpiresAt
            )
            if (claimed === null) return null

            insertExecutionAuditEvent({
                id: createId(),
                projectId: claimed.projectId,
                actorId: input.actorId,
                action: automaticExecutionAuditActions.claimed,
                publicationId: claimed.publicationId,
                jobId: claimed.id,
                attempt: claimed.attempts,
                occurredAt: input.now,
                details: {
                    fromState: 'pending',
                    toState: 'running',
                    leaseExpiresAt: input.leaseExpiresAt,
                    runAt: claimed.runAt,
                },
            })

            return claimed
        }
    )

    const loadRunningJobStatement = client.query<
        RunningJobRow,
        [jobId: string, claimToken: string, now: number]
    >(`
        select jobs.id,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId,
               jobs.run_at as runAt,
               jobs.attempts as attempts,
               jobs.claim_token as claimToken,
               jobs.claimed_by_actor_id as claimedByActorId,
               jobs.lease_expires_at as leaseExpiresAt,
               jobs.effect_started_at as effectStartedAt,
               publications.state as publicationState
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        where jobs.id = ?1
          and jobs.state = 'running'
          and jobs.claim_token = ?2
          and jobs.lease_expires_at > ?3
          and jobs.effect_started_at is null
    `)

    const promoteScheduledPublicationStatement = client.query<
        { changes: number },
        [now: number, actorId: string, projectId: string, publicationId: string]
    >(`
        update publications
        set state = 'ready',
            error_message = null,
            state_changed_by_actor_id = ?2,
            updated_at = ?1
        where project_id = ?3
          and id = ?4
          and state = 'scheduled'
    `)

    const startPublishingStatement = client.query<
        { changes: number },
        [now: number, actorId: string, projectId: string, publicationId: string]
    >(`
        update publications
        set state = 'publishing',
            error_message = null,
            state_changed_by_actor_id = ?2,
            updated_at = ?1
        where project_id = ?3
          and id = ?4
          and state = 'ready'
    `)

    const markEffectStartedStatement = client.query<
        { changes: number },
        [now: number, jobId: string, claimToken: string]
    >(`
        update jobs
        set effect_started_at = ?1,
            updated_at = ?1
        where id = ?2
          and state = 'running'
          and claim_token = ?3
          and lease_expires_at > ?1
          and effect_started_at is null
    `)

    const insertExecutionRevisionStatement = client.query<
        { changes: number },
        [id: string, jobId: string, claimToken: string, createdAt: number]
    >(`
        insert into publication_execution_revisions (
            id,
            project_id,
            job_id,
            publication_id,
            target_revision_id,
            profile_version_id,
            delivery_mode,
            media_reference_count,
            content_json,
            content_hash,
            profile_hash,
            schema_hash,
            created_at
        )
        select ?1,
               jobs.project_id,
               jobs.id,
               jobs.publication_id,
               revisions.id,
               revisions.profile_version_id,
               revisions.delivery_mode,
               revisions.media_reference_count,
               revisions.content_json,
               revisions.content_hash,
               revisions.profile_hash,
               revisions.schema_hash,
               ?4
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        inner join publication_target_revisions as revisions
            on revisions.project_id = publications.project_id
           and revisions.id = publications.target_revision_id
           and revisions.publication_id = publications.id
        inner join channel_profile_versions as channel_profiles
            on channel_profiles.project_id = revisions.project_id
           and channel_profiles.id = revisions.profile_version_id
           and channel_profiles.state <> 'disabled'
        where jobs.id = ?2
          and jobs.state = 'running'
          and jobs.claim_token = ?3
          and jobs.effect_started_at is null
          and publications.state in ('scheduled', 'ready')
          and publications.delivery_mode = 'automatic'
          and publications.review_state = 'compatible'
          and revisions.delivery_mode = 'automatic'
        on conflict(project_id, job_id) do nothing
    `)
    const loadExecutionRevisionStatement = client.query<
        ExecutionRevisionRow,
        [projectId: string, jobId: string]
    >(`
        select id,
               target_revision_id as targetRevisionId,
               media_reference_count as mediaReferenceCount
        from publication_execution_revisions
        where project_id = ?1
          and job_id = ?2
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
    const listExecutionRevisionMediaCountStatement = client.query<
        { count: number },
        [projectId: string, executionRevisionId: string]
    >(`
        select count(*) as count
        from publication_execution_revision_media
        where project_id = ?1
          and execution_revision_id = ?2
    `)
    const loadTargetRevisionContentStatement = client.query<
        TargetRevisionContentRow,
        [projectId: string, targetRevisionId: string]
    >(`
        select channel_profiles.profile_json as profileJson,
               revisions.content_json as contentJson
        from publication_target_revisions as revisions
        inner join channel_profile_versions as channel_profiles
            on channel_profiles.project_id = revisions.project_id
           and channel_profiles.id = revisions.profile_version_id
           and channel_profiles.state <> 'disabled'
        where revisions.project_id = ?1
          and revisions.id = ?2
    `)
    const insertExecutionRevisionMediaStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            executionRevisionId: string,
            targetRevisionMediaId: string,
            assetId: string,
            representationId: string,
            position: number,
            contentPath: string,
            role: string | null,
            accessibilityText: string | null,
            createdAt: number,
        ]
    >(`
        insert into publication_execution_revision_media (
            id,
            project_id,
            execution_revision_id,
            target_revision_media_id,
            asset_id,
            representation_id,
            position,
            content_path,
            role,
            accessibility_text,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    `)

    const startExternalEffectTransaction = createDatabaseTransaction(
        database,
        (jobId: string, claimToken: string, now: number): boolean => {
            const runningJob = loadRunningJobStatement.get(jobId, claimToken, now)
            if (runningJob === null) return false

            const executionRevisionId = createId()
            const pinned = insertExecutionRevisionStatement.run(
                executionRevisionId,
                jobId,
                claimToken,
                now
            )
            const executionRevision = loadExecutionRevisionStatement.get(
                runningJob.projectId,
                runningJob.id
            )
            if (executionRevision === null) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Job ${runningJob.id} has no valid target revision to execute`
                )
            }
            const targetMedia = listTargetRevisionMediaStatement.all(
                runningJob.projectId,
                executionRevision.targetRevisionId
            )
            assertTargetRevisionMediaMatchesContent(
                loadTargetRevisionContentStatement.get(
                    runningJob.projectId,
                    executionRevision.targetRevisionId
                ),
                targetMedia,
                executionRevision.targetRevisionId,
                executionRevision.mediaReferenceCount,
                profileCompiler
            )
            if (pinned.changes === 1) {
                for (const media of targetMedia) {
                    insertExecutionRevisionMediaStatement.run(
                        createId(),
                        media.projectId,
                        executionRevision.id,
                        media.id,
                        media.assetId,
                        media.representationId,
                        media.position,
                        media.contentPath,
                        media.role,
                        media.accessibilityText,
                        now
                    )
                }
            }
            const executionMediaCount = listExecutionRevisionMediaCountStatement.get(
                runningJob.projectId,
                executionRevision.id
            )?.count
            if (executionMediaCount !== executionRevision.mediaReferenceCount) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Execution revision ${executionRevision.id} has inconsistent media references`
                )
            }

            if (runningJob.publicationState === 'scheduled') {
                const promoted = promoteScheduledPublicationStatement.run(
                    now,
                    runningJob.claimedByActorId,
                    runningJob.projectId,
                    runningJob.publicationId
                )
                if (promoted.changes !== 1) {
                    throw new DomainInvariantError(
                        'invalid_transition',
                        `Publication ${runningJob.publicationId} could not become ready`
                    )
                }
            } else if (runningJob.publicationState !== 'ready') {
                return false
            }

            const publishing = startPublishingStatement.run(
                now,
                runningJob.claimedByActorId,
                runningJob.projectId,
                runningJob.publicationId
            )
            if (publishing.changes !== 1) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Publication ${runningJob.publicationId} could not start publishing`
                )
            }

            const effectStarted = markEffectStartedStatement.run(now, jobId, claimToken)
            if (effectStarted.changes !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    'The job claim changed before the effect boundary was committed'
                )
            }

            insertExecutionAuditEvent({
                id: createId(),
                projectId: runningJob.projectId,
                actorId: runningJob.claimedByActorId,
                action: automaticExecutionAuditActions.effectStarted,
                publicationId: runningJob.publicationId,
                jobId: runningJob.id,
                attempt: runningJob.attempts,
                occurredAt: now,
                details: {
                    fromState: runningJob.publicationState,
                    toState: 'publishing',
                    effectStartedAt: now,
                    runAt: runningJob.runAt,
                },
            })

            return true
        }
    )

    const loadCompletableJobStatement = client.query<
        RunningJobRow,
        [jobId: string, claimToken: string]
    >(`
        select jobs.id,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId,
               jobs.run_at as runAt,
               jobs.attempts as attempts,
               jobs.claim_token as claimToken,
               jobs.claimed_by_actor_id as claimedByActorId,
               jobs.lease_expires_at as leaseExpiresAt,
               jobs.effect_started_at as effectStartedAt,
               publications.state as publicationState
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        where jobs.id = ?1
          and jobs.state = 'running'
          and jobs.claim_token = ?2
          and jobs.effect_started_at is not null
          and publications.state = 'publishing'
    `)

    const publishPublicationStatement = client.query<
        { changes: number },
        [
            completedAt: number,
            actorId: string,
            externalId: string | null,
            externalUrl: string | null,
            projectId: string,
            publicationId: string,
        ]
    >(`
        update publications
        set state = 'published',
            published_at = ?1,
            published_by_actor_id = ?2,
            external_id = ?3,
            external_url = ?4,
            error_message = null,
            state_changed_by_actor_id = ?2,
            updated_at = ?1
        where project_id = ?5
          and id = ?6
          and state = 'publishing'
    `)

    const failPublicationStatement = client.query<
        { changes: number },
        [
            state: 'failed' | 'ambiguous',
            errorMessage: string,
            completedAt: number,
            actorId: string,
            projectId: string,
            publicationId: string,
        ]
    >(`
        update publications
        set state = ?1,
            error_message = ?2,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where project_id = ?5
          and id = ?6
          and state = 'publishing'
    `)

    const readyPublicationForRetryStatement = client.query<
        { changes: number },
        [completedAt: number, actorId: string, projectId: string, publicationId: string]
    >(`
        update publications
        set state = 'ready',
            error_message = null,
            state_changed_by_actor_id = ?2,
            updated_at = ?1
        where project_id = ?3
          and id = ?4
          and state = 'publishing'
    `)

    const succeedJobStatement = client.query<
        { changes: number },
        [completedAt: number, jobId: string, claimToken: string]
    >(`
        update jobs
        set state = 'succeeded',
            claim_token = null,
            lease_expires_at = null,
            completed_at = ?1,
            error_message = null,
            updated_at = ?1
        where id = ?2
          and state = 'running'
          and claim_token = ?3
          and effect_started_at is not null
    `)

    const failJobStatement = client.query<
        { changes: number },
        [errorMessage: string, completedAt: number, jobId: string, claimToken: string]
    >(`
        update jobs
        set state = 'failed',
            claim_token = null,
            lease_expires_at = null,
            completed_at = ?2,
            error_message = ?1,
            updated_at = ?2
        where id = ?3
          and state = 'running'
          and claim_token = ?4
          and effect_started_at is not null
    `)

    const retryJobStatement = client.query<
        { changes: number },
        [retryAt: number, completedAt: number, jobId: string, claimToken: string]
    >(`
        update jobs
        set state = 'pending',
            run_at = ?1,
            claim_token = null,
            claimed_by_actor_id = null,
            claimed_at = null,
            lease_expires_at = null,
            effect_started_at = null,
            started_at = null,
            completed_at = null,
            error_message = null,
            updated_at = ?2
        where id = ?3
          and state = 'running'
          and claim_token = ?4
          and effect_started_at is not null
    `)

    const completeExternalEffectTransaction = createDatabaseTransaction(
        database,
        (input: CompleteExternalEffectInput): PersistedEffectOutcome | null => {
            const job = loadCompletableJobStatement.get(input.jobId, input.claimToken)
            if (job === null) return null

            const completedAt = requireTimestamp(input.completedAt, 'completedAt')
            if (job.effectStartedAt === null || completedAt < job.effectStartedAt) {
                throw new DomainInvariantError(
                    'invalid_time',
                    'Completion cannot predate the external-effect boundary'
                )
            }
            let publicationChanges: number
            let jobChanges: number
            let persisted: PersistedEffectOutcome
            let auditAction: AutomaticExecutionAuditAction
            let auditDetails: Readonly<Record<string, unknown>>

            if (input.outcome.type === 'published') {
                const externalId = normalizeOptionalResult(input.outcome.externalId, 'externalId')
                const externalUrl = normalizeOptionalResult(
                    input.outcome.externalUrl,
                    'externalUrl'
                )
                publicationChanges = publishPublicationStatement.run(
                    completedAt,
                    job.claimedByActorId,
                    externalId,
                    externalUrl,
                    job.projectId,
                    job.publicationId
                ).changes
                jobChanges = succeedJobStatement.run(completedAt, job.id, job.claimToken).changes
                persisted = 'published'
                auditAction = automaticExecutionAuditActions.succeeded
                auditDetails = {
                    fromState: 'publishing',
                    toState: 'published',
                    outcome: input.outcome.type,
                    completedAt,
                    effectStartedAt: job.effectStartedAt,
                    runAt: job.runAt,
                    externalId,
                    externalUrl,
                }
            } else {
                const errorMessage = requireNonBlank(input.outcome.errorMessage, 'errorMessage')
                const retryAt =
                    (input.outcome.type === 'retryable_failure' ||
                        input.outcome.type === 'deferred') &&
                    input.retryAt != null
                        ? requireTimestamp(input.retryAt, 'retryAt')
                        : null

                if (retryAt !== null && retryAt < completedAt) {
                    throw new DomainInvariantError(
                        'invalid_time',
                        'A retry cannot predate its failure'
                    )
                }

                if (retryAt !== null) {
                    publicationChanges = readyPublicationForRetryStatement.run(
                        completedAt,
                        job.claimedByActorId,
                        job.projectId,
                        job.publicationId
                    ).changes
                    jobChanges = retryJobStatement.run(
                        retryAt,
                        completedAt,
                        job.id,
                        job.claimToken
                    ).changes
                    if (input.outcome.type === 'deferred') {
                        client
                            .query('update jobs set attempts = max(0, attempts - 1) where id = ?1')
                            .run(job.id)
                    }
                    persisted = 'retry_scheduled'
                    auditAction =
                        input.outcome.type === 'deferred'
                            ? automaticExecutionAuditActions.deferred
                            : automaticExecutionAuditActions.retryScheduled
                    auditDetails = {
                        fromState: 'publishing',
                        toState: 'ready',
                        outcome: input.outcome.type,
                        effectOccurred: false,
                        errorMessage,
                        completedAt,
                        effectStartedAt: job.effectStartedAt,
                        runAt: job.runAt,
                        retryAt,
                    }
                } else {
                    const publicationState =
                        input.outcome.type === 'ambiguous' ? 'ambiguous' : 'failed'
                    publicationChanges = failPublicationStatement.run(
                        publicationState,
                        errorMessage,
                        completedAt,
                        job.claimedByActorId,
                        job.projectId,
                        job.publicationId
                    ).changes
                    jobChanges = failJobStatement.run(
                        errorMessage,
                        completedAt,
                        job.id,
                        job.claimToken
                    ).changes
                    persisted = publicationState
                    auditAction =
                        publicationState === 'ambiguous'
                            ? automaticExecutionAuditActions.ambiguous
                            : automaticExecutionAuditActions.failed
                    auditDetails = {
                        fromState: 'publishing',
                        toState: publicationState,
                        outcome: input.outcome.type,
                        effectOccurred:
                            input.outcome.type === 'ambiguous'
                                ? undefined
                                : input.outcome.effectOccurred,
                        errorMessage,
                        completedAt,
                        effectStartedAt: job.effectStartedAt,
                        runAt: job.runAt,
                    }
                }
            }

            if (publicationChanges !== 1 || jobChanges !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not complete the external effect for job ${job.id}`
                )
            }

            insertExecutionAuditEvent({
                id: createId(),
                projectId: job.projectId,
                actorId: job.claimedByActorId,
                action: auditAction,
                publicationId: job.publicationId,
                jobId: job.id,
                attempt: job.attempts,
                occurredAt: completedAt,
                details: auditDetails,
            })

            return persisted
        }
    )

    const loadCancellableJobStatement = client.query<
        CancellableJobRow,
        [jobId: string, actorId: string]
    >(`
        select jobs.id,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId,
               jobs.run_at as runAt,
               jobs.attempts as attempts
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        inner join actors
            on actors.project_id = jobs.project_id
           and actors.id = ?2
        where jobs.id = ?1
          and jobs.state = 'pending'
          and publications.state in ('scheduled', 'ready')
    `)

    const cancelPublicationStatement = client.query<
        { changes: number },
        [now: number, actorId: string, projectId: string, publicationId: string]
    >(`
        update publications
        set state = 'cancelled',
            error_message = null,
            state_changed_by_actor_id = ?2,
            updated_at = ?1
        where project_id = ?3
          and id = ?4
          and state in ('scheduled', 'ready')
    `)

    const cancelJobStatement = client.query<{ changes: number }, [now: number, jobId: string]>(`
        update jobs
        set state = 'cancelled',
            completed_at = ?1,
            error_message = null,
            updated_at = ?1
        where id = ?2
          and state = 'pending'
    `)

    const cancelPendingJobTransaction = createDatabaseTransaction(
        database,
        (jobId: string, actorId: string, now: number): boolean => {
            const job = loadCancellableJobStatement.get(jobId, actorId)
            if (job === null) return false

            const publication = cancelPublicationStatement.run(
                now,
                actorId,
                job.projectId,
                job.publicationId
            )
            const cancelled = cancelJobStatement.run(now, job.id)

            if (publication.changes !== 1 || cancelled.changes !== 1) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Could not cancel pending job ${job.id}`
                )
            }

            insertExecutionAuditEvent({
                id: createId(),
                projectId: job.projectId,
                actorId,
                action: automaticExecutionAuditActions.cancelled,
                publicationId: job.publicationId,
                jobId: job.id,
                attempt: job.attempts,
                occurredAt: now,
                details: {
                    toState: 'cancelled',
                    cancelledAt: now,
                    runAt: job.runAt,
                },
            })

            return true
        }
    )

    const loadExpiredClaimsStatement = client.query<RunningJobRow, [now: number]>(`
        select jobs.id,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId,
               jobs.run_at as runAt,
               jobs.attempts as attempts,
               jobs.claim_token as claimToken,
               jobs.claimed_by_actor_id as claimedByActorId,
               jobs.lease_expires_at as leaseExpiresAt,
               jobs.effect_started_at as effectStartedAt,
               publications.state as publicationState
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        where jobs.state = 'running'
          and jobs.lease_expires_at <= ?1
        order by jobs.lease_expires_at, jobs.id
    `)

    const requeueExpiredClaimStatement = client.query<
        { changes: number },
        [now: number, jobId: string, claimToken: string]
    >(`
        update jobs
        set state = 'pending',
            run_at = ?1,
            claim_token = null,
            claimed_by_actor_id = null,
            claimed_at = null,
            lease_expires_at = null,
            effect_started_at = null,
            started_at = null,
            completed_at = null,
            error_message = null,
            updated_at = ?1
        where id = ?2
          and state = 'running'
          and claim_token = ?3
          and lease_expires_at <= ?1
          and effect_started_at is null
    `)

    const ambiguousError = 'Worker claim expired after the external-effect boundary'
    const markPublicationAmbiguousStatement = client.query<
        { changes: number },
        [now: number, actorId: string, projectId: string, publicationId: string]
    >(`
        update publications
        set state = 'ambiguous',
            error_message = '${ambiguousError}',
            state_changed_by_actor_id = ?2,
            updated_at = ?1
        where project_id = ?3
          and id = ?4
          and state = 'publishing'
    `)

    const failAmbiguousJobStatement = client.query<
        { changes: number },
        [now: number, jobId: string, claimToken: string]
    >(`
        update jobs
        set state = 'failed',
            claim_token = null,
            lease_expires_at = null,
            completed_at = ?1,
            error_message = '${ambiguousError}',
            updated_at = ?1
        where id = ?2
          and state = 'running'
          and claim_token = ?3
          and lease_expires_at <= ?1
          and effect_started_at is not null
    `)

    const recoverExpiredClaimsTransaction = createDatabaseTransaction(
        database,
        (now: number): ExpiredClaimRecovery => {
            const requeuedJobIds: string[] = []
            const ambiguousJobIds: string[] = []

            for (const claim of loadExpiredClaimsStatement.all(now)) {
                if (claim.effectStartedAt === null) {
                    const requeued = requeueExpiredClaimStatement.run(
                        now,
                        claim.id,
                        claim.claimToken
                    )
                    if (requeued.changes !== 1) {
                        throw new DomainInvariantError(
                            'claim_mismatch',
                            `Could not recover expired claim for job ${claim.id}`
                        )
                    }
                    insertExecutionAuditEvent({
                        id: createId(),
                        projectId: claim.projectId,
                        actorId: claim.claimedByActorId,
                        action: automaticExecutionAuditActions.claimRecovered,
                        publicationId: claim.publicationId,
                        jobId: claim.id,
                        attempt: claim.attempts,
                        occurredAt: now,
                        details: {
                            fromState: 'running',
                            toState: 'pending',
                            recoveredAt: now,
                            runAt: now,
                            reason: 'lease_expired_before_effect_boundary',
                        },
                    })
                    requeuedJobIds.push(claim.id)
                    continue
                }

                const publication = markPublicationAmbiguousStatement.run(
                    now,
                    claim.claimedByActorId,
                    claim.projectId,
                    claim.publicationId
                )
                if (publication.changes !== 1) {
                    throw new DomainInvariantError(
                        'invalid_transition',
                        `Publication ${claim.publicationId} is not publishing during recovery`
                    )
                }

                const failed = failAmbiguousJobStatement.run(now, claim.id, claim.claimToken)
                if (failed.changes !== 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not fail expired claim for job ${claim.id}`
                    )
                }
                insertExecutionAuditEvent({
                    id: createId(),
                    projectId: claim.projectId,
                    actorId: claim.claimedByActorId,
                    action: automaticExecutionAuditActions.ambiguityRecovered,
                    publicationId: claim.publicationId,
                    jobId: claim.id,
                    attempt: claim.attempts,
                    occurredAt: now,
                    details: {
                        fromState: 'publishing',
                        toState: 'ambiguous',
                        recoveredAt: now,
                        reason: 'lease_expired_after_effect_boundary',
                        errorMessage: ambiguousError,
                        effectStartedAt: claim.effectStartedAt,
                        runAt: claim.runAt,
                    },
                })
                ambiguousJobIds.push(claim.id)
            }

            return { requeuedJobIds, ambiguousJobIds }
        }
    )

    const ensureSystemActorTransaction = client.transaction(
        (projectId: string, now: number): string | null => {
            if (loadProjectStatement.get(projectId) === null) return null

            const existing = loadSystemActorStatement.get(projectId)
            if (existing !== null) return existing.id

            const actorId = `system:${projectId}`
            insertSystemActorStatement.run(actorId, projectId, 'Postdot Worker', now)

            const inserted = loadSystemActorStatement.get(projectId)
            if (inserted === null) {
                throw new DomainInvariantError(
                    'invalid_actor_kind',
                    `Could not create a system actor for project ${projectId}`
                )
            }

            return inserted.id
        }
    )

    return {
        listProjectIds(): string[] {
            return listProjectIdsStatement.all().map(row => row.id)
        },

        ensureSystemActor(projectId: string, now = Date.now()): string | null {
            return ensureSystemActorTransaction.immediate(
                requireNonBlank(projectId, 'projectId'),
                requireTimestamp(now, 'now')
            )
        },

        getNextEventAt(): number | null {
            return nextEventStatement.get()?.eventAt ?? null
        },

        claimNextDueJob(input: ClaimDueJobInput): Job | null {
            const now = requireTimestamp(input.now, 'now')
            const leaseExpiresAt = requireTimestamp(input.leaseExpiresAt, 'leaseExpiresAt')
            if (leaseExpiresAt <= now) {
                throw new DomainInvariantError('invalid_time', 'leaseExpiresAt must be after now')
            }

            return claimNextDueTransaction.immediate({
                actorId: requireNonBlank(input.actorId, 'actorId'),
                claimToken: requireNonBlank(input.claimToken, 'claimToken'),
                now,
                leaseExpiresAt,
            })
        },

        startExternalEffect(jobId: string, claimToken: string, now: number): boolean {
            return startExternalEffectTransaction.immediate(
                requireNonBlank(jobId, 'jobId'),
                requireNonBlank(claimToken, 'claimToken'),
                requireTimestamp(now, 'now')
            )
        },

        completeExternalEffect(input: CompleteExternalEffectInput): PersistedEffectOutcome | null {
            return completeExternalEffectTransaction.immediate({
                ...input,
                jobId: requireNonBlank(input.jobId, 'jobId'),
                claimToken: requireNonBlank(input.claimToken, 'claimToken'),
            })
        },

        cancelPendingJob(jobId: string, actorId: string, now: number): boolean {
            return cancelPendingJobTransaction.immediate(
                requireNonBlank(jobId, 'jobId'),
                requireNonBlank(actorId, 'actorId'),
                requireTimestamp(now, 'now')
            )
        },

        recoverExpiredClaims(now: number): ExpiredClaimRecovery {
            return recoverExpiredClaimsTransaction.immediate(requireTimestamp(now, 'now'))
        },
    }
}

function normalizeOptionalResult(value: string | undefined, field: string): string | null {
    return value === undefined ? null : requireNonBlank(value, field)
}

function assertTargetRevisionMediaMatchesContent(
    row: TargetRevisionContentRow | null,
    media: readonly TargetRevisionMediaRow[],
    targetRevisionId: string,
    mediaReferenceCount: number,
    profileCompiler: ChannelProfileCompiler
): void {
    if (row === null) {
        throw new DomainInvariantError(
            'invalid_transition',
            `Target revision ${targetRevisionId} has no profile or content snapshot`
        )
    }

    let profileJson: unknown
    let contentJson: unknown
    try {
        profileJson = JSON.parse(row.profileJson)
        contentJson = JSON.parse(row.contentJson)
    } catch {
        throw new DomainInvariantError(
            'invalid_content',
            `Target revision ${targetRevisionId} contains invalid JSON`
        )
    }
    if (!isRecord(contentJson)) {
        throw new DomainInvariantError(
            'invalid_content',
            `Target revision ${targetRevisionId} content is not an object`
        )
    }
    const compiled = profileCompiler.compile(profileJson as ChannelProfileDefinition)
    if (!compiled.ok) {
        throw new DomainInvariantError(
            'invalid_content',
            `Target revision ${targetRevisionId} profile is invalid`
        )
    }

    const references = extractTargetMediaReferences(
        compiled.value.profile,
        contentJson as TargetContent
    )
    if (references.length !== mediaReferenceCount || media.length !== mediaReferenceCount) {
        throw new DomainInvariantError(
            'invalid_transition',
            `Target revision ${targetRevisionId} has inconsistent media reference counts`
        )
    }
    for (const [position, reference] of references.entries()) {
        const persisted = media[position]
        if (
            persisted === undefined ||
            persisted.position !== position ||
            persisted.contentPath !== reference.contentPath ||
            persisted.assetId !== reference.assetId ||
            persisted.role !== reference.role ||
            (reference.accessibilityText !== null &&
                persisted.accessibilityText !== reference.accessibilityText)
        ) {
            throw new DomainInvariantError(
                'invalid_transition',
                `Target revision ${targetRevisionId} media index disagrees with its content`
            )
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
