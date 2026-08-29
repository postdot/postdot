import {
    createPublisher,
    requireNonBlank,
    requireTimestamp,
    type Actor,
    type Channel,
    type Project,
    type Timestamp,
} from '@herald/core'

import type { HeraldDatabase } from './client'

export interface CreatePublisherConnectionInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly kind: string
    readonly accountId: string
    readonly requiredScopes?: readonly string[]
}

export interface DisconnectPublisherConnectionInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
}

export interface PublisherConnection {
    readonly id: string
    readonly projectId: string
    readonly publisherId: string
    readonly channelId: string
    readonly kind: string
    readonly accountId: string
    readonly providerId: string
    readonly connectedByActorId: string
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

export interface PublisherExecutionTarget {
    readonly jobId: string
    readonly projectId: string
    readonly publicationId: string
    readonly content: string
    readonly publisherId: string
    readonly channelId: string
    readonly kind: string
    readonly accountId: string
    readonly accountUserId: string
    readonly externalAccountId: string
    readonly providerId: string
}

export type CreatePublisherConnectionResult =
    | { readonly kind: 'created'; readonly connection: PublisherConnection }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'invalid_account' }
    | { readonly kind: 'missing_scopes'; readonly scopes: readonly string[] }
    | { readonly kind: 'publisher_exists' }

export type DisconnectPublisherConnectionResult =
    | { readonly kind: 'disconnected'; readonly connection: PublisherConnection }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'active_work' }

interface ProjectRow {
    readonly id: string
    readonly name: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface ActorRow {
    readonly id: string
    readonly projectId: string
    readonly kind: Actor['kind']
    readonly subjectId: string
    readonly displayName: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface ChannelRow {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface AccountRow {
    readonly id: string
    readonly userId: string
    readonly providerId: string
    readonly scope: string | null
}

interface PublisherRow {
    readonly id: string
}

interface ScheduledPublicationRow {
    readonly id: string
    readonly scheduledAt: number
}

export interface PublisherStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
}

function parseScopes(scope: string | null): ReadonlySet<string> {
    return new Set(
        (scope ?? '')
            .split(',')
            .map(value => value.trim())
            .filter(value => value.length > 0)
    )
}

export function createPublisherStore(
    database: HeraldDatabase,
    options: PublisherStoreOptions = {}
) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())

