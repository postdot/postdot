import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type ChannelProfileCompiler,
    type ChannelProfileDefinition,
    type DeliveryMode,
    type Post,
    type ValidationIssue,
} from '@postdot/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostbotDatabase,
} from '../client'
import type { CreatePostInput, CreatedPost, PublicationEditorState } from '../manual-store'
import { publicationHasAttempt, readPublicationMovement } from '../publication-move-state'
import { invalidProfileError, parseProfile } from './content-codec'
import type { PublicationChannelRow, ProfileRow } from './rows'

export interface MovePublicationInput {
    projectId: string
    publicationId: string
    subjectId: string
    targetChannelId: string
    deliveryMode: DeliveryMode
    expectedPublicationUpdatedAt: number
    expectedDraftRevision: number
    expectedSourceRevision: number
    expectedTargetRevisionId: string | null
    expectedScheduledAt: number | null
    expectedTargetProfileVersionId: string
    cadenceConfirmation?: string
}
export function createPublicationMoveStore(
    database: PostbotDatabase,
    options: {
        now: () => number
        createId: () => string
        profileCompiler: ChannelProfileCompiler
        getEditor: (
            projectId: string,
            publicationId: string,
            subjectId: string
        ) => PublicationEditorState | null
        loadChannel: (projectId: string, channelId: string) => PublicationChannelRow | null
        loadProfile: (projectId: string, profileId: string) => ProfileRow | null
        assessMedia: (
            profile: ChannelProfileDefinition,
            content: unknown,
            projectId: string,
            subjectId: string
        ) => readonly ValidationIssue[]
        createForPost: (input: CreatePostInput, post: Post) => CreatedPost | null
    }
) {
    const client = database.$client
    const move = createDatabaseTransaction(database, (input: MovePublicationInput) => {
        const current = options.getEditor(input.projectId, input.publicationId, input.subjectId)
        if (!current) return null
        const { publication, post, draft } = current
        const now = requireTimestamp(options.now(), 'now')
        const actor = client
            .query<{ id: string }, [string, string]>(
                "select id from actors where project_id=? and subject_id=? and kind in ('human','agent','api_token') order by created_at,id limit 1"
            )
            .get(input.projectId, input.subjectId)
        if (!actor) return null
        if (
            publication.updatedAt !== input.expectedPublicationUpdatedAt ||
            draft.revision !== input.expectedDraftRevision ||
            post.sourceRevision !== input.expectedSourceRevision ||
            draft.sourceRevision !== post.sourceRevision ||
            publication.targetRevisionId !== input.expectedTargetRevisionId ||
            publication.scheduledAt !== input.expectedScheduledAt
        )
            throw new DomainInvariantError(
                'write_conflict',
                'The publication or source changed; reload it before moving'
            )
        if (
            !['draft', 'scheduled', 'ready'].includes(publication.state) ||
            (publication.scheduledAt !== null && publication.scheduledAt <= now) ||
            publicationHasAttempt(database, input.projectId, publication.id)
        )
            throw new DomainInvariantError(
                'invalid_transition',
                'Only future work without an execution attempt can be moved'
            )
        if (input.targetChannelId === publication.channelId)
            throw new DomainInvariantError(
                'invalid_input',
                'Choose a different destination channel'
            )
        const target = options.loadChannel(input.projectId, input.targetChannelId)
        const usable = client
            .query(`select 1 from channels c join projects p on p.workspace_id=c.workspace_id
            join project_channel_attachments a on a.project_id=p.id and a.channel_id=c.id
            where p.id=? and c.id=? and c.state='active' and a.state='active'
            and not exists(select 1 from resource_lifecycles l where l.state<>'active' and
                ((l.kind='project' and l.resource_id=p.id) or (l.kind='workspace' and l.resource_id=c.workspace_id)))`)
            .get(input.projectId, input.targetChannelId)
        if (!target || !usable) return null
        if (target.profileVersionId !== input.expectedTargetProfileVersionId)
            throw new DomainInvariantError(
                'write_conflict',
                'The destination profile changed; reload it before moving'
            )
        const profile = options.loadProfile(input.projectId, target.profileVersionId)
        if (!profile || profile.channelId !== target.id) return null
        const compiled = options.profileCompiler.compile(parseProfile(profile.profileJson))
        if (!compiled.ok) throw invalidProfileError(compiled.issues)
        const validation = compiled.value.validate(draft.content)
        const mediaIssues = options.assessMedia(
            compiled.value.profile,
            draft.content,
            input.projectId,
            input.subjectId
        )
        const compatible = validation.ok && !mediaIssues.some(issue => issue.severity === 'error')
        const inherited = readPublicationMovement(database, publication, now).requestedScheduledAt
        const requestedScheduledAt = publication.scheduledAt ?? inherited
        client
            .query(
                "update publications set state='cancelled',error_message=null,state_changed_by_actor_id=?,updated_at=? where project_id=? and id=?"
            )
            .run(actor.id, now, input.projectId, publication.id)
        client
            .query(
                "update jobs set state='cancelled',completed_at=?,updated_at=? where project_id=? and publication_id=? and state='pending'"
            )
            .run(now, now, input.projectId, publication.id)
        client
            .query('delete from publication_cadence_overrides where publication_id=?')
            .run(publication.id)
        client
            .query(
                "update publication_approval_requests set state='superseded',decided_by_actor_id=?,decided_at=?,updated_at=? where project_id=? and publication_id=? and state='pending'"
            )
            .run(actor.id, now, now, input.projectId, publication.id)
        const tags = client
            .query<{ id: string }, [string, string]>(
                `select t.id from publication_tags a join project_tags t on t.project_id=a.project_id and t.id=a.tag_id where a.project_id=? and a.publication_id=? and t.state='active' order by t.id`
            )
            .all(input.projectId, publication.id)
            .map(tag => tag.id)
        const created = options.createForPost(
            {
                projectId: input.projectId,
                subjectId: input.subjectId,
                sourceContent: post.sourceContent,
                cadenceConfirmation: input.cadenceConfirmation,
                publications: [
                    {
                        channelId: target.id,
                        deliveryMode: input.deliveryMode,
                        targetContent: draft.content,
                        scheduledAt: compatible ? publication.scheduledAt : null,
                        tagIds: tags,
                    },
                ],
            },
            post
        )
        if (!created)
            throw new DomainInvariantError('invalid_transition', 'The destination is unavailable')
        const next = created.publications[0]!
        client
            .query(
                `insert into publication_moves(project_id,source_publication_id,destination_publication_id,requested_scheduled_at,created_by_actor_id,created_at) values (?,?,?,?,?,?)`
            )
            .run(input.projectId, publication.id, next.id, requestedScheduledAt, actor.id, now)
        for (const [entityId, action] of [
            [publication.id, 'publication.moved'],
            [next.id, 'publication.created_by_move'],
        ] as const)
            client
                .query(
                    `insert into audit_events(id,project_id,actor_id,action,entity_type,entity_id,metadata_json,created_at) values (?,?,?,?,'publication',?,?,?)`
                )
                .run(
                    options.createId(),
                    input.projectId,
                    actor.id,
                    action,
                    entityId,
                    JSON.stringify({
                        fromPublicationId: publication.id,
                        toPublicationId: next.id,
                        fromChannelId: publication.channelId,
                        toChannelId: target.id,
                        requestedScheduledAt,
                        scheduledAt: next.scheduledAt,
                        reviewState: next.reviewState,
                    }),
                    now
                )
        recordDatabaseCommitProject(database, input.projectId)
        return options.getEditor(input.projectId, next.id, input.subjectId)!
    })
    return {
        movePublication(input: MovePublicationInput) {
            return move.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                targetChannelId: requireNonBlank(input.targetChannelId, 'targetChannelId'),
            })
        },
    }
}
