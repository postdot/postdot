import {
    adaptSourceContentToProfile,
    DomainInvariantError,
    requireTimestamp,
    requireNonBlank,
    validateSourceContent,
    type ChannelProfileDefinition,
    type PublicationReviewState,
    type ValidationIssue,
} from '@herald/core'

import type { HeraldDatabase } from '../client'
import type {
    PublicationWorkingDraft,
    RebasePublicationDraftInput,
    SavePublicationDraftInput,
} from '../manual-store'
import {
    canonicalJson,
    invalidProfileError,
    invalidSourceContentError,
    isRecord,
    parseProfile,
    parseSourceContent,
    requirePositiveRevision,
} from './content-codec'
import { toWorkingDraft } from './mappers'
import type { PublicationPromotionDependencies } from './publication-promotion-store'
import { createPublicationPromotionStore } from './publication-promotion-store'
import { createPublicationReadStore } from './publication-read-store'

export interface PublicationAuthoringStoreOptions extends PublicationPromotionDependencies {
    readonly assessWorkingDraftMedia: (
        profile: ChannelProfileDefinition,
        content: unknown,
        projectId: string,
        subjectId: string
    ) => readonly ValidationIssue[]
}

export function createPublicationAuthoringStore(
    database: HeraldDatabase,
    options: PublicationAuthoringStoreOptions
) {
    const client = database.$client
    const publicationReadStore = createPublicationReadStore(database, {
        loadActor: options.loadActor,
        loadPublication: options.loadPublication,
        loadChannel: options.loadChannel,
        loadProfile: options.loadProfile,
    })
    const loadWorkingDraft = publicationReadStore.loadWorkingDraft
    const publicationPromotionStore = createPublicationPromotionStore(database, {
        ...options,
        loadWorkingDraft,
    })
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
            baseSourceContentJson: string,
            contentJson: string,
            reviewState: PublicationReviewState,
            validationIssuesJson: string,
            lastAssessedProfileVersionId: string | null,
            updatedByActorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
            expectedRevision: number,
        ]
    >(`
        update publication_working_drafts
        set source_revision = ?1,
            base_source_content = ?2,
            content_json = ?3,
            review_state = ?4,
            validation_issues_json = ?5,
            last_assessed_profile_version_id = ?6,
            revision = revision + 1,
            updated_by_actor_id = ?7,
            updated_at = ?8
        where project_id = ?9
          and publication_id = ?10
          and revision = ?11
    `)
    const rebaseWorkingDraftStatement = client.query<
        { changes: number },
        [
            sourceRevision: number,
            baseSourceContentJson: string,
            updatedByActorId: string,
            updatedAt: number,
            projectId: string,
            publicationId: string,
            expectedRevision: number,
        ]
    >(`
        update publication_working_drafts
        set source_revision = ?1,
            base_source_content = ?2,
            revision = revision + 1,
            updated_by_actor_id = ?3,
            updated_at = ?4
        where project_id = ?5
          and publication_id = ?6
          and revision = ?7
    `)
    const savePublicationDraftTransaction = client.transaction(
        (input: SavePublicationDraftInput): PublicationWorkingDraft | null => {
            if (input.sourceContent === undefined && input.targetContent === undefined) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'A publication draft must include sourceContent or targetContent'
                )
            }

            const actorRow = options.loadActor(input.projectId, input.subjectId)
            const publicationRow = options.loadPublication(input.projectId, input.publicationId)
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

            const draftRow = loadWorkingDraft(input.projectId, input.publicationId)
            const postRow = options.loadPostSource(input.projectId, publicationRow.postId)
            if (draftRow === null || postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has incomplete draft state`
                )
            }
            const channelRow = options.loadChannel(input.projectId, publicationRow.channelId)
            const profileRow = options.loadProfile(input.projectId, draftRow.profileVersionId)
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
            if (channelRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot edit a publication for an ${channelRow.state} channel`
                )
            }
            if (input.expectedRevision !== draftRow.revision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed after revision ${input.expectedRevision}`
                )
            }
            if (postRow.sourceRevision !== draftRow.sourceRevision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Source post ${postRow.id} changed after this publication draft was loaded`
                )
            }
            const profileResult = options.profileCompiler.compile(
                parseProfile(profileRow.profileJson)
            )
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
            const mediaIssues = options.assessWorkingDraftMedia(
                profileResult.value.profile,
                targetContent,
                input.projectId,
                input.subjectId
            )
            const validationIssues = [...validation.issues, ...mediaIssues]
            const reviewState: PublicationReviewState =
                validation.ok && mediaIssues.length === 0 ? 'compatible' : 'review_required'
            const timestamp = requireTimestamp(options.now(), 'now')
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
                sourceChanged ? sourceContentJson : draftRow.baseSourceContentJson,
                targetContentJson,
                reviewState,
                JSON.stringify(validationIssues),
                draftRow.profileVersionId,
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

            const updated = loadWorkingDraft(input.projectId, input.publicationId)
            if (updated === null)
                throw new DomainInvariantError('invalid_input', 'Draft disappeared')
            return toWorkingDraft(updated)
        }
    )

    const rebasePublicationDraftTransaction = client.transaction(
        (input: RebasePublicationDraftInput): PublicationWorkingDraft | null => {
            const actorRow = options.loadActor(input.projectId, input.subjectId)
            const publicationRow = options.loadPublication(input.projectId, input.publicationId)
            const draftRow = loadWorkingDraft(input.projectId, input.publicationId)
            if (actorRow === null || publicationRow === null || draftRow === null) return null
            if (
                ['ready', 'publishing', 'published', 'ambiguous', 'cancelled'].includes(
                    publicationRow.state
                )
            ) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot rebase a ${publicationRow.state} publication`
                )
            }
            if (input.expectedRevision !== draftRow.revision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed after revision ${input.expectedRevision}`
                )
            }

            const postRow = options.loadPostSource(input.projectId, publicationRow.postId)
            if (postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has no source post`
                )
            }
            const channelRow = options.loadChannel(input.projectId, publicationRow.channelId)
            if (channelRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has no channel`
                )
            }
            if (channelRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot rebase a publication for an ${channelRow.state} channel`
                )
            }
            if (postRow.sourceRevision < draftRow.sourceRevision) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has a source revision newer than its post`
                )
            }
            if (postRow.sourceRevision === draftRow.sourceRevision) {
                return toWorkingDraft(draftRow)
            }

            const timestamp = requireTimestamp(options.now(), 'now')
            const update = rebaseWorkingDraftStatement.run(
                postRow.sourceRevision,
                postRow.sourceContentJson,
                actorRow.id,
                timestamp,
                input.projectId,
                input.publicationId,
                input.expectedRevision
            )
            if (update.changes !== 1) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed before it could be rebased`
                )
            }
            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actorRow.id,
                action: 'publication.draft.rebased',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({
                    fromSourceRevision: draftRow.sourceRevision,
                    toSourceRevision: postRow.sourceRevision,
                    targetPreserved: true,
                }),
                createdAt: timestamp,
            })

            const rebased = loadWorkingDraft(input.projectId, input.publicationId)
            if (rebased === null) {
                throw new DomainInvariantError('invalid_input', 'Draft disappeared after rebase')
            }
            return toWorkingDraft(rebased)
        }
    )

    return {
        ...publicationReadStore.api,
        ...publicationPromotionStore,

        savePublicationDraft(input: SavePublicationDraftInput): PublicationWorkingDraft | null {
            return savePublicationDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requirePositiveRevision(input.expectedRevision),
            })
        },

        rebasePublicationDraft(input: RebasePublicationDraftInput): PublicationWorkingDraft | null {
            return rebasePublicationDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requirePositiveRevision(input.expectedRevision),
            })
        },
    }
}
