import {
    createPublicationTagFilter,
    DomainInvariantError,
    requireNonBlank,
    type PublicationTagFilter,
} from '@herald/core'

import type { HeraldDatabase } from '../client'
import type {
    PublicationEditorState,
    PublicationSummary,
    PublicationWorkingDraft,
} from '../manual-store'
import {
    toPost,
    toProfileVersion,
    toPublication,
    toPublicationSummary,
    toTargetRevision,
    toWorkingDraft,
} from './mappers'
import { toChannel } from './project-channel-mappers'
import type {
    ActorRow,
    PostRow,
    ProfileRow,
    PublicationChannelRow,
    PublicationRow,
    PublicationSummaryRow,
    TargetRevisionRow,
    WorkingDraftRow,
} from './rows'
import { publicationColumns } from './sql-fragments'

export interface PublicationReadStoreOptions {
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly loadPublication: (projectId: string, publicationId: string) => PublicationRow | null
    readonly loadChannel: (projectId: string, channelId: string) => PublicationChannelRow | null
    readonly loadProfile: (projectId: string, profileId: string) => ProfileRow | null
}

export interface PublicationReadStoreApi {
    readonly getPublicationWorkingDraft: (
        projectId: string,
        publicationId: string,
        subjectId: string
    ) => PublicationWorkingDraft | null
    readonly getPublicationEditorState: (
        projectId: string,
        publicationId: string,
        subjectId: string
    ) => PublicationEditorState | null
    readonly listPublicationSummaries: (
        projectId: string,
        subjectId: string,
        filter?: PublicationTagFilter
    ) => PublicationSummary[] | null
    readonly listPublicationSummaryPage: (
        projectId: string,
        subjectId: string,
        options?: PublicationSummaryPageOptions
    ) => PublicationSummaryPage | null
}

export interface PublicationSummaryPageOptions {
    readonly filter?: PublicationTagFilter
    readonly cursor?: string | null
    readonly limit?: number
    /** Inclusive UTC timestamp lower bound for scheduled publications. */
    readonly from?: number | null
    /** Exclusive UTC timestamp upper bound for scheduled publications. */
    readonly to?: number | null
}

export interface PublicationSummaryPage {
    readonly publications: PublicationSummary[]
    readonly nextCursor: string | null
}

export interface PublicationReadStoreHandle {
    readonly api: PublicationReadStoreApi
    readonly loadWorkingDraft: (projectId: string, publicationId: string) => WorkingDraftRow | null
}

