import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type CompleteExternalEffectInput,
    type ExpiredClaimRecovery,
    type Job,
    type PersistedEffectOutcome,
    type PublicationState,
} from '@herald/core'

import type { HeraldDatabase } from './client'

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
}

interface SystemActorRow {
    readonly id: string
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

export function createWorkflowStore(database: HeraldDatabase) {
    const client = database.$client

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
            where jobs.state = 'pending'

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
            inner join actors
                on actors.project_id = jobs.project_id
               and actors.id = ?2
               and actors.kind = 'system'
            where jobs.state = 'pending'
              and jobs.run_at <= ?3
              and publications.state in ('scheduled', 'ready')
            order by jobs.run_at, jobs.id
            limit 1
        )
          and state = 'pending'
        returning ${claimedJobColumns}
    `)

    const loadRunningJobStatement = client.query<
        RunningJobRow,
        [jobId: string, claimToken: string, now: number]
    >(`
        select jobs.id,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId,
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

    const startExternalEffectTransaction = client.transaction(
        (jobId: string, claimToken: string, now: number): boolean => {
            const runningJob = loadRunningJobStatement.get(jobId, claimToken, now)
            if (runningJob === null) return false

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

    const completeExternalEffectTransaction = client.transaction(
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

            if (input.outcome.type === 'published') {
                publicationChanges = publishPublicationStatement.run(
                    completedAt,
                    job.claimedByActorId,
                    normalizeOptionalResult(input.outcome.externalId, 'externalId'),
                    normalizeOptionalResult(input.outcome.externalUrl, 'externalUrl'),
                    job.projectId,
                    job.publicationId
                ).changes
                jobChanges = succeedJobStatement.run(completedAt, job.id, job.claimToken).changes
                persisted = 'published'
            } else {
                const errorMessage = requireNonBlank(input.outcome.errorMessage, 'errorMessage')
                const retryAt =
                    input.outcome.type === 'retryable_failure' && input.retryAt != null
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
                    persisted = 'retry_scheduled'
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
                }
            }

            if (publicationChanges !== 1 || jobChanges !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not complete the external effect for job ${job.id}`
                )
            }

            return persisted
        }
    )

    const loadCancellableJobStatement = client.query<
        CancellableJobRow,
        [jobId: string, actorId: string]
    >(`
        select jobs.id,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId
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

    const cancelPendingJobTransaction = client.transaction(
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

            return true
        }
    )

    const loadExpiredClaimsStatement = client.query<RunningJobRow, [now: number]>(`
        select jobs.id,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId,
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

    const recoverExpiredClaimsTransaction = client.transaction(
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
            insertSystemActorStatement.run(actorId, projectId, 'Herald Worker', now)

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

            return (
                claimNextDueStatement.get(
                    requireNonBlank(input.claimToken, 'claimToken'),
                    requireNonBlank(input.actorId, 'actorId'),
                    now,
                    leaseExpiresAt
                ) ?? null
            )
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
