import {
    createJob,
    DomainInvariantError,
    hasValidationErrors,
    requireNonBlank,
    requireTimestamp,
    type ChannelProfileCompiler,
    type ChannelProfileDefinition,
    type DeliveryMode,
    type Publication,
    type ValidationIssue,
} from '@postdot/core'

import { createChannelCadenceStore } from '../channel-cadence'
import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostdotDatabase,
} from '../client'
import type { PromotePublicationDraftInput } from '../manual-store'
import {
    canonicalJson,
    contentHash,
    invalidProfileError,
    invalidTargetContentError,
    parseJsonObject,
    parseProfile,
    requirePositiveRevision,
} from './content-codec'
import { toPublication, toPublisher } from './mappers'
import type {
    ActorRow,
    PostSourceRow,
    ProfileRow,
    PublicationChannelRow,
    PublicationRow,
    ResolvedTargetMedia,
    WorkingDraftRow,
} from './rows'

interface ActiveJobRow {
    readonly id: string
    readonly state: 'pending' | 'running'
}

interface PendingApprovalRequestRow {
    readonly id: string
    readonly targetRevisionId: string
    readonly draftRevision: number
    readonly proposedScheduledAt: number
}

interface ApprovalTargetRevisionRow {
    readonly sequence: number
    readonly profileVersionId: string
    readonly sourceRevision: number
    readonly deliveryMode: DeliveryMode
    readonly mediaReferenceCount: number
    readonly contentHash: string
    readonly profileHash: string
    readonly schemaHash: string
}

interface TargetRevisionInsert {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly sequence: number
    readonly profileVersionId: string
    readonly sourceRevision: number
    readonly deliveryMode: DeliveryMode
    readonly mediaReferenceCount: number
    readonly contentJson: string
    readonly contentHash: string
    readonly profileHash: string
    readonly schemaHash: string
    readonly validationIssuesJson: string
    readonly createdByActorId: string
    readonly createdAt: number
}

interface TargetRevisionMediaInsert {
    readonly id: string
    readonly projectId: string
    readonly targetRevisionId: string
    readonly assetId: string
    readonly representationId: string
    readonly position: number
    readonly contentPath: string
    readonly role: string | null
    readonly accessibilityText: string | null
    readonly createdAt: number
}

