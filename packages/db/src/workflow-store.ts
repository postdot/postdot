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

import { cadenceEligibleAtSql, createChannelCadenceStore } from './channel-cadence'
import { readChannelDestination, publicationDestinationConfirmed } from './channel-destination'
import { defineTransaction, recordDatabaseCommitProject, type DatabaseHandle } from './client'
import {
    automaticExecutionAuditActions,
    serializeAutomaticExecutionAuditMetadata,
    type AutomaticExecutionAuditAction,
} from './execution-audit'
import { createRetainedTargetAssessor } from './retained-target-assessment'
import { isPostgresTransactionConflict } from './sql/postgres-adapter'

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

export function createWorkflowStore(
    database: DatabaseHandle,
    options: { publicMediaUrlAvailable?: boolean } = {}
) {
    const cadence = createChannelCadenceStore(database)
    const sql = database.sql
    const createId = () => crypto.randomUUID()
    const profileCompiler = new ChannelProfileCompiler()
    const assessRetainedTarget = createRetainedTargetAssessor(
        database,
        options.publicMediaUrlAvailable
    )

    const listProjectIdsStatement = sql.statement<{ id: string }, []>(`
        select id
        from projects
        order by created_at, id
    `)
    const loadProjectStatement = sql.statement<{ id: string }, [projectId: string]>(`
        select id
        from projects
        where id = ?1
    `)
    const loadSystemActorStatement = sql.statement<SystemActorRow, [projectId: string]>(`
        select id
        from actors
        where project_id = ?1
          and kind = 'system'
        order by created_at, id
        limit 1
    `)
    const insertSystemActorStatement = sql.statement<
        void,
        [id: string, projectId: string, displayName: string, now: number]
    >(`
        insert into actors (id, project_id, kind, display_name, created_at, updated_at)
        values (?1, ?2, 'system', ?3, ?4, ?4)
        on conflict(id) do nothing
    `)
    const loadPublisherKindStatement = sql.statement<
        { readonly kind: string },
        [projectId: string, publicationId: string]
    >(`
        select publishers.kind
        from publications
        inner join project_publisher_contexts as publishers
            on publishers.project_id = publications.project_id
           and publishers.channel_id = publications.channel_id
        where publications.project_id = ?1
          and publications.id = ?2
        limit 1
    `)
    const insertExecutionAuditEventStatement = sql.statement<
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

    const insertExecutionAuditEvent = async (input: {
        readonly id: string
        readonly projectId: string
        readonly actorId: string
        readonly action: AutomaticExecutionAuditAction
        readonly publicationId: string
        readonly jobId: string
        readonly attempt: number
        readonly occurredAt: number
        readonly details?: Readonly<Record<string, unknown>>
    }): Promise<void> => {
        recordDatabaseCommitProject(database, input.projectId)
        await insertExecutionAuditEventStatement.run(
            input.id,
            input.projectId,
            input.actorId,
            input.action,
            input.publicationId,
            serializeAutomaticExecutionAuditMetadata({
                ...input.details,
                deliveryMode: 'automatic',
                provider:
                    (await loadPublisherKindStatement.get(input.projectId, input.publicationId))
                        ?.kind ?? null,
                jobId: input.jobId,
                attempt: input.attempt,
                occurredAt: input.occurredAt,
            }),
            input.jobId,
            input.occurredAt
        )
    }

    // SQLite's existing join plan remains efficient. PostgreSQL needs bounded
    // context lookups to avoid quadratic joins with stale bulk-insert statistics.
    const eligibilityJoins =
        sql.dialect === 'sqlite'
            ? `
            inner join project_publisher_contexts as publishers
                on publishers.project_id = publications.project_id
               and publishers.channel_id = publications.channel_id
            inner join publication_target_revisions as target_revisions
                on target_revisions.project_id = publications.project_id
               and target_revisions.id = publications.target_revision_id
               and target_revisions.publication_id = publications.id
            inner join project_channel_profile_contexts as channel_profiles
                on channel_profiles.project_id = target_revisions.project_id
               and channel_profiles.id = target_revisions.profile_version_id
    `
            : ''

    // Keep context validation correlated to one publication. Flattening these
    // views into the candidate join lets PostgreSQL choose quadratic nested loops
    // after a bulk insert with stale statistics. OFFSET 0 keeps the bounded EXISTS
    // lookups intact; both engines still use the same eligibility predicates.
    const eligiblePublicationSql =
        sql.dialect === 'sqlite'
            ? "channel_profiles.state <> 'disabled'"
            : `
        exists (
            select 1 from project_publisher_contexts as publishers
            where publishers.project_id = publications.project_id
              and publishers.channel_id = publications.channel_id
            limit 1 offset 0
        ) and exists (
            select 1 from publication_target_revisions as target_revisions
            inner join project_channel_profile_contexts as channel_profiles
                on channel_profiles.project_id = target_revisions.project_id
               and channel_profiles.id = target_revisions.profile_version_id
            where target_revisions.project_id = publications.project_id
              and target_revisions.id = publications.target_revision_id
              and target_revisions.publication_id = publications.id
              and channel_profiles.state <> 'disabled'
            limit 1 offset 0
        )
    `

    const nextEventStatement = sql.statement<{ eventAt: number | null }, []>(`
        select min(event_at) as eventAt
        from (
            select ${cadenceEligibleAtSql(sql.dialect)} as event_at
            from jobs
            inner join publications
                on publications.project_id = jobs.project_id
               and publications.id = jobs.publication_id
            ${eligibilityJoins}
            where jobs.state = 'pending'
              and ${eligiblePublicationSql}
              and not exists (select 1 from resource_lifecycles where kind = 'project' and resource_id = jobs.project_id and state <> 'active')
              and publications.delivery_mode = 'automatic'
              and publications.review_state = 'compatible'
              and publications.confirmed_destination_revision = (select destination_revision from project_channel_contexts as channels where channels.project_id = publications.project_id and channels.id = publications.channel_id)
              and publications.target_revision_id is not null

            union all

            select jobs.lease_expires_at as event_at
            from jobs
            where jobs.state = 'running'
        )
    `)

    const claimNextDueStatement = sql.statement<
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
            ${eligibilityJoins}
            inner join actors
                on actors.project_id = jobs.project_id
               and actors.id = ?2
               and actors.kind = 'system'
            where jobs.state = 'pending'
              and ${eligiblePublicationSql}
              and not exists (select 1 from resource_lifecycles where kind = 'project' and resource_id = jobs.project_id and state <> 'active')
              and ${cadenceEligibleAtSql(sql.dialect)} <= ?3
              and publications.state in ('scheduled', 'ready')
              and publications.delivery_mode = 'automatic'
              and publications.review_state = 'compatible'
              and publications.confirmed_destination_revision = (select destination_revision from project_channel_contexts as channels where channels.project_id = publications.project_id and channels.id = publications.channel_id)
              and publications.target_revision_id is not null
            order by ${cadenceEligibleAtSql(sql.dialect)}, jobs.id
            limit 1
        )
          and state = 'pending'
        returning ${claimedJobColumns}
    `)

    const claimNextDueTransaction = defineTransaction(
        database,
        async (input: ClaimDueJobInput): Promise<Job | null> => {
            const claimed = await claimNextDueStatement.get(
                input.claimToken,
                input.actorId,
                input.now,
                input.leaseExpiresAt
            )
            if (claimed === null) return null

            await insertExecutionAuditEvent({
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

    const loadRunningJobStatement = sql.statement<
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

    const promoteScheduledPublicationStatement = sql.statement<
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

    const startPublishingStatement = sql.statement<
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

    const markEffectStartedStatement = sql.statement<
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

    const insertExecutionRevisionStatement = sql.statement<
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
        inner join project_channel_profile_contexts as channel_profiles
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
    const loadExecutionRevisionStatement = sql.statement<
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
    const listTargetRevisionMediaStatement = sql.statement<
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
    const listExecutionRevisionMediaCountStatement = sql.statement<
        { count: number },
        [projectId: string, executionRevisionId: string]
    >(`
        select count(*) as count
        from publication_execution_revision_media
        where project_id = ?1
          and execution_revision_id = ?2
    `)
    const loadTargetRevisionContentStatement = sql.statement<
        TargetRevisionContentRow,
        [projectId: string, targetRevisionId: string]
    >(`
        select channel_profiles.profile_json as profileJson,
               revisions.content_json as contentJson
        from publication_target_revisions as revisions
        inner join project_channel_profile_contexts as channel_profiles
            on channel_profiles.project_id = revisions.project_id
           and channel_profiles.id = revisions.profile_version_id
           and channel_profiles.state <> 'disabled'
        where revisions.project_id = ?1
          and revisions.id = ?2
    `)
    const insertExecutionRevisionMediaStatement = sql.statement<
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

    const startExternalEffectTransaction = defineTransaction(
        database,
        async (jobId: string, claimToken: string, now: number): Promise<boolean> => {
            const runningJob = await loadRunningJobStatement.get(jobId, claimToken, now)
            if (runningJob === null) return false
            if (
                !(await publicationDestinationConfirmed(
                    database,
                    runningJob.projectId,
                    runningJob.publicationId
                ))
            ) {
                await sql
                    .statement(`update jobs set state = 'pending', claim_token = null, claimed_by_actor_id = null,
                    claimed_at = null, lease_expires_at = null, effect_started_at = null, started_at = null,
                    completed_at = null, error_message = null, updated_at = ? where id = ? and effect_started_at is null`)
                    .run(now, jobId)
                recordDatabaseCommitProject(database, runningJob.projectId)
                return false
            }
            if (
                !(await assessRetainedTarget(
                    runningJob.projectId,
                    runningJob.publicationId,
                    runningJob.claimedByActorId,
                    now
                ))
            ) {
                await sql
                    .statement(
                        "update jobs set state = 'cancelled', claim_token = null, lease_expires_at = null, completed_at = ?, updated_at = ? where id = ? and state = 'running' and effect_started_at is null"
                    )
                    .run(now, now, jobId)
                return false
            }

            const eligibleAt = await cadence.eligibleAt(runningJob.publicationId, runningJob.runAt)
            if (eligibleAt > now) {
                await sql
                    .statement(`update jobs set state='pending', attempts=(case when attempts > 0 then attempts - 1 else 0 end),
                    claim_token=null,claimed_by_actor_id=null,claimed_at=null,lease_expires_at=null,
                    started_at=null,updated_at=? where id=?`)
                    .run(now, jobId)
                recordDatabaseCommitProject(database, runningJob.projectId)
                return false
            }
            const executionRevisionId = createId()
            const pinned = await insertExecutionRevisionStatement.run(
                executionRevisionId,
                jobId,
                claimToken,
                now
            )
            const executionRevision = await loadExecutionRevisionStatement.get(
                runningJob.projectId,
                runningJob.id
            )
            if (executionRevision === null) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Job ${runningJob.id} has no valid target revision to execute`
                )
            }
            const targetMedia = await listTargetRevisionMediaStatement.all(
                runningJob.projectId,
                executionRevision.targetRevisionId
            )
            assertTargetRevisionMediaMatchesContent(
                await loadTargetRevisionContentStatement.get(
                    runningJob.projectId,
                    executionRevision.targetRevisionId
                ),
                targetMedia,
                executionRevision.targetRevisionId,
                executionRevision.mediaReferenceCount,
                profileCompiler
            )
            if (pinned.changes === 1) {
                const channel = (await sql
                    .statement<{ channelId: string; revision: number }, [string, string]>(`
                    select p.channel_id as channelId, c.destination_revision as revision from publications p
                    join project_channel_contexts c on c.project_id = p.project_id and c.id = p.channel_id
                    where p.project_id = ? and p.id = ?
                `)
                    .get(runningJob.projectId, runningJob.publicationId))!
                const identity = await readChannelDestination(
                    database,
                    runningJob.projectId,
                    channel.channelId
                )
                if (identity !== null)
                    await sql
                        .statement(
                            'update publication_execution_revisions set destination_snapshot_json = ? where id = ?'
                        )
                        .run(
                            JSON.stringify({ ...identity, revision: channel.revision }),
                            executionRevision.id
                        )
                for (const media of targetMedia) {
                    await insertExecutionRevisionMediaStatement.run(
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
            const executionMediaCount = (
                await listExecutionRevisionMediaCountStatement.get(
                    runningJob.projectId,
                    executionRevision.id
                )
            )?.count
            if (executionMediaCount !== executionRevision.mediaReferenceCount) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Execution revision ${executionRevision.id} has inconsistent media references`
                )
            }

            if (runningJob.publicationState === 'scheduled') {
                const promoted = await promoteScheduledPublicationStatement.run(
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

            const publishing = await startPublishingStatement.run(
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

            await cadence.recordEffect(runningJob.publicationId, now)
            const effectStarted = await markEffectStartedStatement.run(now, jobId, claimToken)
            if (effectStarted.changes !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    'The job claim changed before the effect boundary was committed'
                )
            }

            await insertExecutionAuditEvent({
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

    const loadCompletableJobStatement = sql.statement<
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

    const publishPublicationStatement = sql.statement<
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

    const failPublicationStatement = sql.statement<
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

    const readyPublicationForRetryStatement = sql.statement<
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

    const succeedJobStatement = sql.statement<
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

    const failJobStatement = sql.statement<
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

    const retryJobStatement = sql.statement<
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

    const completeExternalEffectTransaction = defineTransaction(
        database,
        async (input: CompleteExternalEffectInput): Promise<PersistedEffectOutcome | null> => {
            const job = await loadCompletableJobStatement.get(input.jobId, input.claimToken)
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
                publicationChanges = (
                    await publishPublicationStatement.run(
                        completedAt,
                        job.claimedByActorId,
                        externalId,
                        externalUrl,
                        job.projectId,
                        job.publicationId
                    )
                ).changes
                jobChanges = (await succeedJobStatement.run(completedAt, job.id, job.claimToken))
                    .changes
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
                let retryAt =
                    (input.outcome.type === 'retryable_failure' ||
                        input.outcome.type === 'deferred' ||
                        (input.outcome.type === 'checkpointed_failure' &&
                            input.outcome.retryable)) &&
                    input.retryAt != null
                        ? requireTimestamp(input.retryAt, 'retryAt')
                        : null

                if (retryAt !== null && retryAt < completedAt) {
                    throw new DomainInvariantError(
                        'invalid_time',
                        'A retry cannot predate its failure'
                    )
                }

                if (
                    retryAt !== null &&
                    !(await assessRetainedTarget(
                        job.projectId,
                        job.publicationId,
                        job.claimedByActorId,
                        completedAt
                    ))
                )
                    retryAt = null
                if (
                    retryAt !== null &&
                    !(await publicationDestinationConfirmed(
                        database,
                        job.projectId,
                        job.publicationId
                    ))
                )
                    retryAt = null
                if (retryAt !== null) {
                    publicationChanges = (
                        await readyPublicationForRetryStatement.run(
                            completedAt,
                            job.claimedByActorId,
                            job.projectId,
                            job.publicationId
                        )
                    ).changes
                    jobChanges = (
                        await retryJobStatement.run(retryAt, completedAt, job.id, job.claimToken)
                    ).changes
                    if (input.outcome.type === 'deferred') {
                        await sql
                            .statement(
                                'update jobs set attempts = (case when attempts > 0 then attempts - 1 else 0 end) where id = ?1'
                            )
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
                        effectOccurred: input.outcome.type === 'checkpointed_failure',
                        ...(input.outcome.type === 'checkpointed_failure'
                            ? { confirmedMessageCount: input.outcome.confirmedMessageCount }
                            : {}),
                        errorMessage,
                        completedAt,
                        effectStartedAt: job.effectStartedAt,
                        runAt: job.runAt,
                        retryAt,
                    }
                } else {
                    const publicationState =
                        input.outcome.type === 'ambiguous' ? 'ambiguous' : 'failed'
                    publicationChanges = (
                        await failPublicationStatement.run(
                            publicationState,
                            errorMessage,
                            completedAt,
                            job.claimedByActorId,
                            job.projectId,
                            job.publicationId
                        )
                    ).changes
                    jobChanges = (
                        await failJobStatement.run(
                            errorMessage,
                            completedAt,
                            job.id,
                            job.claimToken
                        )
                    ).changes
                    persisted = publicationState
                    auditAction =
                        publicationState === 'ambiguous'
                            ? automaticExecutionAuditActions.ambiguous
                            : automaticExecutionAuditActions.failed
                    auditDetails = {
                        ...(input.outcome.type === 'checkpointed_failure'
                            ? { confirmedMessageCount: input.outcome.confirmedMessageCount }
                            : {}),
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

            await insertExecutionAuditEvent({
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

    const loadCancellableJobStatement = sql.statement<
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

    const cancelPublicationStatement = sql.statement<
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

    const cancelJobStatement = sql.statement<{ changes: number }, [now: number, jobId: string]>(`
        update jobs
        set state = 'cancelled',
            completed_at = ?1,
            error_message = null,
            updated_at = ?1
        where id = ?2
          and state = 'pending'
    `)

    const cancelPendingJobTransaction = defineTransaction(
        database,
        async (jobId: string, actorId: string, now: number): Promise<boolean> => {
            const job = await loadCancellableJobStatement.get(jobId, actorId)
            if (job === null) return false

            const publication = await cancelPublicationStatement.run(
                now,
                actorId,
                job.projectId,
                job.publicationId
            )
            const cancelled = await cancelJobStatement.run(now, job.id)

            if (publication.changes !== 1 || cancelled.changes !== 1) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Could not cancel pending job ${job.id}`
                )
            }

            await insertExecutionAuditEvent({
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

    const loadExpiredClaimsStatement = sql.statement<RunningJobRow, [now: number]>(`
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

    const requeueExpiredClaimStatement = sql.statement<
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
    const markPublicationAmbiguousStatement = sql.statement<
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

    const failAmbiguousJobStatement = sql.statement<
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

    // This is an owner giving back a claim after its pre-effect transaction
    // aborted, not a lease takeover. The token and null marker fence the write.
    const releaseUnstartedClaimTransaction = defineTransaction(
        database,
        async (jobId: string, claimToken: string, now: number): Promise<void> => {
            const claim = await loadRunningJobStatement.get(jobId, claimToken, now)
            if (claim === null || !['scheduled', 'ready'].includes(claim.publicationState)) return
            const released = await sql
                .statement(`
                update jobs
                set state = 'pending', claim_token = null, claimed_by_actor_id = null,
                    claimed_at = null, lease_expires_at = null, started_at = null,
                    completed_at = null, error_message = null, updated_at = ?1
                where id = ?2 and state = 'running' and claim_token = ?3
                  and lease_expires_at > ?1 and effect_started_at is null
            `)
                .run(now, jobId, claimToken)
            if (released.changes !== 1) return
            await insertExecutionAuditEvent({
                id: createId(),
                projectId: claim.projectId,
                actorId: claim.claimedByActorId,
                action: automaticExecutionAuditActions.claimRecovered,
                publicationId: claim.publicationId,
                jobId,
                attempt: claim.attempts,
                occurredAt: now,
                details: {
                    fromState: 'running',
                    toState: 'pending',
                    recoveredAt: now,
                    runAt: claim.runAt,
                    reason: 'owner_released_after_pre_effect_transaction_conflict',
                },
            })
        }
    )

    const recoverExpiredClaimsTransaction = defineTransaction(
        database,
        async (now: number): Promise<ExpiredClaimRecovery> => {
            const requeuedJobIds: string[] = []
            const ambiguousJobIds: string[] = []

            for (const claim of await loadExpiredClaimsStatement.all(now)) {
                if (claim.effectStartedAt === null) {
                    const requeued = await requeueExpiredClaimStatement.run(
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
                    await insertExecutionAuditEvent({
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

                const publication = await markPublicationAmbiguousStatement.run(
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

                const failed = await failAmbiguousJobStatement.run(now, claim.id, claim.claimToken)
                if (failed.changes !== 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not fail expired claim for job ${claim.id}`
                    )
                }
                await insertExecutionAuditEvent({
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

    const ensureSystemActorTransaction = defineTransaction(
        database,
        async (projectId: string, now: number): Promise<string | null> => {
            if ((await loadProjectStatement.get(projectId)) === null) return null

            const existing = await loadSystemActorStatement.get(projectId)
            if (existing !== null) return existing.id

            const actorId = `system:${projectId}`
            await insertSystemActorStatement.run(actorId, projectId, 'Postdot Worker', now)

            const inserted = await loadSystemActorStatement.get(projectId)
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
        async listProjectIds(): Promise<string[]> {
            return (await listProjectIdsStatement.all()).map(row => row.id)
        },

        async ensureSystemActor(projectId: string, now = Date.now()): Promise<string | null> {
            return ensureSystemActorTransaction.immediate(
                requireNonBlank(projectId, 'projectId'),
                requireTimestamp(now, 'now')
            )
        },

        async getNextEventAt(): Promise<number | null> {
            return (await nextEventStatement.get())?.eventAt ?? null
        },

        async claimNextDueJob(input: ClaimDueJobInput): Promise<Job | null> {
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

        async renewClaim(input: {
            jobId: string
            claimToken: string
            now: number
            leaseExpiresAt: number
        }): Promise<boolean> {
            const at = requireTimestamp(input.now, 'now')
            const expiry = requireTimestamp(input.leaseExpiresAt, 'leaseExpiresAt')
            if (expiry <= at)
                throw new DomainInvariantError('invalid_time', 'leaseExpiresAt must be after now')
            return (
                (
                    await database.sql
                        .statement(
                            `UPDATE jobs SET lease_expires_at = ? WHERE id = ? AND state = 'running' AND claim_token = ? AND lease_expires_at > ? AND lease_expires_at <= ?`
                        )
                        .run(
                            expiry,
                            requireNonBlank(input.jobId, 'jobId'),
                            requireNonBlank(input.claimToken, 'claimToken'),
                            at,
                            expiry
                        )
                ).changes === 1
            )
        },

        async startExternalEffect(
            jobId: string,
            claimToken: string,
            now: number
        ): Promise<boolean> {
            const id = requireNonBlank(jobId, 'jobId')
            const token = requireNonBlank(claimToken, 'claimToken')
            const at = requireTimestamp(now, 'now')
            try {
                return await startExternalEffectTransaction.immediate(id, token, at)
            } catch (error) {
                if (isPostgresTransactionConflict(error)) {
                    try {
                        await releaseUnstartedClaimTransaction.immediate(id, token, at)
                    } catch {
                        // Preserve the original conflict for scheduler recovery. If cleanup
                        // cannot commit, the durable lease remains the safe fallback.
                    }
                }
                throw error
            }
        },

        async completeExternalEffect(
            input: CompleteExternalEffectInput
        ): Promise<PersistedEffectOutcome | null> {
            return completeExternalEffectTransaction.immediate({
                ...input,
                jobId: requireNonBlank(input.jobId, 'jobId'),
                claimToken: requireNonBlank(input.claimToken, 'claimToken'),
            })
        },

        async cancelPendingJob(jobId: string, actorId: string, now: number): Promise<boolean> {
            return cancelPendingJobTransaction.immediate(
                requireNonBlank(jobId, 'jobId'),
                requireNonBlank(actorId, 'actorId'),
                requireTimestamp(now, 'now')
            )
        },

        async recoverExpiredClaims(now: number): Promise<ExpiredClaimRecovery> {
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
