import {
    adaptSourceContentToProfile,
    applySourceContentToTarget,
    DomainInvariantError,
    requireTimestamp,
    requireNonBlank,
    validateSourceContent,
    type ChannelProfileDefinition,
    type PublicationReviewState,
    type Post,
    type Publication,
    type SourceContent,
    type ValidationIssue,
} from '@postdot/core'

import { defineTransaction, type DatabaseHandle } from '../client'
import type {
    PublicationWorkingDraft,
    RebasePublicationDraftInput,
    SavePublicationDraftInput,
    SavePostCompositionInput,
    SavePostSourceInput,
    ReschedulePublicationsInput,
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
import { PostCompositionConflictError } from './post-composition-conflict'
import { createPublicationApprovalStore } from './publication-approval-store'
import { createPublicationProfileAdoptionStore } from './publication-profile-adoption-store'
import type { PublicationPromotionDependencies } from './publication-promotion-store'
import { createPublicationPromotionStore } from './publication-promotion-store'
import { createPublicationReadStore } from './publication-read-store'

export interface PublicationAuthoringStoreOptions extends PublicationPromotionDependencies {
    readonly getPost: (projectId: string, postId: string, subjectId: string) => Promise<Post | null>
    readonly savePostSource: (input: SavePostSourceInput) => Promise<Post | null>
    readonly reschedulePublications: (
        input: ReschedulePublicationsInput
    ) => Promise<readonly Publication[] | null>
    readonly assessWorkingDraftMedia: (
        profile: ChannelProfileDefinition,
        content: unknown,
        projectId: string,
        subjectId: string
    ) => Promise<readonly ValidationIssue[]>
}

export function createPublicationAuthoringStore(
    database: DatabaseHandle,
    options: PublicationAuthoringStoreOptions
) {
    const sql = database.sql
    const publicationReadStore = createPublicationReadStore(database, {
        now: options.now,
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
    const publicationApprovalStore = createPublicationApprovalStore(database, {
        ...options,
        promotePublicationDraft: publicationPromotionStore.promotePublicationDraft,
    })
    const updatePostSourceStatement = sql.statement<
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
    const updateWorkingDraftStatement = sql.statement<
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
    const rebaseWorkingDraftStatement = sql.statement<
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
    const listSiblingWorkingDraftsStatement = sql.statement<
        {
            publicationId: string
            profileVersionId: string
            sourceRevision: number
            contentJson: string
            revision: number
        },
        [projectId: string, postId: string]
    >(`
        select publication_working_drafts.publication_id as publicationId,
               publication_working_drafts.profile_version_id as profileVersionId,
               publication_working_drafts.source_revision as sourceRevision,
               publication_working_drafts.content_json as contentJson,
               publication_working_drafts.revision as revision
        from publication_working_drafts
        inner join publications
            on publications.project_id = publication_working_drafts.project_id
           and publications.id = publication_working_drafts.publication_id
        where publication_working_drafts.project_id = ?1
          and publications.post_id = ?2
          and publications.state in ('draft', 'scheduled', 'ready', 'failed')
    `)
    const supersedePendingApprovalRequestStatement = sql.statement<
        { changes: number },
        [
            decidedByActorId: string,
            decidedAt: number,
            updatedAt: number,
            projectId: string,
            publicationId: string,
        ]
    >(`
        update publication_approval_requests
        set state = 'superseded',
            decided_by_actor_id = ?1,
            decided_at = ?2,
            updated_at = ?3
        where project_id = ?4
          and publication_id = ?5
          and state = 'pending'
    `)
    const supersedePendingApprovalRequest = async (
        projectId: string,
        publicationId: string,
        actorId: string,
        timestamp: number
    ) => {
        const result = await supersedePendingApprovalRequestStatement.run(
            actorId,
            timestamp,
            timestamp,
            projectId,
            publicationId
        )
        if (result.changes === 1) {
            await options.insertAuditEvent({
                id: options.createId(),
                projectId,
                actorId,
                action: 'publication.approval_superseded',
                entityType: 'publication',
                entityId: publicationId,
                metadataJson: JSON.stringify({ reason: 'draft_changed' }),
                createdAt: timestamp,
            })
        }
    }
    const keepUnaffectedSiblingsCurrent = async (
        projectId: string,
        postId: string,
        sourceContent: SourceContent,
        sourceRevision: number,
        sourceContentJson: string,
        actorId: string,
        timestamp: number,
        excluded: ReadonlySet<string>
    ) => {
        // A sibling channel version that this change leaves exactly as it is stays
        // current: there is nothing to review, so it is not reported as behind. This
        // also settles siblings when a change is undone and the post returns to text
        // they already show. Versions the change would alter stay behind for review.
        const siblings = await listSiblingWorkingDraftsStatement.all(projectId, postId)
        for (const sibling of siblings) {
            if (excluded.has(sibling.publicationId) || sibling.sourceRevision >= sourceRevision)
                continue
            const siblingProfileRow = await options.loadProfile(projectId, sibling.profileVersionId)
            if (!siblingProfileRow) continue
            const siblingProfile = options.profileCompiler.compile(
                parseProfile(siblingProfileRow.profileJson)
            )
            if (!siblingProfile.ok) continue
            const siblingContent: unknown = JSON.parse(sibling.contentJson)
            if (!isRecord(siblingContent)) continue
            const projected = applySourceContentToTarget(
                sourceContent,
                siblingProfile.value.profile,
                siblingContent
            )
            if (canonicalJson(projected) !== canonicalJson(siblingContent)) continue
            await rebaseWorkingDraftStatement.run(
                sourceRevision,
                sourceContentJson,
                actorId,
                timestamp,
                projectId,
                sibling.publicationId,
                sibling.revision
            )
        }
    }
    const loadStartedThreadStatement = sql.statement<
        { position: number },
        [projectId: string, publicationId: string]
    >(`
        select messages.position
        from publication_thread_messages messages
        inner join publication_execution_revisions executions
            on executions.project_id = messages.project_id
           and executions.id = messages.execution_revision_id
        where executions.project_id = ?1
          and executions.publication_id = ?2
          and messages.state in ('confirmed', 'sending', 'ambiguous')
        limit 1
    `)
    const savePublicationDraftTransaction = defineTransaction(
        database,
        async (
            input: SavePublicationDraftInput,
            composition = false
        ): Promise<PublicationWorkingDraft | null> => {
            if (input.sourceContent === undefined && input.targetContent === undefined) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'A publication draft must include sourceContent or targetContent'
                )
            }

            const actorRow = await options.loadActor(input.projectId, input.subjectId)
            const publicationRow = await options.loadPublication(
                input.projectId,
                input.publicationId
            )
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

            if (await loadStartedThreadStatement.get(input.projectId, input.publicationId)) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    'A started thread keeps its original version'
                )
            }

            const draftRow = await loadWorkingDraft(input.projectId, input.publicationId)
            const postRow = await options.loadPostSource(input.projectId, publicationRow.postId)
            if (draftRow === null || postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has incomplete draft state`
                )
            }
            const channelRow = await options.loadChannel(input.projectId, publicationRow.channelId)
            const profileRow = await options.loadProfile(input.projectId, draftRow.profileVersionId)
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
            if (!composition && postRow.sourceRevision !== draftRow.sourceRevision) {
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
            const mediaIssues = await options.assessWorkingDraftMedia(
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
                const sourceUpdate = await updatePostSourceStatement.run(
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

            if (sourceChanged) {
                await keepUnaffectedSiblingsCurrent(
                    input.projectId,
                    publicationRow.postId,
                    sourceResult.value,
                    sourceRevision,
                    sourceContentJson,
                    actorRow.id,
                    timestamp,
                    new Set([input.publicationId])
                )
            }

            const draftUpdate = await updateWorkingDraftStatement.run(
                sourceRevision,
                sourceChanged || composition ? sourceContentJson : draftRow.baseSourceContentJson,
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
            await supersedePendingApprovalRequest(
                input.projectId,
                input.publicationId,
                actorRow.id,
                timestamp
            )

            const updated = await loadWorkingDraft(input.projectId, input.publicationId)
            if (updated === null)
                throw new DomainInvariantError('invalid_input', 'Draft disappeared')
            return toWorkingDraft(updated)
        }
    )

    const savePostCompositionTransaction = defineTransaction(
        database,
        async (input: SavePostCompositionInput) => {
            requirePositiveRevision(input.expectedSourceRevision)
            const actor = await options.loadActor(input.projectId, input.subjectId)
            const original = await options.loadPostSource(input.projectId, input.postId)
            if (actor === null || original === null) return null
            const ids = input.publications.map(item =>
                requireNonBlank(item.publicationId, 'publicationId')
            )
            if (new Set(ids).size !== ids.length) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Each publication must appear at most once'
                )
            }
            const conflicts: string[] = []
            const drafts = new Map<
                string,
                NonNullable<Awaited<ReturnType<typeof loadWorkingDraft>>>
            >()
            for (const item of input.publications) {
                requirePositiveRevision(item.expectedRevision)
                const publication = await options.loadPublication(
                    input.projectId,
                    item.publicationId
                )
                const draft = await loadWorkingDraft(input.projectId, item.publicationId)
                if (publication === null || publication.postId !== input.postId || draft === null) {
                    throw new DomainInvariantError(
                        'invalid_input',
                        'Every publication must belong to this post'
                    )
                }
                if (item.expectedRevision !== draft.revision) conflicts.push(item.publicationId)
                drafts.set(item.publicationId, draft)
            }
            if (original.sourceRevision !== input.expectedSourceRevision || conflicts.length > 0) {
                throw new PostCompositionConflictError(
                    original.sourceRevision !== input.expectedSourceRevision ? ids : conflicts
                )
            }
            const post =
                input.sourceContent === undefined
                    ? await options.getPost(input.projectId, input.postId, input.subjectId)
                    : await options.savePostSource({
                          ...input,
                          sourceContent: input.sourceContent,
                      })
            if (post === null) throw new DomainInvariantError('invalid_input', 'Post disappeared')
            const scheduledTimes = new Map<string, number>()
            for (const item of input.publications) {
                const publication = (await options.loadPublication(
                    input.projectId,
                    item.publicationId
                ))!
                // Delivery mode belongs to the publication and immutable selected target, not its draft.
                if (
                    item.deliveryMode !== undefined &&
                    item.deliveryMode !== publication.deliveryMode
                ) {
                    throw new DomainInvariantError(
                        'invalid_transition',
                        'Changing delivery mode requires the destination move workflow'
                    )
                }
                await savePublicationDraftTransaction.immediate(
                    {
                        projectId: input.projectId,
                        publicationId: item.publicationId,
                        subjectId: input.subjectId,
                        expectedRevision: item.expectedRevision,
                        targetContent:
                            item.targetContent ??
                            JSON.parse(drafts.get(item.publicationId)!.contentJson),
                    },
                    true
                )
                // Scheduling remains applied publication state. Draft scheduling requires promotion.
                if (
                    item.scheduledAt !== undefined &&
                    item.scheduledAt !== publication.scheduledAt
                ) {
                    if (item.scheduledAt === null) {
                        throw new DomainInvariantError(
                            'invalid_transition',
                            'Removing a schedule requires the existing publication lifecycle workflow'
                        )
                    }
                    scheduledTimes.set(item.publicationId, item.scheduledAt)
                }
            }
            if (scheduledTimes.size > 0) {
                const rescheduled = await options.reschedulePublications({
                    projectId: input.projectId,
                    publicationIds: [...scheduledTimes.keys()],
                    subjectId: input.subjectId,
                    scheduledAt: scheduledTimes.values().next().value!,
                    scheduledTimes: Object.fromEntries(scheduledTimes),
                })
                if (rescheduled === null)
                    throw new DomainInvariantError('invalid_input', 'Publication disappeared')
            }
            if (post.sourceRevision !== original.sourceRevision) {
                await keepUnaffectedSiblingsCurrent(
                    input.projectId,
                    input.postId,
                    post.sourceContent,
                    post.sourceRevision,
                    canonicalJson(post.sourceContent),
                    actor.id,
                    requireTimestamp(options.now(), 'now'),
                    new Set(ids)
                )
            }
            const publications = []
            for (const publicationId of ids) {
                const editor = await publicationReadStore.api.getPublicationEditorState(
                    input.projectId,
                    publicationId,
                    input.subjectId
                )
                if (editor === null)
                    throw new DomainInvariantError('invalid_input', 'Publication disappeared')
                publications.push(editor)
            }
            return {
                post,
                publications,
                sourceChanged: post.sourceRevision !== original.sourceRevision,
            }
        }
    )

    const rebasePublicationDraftTransaction = defineTransaction(
        database,
        async (input: RebasePublicationDraftInput): Promise<PublicationWorkingDraft | null> => {
            const actorRow = await options.loadActor(input.projectId, input.subjectId)
            const publicationRow = await options.loadPublication(
                input.projectId,
                input.publicationId
            )
            const draftRow = await loadWorkingDraft(input.projectId, input.publicationId)
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

            const postRow = await options.loadPostSource(input.projectId, publicationRow.postId)
            if (postRow === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Publication ${input.publicationId} has no source post`
                )
            }
            const channelRow = await options.loadChannel(input.projectId, publicationRow.channelId)
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
            if (input.replaceContent && input.expectedSourceRevision === undefined) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Source replacement requires its expected revision'
                )
            }
            if (
                input.expectedSourceRevision !== undefined &&
                input.expectedSourceRevision !== postRow.sourceRevision
            ) {
                throw new DomainInvariantError(
                    'write_conflict',
                    'The source changed during destination review'
                )
            }
            if (postRow.sourceRevision === draftRow.sourceRevision && !input.replaceContent) {
                return toWorkingDraft(draftRow)
            }

            const timestamp = requireTimestamp(options.now(), 'now')
            let update: { changes: number }
            if (input.replaceContent) {
                const profileRow = await options.loadProfile(
                    input.projectId,
                    draftRow.profileVersionId
                )
                if (!profileRow || profileRow.channelId !== channelRow.id) {
                    throw new DomainInvariantError('invalid_input', 'Draft profile unavailable')
                }
                const profile = options.profileCompiler.compile(
                    parseProfile(profileRow.profileJson)
                )
                if (!profile.ok) throw invalidProfileError(profile.issues)
                const content = applySourceContentToTarget(
                    parseSourceContent(postRow.sourceContentJson),
                    profile.value.profile,
                    JSON.parse(draftRow.contentJson)
                )
                const validation = profile.value.validate(content)
                const mediaIssues = await options.assessWorkingDraftMedia(
                    profile.value.profile,
                    content,
                    input.projectId,
                    input.subjectId
                )
                update = await updateWorkingDraftStatement.run(
                    postRow.sourceRevision,
                    postRow.sourceContentJson,
                    canonicalJson(content),
                    validation.ok && mediaIssues.length === 0 ? 'compatible' : 'review_required',
                    JSON.stringify([...validation.issues, ...mediaIssues]),
                    draftRow.profileVersionId,
                    actorRow.id,
                    timestamp,
                    input.projectId,
                    input.publicationId,
                    input.expectedRevision
                )
            } else {
                update = await rebaseWorkingDraftStatement.run(
                    postRow.sourceRevision,
                    postRow.sourceContentJson,
                    actorRow.id,
                    timestamp,
                    input.projectId,
                    input.publicationId,
                    input.expectedRevision
                )
            }
            if (update.changes !== 1) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Publication draft ${input.publicationId} changed before it could be rebased`
                )
            }
            await supersedePendingApprovalRequest(
                input.projectId,
                input.publicationId,
                actorRow.id,
                timestamp
            )
            await options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actorRow.id,
                action: 'publication.draft.rebased',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({
                    fromSourceRevision: draftRow.sourceRevision,
                    toSourceRevision: postRow.sourceRevision,
                    targetPreserved: !input.replaceContent,
                }),
                createdAt: timestamp,
            })

            const rebased = await loadWorkingDraft(input.projectId, input.publicationId)
            if (rebased === null) {
                throw new DomainInvariantError('invalid_input', 'Draft disappeared after rebase')
            }
            return toWorkingDraft(rebased)
        }
    )

    return {
        ...createPublicationProfileAdoptionStore(database, {
            ...options,
            loadWorkingDraft,
            supersedePendingApprovalRequest,
        }),
        ...publicationReadStore.api,
        ...publicationPromotionStore,
        ...publicationApprovalStore,

        async savePostComposition(input: SavePostCompositionInput) {
            return savePostCompositionTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                postId: requireNonBlank(input.postId, 'postId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        async savePublicationDraft(
            input: SavePublicationDraftInput
        ): Promise<PublicationWorkingDraft | null> {
            return savePublicationDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requirePositiveRevision(input.expectedRevision),
            })
        },

        async rebasePublicationDraft(
            input: RebasePublicationDraftInput
        ): Promise<PublicationWorkingDraft | null> {
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