    const loadProjectStatement = client.query<ProjectRow, [projectId: string]>(`
        select id, name, created_at as createdAt, updated_at as updatedAt
        from projects
        where id = ?1
    `)
    const loadActorStatement = client.query<ActorRow, [projectId: string, subjectId: string]>(`
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
          and kind = 'human'
        order by created_at, id
        limit 1
    `)
    const loadChannelStatement = client.query<ChannelRow, [projectId: string, channelId: string]>(`
        select id, project_id as projectId, name,
               created_at as createdAt, updated_at as updatedAt
        from channels
        where project_id = ?1
          and id = ?2
    `)
    const loadAccountStatement = client.query<AccountRow, [accountId: string]>(`
        select id,
               user_id as userId,
               provider_id as providerId,
               scope
        from account
        where id = ?1
    `)
    const loadPublisherForChannelStatement = client.query<
        PublisherRow,
        [projectId: string, channelId: string]
    >(`
        select id
        from publishers
        where project_id = ?1
          and channel_id = ?2
        limit 1
    `)
    const publisherConnectionColumns = `
        publisher_connections.id,
        publisher_connections.project_id as projectId,
        publisher_connections.publisher_id as publisherId,
        publishers.channel_id as channelId,
        publishers.kind,
        publisher_connections.account_id as accountId,
        account.provider_id as providerId,
        publisher_connections.connected_by_actor_id as connectedByActorId,
        publisher_connections.created_at as createdAt,
        publisher_connections.updated_at as updatedAt
    `
    const listPublisherConnectionsStatement = client.query<
        PublisherConnection,
        [projectId: string]
    >(`
        select ${publisherConnectionColumns}
        from publisher_connections
        inner join publishers
            on publishers.project_id = publisher_connections.project_id
           and publishers.id = publisher_connections.publisher_id
        inner join account
            on account.id = publisher_connections.account_id
        where publisher_connections.project_id = ?1
        order by publisher_connections.created_at, publisher_connections.id
    `)
    const loadPublisherConnectionStatement = client.query<
        PublisherConnection,
        [projectId: string, channelId: string]
    >(`
        select ${publisherConnectionColumns}
        from publisher_connections
        inner join publishers
            on publishers.project_id = publisher_connections.project_id
           and publishers.id = publisher_connections.publisher_id
        inner join account
            on account.id = publisher_connections.account_id
        where publisher_connections.project_id = ?1
          and publishers.channel_id = ?2
        limit 1
    `)
    const loadPublisherExecutionTargetStatement = client.query<
        PublisherExecutionTarget,
        [jobId: string, claimToken: string]
    >(`
        select jobs.id as jobId,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId,
               publications.content,
               publishers.id as publisherId,
               publishers.channel_id as channelId,
               publishers.kind,
               publisher_connections.account_id as accountId,
               account.user_id as accountUserId,
               account.account_id as externalAccountId,
               account.provider_id as providerId
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        inner join publishers
            on publishers.project_id = publications.project_id
           and publishers.channel_id = publications.channel_id
        inner join publisher_connections
            on publisher_connections.project_id = publishers.project_id
           and publisher_connections.publisher_id = publishers.id
        inner join account
            on account.id = publisher_connections.account_id
        where jobs.id = ?1
          and jobs.claim_token = ?2
          and jobs.state = 'running'
          and jobs.effect_started_at is not null
        limit 1
    `)
    const listUnqueuedScheduledPublicationsStatement = client.query<
        ScheduledPublicationRow,
        [projectId: string, channelId: string]
    >(`
        select publications.id,
               publications.scheduled_at as scheduledAt
        from publications
        where publications.project_id = ?1
          and publications.channel_id = ?2
          and publications.state = 'scheduled'
          and publications.scheduled_at is not null
          and not exists (
              select 1
              from jobs
              where jobs.project_id = publications.project_id
                and jobs.publication_id = publications.id
          )
        order by publications.scheduled_at, publications.id
    `)
    const loadActiveWorkStatement = client.query<
        { id: string },
        [projectId: string, channelId: string]
    >(`
        select publications.id
        from publications
        where publications.project_id = ?1
          and publications.channel_id = ?2
          and publications.state in ('scheduled', 'ready', 'publishing')

        union all

        select jobs.id
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        where jobs.project_id = ?1
          and publications.channel_id = ?2
          and jobs.state in ('pending', 'running')
        limit 1
    `)
    const insertPublisherStatement = client.query<
        void,
        [id: string, projectId: string, channelId: string, kind: string, timestamp: number]
    >(`
        insert into publishers (
            id, project_id, channel_id, kind, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?5)
    `)
    const insertConnectionStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            publisherId: string,
            accountId: string,
            connectedByActorId: string,
            timestamp: number,
        ]
    >(`
        insert into publisher_connections (
            id,
            project_id,
            publisher_id,
            account_id,
            connected_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `)
    const insertJobStatement = client.query<
        void,
        [id: string, projectId: string, publicationId: string, runAt: number, timestamp: number]
    >(`
        insert into jobs (
            id,
            project_id,
            publication_id,
            state,
            run_at,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, 'pending', ?4, ?5, ?5)
    `)
    const insertAuditEventStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            action: string,
            entityType: string,
            entityId: string,
            metadataJson: string,
            timestamp: number,
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
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `)
    const deletePublisherStatement = client.query<
        { changes: number },
        [projectId: string, publisherId: string]
    >(`
        delete from publishers
        where project_id = ?1
          and id = ?2
    `)

    const createPublisherConnectionTransaction = client.transaction(
        (input: CreatePublisherConnectionInput): CreatePublisherConnectionResult => {
            const projectRow = loadProjectStatement.get(input.projectId)
            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const channelRow = loadChannelStatement.get(input.projectId, input.channelId)
            if (projectRow === null || actorRow === null || channelRow === null) {
                return { kind: 'not_found' }
            }

            const accountRow = loadAccountStatement.get(input.accountId)
            if (
                accountRow === null ||
                accountRow.userId !== actorRow.subjectId ||
                accountRow.providerId !== input.kind
            ) {
                return { kind: 'invalid_account' }
            }

            const requiredScopes = input.requiredScopes ?? []
            const grantedScopes = parseScopes(accountRow.scope)
            const missingScopes = requiredScopes.filter(scope => !grantedScopes.has(scope))
            if (missingScopes.length > 0) {
                return { kind: 'missing_scopes', scopes: missingScopes }
            }

            if (loadPublisherForChannelStatement.get(input.projectId, input.channelId) !== null) {
                return { kind: 'publisher_exists' }
            }

            const timestamp = requireTimestamp(now(), 'now')
            const project = toProject(projectRow)
            const actor = toActor(actorRow)
            const channel = toChannel(channelRow)
            const publisher = createPublisher({
                id: createId(),
                project,
                channel,
                kind: input.kind,
                now: timestamp,
            })
            const connectionId = createId()

            insertPublisherStatement.run(
                publisher.id,
                publisher.projectId,
                publisher.channelId,
                publisher.kind,
                timestamp
            )
            insertConnectionStatement.run(
                connectionId,
                publisher.projectId,
                publisher.id,
                accountRow.id,
                actor.id,
                timestamp
            )
            for (const publication of listUnqueuedScheduledPublicationsStatement.all(
                publisher.projectId,
                publisher.channelId
            )) {
                insertJobStatement.run(
                    createId(),
                    publisher.projectId,
                    publication.id,
                    Math.max(publication.scheduledAt, timestamp),
                    timestamp
                )
            }
            insertAuditEventStatement.run(
                createId(),
                project.id,
                actor.id,
                'publisher.connected',
                'publisher',
                publisher.id,
                JSON.stringify({ kind: publisher.kind, providerId: accountRow.providerId }),
                timestamp
            )

            return {
                kind: 'created',
                connection: {
                    id: connectionId,
                    projectId: publisher.projectId,
                    publisherId: publisher.id,
                    channelId: publisher.channelId,
                    kind: publisher.kind,
                    accountId: accountRow.id,
                    providerId: accountRow.providerId,
                    connectedByActorId: actor.id,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            }
        }
    )

    const disconnectPublisherConnectionTransaction = client.transaction(
        (input: DisconnectPublisherConnectionInput): DisconnectPublisherConnectionResult => {
            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const connection = loadPublisherConnectionStatement.get(
                input.projectId,
                input.channelId
            )
            if (actorRow === null || connection === null) return { kind: 'not_found' }

            if (loadActiveWorkStatement.get(input.projectId, input.channelId) !== null) {
                return { kind: 'active_work' }
            }

            const timestamp = requireTimestamp(now(), 'now')
            const deleted = deletePublisherStatement.run(input.projectId, connection.publisherId)
            if (deleted.changes < 1) return { kind: 'not_found' }

            insertAuditEventStatement.run(
                createId(),
                input.projectId,
                actorRow.id,
                'publisher.disconnected',
                'publisher',
                connection.publisherId,
                JSON.stringify({ kind: connection.kind, providerId: connection.providerId }),
                timestamp
            )

            return { kind: 'disconnected', connection }
        }
    )

    return {
        hasChannelAccess(projectId: string, channelId: string, subjectId: string): boolean {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedChannelId = requireNonBlank(channelId, 'channelId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')

            return (
                loadActorStatement.get(normalizedProjectId, normalizedSubjectId) !== null &&
                loadChannelStatement.get(normalizedProjectId, normalizedChannelId) !== null
            )
        },

        getPublisherExecutionTarget(
            jobId: string,
            claimToken: string
        ): PublisherExecutionTarget | null {
            return (
                loadPublisherExecutionTargetStatement.get(
                    requireNonBlank(jobId, 'jobId'),
                    requireNonBlank(claimToken, 'claimToken')
                ) ?? null
            )
        },

        createPublisherConnection(
            input: CreatePublisherConnectionInput
        ): CreatePublisherConnectionResult {
            return createPublisherConnectionTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                kind: requireNonBlank(input.kind, 'kind'),
                accountId: requireNonBlank(input.accountId, 'accountId'),
                requiredScopes: input.requiredScopes?.map(scope =>
                    requireNonBlank(scope, 'requiredScope')
                ),
            })
        },

        listPublisherConnections(
            projectId: string,
            subjectId: string
        ): PublisherConnection[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
            if (loadActorStatement.get(normalizedProjectId, normalizedSubjectId) === null) {
                return null
            }

            return listPublisherConnectionsStatement.all(normalizedProjectId)
        },

        disconnectPublisherConnection(
            input: DisconnectPublisherConnectionInput
        ): DisconnectPublisherConnectionResult {
            return disconnectPublisherConnectionTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}

function toProject(row: ProjectRow): Project {
    return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toActor(row: ActorRow): Actor {
    return {
        id: row.id,
        projectId: row.projectId,
        kind: row.kind,
        subjectId: row.subjectId,
        displayName: row.displayName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toChannel(row: ChannelRow): Channel {
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}
