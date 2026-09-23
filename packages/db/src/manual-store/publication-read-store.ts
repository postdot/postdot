import {
    createPublicationTagFilter,
    DomainInvariantError,
    requireNonBlank,
    type Publication,
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
    readonly sort?: PublicationListSort
    readonly state?: PublicationListState
    /** Inclusive UTC timestamp lower bound for scheduled publications. */
    readonly from?: number | null
    /** Exclusive UTC timestamp upper bound for scheduled publications. */
    readonly to?: number | null
}

export type PublicationListState = Extract<Publication['state'], 'draft' | 'scheduled'>
export type PublicationListSort =
    | 'queue'
    | 'updated_desc'
    | 'updated_asc'
    | 'created_desc'
    | 'created_asc'
    | 'scheduled_desc'
    | 'scheduled_asc'

export interface PublicationSummaryCounts {
    readonly total: number
    readonly manual: number
    readonly automatic: number
    readonly scheduled: number
    readonly draft: number
}

export interface PublicationSummaryPage {
    readonly publications: PublicationSummary[]
    readonly nextCursor: string | null
    readonly summary: PublicationSummaryCounts
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
            state: PublicationListState | null,
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
               posts.source_content as sourceContentJson,
               posts.updated_at as postUpdatedAt,
               channels.name as channelName,
               working_drafts.revision as draftRevision,
               working_drafts.review_state as draftReviewState,
               working_drafts.source_revision as draftSourceRevision,
               working_drafts.content_json as draftContentJson,
               working_drafts.updated_at as draftUpdatedAt,
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
          and (?9 is null or publications.state = ?9)
        order by
            case when publications.scheduled_at is null then 1 else 0 end,
            publications.scheduled_at,
            publications.updated_at desc,
            publications.id
        limit ?10
    `)

    const publicationSummaryCommonCtes = `
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
    `
    const publicationSummaryCommonSelect = `
        select ${publicationColumns},
               posts.title as postTitle,
               posts.source_content as sourceContentJson,
               posts.updated_at as postUpdatedAt,
               channels.name as channelName,
               working_drafts.revision as draftRevision,
               working_drafts.review_state as draftReviewState,
               working_drafts.source_revision as draftSourceRevision,
               working_drafts.content_json as draftContentJson,
               working_drafts.updated_at as draftUpdatedAt,
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
    `
    const publicationSummaryCommonJoins = `
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
    `
    const publicationSummaryCommonFilter = `
        where publications.project_id = ?1
          and (
              not exists (select 1 from selected_tag_ids)
              or exists (
                  select 1
                  from matching_publications
                  where matching_publications.publicationId = publications.id
              )
          )
    `
    const listPublicationSummaryUpdatedDescStatement = client.query<
        PublicationSummaryRow,
        [
            projectId: string,
            tagIdsJson: string,
            cursorUpdatedAt: number | null,
            cursorId: string | null,
            from: number | null,
            to: number | null,
            state: PublicationListState | null,
            limit: number,
        ]
    >(`
        ${publicationSummaryCommonCtes}
        ${publicationSummaryCommonSelect}
        ${publicationSummaryCommonJoins}
        ${publicationSummaryCommonFilter}
          and (
              ?3 is null
              or max(publications.updated_at, posts.updated_at, working_drafts.updated_at) < ?3
              or (
                  max(publications.updated_at, posts.updated_at, working_drafts.updated_at) = ?3
                  and publications.id > ?4
              )
          )
          and (?5 is null or publications.scheduled_at >= ?5)
          and (?6 is null or publications.scheduled_at < ?6)
          and (?7 is null or publications.state = ?7)
        order by max(publications.updated_at, posts.updated_at, working_drafts.updated_at) desc,
                 publications.id
        limit ?8
    `)
    const listPublicationSummaryUpdatedAscStatement = client.query<
        PublicationSummaryRow,
        [
            projectId: string,
            tagIdsJson: string,
            cursorUpdatedAt: number | null,
            cursorId: string | null,
            from: number | null,
            to: number | null,
            state: PublicationListState | null,
            limit: number,
        ]
    >(`
        ${publicationSummaryCommonCtes}
        ${publicationSummaryCommonSelect}
        ${publicationSummaryCommonJoins}
        ${publicationSummaryCommonFilter}
          and (
              ?3 is null
              or max(publications.updated_at, posts.updated_at, working_drafts.updated_at) > ?3
              or (
                  max(publications.updated_at, posts.updated_at, working_drafts.updated_at) = ?3
                  and publications.id > ?4
              )
          )
          and (?5 is null or publications.scheduled_at >= ?5)
          and (?6 is null or publications.scheduled_at < ?6)
          and (?7 is null or publications.state = ?7)
        order by max(publications.updated_at, posts.updated_at, working_drafts.updated_at),
                 publications.id
        limit ?8
    `)
    const listPublicationSummaryCreatedDescStatement = client.query<
        PublicationSummaryRow,
        [
            projectId: string,
            tagIdsJson: string,
            cursorCreatedAt: number | null,
            cursorId: string | null,
            from: number | null,
            to: number | null,
            state: PublicationListState | null,
            limit: number,
        ]
    >(`
        ${publicationSummaryCommonCtes}
        ${publicationSummaryCommonSelect}
        ${publicationSummaryCommonJoins}
        ${publicationSummaryCommonFilter}
          and (
              ?3 is null
              or publications.created_at < ?3
              or (publications.created_at = ?3 and publications.id > ?4)
          )
          and (?5 is null or publications.scheduled_at >= ?5)
          and (?6 is null or publications.scheduled_at < ?6)
          and (?7 is null or publications.state = ?7)
        order by publications.created_at desc, publications.id
        limit ?8
    `)
    const listPublicationSummaryCreatedAscStatement = client.query<
        PublicationSummaryRow,
        [
            projectId: string,
            tagIdsJson: string,
            cursorCreatedAt: number | null,
            cursorId: string | null,
            from: number | null,
            to: number | null,
            state: PublicationListState | null,
            limit: number,
        ]
    >(`
        ${publicationSummaryCommonCtes}
        ${publicationSummaryCommonSelect}
        ${publicationSummaryCommonJoins}
        ${publicationSummaryCommonFilter}
          and (
              ?3 is null
              or publications.created_at > ?3
              or (publications.created_at = ?3 and publications.id > ?4)
          )
          and (?5 is null or publications.scheduled_at >= ?5)
          and (?6 is null or publications.scheduled_at < ?6)
          and (?7 is null or publications.state = ?7)
        order by publications.created_at, publications.id
        limit ?8
    `)
    const listPublicationSummaryScheduledAscStatement = client.query<
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
            state: PublicationListState | null,
            limit: number,
        ]
    >(`
        ${publicationSummaryCommonCtes}
        ${publicationSummaryCommonSelect}
        ${publicationSummaryCommonJoins}
        ${publicationSummaryCommonFilter}
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
                              max(publications.updated_at, posts.updated_at, working_drafts.updated_at) < ?5
                              or (
                                  max(publications.updated_at, posts.updated_at, working_drafts.updated_at) = ?5
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
                      max(publications.updated_at, posts.updated_at, working_drafts.updated_at) < ?5
                      or (
                          max(publications.updated_at, posts.updated_at, working_drafts.updated_at) = ?5
                          and publications.id > ?6
                      )
                  )
              )
          )
          and (?7 is null or publications.scheduled_at >= ?7)
          and (?8 is null or publications.scheduled_at < ?8)
          and (?9 is null or publications.state = ?9)
        order by case when publications.scheduled_at is null then 1 else 0 end,
                 publications.scheduled_at,
                 max(publications.updated_at, posts.updated_at, working_drafts.updated_at) desc,
                 publications.id
        limit ?10
    `)
    const listPublicationSummaryScheduledDescStatement = client.query<
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
            state: PublicationListState | null,
            limit: number,
        ]
    >(`
        ${publicationSummaryCommonCtes}
        ${publicationSummaryCommonSelect}
        ${publicationSummaryCommonJoins}
        ${publicationSummaryCommonFilter}
          and (
              ?3 is null
              or (
                  ?3 = 0
                  and (
                      publications.scheduled_at is null
                      or publications.scheduled_at < ?4
                      or (
                          publications.scheduled_at = ?4
                          and (
                              max(publications.updated_at, posts.updated_at, working_drafts.updated_at) < ?5
                              or (
                                  max(publications.updated_at, posts.updated_at, working_drafts.updated_at) = ?5
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
                      max(publications.updated_at, posts.updated_at, working_drafts.updated_at) < ?5
                      or (
                          max(publications.updated_at, posts.updated_at, working_drafts.updated_at) = ?5
                          and publications.id > ?6
                      )
                  )
              )
          )
          and (?7 is null or publications.scheduled_at >= ?7)
          and (?8 is null or publications.scheduled_at < ?8)
          and (?9 is null or publications.state = ?9)
        order by case when publications.scheduled_at is null then 1 else 0 end,
                 publications.scheduled_at desc,
                 max(publications.updated_at, posts.updated_at, working_drafts.updated_at) desc,
                 publications.id
        limit ?10
    `)
    const listPublicationSummaryCountsStatement = client.query<
        PublicationSummaryCounts,
        [projectId: string, tagIdsJson: string, from: number | null, to: number | null]
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
        ),
        visible_publications as (
            select publications.id,
                   publications.delivery_mode,
                   publications.scheduled_at,
                   publications.state
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
            where publications.project_id = ?1
              and (
                  not exists (select 1 from selected_tag_ids)
                  or exists (
                      select 1
                      from matching_publications
                      where matching_publications.publicationId = publications.id
                  )
              )
              and (?3 is null or publications.scheduled_at >= ?3)
              and (?4 is null or publications.scheduled_at < ?4)
        )
        select count(*) as total,
               coalesce(sum(case when delivery_mode = 'manual' then 1 else 0 end), 0) as manual,
               coalesce(sum(case when delivery_mode = 'automatic' then 1 else 0 end), 0) as automatic,
               coalesce(sum(case when state = 'scheduled' then 1 else 0 end), 0) as scheduled,
               coalesce(sum(case when state = 'draft' then 1 else 0 end), 0) as draft
        from visible_publications
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

        const sort = pageOptions.sort ?? 'queue'
        const state = pageOptions.state ?? null
        const cursor = parsePublicationCursor(pageOptions.cursor)
        if (cursor !== null && cursor.sort !== sort) {
            throw new DomainInvariantError(
                'invalid_input',
                'publication cursor does not match the requested sort'
            )
        }
        const normalizedFilter = createPublicationTagFilter(pageOptions.filter?.tagIds ?? [])
        const tagIdsJson = JSON.stringify(normalizedFilter.tagIds)
        let rows: PublicationSummaryRow[]
        if (sort === 'queue') {
            const queueCursor = cursor?.sort === 'queue' ? cursor : null
            rows = listPublicationSummaryPageStatement.all(
                normalizedProjectId,
                tagIdsJson,
                queueCursor?.scheduledAt === null ? 1 : queueCursor === null ? null : 0,
                queueCursor?.scheduledAt ?? null,
                queueCursor?.updatedAt ?? null,
                queueCursor?.id ?? null,
                from,
                to,
                state,
                limit + 1
            )
        } else if (sort === 'updated_desc') {
            const sortedCursor = cursor?.sort === sort ? cursor : null
            rows = listPublicationSummaryUpdatedDescStatement.all(
                normalizedProjectId,
                tagIdsJson,
                sortedCursor?.primary ?? null,
                sortedCursor?.id ?? null,
                from,
                to,
                state,
                limit + 1
            )
        } else if (sort === 'updated_asc') {
            const sortedCursor = cursor?.sort === sort ? cursor : null
            rows = listPublicationSummaryUpdatedAscStatement.all(
                normalizedProjectId,
                tagIdsJson,
                sortedCursor?.primary ?? null,
                sortedCursor?.id ?? null,
                from,
                to,
                state,
                limit + 1
            )
        } else if (sort === 'created_desc') {
            const sortedCursor = cursor?.sort === sort ? cursor : null
            rows = listPublicationSummaryCreatedDescStatement.all(
                normalizedProjectId,
                tagIdsJson,
                sortedCursor?.primary ?? null,
                sortedCursor?.id ?? null,
                from,
                to,
                state,
                limit + 1
            )
        } else if (sort === 'created_asc') {
            const sortedCursor = cursor?.sort === sort ? cursor : null
            rows = listPublicationSummaryCreatedAscStatement.all(
                normalizedProjectId,
                tagIdsJson,
                sortedCursor?.primary ?? null,
                sortedCursor?.id ?? null,
                from,
                to,
                state,
                limit + 1
            )
        } else if (sort === 'scheduled_asc') {
            const scheduledCursor = cursor?.sort === sort ? cursor : null
            rows = listPublicationSummaryScheduledAscStatement.all(
                normalizedProjectId,
                tagIdsJson,
                scheduledCursor === null ? null : scheduledCursor.bucket,
                scheduledCursor?.scheduledAt ?? null,
                scheduledCursor?.updatedAt ?? null,
                scheduledCursor?.id ?? null,
                from,
                to,
                state,
                limit + 1
            )
        } else {
            const scheduledCursor = cursor?.sort === sort ? cursor : null
            rows = listPublicationSummaryScheduledDescStatement.all(
                normalizedProjectId,
                tagIdsJson,
                scheduledCursor === null ? null : scheduledCursor.bucket,
                scheduledCursor?.scheduledAt ?? null,
                scheduledCursor?.updatedAt ?? null,
                scheduledCursor?.id ?? null,
                from,
                to,
                state,
                limit + 1
            )
        }
        const summary = listPublicationSummaryCountsStatement.get(
            normalizedProjectId,
            tagIdsJson,
            from,
            to
        )
        if (summary === null) {
            throw new DomainInvariantError(
                'invalid_input',
                `Publication summary counts are unavailable for project ${normalizedProjectId}`
            )
        }
        const hasMore = rows.length > limit
        const pageRows = rows.slice(0, limit)
        const lastRow = hasMore ? pageRows.at(-1) : undefined
        const publications = pageRows.map(toPublicationSummary)
        const lastPublication = publications.at(-1)

        return {
            publications,
            nextCursor:
                lastRow === undefined || lastPublication === undefined
                    ? null
                    : encodeNextPublicationCursor(sort, lastRow, lastPublication),
            summary,
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

interface QueuePublicationCursor {
    readonly sort: 'queue'
    readonly scheduledAt: number | null
    readonly updatedAt: number
    readonly id: string
}

interface DatePublicationCursor {
    readonly sort: 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc'
    readonly primary: number
    readonly id: string
}

interface ScheduledPublicationCursor {
    readonly sort: 'scheduled_desc' | 'scheduled_asc'
    readonly bucket: 0 | 1
    readonly scheduledAt: number | null
    readonly updatedAt: number
    readonly id: string
}

type PublicationCursor = QueuePublicationCursor | DatePublicationCursor | ScheduledPublicationCursor

const publicationCursorPrefix = 'publication-v1:'
const sortedPublicationCursorPrefix = 'publication-v2:'

function encodePublicationCursor(cursor: PublicationCursor): string {
    if (cursor.sort === 'queue') {
        return `${publicationCursorPrefix}${cursor.scheduledAt === null ? 'null' : cursor.scheduledAt}:${cursor.updatedAt}:${encodeURIComponent(cursor.id)}`
    }
    return `${sortedPublicationCursorPrefix}${encodeURIComponent(JSON.stringify(cursor))}`
}

function parsePublicationCursor(cursor: string | null | undefined): PublicationCursor | null {
    if (cursor === null || cursor === undefined) return null
    if (cursor.startsWith(publicationCursorPrefix)) {
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

        const parsed: QueuePublicationCursor = { sort: 'queue', scheduledAt, updatedAt, id }
        if (encodePublicationCursor(parsed) !== cursor) {
            throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
        }
        return parsed
    }

    if (!cursor.startsWith(sortedPublicationCursorPrefix)) {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }

    let parsedValue: unknown
    try {
        parsedValue = JSON.parse(
            decodeURIComponent(cursor.slice(sortedPublicationCursorPrefix.length))
        )
    } catch {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }
    if (!isRecord(parsedValue) || !isPublicationListSort(parsedValue.sort)) {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }

    let parsed: PublicationCursor | null = null
    if (
        parsedValue.sort === 'updated_desc' ||
        parsedValue.sort === 'updated_asc' ||
        parsedValue.sort === 'created_desc' ||
        parsedValue.sort === 'created_asc'
    ) {
        parsed = {
            sort: parsedValue.sort,
            primary: parseCursorValue(parsedValue.primary),
            id: parseCursorId(parsedValue.id),
        }
    } else if (parsedValue.sort === 'scheduled_desc' || parsedValue.sort === 'scheduled_asc') {
        const bucket = parsedValue.bucket
        if (bucket !== 0 && bucket !== 1) {
            throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
        }
        parsed = {
            sort: parsedValue.sort,
            bucket,
            scheduledAt:
                parsedValue.scheduledAt === null ? null : parseCursorValue(parsedValue.scheduledAt),
            updatedAt: parseCursorValue(parsedValue.updatedAt),
            id: parseCursorId(parsedValue.id),
        }
    }
    if (parsed === null || encodePublicationCursor(parsed) !== cursor) {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }
    return parsed
}

function encodeNextPublicationCursor(
    sort: PublicationListSort,
    row: PublicationSummaryRow,
    publication: PublicationSummary
): string {
    if (sort === 'queue') {
        return encodePublicationCursor({
            sort,
            scheduledAt: row.scheduledAt,
            updatedAt: row.updatedAt,
            id: row.id,
        })
    }
    if (sort === 'updated_desc' || sort === 'updated_asc') {
        return encodePublicationCursor({ sort, primary: publication.lastEditedAt, id: row.id })
    }
    if (sort === 'created_desc' || sort === 'created_asc') {
        return encodePublicationCursor({ sort, primary: publication.createdAt, id: row.id })
    }
    return encodePublicationCursor({
        sort,
        bucket: row.scheduledAt === null ? 1 : 0,
        scheduledAt: row.scheduledAt,
        updatedAt: publication.lastEditedAt,
        id: row.id,
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPublicationListSort(value: unknown): value is PublicationListSort {
    return (
        value === 'queue' ||
        value === 'updated_desc' ||
        value === 'updated_asc' ||
        value === 'created_desc' ||
        value === 'created_asc' ||
        value === 'scheduled_desc' ||
        value === 'scheduled_asc'
    )
}

function parseCursorValue(value: unknown): number {
    if (typeof value !== 'number') {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }
    return parseCursorTimestamp(`${value}`, 'publication cursor')
}

function parseCursorId(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new DomainInvariantError('invalid_input', 'publication cursor is invalid')
    }
    return value
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
