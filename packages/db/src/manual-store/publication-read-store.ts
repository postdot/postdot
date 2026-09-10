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
    const listPublicationSummariesStatement = client.query<
        PublicationSummaryRow,
        [projectId: string, tagIdsJson: string, limit: number]
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
        order by
            case when publications.scheduled_at is null then 1 else 0 end,
            publications.scheduled_at,
            publications.updated_at desc,
            publications.id
        limit ?3
    `)

    const loadWorkingDraft = (projectId: string, publicationId: string) =>
        loadWorkingDraftStatement.get(projectId, publicationId)

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

            listPublicationSummaries(
                projectId: string,
                subjectId: string,
                filter?: PublicationTagFilter
            ): PublicationSummary[] | null {
                const normalizedProjectId = requireNonBlank(projectId, 'projectId')
                if (
                    options.loadActor(
                        normalizedProjectId,
                        requireNonBlank(subjectId, 'subjectId')
                    ) === null
                ) {
                    return null
                }

                const normalizedFilter = createPublicationTagFilter(filter?.tagIds ?? [])
                return listPublicationSummariesStatement
                    .all(normalizedProjectId, JSON.stringify(normalizedFilter.tagIds), 100)
                    .map(toPublicationSummary)
            },
        },
    }
}
