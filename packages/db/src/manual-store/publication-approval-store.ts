import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type PublicationApprovalRequest,
} from '@postdot/core'
import type { Publication } from '@postdot/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostdotDatabase,
} from '../client'
import type { PromotePublicationDraftInput } from '../manual-store'
import type { ActorRow } from './rows'

export interface DecidePublicationApprovalRequestInput {
    readonly projectId: string
    readonly publicationId: string
    readonly requestId: string
    readonly subjectId: string
    readonly rejectionReason?: string | null
}

export interface SubmitPublicationForApprovalInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedDraftRevision: number
    readonly proposedScheduledAt: number
}

export interface ApprovePublicationRequestInput {
    readonly cadenceConfirmation?: string
    readonly projectId: string
    readonly publicationId: string
    readonly requestId: string
    readonly subjectId: string
    readonly scheduledAt?: number
    readonly publishNow?: boolean
}

export interface PublicationApprovalRequestRow extends PublicationApprovalRequest {}

export interface PublicationApprovalStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly promotePublicationDraft: (input: PromotePublicationDraftInput) => Publication | null
    readonly insertAuditEvent: (input: {
        readonly id: string
        readonly projectId: string
        readonly actorId: string
        readonly action: string
        readonly entityType: string
        readonly entityId: string
        readonly metadataJson: string | null
        readonly createdAt: number
    }) => void
}

