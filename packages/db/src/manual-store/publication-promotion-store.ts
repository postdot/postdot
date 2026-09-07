import {
    createJob,
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type ChannelProfileCompiler,
    type ChannelProfileDefinition,
    type DeliveryMode,
    type Publication,
} from '@herald/core'

import { createDatabaseTransaction, type HeraldDatabase } from '../client'
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
    database: HeraldDatabase,
    options: PublicationPromotionStoreOptions
) {
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
                input.scheduledAt === undefined
                    ? publicationRow.scheduledAt
                    : input.scheduledAt === null
                      ? null
                      : requireTimestamp(input.scheduledAt, 'scheduledAt')
            if (scheduledAt !== null && scheduledAt < timestamp) {
                throw new DomainInvariantError('invalid_time', 'scheduledAt must not be before now')
            }
            const nextState: 'draft' | 'scheduled' = scheduledAt === null ? 'draft' : 'scheduled'
            const targetRevisionId = options.createId()
            const sequence =
                (nextTargetRevisionSequenceStatement.get(input.projectId, input.publicationId)
                    ?.sequence ?? 0) + 1
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

            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actorRow.id,
                action: 'publication.target_promoted',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({ targetRevisionId, sequence, scheduledAt }),
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
