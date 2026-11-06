import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type Channel,
} from '@postdot/core'

import { defineTransaction, recordDatabaseCommitProject, type PostdotDatabase } from '../client'
import { toChannel } from './project-channel-mappers'
import type { ActorRow, ChannelRow } from './rows'

export const channelLifecycleBlockerCodes = [
    'active_work',
    'pending_authorization',
    'publications',
    'publisher',
    'must_be_archived',
    'shared',
] as const

export type ChannelLifecycleBlockerCode = (typeof channelLifecycleBlockerCodes)[number]

export interface RenameChannelInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly name: string
    readonly expectedRevision: number
}

export interface ArchiveChannelInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly expectedRevision: number
}

export interface RestoreChannelInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly expectedRevision: number
}

export interface DeleteChannelInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly expectedRevision: number
}

export type ChannelLifecycleUpdateResult =
    | { readonly kind: 'updated'; readonly channel: Channel }
    | {
          readonly kind: 'blocked'
          readonly blockers: readonly ChannelLifecycleBlockerCode[]
      }

export type DeleteChannelResult =
    | { readonly kind: 'deleted' }
    | {
          readonly kind: 'blocked'
          readonly blockers: readonly ChannelLifecycleBlockerCode[]
      }

export interface ChannelLifecycleStoreOptions {
    readonly now: () => number
    readonly createId: () => string
}