interface ApprovalRequestDbRow {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly targetRevisionId: string
    readonly draftRevision: number
    readonly proposedScheduledAt: number
    readonly state: PublicationApprovalRequest['state']
    readonly requestedByActorId: string
    readonly decidedByActorId: string | null
    readonly decidedAt: number | null
    readonly scheduledAt: number | null
    readonly rejectionReason: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

function toApprovalRequest(row: ApprovalRequestDbRow): PublicationApprovalRequest {
    return {
        id: row.id,
        projectId: row.projectId,
        publicationId: row.publicationId,
        targetRevisionId: row.targetRevisionId,
        draftRevision: row.draftRevision,
        proposedScheduledAt: row.proposedScheduledAt,
        state: row.state,
        requestedByActorId: row.requestedByActorId,
        decidedByActorId: row.decidedByActorId,
        decidedAt: row.decidedAt,
        scheduledAt: row.scheduledAt,
        rejectionReason: row.rejectionReason,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export function createPublicationApprovalStore(
    database: PostdotDatabase,
    options: PublicationApprovalStoreOptions
) {
    const client = database.$client
    const selectApprovalRequest = `
        select id,
               project_id as projectId,
               publication_id as publicationId,
               target_revision_id as targetRevisionId,
               draft_revision as draftRevision,
               proposed_scheduled_at as proposedScheduledAt,
               state,
               requested_by_actor_id as requestedByActorId,
               decided_by_actor_id as decidedByActorId,
               decided_at as decidedAt,
               scheduled_at as scheduledAt,
               rejection_reason as rejectionReason,
               created_at as createdAt,
               updated_at as updatedAt
        from publication_approval_requests
    `
    const loadRequestStatement = client.query<
        ApprovalRequestDbRow,
        [projectId: string, requestId: string, publicationId: string]
    >(`${selectApprovalRequest}
        where project_id = ?1
          and id = ?2
          and publication_id = ?3`)
    const listPendingRequestsStatement = client.query<
        ApprovalRequestDbRow,
        [projectId: string]
    >(`${selectApprovalRequest}
        where project_id = ?1
          and state = 'pending'
        order by proposed_scheduled_at, created_at, id`)
    const rejectRequestStatement = client.query<
        { changes: number },
        [
            reason: string | null,
            decidedByActorId: string,
            decidedAt: number,
            updatedAt: number,
            projectId: string,
            requestId: string,
            publicationId: string,
        ]
    >(`
        update publication_approval_requests
        set state = 'rejected',
            rejection_reason = ?1,
            decided_by_actor_id = ?2,
            decided_at = ?3,
            updated_at = ?4
        where project_id = ?5
          and id = ?6
          and publication_id = ?7
          and state = 'pending'
    `)

    const rejectRequestTransaction = createDatabaseTransaction(
        database,
        (input: DecidePublicationApprovalRequestInput): PublicationApprovalRequest | null => {
            const actor = options.loadActor(input.projectId, input.subjectId)
            if (actor === null) return null
            const request = loadRequestStatement.get(
                input.projectId,
                input.requestId,
                input.publicationId
            )
            if (request === null) return null
            if (request.state !== 'pending') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot reject a ${request.state} approval request`
                )
            }
            const reason = input.rejectionReason?.trim() || null
            if (reason !== null && reason.length > 500) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'The rejection reason must be at most 500 characters'
                )
            }
            const timestamp = requireTimestamp(options.now(), 'now')
            const result = rejectRequestStatement.run(
                reason,
                actor.id,
                timestamp,
                timestamp,
                input.projectId,
                input.requestId,
                input.publicationId
            )
            if (result.changes !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not reject approval request ${input.requestId}`
                )
            }
            recordDatabaseCommitProject(database, input.projectId)
            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actor.id,
                action: 'publication.approval_rejected',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({
                    requestId: input.requestId,
                    targetRevisionId: request.targetRevisionId,
                    rejectionReason: reason,
                }),
                createdAt: timestamp,
            })
            return {
                ...toApprovalRequest(request),
                state: 'rejected',
                decidedByActorId: actor.id,
                decidedAt: timestamp,
                rejectionReason: reason,
                updatedAt: timestamp,
            }
        }
    )

    return {
        submitPublicationForApproval(input: SubmitPublicationForApprovalInput) {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const proposedScheduledAt = requireTimestamp(
                input.proposedScheduledAt,
                'proposedScheduledAt'
            )
            if (proposedScheduledAt <= requireTimestamp(options.now(), 'now')) {
                throw new DomainInvariantError(
                    'invalid_time',
                    'The proposed schedule must be in the future'
                )
            }
            const requestId = requireNonBlank(options.createId(), 'approval request id')
            const publication = options.promotePublicationDraft({
                projectId,
                publicationId,
                subjectId,
                expectedRevision: input.expectedDraftRevision,
                scheduledAt: null,
                approvalRequest: { id: requestId, proposedScheduledAt },
            })
            if (publication === null) return null
            const request = loadRequestStatement.get(projectId, requestId, publicationId)
            if (request === null) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not load approval request ${requestId} after submission`
                )
            }
            return toApprovalRequest(request)
        },
        listPendingPublicationApprovalRequests(projectId: string, subjectId: string) {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            if (
                options.loadActor(normalizedProjectId, requireNonBlank(subjectId, 'subjectId')) ===
                null
            ) {
                return null
            }
            return listPendingRequestsStatement.all(normalizedProjectId).map(toApprovalRequest)
        },
        approvePublicationApprovalRequest(input: ApprovePublicationRequestInput) {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            const requestId = requireNonBlank(input.requestId, 'requestId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = options.loadActor(projectId, subjectId)
            const request = loadRequestStatement.get(projectId, requestId, publicationId)
            if (actor === null || request === null) return null
            if (request.state !== 'pending') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot approve an approval request in the ${request.state} state`
                )
            }
            const timestamp = requireTimestamp(options.now(), 'now')
            if (input.publishNow === true && input.scheduledAt !== undefined) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Choose either an explicit schedule or publish now, not both'
                )
            }
            if (
                request.proposedScheduledAt <= timestamp &&
                input.scheduledAt === undefined &&
                input.publishNow !== true
            ) {
                throw new DomainInvariantError(
                    'invalid_time',
                    'The proposed time has passed; choose a new time or explicitly publish now'
                )
            }
            const scheduledAt =
                input.scheduledAt === undefined
                    ? request.proposedScheduledAt
                    : requireTimestamp(input.scheduledAt, 'scheduledAt')
            if (input.publishNow !== true && scheduledAt < timestamp) {
                throw new DomainInvariantError(
                    'invalid_time',
                    'The approved schedule must not be before now'
                )
            }
            return options.promotePublicationDraft({
                projectId,
                publicationId,
                subjectId,
                expectedRevision: request.draftRevision,
                ...(input.publishNow === true ? { publishNow: true } : { scheduledAt }),
                cadenceConfirmation: input.cadenceConfirmation,
                approvalRequestId: requestId,
            })
        },
        rejectPublicationApprovalRequest(input: DecidePublicationApprovalRequestInput) {
            return rejectRequestTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                requestId: requireNonBlank(input.requestId, 'requestId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}
