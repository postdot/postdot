import {
    assessChannelProfileChange,
    type ChannelProfileDefinition,
    type ChannelProfileImpactAssessment,
    type ValidationIssue,
} from '@postbot/core'

import type { PostbotDatabase } from '../client'
import { invalidProfileError, parseJsonObject } from './content-codec'
import type {
    ProfileImpactTargetRow,
    ProfileImpactWorkingDraftRow,
    ProfileRow,
    TargetRevisionMediaRow,
} from './rows'

export interface ChannelProfileImpactAssessorOptions {
    readonly parseProfile: (value: string) => ChannelProfileDefinition
    readonly validateWorkingDraftMedia: (
        profile: ChannelProfileDefinition,
        content: unknown,
        projectId: string,
        subjectId: string
    ) => readonly ValidationIssue[]
    readonly validatePinnedTargetMedia: (
        profile: ChannelProfileDefinition,
        content: unknown,
        projectId: string,
        subjectId: string,
        pinnedMedia: readonly TargetRevisionMediaRow[]
    ) => readonly ValidationIssue[]
}

export interface ChannelProfileImpactResult {
    readonly assessment: ChannelProfileImpactAssessment
    readonly workingDraftRows: readonly ProfileImpactWorkingDraftRow[]
    readonly targetRows: readonly ProfileImpactTargetRow[]
}

export function createChannelProfileImpactAssessor(
    database: PostbotDatabase,
    options: ChannelProfileImpactAssessorOptions
) {
    const client = database.$client

    const listProfileImpactWorkingDraftsStatement = client.query<
        ProfileImpactWorkingDraftRow,
        [projectId: string, channelId: string]
    >(`
        select drafts.id,
               drafts.publication_id as publicationId,
               drafts.content_json as contentJson,
               publications.delivery_mode as deliveryMode,
               drafts.revision
        from publication_working_drafts as drafts
        inner join publications
            on publications.project_id = drafts.project_id
           and publications.id = drafts.publication_id
        where drafts.project_id = ?1
          and publications.channel_id = ?2
          and publications.state in ('draft', 'scheduled', 'failed')
        order by drafts.id
    `)
    const listProfileImpactTargetsStatement = client.query<
        ProfileImpactTargetRow,
        [projectId: string, channelId: string]
    >(`
        select publications.id,
               publications.id as publicationId,
               publications.target_revision_id as targetRevisionId,
               target_revisions.content_json as contentJson,
               publications.delivery_mode as deliveryMode,
               publications.scheduled_at as scheduledAt,
               publications.state
        from publications
        inner join publication_target_revisions as target_revisions
            on target_revisions.project_id = publications.project_id
           and target_revisions.id = publications.target_revision_id
           and target_revisions.publication_id = publications.id
        where publications.project_id = ?1
          and publications.channel_id = ?2
          and publications.target_revision_id is not null
          and publications.state in ('scheduled', 'ready')
          and not exists (
              select 1
              from jobs
              where jobs.project_id = publications.project_id
                and jobs.publication_id = publications.id
                and jobs.state = 'running'
          )
        order by publications.scheduled_at, publications.id
    `)
    const listTargetRevisionMediaStatement = client.query<
        TargetRevisionMediaRow,
        [projectId: string, targetRevisionId: string]
    >(`
        select id,
               project_id as projectId,
               target_revision_id as targetRevisionId,
               asset_id as assetId,
               representation_id as representationId,
               position,
               content_path as contentPath,
               role,
               accessibility_text as accessibilityText
        from publication_revision_media
        where project_id = ?1
          and target_revision_id = ?2
        order by position, id
    `)

    return (
        projectId: string,
        channelId: string,
        currentProfileRow: ProfileRow,
        proposedProfileRow: ProfileRow,
        subjectId: string
    ): ChannelProfileImpactResult => {
        const workingDraftRows = listProfileImpactWorkingDraftsStatement.all(projectId, channelId)
        const targetRows = listProfileImpactTargetsStatement.all(projectId, channelId)
        const targetMediaByPublicationId = new Map<string, readonly TargetRevisionMediaRow[]>()

        for (const target of targetRows) {
            targetMediaByPublicationId.set(
                target.publicationId,
                listTargetRevisionMediaStatement.all(projectId, target.targetRevisionId)
            )
        }

        const assessmentResult = assessChannelProfileChange({
            currentProfile: options.parseProfile(currentProfileRow.profileJson),
            proposedProfile: options.parseProfile(proposedProfileRow.profileJson),
            workingDrafts: workingDraftRows.map(row => ({
                id: row.publicationId,
                kind: 'working_draft' as const,
                content: parseJsonObject(row.contentJson, 'publication working draft content'),
                deliveryMode: row.deliveryMode,
            })),
            pendingTargets: targetRows.map(row => ({
                id: row.publicationId,
                kind: 'pending_target' as const,
                content: parseJsonObject(row.contentJson, 'publication target content'),
                deliveryMode: row.deliveryMode,
            })),
            validateMedia: (candidate, profile) => {
                if (candidate.kind === 'working_draft') {
                    return options.validateWorkingDraftMedia(
                        profile,
                        candidate.content,
                        projectId,
                        subjectId
                    )
                }

                const target = targetRows.find(row => row.publicationId === candidate.id)
                if (target === undefined) {
                    return [
                        profileAssessmentIssue(
                            'profile.target_missing',
                            'The pending target could not be loaded during profile assessment'
                        ),
                    ]
                }

                return options.validatePinnedTargetMedia(
                    profile,
                    candidate.content,
                    projectId,
                    subjectId,
                    targetMediaByPublicationId.get(target.publicationId) ?? []
                )
            },
        })
        if (!assessmentResult.ok) throw invalidProfileError(assessmentResult.issues)

        return {
            assessment: assessmentResult.value,
            workingDraftRows,
            targetRows,
        }
    }
}

function profileAssessmentIssue(code: string, message: string, path = '/media'): ValidationIssue {
    return { path, code, message, severity: 'error', source: 'capability' }
}
