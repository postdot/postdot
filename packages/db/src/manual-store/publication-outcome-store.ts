import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    transitionPublication,
    type Publication,
} from '@postdot/core'

import { defineTransaction, type DatabaseHandle } from '../client'
import type {
    DueManualPublication,
    PublishManualPublicationInput,
    ReconcileAmbiguousPublicationInput,
    ReconcileAmbiguousPublicationResult,
} from '../manual-store'
import { jsonExtractTextSql } from '../sql/dialect'
import { parseJsonObject } from './content-codec'
import { toActor, toPublication } from './mappers'
import type { ActorRow, DuePublicationRow, PublicationRow } from './rows'
import { publicationColumns } from './sql-fragments'

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

export interface PublicationOutcomeStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly loadActor: (projectId: string, subjectId: string) => Promise<ActorRow | null>
    readonly loadPublication: (
        projectId: string,
        publicationId: string
    ) => Promise<PublicationRow | null>
    readonly insertAuditEvent: (input: AuditEventInsert) => Promise<unknown>
}

export function createPublicationOutcomeStore(
    database: DatabaseHandle,
    options: PublicationOutcomeStoreOptions
) {
    const sql = database.sql

    const loadDuePublicationStatement = sql.statement<
        PublicationRow,
        [projectId: string, publicationId: string, now: number]
    >(`
        select ${publicationColumns}
        from publications
        inner join publication_target_revisions as target_revisions
            on target_revisions.project_id = publications.project_id
           and target_revisions.id = publications.target_revision_id
           and target_revisions.publication_id = publications.id
        where publications.project_id = ?1
          and publications.id = ?2
          and publications.state = 'scheduled'
          and publications.delivery_mode = 'manual'
          and publications.review_state = 'compatible'
          and publications.scheduled_at <= ?3
    `)
    const loadAmbiguousExecutionProviderStatement = sql.statement<
        { readonly provider: string | null },
        [projectId: string, publicationId: string]
    >(`
        select ${jsonExtractTextSql(sql.dialect, 'audit_events.metadata_json', ['provider'])} as provider
        from audit_events
        where audit_events.project_id = ?1
          and audit_events.entity_type = 'publication'
          and audit_events.entity_id = ?2
          and audit_events.event_version = 1
          and audit_events.action in (
              'publication.execution.ambiguous',
              'publication.execution.ambiguity_recovered'
          )
        order by audit_events.sequence desc
        limit 1
    `)
    const publishPublicationStatement = sql.statement<
        void,
        [
            publicationId: string,
            projectId: string,
            publishedAt: number,
            actorId: string,
            externalId: string | null,
            externalUrl: string | null,
        ]
    >(`
        update publications
        set state = 'published',
            published_at = ?3,
            published_by_actor_id = ?4,
            external_id = ?5,
            external_url = ?6,
            error_message = null,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'scheduled'
    `)
    const reconcilePublishedPublicationStatement = sql.statement<
        { changes: number },
        [
            publicationId: string,
            projectId: string,
            publishedAt: number,
            actorId: string,
            externalId: string,
            externalUrl: string | null,
        ]
    >(`
        update publications
        set state = 'published',
            published_at = ?3,
            published_by_actor_id = ?4,
            external_id = ?5,
            external_url = ?6,
            error_message = null,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'ambiguous'
    `)
    const reconcileFailedPublicationStatement = sql.statement<
        { changes: number },
        [
            publicationId: string,
            projectId: string,
            updatedAt: number,
            actorId: string,
            errorMessage: string,
        ]
    >(`
        update publications
        set state = 'failed',
            error_message = ?5,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'ambiguous'
    `)
    const listDuePublicationsStatement = sql.statement<
        DuePublicationRow,
        [projectId: string, now: number]
    >(`
        select ${publicationColumns},
               posts.title as postTitle,
               channels.name as channelName,
               target_revisions.content_json as targetContentJson
        from publications
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join project_channel_contexts as channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        inner join publication_target_revisions as target_revisions
            on target_revisions.project_id = publications.project_id
           and target_revisions.id = publications.target_revision_id
           and target_revisions.publication_id = publications.id
        where publications.project_id = ?1
          and publications.state = 'scheduled'
          and publications.delivery_mode = 'manual'
          and publications.review_state = 'compatible'
          and publications.scheduled_at <= ?2
        order by publications.scheduled_at, publications.id
    `)

    const publishManualPublicationTransaction = defineTransaction(
        database,
        async (input: PublishManualPublicationInput): Promise<Publication | null> => {
            const actorRow = await options.loadActor(input.projectId, input.subjectId)
            if (actorRow === null) return null

            const timestamp = requireTimestamp(options.now(), 'now')
            const row = await loadDuePublicationStatement.get(
                input.projectId,
                input.publicationId,
                timestamp
            )
            if (row === null) return null

            const publication = toPublication(row)
            const actor = toActor(actorRow)
            const ready = transitionPublication({
                publication,
                to: 'ready',
                actor,
                now: timestamp,
            })
            const published = transitionPublication({
                publication: ready,
                to: 'published',
                actor,
                now: timestamp,
                externalId: input.externalId,
                externalUrl: input.externalUrl,
            })

            const result = await publishPublicationStatement.run(
                published.id,
                published.projectId,
                published.publishedAt as number,
                published.publishedByActorId as string,
                published.externalId,
                published.externalUrl
            )
            if (result.changes !== 1) return null

            await options.insertAuditEvent({
                id: options.createId(),
                projectId: published.projectId,
                actorId: actor.id,
                action: 'publication.ready',
                entityType: 'publication',
                entityId: published.id,
                metadataJson: JSON.stringify({
                    fromState: publication.state,
                    toState: ready.state,
                    deliveryMode: 'manual',
                    provider: 'manual',
                }),
                createdAt: timestamp,
            })
            await options.insertAuditEvent({
                id: options.createId(),
                projectId: published.projectId,
                actorId: actor.id,
                action: 'publication.published',
                entityType: 'publication',
                entityId: published.id,
                metadataJson: JSON.stringify({
                    fromState: ready.state,
                    toState: published.state,
                    externalId: published.externalId,
                    externalUrl: published.externalUrl,
                    deliveryMode: 'manual',
                    provider: 'manual',
                }),
                createdAt: timestamp,
            })

            return published
        }
    )
    const reconcileAmbiguousPublicationTransaction = defineTransaction(
        database,
        async (
            input: ReconcileAmbiguousPublicationInput
        ): Promise<ReconcileAmbiguousPublicationResult> => {
            const actorRow = await options.loadActor(input.projectId, input.subjectId)
            const row = await options.loadPublication(input.projectId, input.publicationId)
            if (actorRow === null || row === null) return { kind: 'not_found' }
            if (row.state !== 'ambiguous') return { kind: 'not_ambiguous' }

            const timestamp = requireTimestamp(options.now(), 'now')
            const publication = toPublication(row)
            const actor = toActor(actorRow)
            const reconciled =
                input.resolution === 'published'
                    ? transitionPublication({
                          publication,
                          to: 'published',
                          actor,
                          now: timestamp,
                          externalId: requireNonBlank(input.externalId ?? '', 'externalId'),
                          externalUrl:
                              input.externalUrl === undefined
                                  ? undefined
                                  : requireNonBlank(input.externalUrl, 'externalUrl'),
                      })
                    : transitionPublication({
                          publication,
                          to: 'failed',
                          actor,
                          now: timestamp,
                          errorMessage: requireNonBlank(input.errorMessage ?? '', 'errorMessage'),
                      })

            const result =
                reconciled.state === 'published'
                    ? await reconcilePublishedPublicationStatement.run(
                          reconciled.id,
                          reconciled.projectId,
                          reconciled.publishedAt as number,
                          reconciled.publishedByActorId as string,
                          reconciled.externalId as string,
                          reconciled.externalUrl
                      )
                    : await reconcileFailedPublicationStatement.run(
                          reconciled.id,
                          reconciled.projectId,
                          reconciled.updatedAt,
                          reconciled.stateChangedByActorId,
                          reconciled.errorMessage as string
                      )

            if (result.changes !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not reconcile publication ${reconciled.id}`
                )
            }

            const ambiguityFact = await loadAmbiguousExecutionProviderStatement.get(
                reconciled.projectId,
                reconciled.id
            )
            const provider =
                reconciled.deliveryMode === 'manual' ? 'manual' : (ambiguityFact?.provider ?? null)

            await options.insertAuditEvent({
                id: options.createId(),
                projectId: reconciled.projectId,
                actorId: actor.id,
                action: 'publication.reconciled',
                entityType: 'publication',
                entityId: reconciled.id,
                metadataJson: JSON.stringify({
                    fromState: publication.state,
                    toState: reconciled.state,
                    externalId: reconciled.externalId,
                    externalUrl: reconciled.externalUrl,
                    errorMessage: reconciled.errorMessage,
                    deliveryMode: reconciled.deliveryMode,
                    provider,
                }),
                createdAt: timestamp,
            })

            return { kind: 'reconciled', publication: reconciled }
        }
    )

    return {
        async listDueManualPublications(
            projectId: string,
            subjectId: string,
            at?: number
        ): Promise<DueManualPublication[] | null> {
            return database.sql.transaction(async () => {
                const normalizedProjectId = requireNonBlank(projectId, 'projectId')
                const actor = await options.loadActor(
                    normalizedProjectId,
                    requireNonBlank(subjectId, 'subjectId')
                )
                if (actor === null) return null

                const timestamp = requireTimestamp(at ?? options.now(), 'now')
                return (await listDuePublicationsStatement.all(normalizedProjectId, timestamp)).map(
                    row => ({
                        ...toPublication(row),
                        postTitle: row.postTitle,
                        channelName: row.channelName,
                        targetContent: parseJsonObject(
                            row.targetContentJson,
                            'publication target content'
                        ),
                    })
                )
            }, 'deferred')
        },

        async publishManualPublication(
            input: PublishManualPublicationInput
        ): Promise<Publication | null> {
            return publishManualPublicationTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                externalId:
                    input.externalId === undefined
                        ? undefined
                        : requireNonBlank(input.externalId, 'externalId'),
                externalUrl:
                    input.externalUrl === undefined
                        ? undefined
                        : requireNonBlank(input.externalUrl, 'externalUrl'),
            })
        },

        async reconcileAmbiguousPublication(
            input: ReconcileAmbiguousPublicationInput
        ): Promise<ReconcileAmbiguousPublicationResult> {
            return reconcileAmbiguousPublicationTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                externalId:
                    input.externalId === undefined
                        ? undefined
                        : requireNonBlank(input.externalId, 'externalId'),
                externalUrl:
                    input.externalUrl === undefined
                        ? undefined
                        : requireNonBlank(input.externalUrl, 'externalUrl'),
                errorMessage:
                    input.errorMessage === undefined
                        ? undefined
                        : requireNonBlank(input.errorMessage, 'errorMessage'),
            })
        },
    }
}