export function createPublicationReadStore(
    database: HeraldDatabase,
    options: PublicationReadStoreOptions
): PublicationReadStoreHandle {
    const client = database.$client

    const loadPostStatement = client.query<PostRow, [projectId: string, postId: string]>(`
        select id,
               project_id as projectId,
               title,
               source_content as sourceContentJson,
               source_revision as sourceRevision,
               created_by_actor_id as createdByActorId,
               created_at as createdAt,
               updated_at as updatedAt
        from posts
        where project_id = ?1
          and id = ?2
    `)
    const loadWorkingDraftStatement = client.query<
        WorkingDraftRow,
        [projectId: string, publicationId: string]
    >(`
        select id,
               project_id as projectId,
               publication_id as publicationId,
               profile_version_id as profileVersionId,
               source_revision as sourceRevision,
               base_source_content as baseSourceContentJson,
               content_json as contentJson,
               review_state as reviewState,
               validation_issues_json as validationIssuesJson,
               last_assessed_profile_version_id as lastAssessedProfileVersionId,
               revision,
               updated_by_actor_id as updatedByActorId,
               created_at as createdAt,
               updated_at as updatedAt
        from publication_working_drafts
        where project_id = ?1
          and publication_id = ?2
    `)
    const loadTargetRevisionStatement = client.query<
        TargetRevisionRow,
        [projectId: string, targetRevisionId: string, publicationId: string]
    >(`
        select id,
               project_id as projectId,
               publication_id as publicationId,
               sequence,
               profile_version_id as profileVersionId,
               source_revision as sourceRevision,
               delivery_mode as deliveryMode,
               media_reference_count as mediaReferenceCount,
               content_json as contentJson,
               content_hash as contentHash,
               profile_hash as profileHash,
               schema_hash as schemaHash,
               validation_issues_json as validationIssuesJson,
               created_by_actor_id as createdByActorId,
               created_at as createdAt
        from publication_target_revisions
        where project_id = ?1
          and id = ?2
          and publication_id = ?3
    `)
    const listPublicationSummaryPageStatement = client.query<
        PublicationSummaryRow,
        [
            projectId: string,
            tagIdsJson: string,
            cursorBucket: number | null,
            cursorScheduledAt: number | null,
            cursorUpdatedAt: number | null,
            cursorId: string | null,
            from: number | null,
            to: number | null,
            limit: number,
        ]
    >(`
        with selected_tag_ids as (
            select value as tagId
            from json_each(?2)
        ),
        matching_publications as (
            select assignments.publication_id as publicationId
            from publication_tags as assignments
            inner join selected_tag_ids
                on selected_tag_ids.tagId = assignments.tag_id
            where assignments.project_id = ?1
            group by assignments.publication_id
            having count(distinct assignments.tag_id) = (select count(*) from selected_tag_ids)
        )
        select ${publicationColumns},
               posts.title as postTitle,
               channels.name as channelName,
               working_drafts.revision as draftRevision,
               working_drafts.review_state as draftReviewState,
               working_drafts.source_revision as draftSourceRevision,
               working_drafts.content_json as draftContentJson,
               target_revisions.source_revision as targetSourceRevision,
               target_revisions.content_json as targetContentJson,
               coalesce((
                   select json_group_array(ordered_tags.tagId)
                   from (
                       select assignments.tag_id as tagId
                       from publication_tags as assignments
                       inner join project_tags as tags
                           on tags.project_id = assignments.project_id
                          and tags.id = assignments.tag_id
                       where assignments.project_id = publications.project_id
                         and assignments.publication_id = publications.id
                       order by tags.normalized_name, tags.id
                   ) as ordered_tags
               ), '[]') as tagIdsJson
        from publications
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        inner join publication_working_drafts as working_drafts
            on working_drafts.project_id = publications.project_id
           and working_drafts.publication_id = publications.id
        left join publication_target_revisions as target_revisions
            on target_revisions.project_id = publications.project_id
           and target_revisions.id = publications.target_revision_id
           and target_revisions.publication_id = publications.id
        where publications.project_id = ?1
          and (
              not exists (select 1 from selected_tag_ids)
              or exists (
                  select 1
                  from matching_publications
                  where matching_publications.publicationId = publications.id
              )
          )
          and (
              ?3 is null
              or (
                  ?3 = 0
                  and (
                      publications.scheduled_at is null
                      or publications.scheduled_at > ?4
                      or (
                          publications.scheduled_at = ?4
                          and (
                              publications.updated_at < ?5
                              or (
                                  publications.updated_at = ?5
                                  and publications.id > ?6
                              )
                          )
                      )
                  )
              )
              or (
                  ?3 = 1
                  and publications.scheduled_at is null
                  and (
                      publications.updated_at < ?5
                      or (
                          publications.updated_at = ?5
                          and publications.id > ?6
                      )
                  )
              )
          )
          and (?7 is null or publications.scheduled_at >= ?7)
          and (?8 is null or publications.scheduled_at < ?8)
        order by
            case when publications.scheduled_at is null then 1 else 0 end,
            publications.scheduled_at,
            publications.updated_at desc,
            publications.id
        limit ?9
    `)

    const loadWorkingDraft = (projectId: string, publicationId: string) =>
        loadWorkingDraftStatement.get(projectId, publicationId)

    const listPublicationSummaryPage = (
        projectId: string,
        subjectId: string,
        pageOptions: PublicationSummaryPageOptions = {}
    ): PublicationSummaryPage | null => {
        const normalizedProjectId = requireNonBlank(projectId, 'projectId')
        const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
        if (options.loadActor(normalizedProjectId, normalizedSubjectId) === null) return null

        const limit = pageOptions.limit ?? 100
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw new DomainInvariantError(
                'invalid_input',
                'publication list limit must be between 1 and 100'
            )
        }

        const from = normalizeOptionalTimestamp(pageOptions.from, 'from')
        const to = normalizeOptionalTimestamp(pageOptions.to, 'to')
        if (from !== null && to !== null && to <= from) {
            throw new DomainInvariantError(
                'invalid_input',
                'publication list range must have a to timestamp after from'
            )
        }

        const cursor = parsePublicationCursor(pageOptions.cursor)
        const normalizedFilter = createPublicationTagFilter(pageOptions.filter?.tagIds ?? [])
        const rows = listPublicationSummaryPageStatement.all(
            normalizedProjectId,
            JSON.stringify(normalizedFilter.tagIds),
            cursor?.scheduledAt === null ? 1 : cursor === null ? null : 0,
            cursor?.scheduledAt ?? null,
            cursor?.updatedAt ?? null,
            cursor?.id ?? null,
            from,
            to,
            limit + 1
        )
        const hasMore = rows.length > limit
        const pageRows = rows.slice(0, limit)
        const lastRow = hasMore ? pageRows.at(-1) : undefined

        return {
            publications: pageRows.map(toPublicationSummary),
            nextCursor:
                lastRow === undefined
                    ? null
                    : encodePublicationCursor({
                          scheduledAt: lastRow.scheduledAt,
                          updatedAt: lastRow.updatedAt,
                          id: lastRow.id,
                      }),
        }
    }

    const listPublicationSummaries = (
        projectId: string,
        subjectId: string,
        filter?: PublicationTagFilter
    ): PublicationSummary[] | null => {
        const publications: PublicationSummary[] = []
        let cursor: string | null = null

        do {
            const page = listPublicationSummaryPage(projectId, subjectId, {
                cursor,
                filter,
            })
            if (page === null) return null
            publications.push(...page.publications)
            cursor = page.nextCursor
        } while (cursor !== null)

        return publications
    }

    return {
        loadWorkingDraft,
        api: {
            getPublicationWorkingDraft(
                projectId: string,
                publicationId: string,
                subjectId: string
            ): PublicationWorkingDraft | null {
                const normalizedProjectId = requireNonBlank(projectId, 'projectId')
                const normalizedPublicationId = requireNonBlank(publicationId, 'publicationId')
                const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
                if (options.loadActor(normalizedProjectId, normalizedSubjectId) === null)
                    return null

                const draft = loadWorkingDraft(normalizedProjectId, normalizedPublicationId)
                return draft === null ? null : toWorkingDraft(draft)
            },

            getPublicationEditorState(
                projectId: string,
                publicationId: string,
                subjectId: string
            ): PublicationEditorState | null {
                const normalizedProjectId = requireNonBlank(projectId, 'projectId')
                const normalizedPublicationId = requireNonBlank(publicationId, 'publicationId')
                const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
                if (options.loadActor(normalizedProjectId, normalizedSubjectId) === null) {
                    return null
                }

                const publicationRow = options.loadPublication(
                    normalizedProjectId,
                    normalizedPublicationId
                )
                const draftRow = loadWorkingDraft(normalizedProjectId, normalizedPublicationId)
                if (publicationRow === null || draftRow === null) return null

                const postRow = loadPostStatement.get(normalizedProjectId, publicationRow.postId)
                const channelRow = options.loadChannel(
                    normalizedProjectId,
                    publicationRow.channelId
                )
                const profileRow = options.loadProfile(
                    normalizedProjectId,
                    draftRow.profileVersionId
                )
                if (
                    postRow === null ||
                    channelRow === null ||
                    profileRow === null ||
                    profileRow.channelId !== channelRow.id
                ) {
                    throw new DomainInvariantError(
                        'invalid_input',
                        `Publication ${normalizedPublicationId} has incomplete editor state`
                    )
                }

                const selectedTarget =
                    publicationRow.targetRevisionId === null
                        ? null
                        : loadTargetRevisionStatement.get(
                              normalizedProjectId,
                              publicationRow.targetRevisionId,
                              normalizedPublicationId
                          )
                if (publicationRow.targetRevisionId !== null && selectedTarget === null) {
                    throw new DomainInvariantError(
                        'invalid_input',
                        `Publication ${normalizedPublicationId} points to a missing target revision`
                    )
                }

                return {
                    publication: toPublication(publicationRow),
                    post: toPost(postRow),
                    channel: toChannel(channelRow),
                    profile: toProfileVersion(profileRow),
                    draft: toWorkingDraft(draftRow),
                    selectedTarget:
                        selectedTarget === null ? null : toTargetRevision(selectedTarget),
                }
            },

            listPublicationSummaries,
            listPublicationSummaryPage,
        },
    }
}

