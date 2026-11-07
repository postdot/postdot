import { DomainInvariantError, requireNonBlank, type Timestamp } from '@postdot/core'

import { defineTransaction, type DatabaseHandle } from '../client'
import { canonicalJson, parseJsonObject } from './content-codec'
import type { ActorRow } from './rows'

export type PublicationComposerDraftContent = Readonly<Record<string, unknown>>

export interface PublicationComposerDraft {
    readonly id: string
    readonly projectId: string
    readonly content: PublicationComposerDraftContent
    readonly revision: number
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

export interface SavePublicationComposerDraftInput {
    readonly projectId: string
    readonly subjectId: string
    readonly expectedRevision: number
    readonly expectedDraftId?: string
    readonly content: PublicationComposerDraftContent
}

export interface DeletePublicationComposerDraftInput {
    readonly expectedRevision?: number
    readonly expectedDraftId?: string
    readonly projectId: string
    readonly subjectId: string
}

interface PublicationComposerDraftRow {
    readonly id: string
    readonly projectId: string
    readonly ownerActorId: string
    readonly contentJson: string
    readonly revision: number
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

export interface PublicationComposerDraftStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly loadActor: (projectId: string, subjectId: string) => Promise<ActorRow | null>
}

export function createPublicationComposerDraftStore(
    database: DatabaseHandle,
    options: PublicationComposerDraftStoreOptions
) {
    const sql = database.sql
    const loadDraftStatement = sql.statement<
        PublicationComposerDraftRow,
        [projectId: string, ownerActorId: string]
    >(`
        select id,
               project_id as projectId,
               owner_actor_id as ownerActorId,
               content_json as contentJson,
               revision,
               created_at as createdAt,
               updated_at as updatedAt
        from publication_composer_drafts
        where project_id = ?1
          and owner_actor_id = ?2
    `)
    const insertDraftStatement = sql.statement<
        { changes: number },
        [id: string, projectId: string, ownerActorId: string, contentJson: string, now: number]
    >(`
        insert into publication_composer_drafts (
            id,
            project_id,
            owner_actor_id,
            content_json,
            revision,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, 1, ?5, ?5)
    `)
    const updateDraftStatement = sql.statement<
        { changes: number },
        [
            contentJson: string,
            updatedAt: number,
            projectId: string,
            ownerActorId: string,
            expectedRevision: number,
        ]
    >(`
        update publication_composer_drafts
        set content_json = ?1,
            revision = revision + 1,
            updated_at = ?2
        where project_id = ?3
          and owner_actor_id = ?4
          and revision = ?5
    `)
    const deleteDraftStatement = sql.statement<
        { changes: number },
        [projectId: string, ownerActorId: string]
    >(`
        delete from publication_composer_drafts
        where project_id = ?1
          and owner_actor_id = ?2
    `)

    const saveDraftTransaction = defineTransaction(
        database,
        async (
            input: SavePublicationComposerDraftInput
        ): Promise<PublicationComposerDraft | null> => {
            const actor = await options.loadActor(input.projectId, input.subjectId)
            if (actor === null) return null
            if (!hasComposerContent(input.content)) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'A composer draft must include content or at least one media asset'
                )
            }

            const contentJson = canonicalJson(input.content)
            const current = await loadDraftStatement.get(input.projectId, actor.id)
            const timestamp = options.now()

            if (input.expectedDraftId !== undefined && input.expectedDraftId !== current?.id) {
                throw new DomainInvariantError(
                    'write_conflict',
                    'The composer draft was replaced in another session'
                )
            }
            if (current === null) {
                if (input.expectedRevision !== 0) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        'The composer draft was created in another session'
                    )
                }
                const inserted = await insertDraftStatement.run(
                    options.createId(),
                    input.projectId,
                    actor.id,
                    contentJson,
                    timestamp
                )
                if (inserted.changes !== 1) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        'The composer draft was created in another session'
                    )
                }
            } else {
                if (input.expectedRevision !== current.revision) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        `Composer draft changed after revision ${input.expectedRevision}`
                    )
                }
                if (current.contentJson === contentJson) return toPublicationComposerDraft(current)

                const updated = await updateDraftStatement.run(
                    contentJson,
                    timestamp,
                    input.projectId,
                    actor.id,
                    input.expectedRevision
                )
                if (updated.changes !== 1) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        `Composer draft changed before it could be saved`
                    )
                }
            }

            const saved = await loadDraftStatement.get(input.projectId, actor.id)
            if (saved === null) {
                throw new DomainInvariantError('invalid_input', 'Composer draft disappeared')
            }
            return toPublicationComposerDraft(saved)
        }
    )

    const deleteDraftTransaction = defineTransaction(
        database,
        async (input: DeletePublicationComposerDraftInput): Promise<boolean> => {
            const actor = await options.loadActor(input.projectId, input.subjectId)
            if (actor === null) return false
            const current = await loadDraftStatement.get(input.projectId, actor.id)
            if (
                (input.expectedRevision !== undefined &&
                    input.expectedRevision !== current?.revision) ||
                (input.expectedDraftId !== undefined && input.expectedDraftId !== current?.id)
            ) {
                throw new DomainInvariantError(
                    'write_conflict',
                    'The composer draft changed before it could be discarded'
                )
            }
            return (await deleteDraftStatement.run(input.projectId, actor.id)).changes === 1
        }
    )

    return {
        async getPublicationComposerDraft(projectId: string, subjectId: string) {
            return database.sql.transaction(async () => {
                const actor = await options.loadActor(
                    requireNonBlank(projectId, 'projectId'),
                    requireNonBlank(subjectId, 'subjectId')
                )
                if (actor === null) return null
                const row = await loadDraftStatement.get(projectId, actor.id)
                return row === null ? null : toPublicationComposerDraft(row)
            }, 'deferred')
        },

        savePublicationComposerDraft(input: SavePublicationComposerDraftInput) {
            return saveDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                expectedRevision: requireComposerRevision(input.expectedRevision),
            })
        },

        deletePublicationComposerDraft(input: DeletePublicationComposerDraftInput) {
            return deleteDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}

function requireComposerRevision(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DomainInvariantError(
            'invalid_input',
            'expectedRevision must be a non-negative safe integer'
        )
    }
    return value
}

function toPublicationComposerDraft(row: PublicationComposerDraftRow): PublicationComposerDraft {
    return {
        id: row.id,
        projectId: row.projectId,
        content: parseJsonObject(row.contentJson, 'publication composer draft content'),
        revision: row.revision,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function hasComposerContent(content: PublicationComposerDraftContent): boolean {
    const postTitle = content.postTitle
    if (typeof postTitle === 'string' && postTitle.trim() !== '') return true

    const postContent = content.postContent
    if (typeof postContent === 'string' && postContent.trim() !== '') return true

    const sourceMedia = content.sourceMedia
    if (Array.isArray(sourceMedia) && sourceMedia.length > 0) return true

    const targets = content.publicationTargets
    return (
        Array.isArray(targets) &&
        targets.some(
            target =>
                typeof target === 'object' &&
                target !== null &&
                !Array.isArray(target) &&
                'content' in target &&
                typeof target.content === 'string' &&
                target.content.trim() !== ''
        )
    )
}