export function createChannelLifecycleStore(
    database: PostdotDatabase,
    options: ChannelLifecycleStoreOptions
) {
    const sql = database.sql

    const loadActorStatement = sql.statement<ActorRow, [projectId: string, subjectId: string]>(`
        select id,
               project_id as projectId,
               kind,
               subject_id as subjectId,
               display_name as displayName,
               created_at as createdAt,
               updated_at as updatedAt
        from actors
        where project_id = ?1
          and subject_id = ?2
          and kind in ('human', 'agent', 'api_token')
        order by created_at, id
        limit 1
    `)
    const loadChannelStatement = sql.statement<ChannelRow, [projectId: string, channelId: string]>(`
        select channels.id,
               channels.project_id as projectId,
               channels.name,
               channel_profiles.profile_id as profileId,
               channels.profile_version_id as profileVersionId,
               channels.state,
               channels.archived_at as archivedAt,
               channels.revision,
               channels.created_at as createdAt,
               channels.updated_at as updatedAt
        from project_channel_contexts as channels
        inner join project_channel_profile_contexts as channel_profiles
            on channel_profiles.project_id = channels.project_id
           and channel_profiles.channel_id = channels.id
           and channel_profiles.id = channels.profile_version_id
        where channels.project_id = ?1
          and channels.id = ?2
    `)
    const loadActiveWorkStatement = sql.statement<
        { readonly found: number },
        [projectId: string, channelId: string]
    >(`
        select 1 as found
        from publications
        where channel_id = ?2
          and state in ('scheduled', 'ready', 'publishing', 'ambiguous')
        union all
        select 1 as found
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        where publications.channel_id = ?2
          and jobs.state in ('pending', 'running')
        limit 1
    `)
    const loadPendingAuthorizationStatement = sql.statement<
        { readonly found: number },
        [projectId: string, channelId: string]
    >(`
        select 1 as found
        from oauth_authorization_attempts
        where channel_id = ?2
          and status = 'pending'
        limit 1
    `)
    const loadPublicationReferenceStatement = sql.statement<
        { readonly found: number },
        [projectId: string, channelId: string]
    >(`
        select 1 as found
        from publications
        where channel_id = ?2
        limit 1
    `)
    const loadPublisherReferenceStatement = sql.statement<
        { readonly found: number },
        [projectId: string, channelId: string]
    >(`
        select 1 as found
        from project_publisher_contexts as publishers
        where project_id = ?1
          and channel_id = ?2
        limit 1
    `)
    const loadOtherAttachmentStatement = sql.statement<
        { readonly found: number },
        [projectId: string, channelId: string]
    >(`
        select 1 as found
        from project_channel_attachments
        where channel_id = ?2
          and project_id <> ?1
        limit 1
    `)
    const renameChannelStatement = sql.statement<
        { readonly changes: number },
        [name: string, updatedAt: number, projectId: string, channelId: string, revision: number]
    >(`
        update channels
        set name = ?1,
            updated_at = ?2,
            revision = revision + 1
        where id = ?4
          and revision = ?5
          and exists (
              select 1
              from project_channel_contexts as visible
              where visible.project_id = ?3
                and visible.id = channels.id
                and visible.attachment_state = 'active'
          )
    `)
    const archiveChannelStatement = sql.statement<
        { readonly changes: number },
        [archivedAt: number, projectId: string, channelId: string, revision: number]
    >(`
        update channels
        set state = 'archived',
            archived_at = ?1,
            updated_at = ?1,
            revision = revision + 1
        where id = ?3
          and state = 'active'
          and revision = ?4
          and exists (
              select 1
              from project_channel_contexts as visible
              where visible.project_id = ?2
                and visible.id = channels.id
                and visible.attachment_state = 'active'
          )
    `)
    const restoreChannelStatement = sql.statement<
        { readonly changes: number },
        [updatedAt: number, projectId: string, channelId: string, revision: number]
    >(`
        update channels
        set state = 'active',
            archived_at = null,
            updated_at = ?1,
            revision = revision + 1
        where id = ?3
          and state = 'archived'
          and revision = ?4
          and exists (
              select 1
              from project_channel_contexts as visible
              where visible.project_id = ?2
                and visible.id = channels.id
                and visible.attachment_state = 'active'
          )
    `)
    const deleteChannelStatement = sql.statement<
        { readonly changes: number },
        [projectId: string, channelId: string, revision: number]
    >(`
        delete from channels
        where id = ?2
          and state = 'archived'
          and revision = ?3
          and exists (
              select 1
              from project_channel_contexts as visible
              where visible.project_id = ?1
                and visible.id = channels.id
                and visible.attachment_state = 'active'
          )
          and not exists (
              select 1
              from project_channel_attachments as other
              where other.channel_id = channels.id
                and other.project_id <> ?1
          )
    `)
    const insertAuditEventStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            action: string,
            entityId: string,
            metadataJson: string | null,
            createdAt: number,
        ]
    >(`
        insert into audit_events (
            id,
            project_id,
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata_json,
            created_at
        ) values (?1, ?2, ?3, ?4, 'channel', ?5, ?6, ?7)
    `)

    const renameChannelTransaction = defineTransaction(
        database,
        async (input: RenameChannelInput): Promise<Channel | null> => {
            const actor = await loadActorStatement.get(input.projectId, input.subjectId)
            const row = await loadChannelStatement.get(input.projectId, input.channelId)
            if (actor === null || row === null) return null

            assertExpectedRevision(input.expectedRevision)
            assertCurrentRevision(row.revision, input.channelId, input.expectedRevision)
            const name = requireNonBlank(input.name, 'name')
            if (row.name === name) return toChannel(row)

            const timestamp = requireTimestamp(options.now(), 'now')
            if (
                (
                    await renameChannelStatement.run(
                        name,
                        timestamp,
                        input.projectId,
                        input.channelId,
                        input.expectedRevision
                    )
                ).changes !== 1
            ) {
                throw staleChannelRevision(input.channelId, input.expectedRevision)
            }

            recordDatabaseCommitProject(database, input.projectId)
            await insertAuditEventStatement.run(
                options.createId(),
                input.projectId,
                actor.id,
                'channel.renamed',
                input.channelId,
                JSON.stringify({ from: row.name, to: name, revision: row.revision + 1 }),
                timestamp
            )
            return loadUpdatedChannel(input.projectId, input.channelId)
        }
    )

    const archiveChannelTransaction = defineTransaction(
        database,
        async (input: ArchiveChannelInput): Promise<ChannelLifecycleUpdateResult | null> => {
            const actor = await loadActorStatement.get(input.projectId, input.subjectId)
            const row = await loadChannelStatement.get(input.projectId, input.channelId)
            if (actor === null || row === null) return null

            assertExpectedRevision(input.expectedRevision)
            assertCurrentRevision(row.revision, input.channelId, input.expectedRevision)
            if (row.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot archive an ${row.state} channel`
                )
            }

            const blockers = await archiveBlockers(input.projectId, input.channelId)
            if (blockers.length > 0) return { kind: 'blocked', blockers }

            const timestamp = requireTimestamp(options.now(), 'now')
            if (
                (
                    await archiveChannelStatement.run(
                        timestamp,
                        input.projectId,
                        input.channelId,
                        input.expectedRevision
                    )
                ).changes !== 1
            ) {
                throw staleChannelRevision(input.channelId, input.expectedRevision)
            }

            recordDatabaseCommitProject(database, input.projectId)
            await insertAuditEventStatement.run(
                options.createId(),
                input.projectId,
                actor.id,
                'channel.archived',
                input.channelId,
                JSON.stringify({ revision: row.revision + 1, archivedAt: timestamp }),
                timestamp
            )
            return {
                kind: 'updated',
                channel: await loadUpdatedChannel(input.projectId, input.channelId),
            }
        }
    )

    const restoreChannelTransaction = defineTransaction(
        database,
        async (input: RestoreChannelInput): Promise<ChannelLifecycleUpdateResult | null> => {
            const actor = await loadActorStatement.get(input.projectId, input.subjectId)
            const row = await loadChannelStatement.get(input.projectId, input.channelId)
            if (actor === null || row === null) return null

            assertExpectedRevision(input.expectedRevision)
            assertCurrentRevision(row.revision, input.channelId, input.expectedRevision)
            if (row.state !== 'archived') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot restore an ${row.state} channel`
                )
            }

            const timestamp = requireTimestamp(options.now(), 'now')
            if (
                (
                    await restoreChannelStatement.run(
                        timestamp,
                        input.projectId,
                        input.channelId,
                        input.expectedRevision
                    )
                ).changes !== 1
            ) {
                throw staleChannelRevision(input.channelId, input.expectedRevision)
            }

            recordDatabaseCommitProject(database, input.projectId)
            await insertAuditEventStatement.run(
                options.createId(),
                input.projectId,
                actor.id,
                'channel.restored',
                input.channelId,
                JSON.stringify({ revision: row.revision + 1 }),
                timestamp
            )
            return {
                kind: 'updated',
                channel: await loadUpdatedChannel(input.projectId, input.channelId),
            }
        }
    )

    const deleteChannelTransaction = defineTransaction(
        database,
        async (input: DeleteChannelInput): Promise<DeleteChannelResult | null> => {
            const actor = await loadActorStatement.get(input.projectId, input.subjectId)
            const row = await loadChannelStatement.get(input.projectId, input.channelId)
            if (actor === null || row === null) return null

            assertExpectedRevision(input.expectedRevision)
            assertCurrentRevision(row.revision, input.channelId, input.expectedRevision)
            if (row.state !== 'archived') {
                return { kind: 'blocked', blockers: ['must_be_archived'] }
            }

            const blockers: ChannelLifecycleBlockerCode[] = []
            if (
                (await loadPublicationReferenceStatement.get(input.projectId, input.channelId)) !==
                null
            ) {
                blockers.push('publications')
            }
            if (
                (await loadPublisherReferenceStatement.get(input.projectId, input.channelId)) !==
                null
            ) {
                blockers.push('publisher')
            }
            if (
                (await loadPendingAuthorizationStatement.get(input.projectId, input.channelId)) !==
                null
            ) {
                blockers.push('pending_authorization')
            }
            if (
                (await loadOtherAttachmentStatement.get(input.projectId, input.channelId)) !== null
            ) {
                blockers.push('shared')
            }
            if (blockers.length > 0) return { kind: 'blocked', blockers }

            if (
                (
                    await deleteChannelStatement.run(
                        input.projectId,
                        input.channelId,
                        input.expectedRevision
                    )
                ).changes < 1
            ) {
                throw staleChannelRevision(input.channelId, input.expectedRevision)
            }

            const timestamp = requireTimestamp(options.now(), 'now')
            recordDatabaseCommitProject(database, input.projectId)
            await insertAuditEventStatement.run(
                options.createId(),
                input.projectId,
                actor.id,
                'channel.deleted',
                input.channelId,
                JSON.stringify({ revision: row.revision }),
                timestamp
            )
            return { kind: 'deleted' }
        }
    )

    async function loadUpdatedChannel(projectId: string, channelId: string): Promise<Channel> {
        const row = await loadChannelStatement.get(projectId, channelId)
        if (row === null) {
            throw new DomainInvariantError('invalid_input', 'Channel disappeared after its update')
        }
        return toChannel(row)
    }

    async function archiveBlockers(
        projectId: string,
        channelId: string
    ): Promise<ChannelLifecycleBlockerCode[]> {
        const blockers: ChannelLifecycleBlockerCode[] = []
        if ((await loadActiveWorkStatement.get(projectId, channelId)) !== null) {
            blockers.push('active_work')
        }
        if ((await loadPendingAuthorizationStatement.get(projectId, channelId)) !== null) {
            blockers.push('pending_authorization')
        }
        return blockers
    }

    return {
        async renameChannel(input: RenameChannelInput): Promise<Channel | null> {
            return renameChannelTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                name: requireNonBlank(input.name, 'name'),
            })
        },

        async archiveChannel(
            input: ArchiveChannelInput
        ): Promise<ChannelLifecycleUpdateResult | null> {
            return archiveChannelTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        async restoreChannel(
            input: RestoreChannelInput
        ): Promise<ChannelLifecycleUpdateResult | null> {
            return restoreChannelTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        async deleteChannel(input: DeleteChannelInput): Promise<DeleteChannelResult | null> {
            return deleteChannelTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}

function assertExpectedRevision(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new DomainInvariantError(
            'invalid_input',
            'expectedRevision must be a positive safe integer'
        )
    }
}

function staleChannelRevision(channelId: string, expectedRevision: number): DomainInvariantError {
    return new DomainInvariantError(
        'write_conflict',
        `Channel ${channelId} changed after revision ${expectedRevision}`
    )
}

function assertCurrentRevision(
    currentRevision: number,
    channelId: string,
    expectedRevision: number
): void {
    if (currentRevision !== expectedRevision) {
        throw staleChannelRevision(channelId, expectedRevision)
    }
}
