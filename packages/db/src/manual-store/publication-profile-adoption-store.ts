import { DomainInvariantError, requireNonBlank, requireTimestamp } from '@postdot/core'

import { createDatabaseTransaction, type PostbotDatabase } from '../client'
import type { AdoptPublicationDraftProfileInput } from '../manual-store'
import {
    canonicalJson,
    contentHash,
    invalidProfileError,
    invalidTargetContentError,
    isRecord,
    parseProfile,
    requirePositiveRevision,
} from './content-codec'
import { toWorkingDraft } from './mappers'
import type { PublicationAuthoringStoreOptions } from './publication-authoring-store'
import type { WorkingDraftRow } from './rows'

export function createPublicationProfileAdoptionStore(
    database: PostbotDatabase,
    options: PublicationAuthoringStoreOptions & {
        loadWorkingDraft: (projectId: string, publicationId: string) => WorkingDraftRow | null
        supersedePendingApprovalRequest: (
            projectId: string,
            publicationId: string,
            actorId: string,
            timestamp: number
        ) => void
    }
) {
    const client = database.$client
    const adopt = createDatabaseTransaction(
        database,
        (input: AdoptPublicationDraftProfileInput) => {
            const actor = options.loadActor(input.projectId, input.subjectId)
            const publication = options.loadPublication(input.projectId, input.publicationId)
            if (actor === null || publication === null) return null
            if (
                ['ready', 'publishing', 'published', 'ambiguous', 'cancelled'].includes(
                    publication.state
                )
            ) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    'This publication cannot adopt a profile'
                )
            }
            const draft = options.loadWorkingDraft(input.projectId, input.publicationId)
            const channel = options.loadChannel(input.projectId, publication.channelId)
            const source = options.loadPostSource(input.projectId, publication.postId)
            if (draft === null || channel === null || source === null) {
                throw new DomainInvariantError('invalid_input', 'Publication draft unavailable')
            }
            if (
                channel.state !== 'active' ||
                options.loadActiveJob(input.projectId, input.publicationId)?.state === 'running'
            ) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    'Profile adoption is unavailable'
                )
            }
            if (
                draft.revision !== input.expectedRevision ||
                draft.profileVersionId !== input.expectedProfileVersionId ||
                draft.sourceRevision !== input.expectedSourceRevision ||
                source.sourceRevision !== input.expectedSourceRevision ||
                channel.profileVersionId !== input.activeProfileVersionId
            ) {
                throw new DomainInvariantError(
                    'write_conflict',
                    'The draft, source or active profile changed; review the adaptation again'
                )
            }
            if (draft.profileVersionId === channel.profileVersionId) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    'The draft already uses the active profile'
                )
            }
            if (
                !isRecord(input.targetContent) ||
                (input.previousLocalContent !== undefined && !isRecord(input.previousLocalContent))
            ) {
                throw new DomainInvariantError(
                    'invalid_content',
                    'Adaptation content must be a JSON object'
                )
            }
            const profile = options.loadProfile(input.projectId, channel.profileVersionId)
            if (profile === null || profile.channelId !== channel.id)
                throw new DomainInvariantError('invalid_input', 'Profile unavailable')
            const compiled = options.profileCompiler.compile(parseProfile(profile.profileJson))
            if (!compiled.ok) throw invalidProfileError(compiled.issues)
            const validation = compiled.value.validate(input.targetContent)
            const issues = [
                ...validation.issues,
                ...options.assessWorkingDraftMedia(
                    compiled.value.profile,
                    input.targetContent,
                    input.projectId,
                    input.subjectId
                ),
            ]
            if (!validation.ok || issues.length > 0) throw invalidTargetContentError(issues)
            const media = options.resolveTargetMedia(
                compiled.value.profile,
                input.targetContent,
                input.projectId,
                input.subjectId
            )
            const timestamp = requireTimestamp(options.now(), 'now')
            const targetId = options.createId()
            const sequence =
                (client
                    .query<{ sequence: number }, [string, string]>(
                        'select coalesce(max(sequence), 0) as sequence from publication_target_revisions where project_id = ?1 and publication_id = ?2'
                    )
                    .get(input.projectId, input.publicationId)?.sequence ?? 0) + 1
            options.insertTargetRevision({
                id: targetId,
                projectId: input.projectId,
                publicationId: input.publicationId,
                sequence,
                profileVersionId: profile.id,
                sourceRevision: draft.sourceRevision,
                deliveryMode: publication.deliveryMode,
                mediaReferenceCount: media.length,
                contentJson: canonicalJson(input.targetContent),
                contentHash: contentHash(input.targetContent),
                profileHash: compiled.value.profile.profileHash,
                schemaHash: compiled.value.profile.schemaHash,
                validationIssuesJson: '[]',
                createdByActorId: actor.id,
                createdAt: timestamp,
            })
            for (const [position, entry] of media.entries())
                options.insertTargetRevisionMedia({
                    id: options.createId(),
                    projectId: input.projectId,
                    targetRevisionId: targetId,
                    position,
                    assetId: entry.reference.assetId,
                    representationId: entry.representation.id,
                    contentPath: entry.reference.contentPath,
                    role: entry.reference.role,
                    accessibilityText: entry.accessibilityText,
                    createdAt: timestamp,
                })
            const snapshotId = options.createId()
            client
                .query(`insert into publication_draft_adoptions
            (id, project_id, publication_id, profile_version_id, adopted_profile_version_id, snapshot_json, local_content_json, target_revision_id, created_by_actor_id, created_at)
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
                .run(
                    snapshotId,
                    input.projectId,
                    input.publicationId,
                    draft.profileVersionId,
                    profile.id,
                    canonicalJson(toWorkingDraft(draft)),
                    input.previousLocalContent === undefined
                        ? null
                        : canonicalJson(input.previousLocalContent),
                    targetId,
                    actor.id,
                    timestamp
                )
            const updated = client
                .query(`update publication_working_drafts set profile_version_id = ?1, content_json = ?2,
            revision = revision + 1, review_state = 'compatible', validation_issues_json = '[]', last_assessed_profile_version_id = ?1,
            updated_by_actor_id = ?3, updated_at = ?4 where project_id = ?5 and publication_id = ?6 and revision = ?7`)
                .run(
                    profile.id,
                    canonicalJson(input.targetContent),
                    actor.id,
                    timestamp,
                    input.projectId,
                    input.publicationId,
                    input.expectedRevision
                )
            if (updated.changes !== 1)
                throw new DomainInvariantError(
                    'write_conflict',
                    'The draft changed during adoption'
                )
            options.supersedePendingApprovalRequest(
                input.projectId,
                input.publicationId,
                actor.id,
                timestamp
            )
            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actor.id,
                action: 'publication.profile_adopted',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({
                    snapshotId,
                    targetRevisionId: targetId,
                    previousProfileVersionId: draft.profileVersionId,
                    profileVersionId: profile.id,
                    previousDraftRevision: draft.revision,
                    draftRevision: draft.revision + 1,
                }),
                createdAt: timestamp,
            })
            const result = options.loadWorkingDraft(input.projectId, input.publicationId)
            return result === null ? null : toWorkingDraft(result)
        }
    )
    return {
        assessPublicationDraftAdoption(input: AdoptPublicationDraftProfileInput) {
            const publication = options.loadPublication(input.projectId, input.publicationId)
            if (
                publication === null ||
                options.loadActor(input.projectId, input.subjectId) === null
            )
                return null
            const channel = options.loadChannel(input.projectId, publication.channelId)
            if (channel === null || channel.profileVersionId !== input.activeProfileVersionId)
                throw new DomainInvariantError('write_conflict', 'The active profile changed')
            const profile = options.loadProfile(input.projectId, channel.profileVersionId)
            if (profile === null)
                throw new DomainInvariantError('invalid_input', 'Profile unavailable')
            const compiled = options.profileCompiler.compile(parseProfile(profile.profileJson))
            if (!compiled.ok) throw invalidProfileError(compiled.issues)
            const validation = compiled.value.validate(input.targetContent)
            const issues = [
                ...validation.issues,
                ...options.assessWorkingDraftMedia(
                    compiled.value.profile,
                    input.targetContent,
                    input.projectId,
                    input.subjectId
                ),
            ]
            return {
                valid: validation.ok && issues.length === 0,
                issues: issues.map(issue => ({ ...issue })),
            }
        },
        adoptPublicationDraftProfile(input: AdoptPublicationDraftProfileInput) {
            return adopt.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requirePositiveRevision(input.expectedRevision),
                expectedSourceRevision: requirePositiveRevision(input.expectedSourceRevision),
                expectedProfileVersionId: requireNonBlank(
                    input.expectedProfileVersionId,
                    'expectedProfileVersionId'
                ),
                activeProfileVersionId: requireNonBlank(
                    input.activeProfileVersionId,
                    'activeProfileVersionId'
                ),
            })
        },
        listPublicationDraftAdoptions(projectId: string, publicationId: string, subjectId: string) {
            if (
                options.loadActor(projectId, subjectId) === null ||
                options.loadPublication(projectId, publicationId) === null
            )
                return null
            return client
                .query<
                    {
                        id: string
                        snapshotJson: string
                        localContentJson: string | null
                        adoptedProfileVersionId: string
                        targetRevisionId: string
                        createdAt: number
                    },
                    [string, string]
                >(`
                select id, snapshot_json as snapshotJson, local_content_json as localContentJson,
                adopted_profile_version_id as adoptedProfileVersionId, target_revision_id as targetRevisionId, created_at as createdAt
                from publication_draft_adoptions where project_id = ?1 and publication_id = ?2 order by created_at desc, rowid desc
            `)
                .all(projectId, publicationId)
                .map(row => ({
                    id: row.id,
                    draft: JSON.parse(row.snapshotJson),
                    localContent:
                        row.localContentJson === null ? null : JSON.parse(row.localContentJson),
                    adoptedProfileVersionId: row.adoptedProfileVersionId,
                    targetRevisionId: row.targetRevisionId,
                    createdAt: row.createdAt,
                }))
        },
    }
}
