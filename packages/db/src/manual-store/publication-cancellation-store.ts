import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    transitionPublication,
    type Publication,
} from '@postbot/core'

import { createDatabaseTransaction, type PostbotDatabase } from '../client'
import type { CancelPublicationsInput } from '../manual-store'
import { toActor, toPublication } from './mappers'
import type { ActorRow, PublicationRow } from './rows'

interface ActiveJobRow {
    readonly id: string
    readonly state: 'pending' | 'running'
    readonly runAt: number
    readonly attempts: number
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

export interface PublicationCancellationStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly loadPublication: (projectId: string, publicationId: string) => PublicationRow | null
    readonly loadActiveJob: (projectId: string, publicationId: string) => ActiveJobRow | null
    readonly loadProvider: (projectId: string, channelId: string) => string | null
    readonly cancelPendingJob: (projectId: string, jobId: string, completedAt: number) => boolean
    readonly insertAuditEvent: (input: AuditEventInsert) => void
}

export function createPublicationCancellationStore(
    database: PostbotDatabase,
    options: PublicationCancellationStoreOptions
) {
    const client = database.$client
    const cancelPublicationStatement = client.query<
        { changes: number },
        [
            stateChangedByActorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
            expectedUpdatedAt: number,
        ]
    >(`
        update publications
        set state = 'cancelled',
            error_message = null,
            state_changed_by_actor_id = ?1,
            updated_at = ?2
        where project_id = ?3
          and id = ?4
          and state = 'scheduled'
          and updated_at = ?5
    `)

    const cancelPublicationsTransaction = createDatabaseTransaction(
        database,
        (input: CancelPublicationsInput): Publication[] | null => {
            const actorRow = options.loadActor(input.projectId, input.subjectId)
            if (actorRow === null) return null

            const timestamp = requireTimestamp(options.now(), 'now')
            const actor = toActor(actorRow)
            const currentPublications: PublicationRow[] = []

            for (const publicationId of input.publicationIds) {
                const row = options.loadPublication(input.projectId, publicationId)
                if (row === null) return null
                currentPublications.push(row)
            }

            const candidates = currentPublications.map(row => {
                const publication = toPublication(row)
                const activeJob = options.loadActiveJob(input.projectId, publication.id)
                if (activeJob?.state === 'running') {
                    throw new DomainInvariantError(
                        'invalid_transition',
                        `Cannot cancel publication ${publication.id} while its job is running`
                    )
                }

                return {
                    activeJob,
                    current: publication,
                    next: transitionPublication({
                        publication,
                        to: 'cancelled',
                        actor,
                        now: timestamp,
                    }),
                }
            })

            for (const candidate of candidates) {
                const { current, next } = candidate
                const result = cancelPublicationStatement.run(
                    next.stateChangedByActorId,
                    next.updatedAt,
                    input.projectId,
                    next.id,
                    current.updatedAt
                )
                if (result.changes !== 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not cancel publication ${next.id}`
                    )
                }

                const provider =
                    next.deliveryMode === 'manual'
                        ? 'manual'
                        : options.loadProvider(input.projectId, next.channelId)
                options.insertAuditEvent({
                    id: options.createId(),
                    projectId: input.projectId,
                    actorId: actor.id,
                    action: 'publication.cancelled',
                    entityType: 'publication',
                    entityId: next.id,
                    metadataJson: JSON.stringify({
                        fromState: current.state,
                        toState: next.state,
                        scheduledAt: current.scheduledAt,
                        deliveryMode: next.deliveryMode,
                        provider,
                    }),
                    createdAt: timestamp,
                })

                if (candidate.activeJob !== null) {
                    if (
                        !options.cancelPendingJob(
                            input.projectId,
                            candidate.activeJob.id,
                            timestamp
                        )
                    ) {
                        throw new DomainInvariantError(
                            'claim_mismatch',
                            `Could not cancel job ${candidate.activeJob.id}`
                        )
                    }

                    options.insertAuditEvent({
                        id: options.createId(),
                        projectId: input.projectId,
                        actorId: actor.id,
                        action: 'publication.execution.cancelled',
                        entityType: 'publication',
                        entityId: next.id,
                        metadataJson: JSON.stringify({
                            jobId: candidate.activeJob.id,
                            attempt: candidate.activeJob.attempts,
                            occurredAt: timestamp,
                            cancelledAt: timestamp,
                            runAt: candidate.activeJob.runAt,
                            fromState: current.state,
                            toState: next.state,
                            deliveryMode: next.deliveryMode,
                            provider,
                            lifecycleEvent: 'publication.cancelled',
                        }),
                        createdAt: timestamp,
                    })
                }
            }

            return candidates.map(candidate => candidate.next)
        }
    )

    return {
        cancelPublications(input: CancelPublicationsInput): Publication[] | null {
            const publicationIds = input.publicationIds.map(id =>
                requireNonBlank(id, 'publicationId')
            )
            if (publicationIds.length === 0) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'publicationIds must contain at least one publication'
                )
            }
            if (new Set(publicationIds).size !== publicationIds.length) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'publicationIds must not contain duplicates'
                )
            }

            return cancelPublicationsTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationIds,
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}
