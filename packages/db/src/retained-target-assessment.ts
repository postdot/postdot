import type { ValidationIssue } from '@postdot/core'

import { recordDatabaseCommitProject, type DatabaseHandle } from './client'
import { createEventJournalStore } from './event-journal-store'
import { assessChannelProfileChangeAsync } from './manual-store/channel-profile-impact'
import { parseJsonObject, parseProfile } from './manual-store/content-codec'
import { assessPinnedTargetMedia } from './manual-store/publication-media'
import type { TargetRevisionMediaRow } from './manual-store/rows'
import { createSystemMediaReader } from './media-asset-store'

/** Reassess the immutable selected target, never the mutable working draft. */
export function createRetainedTargetAssessor(
    database: DatabaseHandle,
    publicMediaUrlAvailable = false
) {
    const sql = database.sql
    // System work owns project data independently of the original author's current membership.
    const media = createSystemMediaReader(database)
    return async (projectId: string, publicationId: string, actorId: string, at: number) => {
        const row = await sql
            .statement<
                {
                    activeId: string
                    activeJson: string
                    activeState: string
                    ownedId: string
                    ownedJson: string
                    ownedState: string
                    contentJson: string
                    targetId: string
                    reviewState: string
                    assessedId: string | null
                    issuesJson: string
                },
                [string, string]
            >(`
            select active.id as activeId, active.profile_json as activeJson, active.state as activeState,
                   owned.id as ownedId, owned.profile_json as ownedJson, owned.state as ownedState,
                   target.content_json as contentJson, target.id as targetId,
                   p.review_state as reviewState, p.last_assessed_profile_version_id as assessedId,
                   p.profile_assessment_issues_json as issuesJson
            from publications p
            join project_channel_contexts c on c.project_id = p.project_id and c.id = p.channel_id
            join project_channel_profile_contexts active on active.project_id = c.project_id and active.id = c.profile_version_id and active.channel_id = c.id
            join publication_target_revisions target on target.project_id = p.project_id and target.id = p.target_revision_id and target.publication_id = p.id
            join project_channel_profile_contexts owned on owned.project_id = target.project_id and owned.id = target.profile_version_id and owned.channel_id = c.id
            where p.project_id = ? and p.id = ?
        `)
            .get(projectId, publicationId)
        if (!row) return false
        // Ordinary same-profile execution retains its existing media/integrity checks.
        if (
            row.activeId === row.ownedId &&
            row.activeState !== 'disabled' &&
            row.ownedState !== 'disabled'
        )
            return row.reviewState === 'compatible'
        const pinned = await sql
            .statement<TargetRevisionMediaRow, [string, string]>(`
            select id, project_id as projectId, target_revision_id as targetRevisionId,
                   asset_id as assetId, representation_id as representationId, position,
                   content_path as contentPath, role, accessibility_text as accessibilityText
            from publication_revision_media where project_id = ? and target_revision_id = ? order by position, id
        `)
            .all(projectId, row.targetId)
        const result = await assessChannelProfileChangeAsync(
            {
                currentProfile: parseProfile(row.ownedJson),
                proposedProfile: parseProfile(row.activeJson),
                pendingTargets: [
                    {
                        id: publicationId,
                        kind: 'pending_target',
                        deliveryMode: 'automatic',
                        content: parseJsonObject(row.contentJson, 'selected target'),
                    },
                ],
            },
            (candidate, profile) =>
                assessPinnedTargetMedia(
                    profile,
                    candidate.content,
                    projectId,
                    actorId,
                    media,
                    pinned,
                    publicMediaUrlAvailable
                )
        )
        const issues: readonly ValidationIssue[] =
            row.activeState === 'disabled' || row.ownedState === 'disabled'
                ? [
                      {
                          path: '/execution',
                          code: 'profile.execution_disabled',
                          message: 'The selected or active profile is disabled',
                          source: 'module',
                          severity: 'error',
                      },
                  ]
                : result.ok
                  ? result.value.pendingTargets[0]!.issues
                  : result.issues
        const state = issues.some(issue => issue.severity === 'error')
            ? 'review_required'
            : 'compatible'
        const json = JSON.stringify(issues)
        if (
            row.assessedId !== row.activeId ||
            row.reviewState !== state ||
            row.issuesJson !== json
        ) {
            await sql
                .statement(
                    `update publications set review_state = ?, profile_assessment_issues_json = ?, last_assessed_profile_version_id = ?, updated_at = ? where project_id = ? and id = ?`
                )
                .run(state, json, row.activeId, at, projectId, publicationId)
            await createEventJournalStore(database).append({
                projectId,
                actorId,
                name: 'publication.profile_assessed',
                version: 1,
                subject: { type: 'publication', id: publicationId },
                payload: { profileVersionId: row.activeId, state, issues },
                occurredAt: at,
            })
            recordDatabaseCommitProject(database, projectId)
        }
        return state === 'compatible'
    }
}