interface JobInsert {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly runAt: number
    readonly createdAt: number
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

export interface PublicationPromotionDependencies {
    readonly now: () => number
    readonly createId: () => string
    readonly profileCompiler: ChannelProfileCompiler
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly loadPublication: (projectId: string, publicationId: string) => PublicationRow | null
    readonly loadPostSource: (projectId: string, postId: string) => PostSourceRow | null
    readonly loadChannel: (projectId: string, channelId: string) => PublicationChannelRow | null
    readonly loadProfile: (projectId: string, profileId: string) => ProfileRow | null
    readonly loadActiveJob: (projectId: string, publicationId: string) => ActiveJobRow | null
    readonly assessActiveProfileMedia: (
        profile: ChannelProfileDefinition,
        content: Record<string, unknown>,
        projectId: string,
        subjectId: string
    ) => readonly ValidationIssue[]
    readonly resolveTargetMedia: (
        profile: ChannelProfileDefinition,
        content: Record<string, unknown>,
        projectId: string,
        subjectId: string
    ) => readonly ResolvedTargetMedia[]
    readonly updatePendingJob: (
        projectId: string,
        jobId: string,
        runAt: number,
        updatedAt: number
    ) => boolean
    readonly cancelPendingJob: (projectId: string, jobId: string, completedAt: number) => boolean
    readonly insertTargetRevision: (input: TargetRevisionInsert) => void
    readonly insertTargetRevisionMedia: (input: TargetRevisionMediaInsert) => void
    readonly insertJob: (input: JobInsert) => void
    readonly insertAuditEvent: (input: AuditEventInsert) => void
}

export interface PublicationPromotionStoreOptions extends PublicationPromotionDependencies {
    readonly loadWorkingDraft: (projectId: string, publicationId: string) => WorkingDraftRow | null
}

export function createPublicationPromotionStore(
    database: PostdotDatabase,
    options: PublicationPromotionStoreOptions
) {
    const cadence = createChannelCadenceStore(database)
    const client = database.$client
    const nextTargetRevisionSequenceStatement = client.query<
        { sequence: number | null },
        [projectId: string, publicationId: string]
    >(`
        select max(sequence) as sequence
        from publication_target_revisions
        where project_id = ?1
          and publication_id = ?2
    `)
    const loadPendingApprovalRequestStatement = client.query<
        PendingApprovalRequestRow,
        [projectId: string, publicationId: string]
    >(`
        select id,
               target_revision_id as targetRevisionId,
               draft_revision as draftRevision,
               proposed_scheduled_at as proposedScheduledAt
        from publication_approval_requests
        where project_id = ?1
          and publication_id = ?2
          and state = 'pending'
        limit 1
    `)
    const loadApprovalTargetRevisionStatement = client.query<
        ApprovalTargetRevisionRow,
        [projectId: string, publicationId: string, targetRevisionId: string]
    >(`
        select sequence,
               profile_version_id as profileVersionId,
               source_revision as sourceRevision,
               delivery_mode as deliveryMode,
               media_reference_count as mediaReferenceCount,
               content_hash as contentHash,
               profile_hash as profileHash,
               schema_hash as schemaHash
        from publication_target_revisions
        where project_id = ?1
          and publication_id = ?2
          and id = ?3
    `)
    const approveRequestStatement = client.query<
        { changes: number },
        [
            scheduledAt: number,
            actorId: string,
            decidedAt: number,
            updatedAt: number,
            projectId: string,
            requestId: string,
            publicationId: string,
            targetRevisionId: string,
            draftRevision: number,
        ]
    >(`
        update publication_approval_requests
        set state = 'approved',
            decided_by_actor_id = ?2,
            decided_at = ?3,
            scheduled_at = ?1,
            updated_at = ?4
        where project_id = ?5
          and id = ?6
          and publication_id = ?7
          and target_revision_id = ?8
          and draft_revision = ?9
        and state = 'pending'
    `)
    const insertApprovalRequestStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            publicationId: string,
            targetRevisionId: string,
            draftRevision: number,
            proposedScheduledAt: number,
            requestedByActorId: string,
            createdAt: number,
        ]
    >(`
        insert into publication_approval_requests (
            id,
            project_id,
            publication_id,
            target_revision_id,
            draft_revision,
            proposed_scheduled_at,
            state,
            requested_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?8)
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

    function invalidActiveProfileContentError(
        activeProfile: ChannelProfileDefinition,
        ownedProfile: ChannelProfileDefinition,
        issues: readonly ValidationIssue[]
    ): DomainInvariantError {
        const reported = issues
            .filter(issue => issue.severity === 'error')
            .map(issue => issue.message)
            .join('; ')
        return new DomainInvariantError(
            'invalid_content',
            `Publication target content is incompatible with the active channel profile ${activeProfile.id} v${activeProfile.version} while it satisfies ${ownedProfile.id} v${ownedProfile.version}: ${reported}`
        )
    }

    const promotePublicationDraftTransaction = createDatabaseTransaction(
        database,
        (input: PromotePublicationDraftInput): Publication | null => {
            const actorRow = options.loadActor(input.projectId, input.subjectId)
            const publicationRow = options.loadPublication(input.projectId, input.publicationId)
            const draftRow = options.loadWorkingDraft(input.projectId, input.publicationId)
            if (actorRow === null || publicationRow === null || draftRow === null) return null
            if (input.expectedRevision !== draftRow.revision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed after revision ${input.expectedRevision}`
                )
            }
            const pendingApprovalRequest = loadPendingApprovalRequestStatement.get(
                input.projectId,
                input.publicationId
            )
            if (input.approvalRequestId === undefined && pendingApprovalRequest !== null) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    'This publication is awaiting approval and cannot be scheduled directly'
                )
            }
            if (
                input.approvalRequestId !== undefined &&
                (pendingApprovalRequest === null ||
                    pendingApprovalRequest.id !== input.approvalRequestId ||
                    pendingApprovalRequest.targetRevisionId !== publicationRow.targetRevisionId ||
                    pendingApprovalRequest.draftRevision !== draftRow.revision)
            ) {
                throw new DomainInvariantError(
                    'write_conflict',
                    'The approval request no longer matches the current publication draft'
                )
            }
            if (
                input.publishNow === true &&
                (input.scheduledAt !== undefined || input.approvalRequestId === undefined)
            ) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Immediate publication requires an approval request and cannot include a schedule'
                )
            }
            if (
                pendingApprovalRequest !== null &&
                input.scheduledAt == null &&
                input.publishNow !== true
            ) {
                throw new DomainInvariantError(
                    'invalid_time',
                    'Approving a publication requires an explicit scheduled time'
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

            const postRow = options.loadPostSource(input.projectId, publicationRow.postId)
            if (postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has no source post`
                )
            }
            if (postRow.sourceRevision !== draftRow.sourceRevision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Source post ${publicationRow.postId} changed after this publication draft was loaded`
                )
            }

            const profileRow = options.loadProfile(input.projectId, draftRow.profileVersionId)
            const channelRow = options.loadChannel(input.projectId, publicationRow.channelId)
            if (
                channelRow === null ||
                profileRow === null ||
                profileRow.channelId !== channelRow.id
            ) {
                throw new DomainInvariantError('invalid_input', 'Profile unavailable')
            }
            const activeProfileRow =
                draftRow.profileVersionId === channelRow.profileVersionId
                    ? profileRow
                    : options.loadProfile(input.projectId, channelRow.profileVersionId)
            if (activeProfileRow === null || activeProfileRow.channelId !== channelRow.id) {
                throw new DomainInvariantError('invalid_input', 'Profile unavailable')
            }
            if (channelRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot promote a publication for an ${channelRow.state} channel`
                )
            }
            const profileResult = options.profileCompiler.compile(
                parseProfile(profileRow.profileJson)
            )
            if (!profileResult.ok) throw invalidProfileError(profileResult.issues)
            const content = parseJsonObject(draftRow.contentJson, 'publication draft content')
            const validation = profileResult.value.validate(content)
            if (!validation.ok) throw invalidTargetContentError(validation.issues)
            if (activeProfileRow.id !== profileRow.id) {
                const activeProfileResult = options.profileCompiler.compile(
                    parseProfile(activeProfileRow.profileJson)
                )
                if (!activeProfileResult.ok) throw invalidProfileError(activeProfileResult.issues)
                const activeProfile = activeProfileResult.value.profile
                const activeValidation = activeProfileResult.value.validate(content)
                const activeIssues: ValidationIssue[] = [
                    ...(activeValidation.ok ? [] : activeValidation.issues),
                    ...options.assessActiveProfileMedia(
                        activeProfile,
                        content,
                        input.projectId,
                        input.subjectId
                    ),
                ]
                if (
                    publicationRow.deliveryMode === 'automatic' &&
                    canonicalJson(profileResult.value.profile.execution) !==
                        canonicalJson(activeProfile.execution)
                ) {
                    activeIssues.push({
                        path: '/execution',
                        code: 'profile.execution_contract_changed',
                        message:
                            'The draft uses an execution contract changed by the active channel profile',
                        severity: 'error',
                        source: 'module',
                    })
                }
                if (hasValidationErrors(activeIssues)) {
                    throw invalidActiveProfileContentError(
                        activeProfile,
                        profileResult.value.profile,
                        activeIssues
                    )
                }
            }
            const targetMedia = options.resolveTargetMedia(
                profileResult.value.profile,
                content,
                input.projectId,
                input.subjectId
            )

            const timestamp = requireTimestamp(options.now(), 'now')
            const contentJson = canonicalJson(content)
            const activeJob = options.loadActiveJob(input.projectId, input.publicationId)
            if (activeJob?.state === 'running') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot promote publication ${input.publicationId} while its job is running`
                )
            }
            const scheduledAt =
                input.publishNow === true
                    ? timestamp
                    : input.scheduledAt === undefined
                      ? publicationRow.scheduledAt
                      : input.scheduledAt === null
                        ? null
                        : requireTimestamp(input.scheduledAt, 'scheduledAt')
            const approvalProposal = input.approvalRequest
            if (
                approvalProposal !== undefined &&
                (publicationRow.state !== 'draft' ||
                    publicationRow.scheduledAt !== null ||
                    scheduledAt !== null ||
                    input.approvalRequestId !== undefined)
            ) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    'Only an unscheduled draft can be submitted for approval'
                )
            }
            if (scheduledAt !== null && scheduledAt < timestamp) {
                throw new DomainInvariantError('invalid_time', 'scheduledAt must not be before now')
            }
            const proposedScheduledAt =
                approvalProposal === undefined
                    ? null
                    : requireTimestamp(approvalProposal.proposedScheduledAt, 'proposedScheduledAt')
            if (proposedScheduledAt !== null && proposedScheduledAt <= timestamp) {
                throw new DomainInvariantError(
                    'invalid_time',
                    'The proposed schedule must be in the future'
                )
            }
            const nextState: 'draft' | 'scheduled' = scheduledAt === null ? 'draft' : 'scheduled'
            const approvalTargetRevision =
                pendingApprovalRequest === null
                    ? null
                    : loadApprovalTargetRevisionStatement.get(
                          input.projectId,
                          input.publicationId,
                          pendingApprovalRequest.targetRevisionId
                      )
            if (
                pendingApprovalRequest !== null &&
                (approvalTargetRevision === null ||
                    approvalTargetRevision.profileVersionId !== draftRow.profileVersionId ||
                    approvalTargetRevision.sourceRevision !== draftRow.sourceRevision ||
                    approvalTargetRevision.deliveryMode !== publicationRow.deliveryMode ||
                    approvalTargetRevision.contentHash !== contentHash(content) ||
                    approvalTargetRevision.profileHash !==
                        profileResult.value.profile.profileHash ||
                    approvalTargetRevision.schemaHash !== profileResult.value.profile.schemaHash ||
                    approvalTargetRevision.mediaReferenceCount !== targetMedia.length)
            ) {
                throw new DomainInvariantError(
                    'write_conflict',
                    'The publication content no longer matches the revision requested for approval'
                )
            }
            cadence.check({
                projectId: input.projectId,
                actorId: actorRow.id,
                now: timestamp,
                confirmation: input.cadenceConfirmation,
                candidates: [
                    {
                        id: input.publicationId,
                        channelId: publicationRow.channelId,
                        at: scheduledAt,
                        immediate: input.publishNow === true,
                    },
                ],
            })
            const targetRevisionId = pendingApprovalRequest?.targetRevisionId ?? options.createId()
            const sequence =
                approvalTargetRevision?.sequence ??
                (nextTargetRevisionSequenceStatement.get(input.projectId, input.publicationId)
                    ?.sequence ?? 0) + 1
            if (approvalTargetRevision === null) {
                options.insertTargetRevision({
                    id: targetRevisionId,
                    projectId: input.projectId,
                    publicationId: input.publicationId,
                    sequence,
                    profileVersionId: draftRow.profileVersionId,
                    sourceRevision: draftRow.sourceRevision,
                    deliveryMode: publicationRow.deliveryMode,
                    mediaReferenceCount: targetMedia.length,
                    contentJson,
                    contentHash: contentHash(content),
                    profileHash: profileResult.value.profile.profileHash,
                    schemaHash: profileResult.value.profile.schemaHash,
                    validationIssuesJson: JSON.stringify(validation.issues),
                    createdByActorId: actorRow.id,
                    createdAt: timestamp,
                })
                for (const [position, mediaReference] of targetMedia.entries()) {
                    options.insertTargetRevisionMedia({
                        id: options.createId(),
                        projectId: input.projectId,
                        targetRevisionId,
                        assetId: mediaReference.reference.assetId,
                        representationId: mediaReference.representation.id,
                        position,
                        contentPath: mediaReference.reference.contentPath,
                        role: mediaReference.reference.role,
                        accessibilityText: mediaReference.accessibilityText,
                        createdAt: timestamp,
                    })
                }
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
                    if (
                        !options.updatePendingJob(
                            input.projectId,
                            activeJob.id,
                            scheduledAt as number,
                            timestamp
                        )
                    ) {
                        throw new DomainInvariantError(
                            'claim_mismatch',
                            `Could not reschedule job ${activeJob.id}`
                        )
                    }
                } else if (channelRow.publisherId !== null) {
                    const job = createJob({
                        id: options.createId(),
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
                    options.insertJob({
                        id: job.id,
                        projectId: job.projectId,
                        publicationId: job.publicationId,
                        runAt: job.runAt,
                        createdAt: timestamp,
                    })
                }
            } else if (activeJob !== null) {
                if (!options.cancelPendingJob(input.projectId, activeJob.id, timestamp)) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not cancel job ${activeJob.id}`
                    )
                }
            }

            if (pendingApprovalRequest !== null) {
                const approved = approveRequestStatement.run(
                    scheduledAt as number,
                    actorRow.id,
                    timestamp,
                    timestamp,
                    input.projectId,
                    pendingApprovalRequest.id,
                    input.publicationId,
                    pendingApprovalRequest.targetRevisionId,
                    draftRow.revision
                )
                if (approved.changes !== 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not approve publication request ${pendingApprovalRequest.id}`
                    )
                }
                options.insertAuditEvent({
                    id: options.createId(),
                    projectId: input.projectId,
                    actorId: actorRow.id,
                    action: 'publication.approval_approved',
                    entityType: 'publication',
                    entityId: input.publicationId,
                    metadataJson: JSON.stringify({
                        requestId: pendingApprovalRequest.id,
                        targetRevisionId: pendingApprovalRequest.targetRevisionId,
                        proposedScheduledAt: pendingApprovalRequest.proposedScheduledAt,
                        scheduledAt,
                    }),
                    createdAt: timestamp,
                })
            }

            if (approvalProposal !== undefined && proposedScheduledAt !== null) {
                insertApprovalRequestStatement.run(
                    requireNonBlank(approvalProposal.id, 'approval request id'),
                    input.projectId,
                    input.publicationId,
                    targetRevisionId,
                    draftRow.revision,
                    proposedScheduledAt,
                    actorRow.id,
                    timestamp
                )
                recordDatabaseCommitProject(database, input.projectId)
                options.insertAuditEvent({
                    id: options.createId(),
                    projectId: input.projectId,
                    actorId: actorRow.id,
                    action: 'publication.approval_requested',
                    entityType: 'publication',
                    entityId: input.publicationId,
                    metadataJson: JSON.stringify({
                        requestId: approvalProposal.id,
                        targetRevisionId,
                        proposedScheduledAt,
                    }),
                    createdAt: timestamp,
                })
            }

            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actorRow.id,
                action: 'publication.target_promoted',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({
                    targetRevisionId,
                    sequence,
                    scheduledAt,
                    deliveryMode: publicationRow.deliveryMode,
                    provider:
                        publicationRow.deliveryMode === 'manual'
                            ? 'manual'
                            : channelRow.publisherKind,
                }),
                createdAt: timestamp,
            })
            const updated = options.loadPublication(input.projectId, input.publicationId)
            return updated === null ? null : toPublication(updated)
        }
    )

    return {
        promotePublicationDraft(input: PromotePublicationDraftInput): Publication | null {
            return promotePublicationDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requirePositiveRevision(input.expectedRevision),
            })
        },
    }
}
