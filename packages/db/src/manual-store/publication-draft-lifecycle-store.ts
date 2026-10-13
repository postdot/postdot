import { DomainInvariantError, requireNonBlank, type Publication } from '@postbot/core'

import { createDatabaseTransaction, type PostbotDatabase } from '../client'
import type { CreatePostInput, CreatedPost, PublicationEditorState } from '../manual-store'
import { toActor } from './mappers'
import type { ActorRow, PublicationRow } from './rows'

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

export interface PublicationDraftLifecycleStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly loadPublication: (projectId: string, publicationId: string) => PublicationRow | null
    readonly getPublicationEditorState: (
        projectId: string,
        publicationId: string,
        subjectId: string
    ) => PublicationEditorState | null
    readonly createPost: (input: CreatePostInput) => CreatedPost | null
    readonly insertAuditEvent: (input: AuditEventInsert) => void
}

export interface DeleteDraftPublicationInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
}

export interface DuplicateDraftPublicationInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
}

export type DeleteDraftPublicationResult =
    | {
          readonly kind: 'deleted'
          readonly postDeleted: boolean
      }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_draft' }

export type DuplicateDraftPublicationResult =
    | {
          readonly kind: 'duplicated'
          readonly post: CreatedPost['post']
          readonly publication: Publication
      }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_draft' }

export function createPublicationDraftLifecycleStore(
    database: PostbotDatabase,
    options: PublicationDraftLifecycleStoreOptions
) {
    const client = database.$client
    const deletePublicationStatement = client.query<
        { changes: number },
        [projectId: string, publicationId: string]
    >(`
        delete from publications
        where project_id = ?1
          and id = ?2
          and state = 'draft'
    `)
    const countPostPublicationsStatement = client.query<
        { count: number },
        [projectId: string, postId: string]
    >(`
        select count(*) as count
        from publications
        where project_id = ?1
          and post_id = ?2
    `)
    const deletePostStatement = client.query<
        { changes: number },
        [projectId: string, postId: string]
    >(`
        delete from posts
        where project_id = ?1
          and id = ?2
    `)
    const listActivePublicationTagIdsStatement = client.query<
        { readonly tagId: string },
        [projectId: string, publicationId: string]
    >(`
        select assignments.tag_id as tagId
        from publication_tags as assignments
        inner join project_tags as tags
            on tags.project_id = assignments.project_id
           and tags.id = assignments.tag_id
        where assignments.project_id = ?1
          and assignments.publication_id = ?2
          and tags.state = 'active'
        order by tags.normalized_name, tags.id
    `)

    const deleteDraftPublicationTransaction = createDatabaseTransaction(
        database,
        (input: DeleteDraftPublicationInput): DeleteDraftPublicationResult => {
            const actorRow = options.loadActor(input.projectId, input.subjectId)
            if (actorRow === null) return { kind: 'not_found' }

            const currentRow = options.loadPublication(input.projectId, input.publicationId)
            if (currentRow === null) return { kind: 'not_found' }
            if (currentRow.state !== 'draft') return { kind: 'not_draft' }

            const deleted = deletePublicationStatement.run(input.projectId, input.publicationId)
            if (deleted.changes < 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not delete draft publication ${input.publicationId}`
                )
            }

            const remaining = countPostPublicationsStatement.get(input.projectId, currentRow.postId)
            if (remaining === null) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not verify post ${currentRow.postId} after deleting its publication`
                )
            }
            const postDeleted = remaining.count === 0
            if (postDeleted) {
                const deletedPost = deletePostStatement.run(input.projectId, currentRow.postId)
                if (deletedPost.changes < 1) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not delete orphaned post ${currentRow.postId}`
                    )
                }
            }

            const actor = toActor(actorRow)
            const timestamp = options.now()
            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actor.id,
                action: 'publication.deleted',
                entityType: 'publication',
                entityId: input.publicationId,
                metadataJson: JSON.stringify({
                    fromState: currentRow.state,
                    postDeleted,
                }),
                createdAt: timestamp,
            })

            return { kind: 'deleted', postDeleted }
        }
    )

    return {
        deleteDraftPublication(input: DeleteDraftPublicationInput): DeleteDraftPublicationResult {
            return deleteDraftPublicationTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        duplicateDraftPublication(
            input: DuplicateDraftPublicationInput
        ): DuplicateDraftPublicationResult {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const editor = options.getPublicationEditorState(projectId, publicationId, subjectId)
            if (editor === null) return { kind: 'not_found' }
            if (editor.publication.state !== 'draft') return { kind: 'not_draft' }
            const tagIds = listActivePublicationTagIdsStatement
                .all(projectId, publicationId)
                .map(tag => tag.tagId)

            const created = options.createPost({
                projectId,
                subjectId,
                title: editor.post.title,
                sourceContent: editor.post.sourceContent,
                publications: [
                    {
                        channelId: editor.publication.channelId,
                        targetContent: editor.draft.content,
                        deliveryMode: editor.publication.deliveryMode,
                        scheduledAt: null,
                        tagIds,
                    },
                ],
            })
            if (created === null) return { kind: 'not_found' }

            const publication = created.publications[0]
            if (publication === undefined) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Duplicated post ${created.post.id} has no publication`
                )
            }

            return { kind: 'duplicated', post: created.post, publication }
        },
    }
}
