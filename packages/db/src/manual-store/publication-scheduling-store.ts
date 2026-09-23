import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    reschedulePublication,
    type Publication,
} from '@herald/core'

import { createDatabaseTransaction, type HeraldDatabase } from '../client'
import type { ReschedulePublicationsInput } from '../manual-store'
import { toActor, toPublication } from './mappers'
import type { ActorRow, PublicationRow } from './rows'

interface ActiveJobRow {
    readonly id: string
    readonly state: 'pending' | 'running'
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

export interface PublicationSchedulingStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly loadPublication: (projectId: string, publicationId: string) => PublicationRow | null
    readonly loadActiveJob: (projectId: string, publicationId: string) => ActiveJobRow | null
    readonly updatePendingJob: (
        projectId: string,
        jobId: string,
        runAt: number,
        updatedAt: number
    ) => boolean
    readonly insertAuditEvent: (input: AuditEventInsert) => void
}

export function createPublicationSchedulingStore(
    database: HeraldDatabase,
    options: PublicationSchedulingStoreOptions
) {
    const client = database.$client
    const reschedulePublicationStatement = client.query<
        { changes: number },
        [
            scheduledAt: number,
            scheduledByActorId: string,
            stateChangedByActorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
            expectedUpdatedAt: number,
        ]
    >(`
        update publications
        set scheduled_at = ?1,
            scheduled_by_actor_id = ?2,
            state_changed_by_actor_id = ?3,
            updated_at = ?4
        where project_id = ?5
          and id = ?6
          and state = 'scheduled'
          and updated_at = ?7
    `)

    const reschedulePublicationsTransaction = createDatabaseTransaction(
        database,
        (input: ReschedulePublicationsInput): Publication[] | null => {
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
                        `Cannot reschedule publication ${publication.id} while its job is running`
                    )
                }

                return {
                    activeJob,
                    current: publication,
                    next: reschedulePublication(publication, input.scheduledAt, actor, timestamp),
                }
            })

            for (const candidate of candidates) {
                const { current, next } = candidate
                const result = reschedulePublicationStatement.run(
                    next.scheduledAt as number,
                    next.scheduledByActorId as string,
                    next.stateChangedByActorId,
                    next.updatedAt,
                    input.projectId,
                    next.id,
                    current.updatedAt
                )
                if (result.changes !== 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not reschedule publication ${next.id}`
                    )
                }

                if (candidate.activeJob !== null) {
                    if (
                        !options.updatePendingJob(
                            input.projectId,
                            candidate.activeJob.id,
                            next.scheduledAt as number,
                            timestamp
                        )
                    ) {
                        throw new DomainInvariantError(
                            'claim_mismatch',
                            `Could not reschedule job ${candidate.activeJob.id}`
                        )
                    }
                }

                options.insertAuditEvent({
                    id: options.createId(),
                    projectId: input.projectId,
                    actorId: actor.id,
                    action: 'publication.rescheduled',
                    entityType: 'publication',
                    entityId: next.id,
                    metadataJson: JSON.stringify({
                        fromScheduledAt: current.scheduledAt,
                        scheduledAt: next.scheduledAt,
                        deliveryMode: next.deliveryMode,
                    }),
                    createdAt: timestamp,
                })
            }

            return candidates.map(candidate => candidate.next)
        }
    )

    return {
        reschedulePublications(input: ReschedulePublicationsInput): Publication[] | null {
            const publicationIds = input.publicationIds.map(id =>
                requireNonBlank(id, 'publicationId')
            )
            if (new Set(publicationIds).size !== publicationIds.length) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'publicationIds must not contain duplicates'
                )
            }

            return reschedulePublicationsTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationIds,
                scheduledAt: requireTimestamp(input.scheduledAt, 'scheduledAt'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}