interface PublicationCursor {
    readonly scheduledAt: number | null
    readonly updatedAt: number
    readonly id: string
}

const publicationCursorPrefix = 'publication-v1:'

function encodePublicationCursor(cursor: PublicationCursor): string {
    return `${publicationCursorPrefix}${cursor.scheduledAt === null ? 'null' : cursor.scheduledAt}:${cursor.updatedAt}:${encodeURIComponent(cursor.id)}`
}

function parsePublicationCursor(cursor: string | null | undefined): PublicationCursor | null {
    if (cursor === null || cursor === undefined) return null
    if (!cursor.startsWith(publicationCursorPrefix)) {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }

    const parts = cursor.slice(publicationCursorPrefix.length).split(':')
    if (parts.length !== 3) {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }

    const scheduledAt =
        parts[0] === 'null' ? null : parseCursorTimestamp(parts[0], 'publication cursor')
    const updatedAt = parseCursorTimestamp(parts[1], 'publication cursor')
    let id: string
    try {
        id = decodeURIComponent(parts[2] ?? '')
    } catch {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }
    if (id.length === 0) {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }

    const parsed = { scheduledAt, updatedAt, id }
    if (encodePublicationCursor(parsed) !== cursor) {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }
    return parsed
}

function normalizeOptionalTimestamp(value: number | null | undefined, name: string): number | null {
    if (value === null || value === undefined) return null
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DomainInvariantError('invalid_input', `${name} must be a non-negative timestamp`)
    }
    return value
}

function parseCursorTimestamp(value: string | undefined, label: string): number {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new DomainInvariantError('invalid_input', `${label} is invalid`)
    }
    return parsed
}
