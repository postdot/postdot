import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    transitionJob,
    transitionPublication,
    type Job,
} from '@postdot/core'

import { createChannelCadenceStore } from '../channel-cadence'
import { publicationDestinationConfirmed } from '../channel-destination'
import { createDatabaseTransaction, type PostdotDatabase } from '../client'
import type { RetryFailedPublicationInput, RetryFailedPublicationResult } from '../manual-store'
import { createRetainedTargetAssessor } from '../retained-target-assessment'
import { toActor, toPublication } from './mappers'
import type { ActorRow, PublicationRow } from './rows'

interface FailedJobRow {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly runAt: number
    readonly attempts: number
    readonly claimToken: string | null
    readonly claimedByActorId: string | null
    readonly claimedAt: number | null
    readonly leaseExpiresAt: number | null
    readonly effectStartedAt: number | null
    readonly startedAt: number | null
    readonly completedAt: number | null
    readonly errorMessage: string | null
    readonly createdAt: number
    readonly updatedAt: number
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

export interface PublicationRetryStoreOptions {
    readonly publicMediaUrlAvailable?: boolean
    readonly now: () => number
    readonly createId: () => string
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly loadPublication: (projectId: string, publicationId: string) => PublicationRow | null
    readonly insertAuditEvent: (input: AuditEventInsert) => void
}

export function createPublicationRetryStore(
    database: PostdotDatabase,
    options: PublicationRetryStoreOptions
) {
    const cadence = createChannelCadenceStore(database)
    const client = database.$client
    const assessRetainedTarget = createRetainedTargetAssessor(
        database,
        options.publicMediaUrlAvailable
    )

    const loadLatestFailedJobStatement = client.query<
        FailedJobRow,
        [projectId: string, publicationId: string]
    >(`
        select id,
               project_id as projectId,
               publication_id as publicationId,
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
        from jobs
        where project_id = ?1
          and publication_id = ?2
          and state = 'failed'
        order by coalesce(completed_at, updated_at) desc, id desc
        limit 1
    `)
    const loadActiveJobStatement = client.query<
        { readonly id: string },
        [projectId: string, publicationId: string]
    >(`
        select id
        from jobs
        where project_id = ?1
          and publication_id = ?2
          and state in ('pending', 'running')
        limit 1
    `)
    const loadTargetRevisionStatement = client.query<
        { readonly id: string },
        [projectId: string, publicationId: string, targetRevisionId: string]
    >(`
        select id
        from publication_target_revisions
        where project_id = ?1
          and publication_id = ?2
          and id = ?3
          and delivery_mode = 'automatic'
        limit 1
    `)
    const updatePublicationStatement = client.query<
        { readonly changes: number },
        [actorId: string, updatedAt: number, projectId: string, publicationId: string]
    >(`
        update publications
        set state = 'ready',
            error_message = null,
            state_changed_by_actor_id = ?1,
            updated_at = ?2
        where project_id = ?3
          and id = ?4
          and state = 'failed'
          and delivery_mode = 'automatic'
    `)
    const updateJobStatement = client.query<
        { readonly changes: number },
        [runAt: number, updatedAt: number, projectId: string, jobId: string, publicationId: string]
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
        where project_id = ?3
          and id = ?4
          and publication_id = ?5
          and state = 'failed'
    `)

    const retryFailedPublicationTransaction = createDatabaseTransaction(
        database,
        (input: RetryFailedPublicationInput): RetryFailedPublicationResult => {
            const actorRow = options.loadActor(input.projectId, input.subjectId)
            let publicationRow = options.loadPublication(input.projectId, input.publicationId)
            if (actorRow === null || publicationRow === null) return { kind: 'not_found' }
            if (
                publicationRow.state !== 'failed' ||
                !publicationDestinationConfirmed(database, input.projectId, input.publicationId)
            )
                return { kind: 'not_retryable' }
            if (
                !assessRetainedTarget(
                    input.projectId,
                    input.publicationId,
                    actorRow.id,
                    options.now()
                )
            )
                return { kind: 'not_retryable' }
            publicationRow = options.loadPublication(input.projectId, input.publicationId)!

            if (
                publicationRow.state !== 'failed' ||
                publicationRow.deliveryMode !== 'automatic' ||
                publicationRow.reviewState !== 'compatible' ||
                publicationRow.targetRevisionId === null
            ) {
                return { kind: 'not_retryable' }
            }
            if (
                loadTargetRevisionStatement.get(
                    input.projectId,
                    input.publicationId,
                    publicationRow.targetRevisionId
                ) === null ||
                loadActiveJobStatement.get(input.projectId, input.publicationId) !== null
            ) {
                return { kind: 'not_retryable' }
            }

            const failedJobRow = loadLatestFailedJobStatement.get(
                input.projectId,
                input.publicationId
            )
            if (failedJobRow === null) return { kind: 'not_retryable' }

            const timestamp = requireTimestamp(options.now(), 'now')
            const actor = toActor(actorRow)
            const publication = toPublication(publicationRow)
            const job: Job = {
                id: failedJobRow.id,
                projectId: failedJobRow.projectId,
                publicationId: failedJobRow.publicationId,
                state: 'failed',
                runAt: failedJobRow.runAt,
                attempts: failedJobRow.attempts,
                claimToken: failedJobRow.claimToken,
                claimedByActorId: failedJobRow.claimedByActorId,
                claimedAt: failedJobRow.claimedAt,
                leaseExpiresAt: failedJobRow.leaseExpiresAt,
                effectStartedAt: failedJobRow.effectStartedAt,
                startedAt: failedJobRow.startedAt,
                completedAt: failedJobRow.completedAt,
                errorMessage: failedJobRow.errorMessage,
                createdAt: failedJobRow.createdAt,
                updatedAt: failedJobRow.updatedAt,
            }
            cadence.check({
                projectId: input.projectId,
                actorId: actor.id,
                now: timestamp,
                confirmation: input.cadenceConfirmation,
                candidates: [
                    {
                        id: publication.id,
                        channelId: publication.channelId,
                        at: publication.scheduledAt ?? timestamp,
                    },
                ],
            })
            const ready = transitionPublication({
                publication,
                to: 'ready',
                actor,
                now: timestamp,
            })
            let pending = transitionJob({
                job,
                to: 'pending',
                now: timestamp,
                runAt: timestamp,
            })

            if (
                updatePublicationStatement.run(actor.id, ready.updatedAt, input.projectId, ready.id)
                    .changes !== 1
            ) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not retry publication ${ready.id}`
                )
            }
            const previousExecution = client
                .query<{ revision: number | null; expected: number }, [string, string]>(`
                select json_extract(e.destination_snapshot_json, '$.revision') as revision,
                       p.confirmed_destination_revision as expected
                from publications p join publication_execution_revisions e on e.project_id = p.project_id and e.publication_id = p.id
                where p.project_id = ? and e.job_id = ?
            `)
                .get(input.projectId, pending.id)
            if (
                previousExecution &&
                (previousExecution.revision ?? 0) !== previousExecution.expected
            ) {
                pending = { ...pending, id: options.createId(), attempts: 0, createdAt: timestamp }
                client
                    .query(`insert into jobs (id,project_id,publication_id,state,run_at,created_at,updated_at)
                    values (?,?,?,'pending',?,?,?)`)
                    .run(
                        pending.id,
                        input.projectId,
                        pending.publicationId,
                        pending.runAt,
                        timestamp,
                        timestamp
                    )
            } else if (
                updateJobStatement.run(
                    pending.runAt,
                    pending.updatedAt,
                    input.projectId,
                    pending.id,
                    pending.publicationId
                ).changes !== 1
            ) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not requeue job ${pending.id}`
                )
            }

            options.insertAuditEvent({
                id: options.createId(),
                projectId: ready.projectId,
                actorId: actor.id,
                action: 'publication.retry_requested',
                entityType: 'publication',
                entityId: ready.id,
                metadataJson: JSON.stringify({
                    fromState: publication.state,
                    toState: ready.state,
                    deliveryMode: ready.deliveryMode,
                    targetRevisionId: ready.targetRevisionId,
                    jobId: pending.id,
                    previousAttempts: job.attempts,
                    retryAt: pending.runAt,
                }),
                createdAt: timestamp,
            })

            const updated = options.loadPublication(input.projectId, input.publicationId)
            return updated === null
                ? { kind: 'not_found' }
                : { kind: 'retried', publication: toPublication(updated) }
        }
    )

    return {
        retryFailedPublication(input: RetryFailedPublicationInput): RetryFailedPublicationResult {
            return retryFailedPublicationTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}
