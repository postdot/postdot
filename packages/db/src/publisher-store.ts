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
    readonly credentialId: string
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
    readonly credentialId: string
    readonly providerId: string
    readonly externalAccountId: string
    readonly externalAccountName: string | null
    readonly scopes: string[]
    readonly state: 'active' | 'reconnect_required' | 'revoked'
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
    readonly credentialId: string
    readonly externalAccountId: string
    readonly providerId: string
    readonly credentialState: 'active' | 'reconnect_required' | 'revoked'
    readonly credentialExpiresAt: number | null
}

export type CreatePublisherConnectionResult =
    | { readonly kind: 'created'; readonly connection: PublisherConnection }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'invalid_credential' }
    | { readonly kind: 'credential_unavailable' }
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

interface CredentialRow {
    readonly id: string
    readonly providerId: string
    readonly externalAccountId: string
    readonly externalAccountName: string | null
    readonly scopesJson: string
    readonly state: 'active' | 'reconnect_required' | 'revoked'
}

interface PublisherConnectionRow extends Omit<
    PublisherConnection,
    'externalAccountName' | 'scopes' | 'state'
> {
    readonly externalAccountName: string | null
    readonly scopesJson: string
    readonly state: 'active' | 'reconnect_required' | 'revoked'
}

interface PublisherRow {
    readonly id: string
}

interface ScheduledPublicationRow {
    readonly id: string
    readonly scheduledAt: number
}

export interface PublisherStoreOptions {
    readonly credentialRevoker: {
        readonly revokePublisherCredentialIfUnreferenced: (
            projectId: string,
            credentialId: string
        ) => void
    }
    readonly now?: () => number
    readonly createId?: () => string
}

function parseScopes(scopesJson: string): string[] {
    const parsed: unknown = JSON.parse(scopesJson)
    if (!Array.isArray(parsed) || !parsed.every(scope => typeof scope === 'string')) {
        throw new Error('Stored publisher credential scopes are invalid')
    }
    return parsed.map(scope => requireNonBlank(scope, 'scope'))
}

function credentialFields(row: CredentialRow) {
    return {
        credentialId: row.id,
        providerId: row.providerId,
        externalAccountId: row.externalAccountId,
        externalAccountName: row.externalAccountName,
        scopes: parseScopes(row.scopesJson),
        state: row.state,
    } as const
}

export function createPublisherStore(database: HeraldDatabase, options: PublisherStoreOptions) {
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
    const loadCredentialStatement = client.query<
        CredentialRow,
        [projectId: string, credentialId: string]
    >(`
        select id,
               provider_id as providerId,
               external_account_id as externalAccountId,
               external_account_name as externalAccountName,
               scopes as scopesJson,
               state
        from publisher_credentials
        where project_id = ?1
          and id = ?2
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
        publisher_connections.credential_id as credentialId,
        publisher_credentials.provider_id as providerId,
        publisher_credentials.external_account_id as externalAccountId,
        publisher_credentials.external_account_name as externalAccountName,
        publisher_credentials.scopes as scopesJson,
        publisher_credentials.state,
        publisher_connections.connected_by_actor_id as connectedByActorId,
        publisher_connections.created_at as createdAt,
        publisher_connections.updated_at as updatedAt
    `
    const listPublisherConnectionsStatement = client.query<
        PublisherConnectionRow,
        [projectId: string]
    >(`
        select ${publisherConnectionColumns}
        from publisher_connections
        inner join publishers
            on publishers.project_id = publisher_connections.project_id
           and publishers.id = publisher_connections.publisher_id
        inner join publisher_credentials
            on publisher_credentials.project_id = publisher_connections.project_id
           and publisher_credentials.id = publisher_connections.credential_id
        where publisher_connections.project_id = ?1
        order by publisher_connections.created_at, publisher_connections.id
    `)
    const loadPublisherConnectionStatement = client.query<
        PublisherConnectionRow,
        [projectId: string, channelId: string]
    >(`
        select ${publisherConnectionColumns}
        from publisher_connections
        inner join publishers
            on publishers.project_id = publisher_connections.project_id
           and publishers.id = publisher_connections.publisher_id
        inner join publisher_credentials
            on publisher_credentials.project_id = publisher_connections.project_id
           and publisher_credentials.id = publisher_connections.credential_id
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
               publisher_connections.credential_id as credentialId,
               publisher_credentials.external_account_id as externalAccountId,
               publisher_credentials.provider_id as providerId,
               publisher_credentials.state as credentialState,
               publisher_credentials.expires_at as credentialExpiresAt
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
        inner join publisher_credentials
            on publisher_credentials.project_id = publisher_connections.project_id
           and publisher_credentials.id = publisher_connections.credential_id
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
            credentialId: string,
            connectedByActorId: string,
            timestamp: number,
        ]
    >(`
        insert into publisher_connections (
            id,
            project_id,
            publisher_id,
            credential_id,
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

            const credentialRow = loadCredentialStatement.get(input.projectId, input.credentialId)
            if (credentialRow === null || credentialRow.providerId !== input.kind) {
                return { kind: 'invalid_credential' }
            }
            if (credentialRow.state !== 'active') {
                return { kind: 'credential_unavailable' }
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
                credentialRow.id,
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
                JSON.stringify({ kind: publisher.kind, providerId: credentialRow.providerId }),
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
                    ...credentialFields(credentialRow),
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

            options.credentialRevoker.revokePublisherCredentialIfUnreferenced(
                input.projectId,
                connection.credentialId
            )

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

            return { kind: 'disconnected', connection: toPublisherConnection(connection) }
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

        getHumanActorId(projectId: string, subjectId: string): string | null {
            const actor = loadActorStatement.get(
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(subjectId, 'subjectId')
            )
            return actor?.id ?? null
        },

        hasPublisherForChannel(projectId: string, channelId: string): boolean {
            return (
                loadPublisherForChannelStatement.get(
                    requireNonBlank(projectId, 'projectId'),
                    requireNonBlank(channelId, 'channelId')
                ) !== null
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
                credentialId: requireNonBlank(input.credentialId, 'credentialId'),
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

            return listPublisherConnectionsStatement
                .all(normalizedProjectId)
                .map(toPublisherConnection)
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

function toPublisherConnection(row: PublisherConnectionRow): PublisherConnection {
    return {
        id: row.id,
        projectId: row.projectId,
        publisherId: row.publisherId,
        channelId: row.channelId,
        kind: row.kind,
        ...credentialFields({
            id: row.credentialId,
            providerId: row.providerId,
            externalAccountId: row.externalAccountId,
            externalAccountName: row.externalAccountName,
            scopesJson: row.scopesJson,
            state: row.state,
        }),
        connectedByActorId: row.connectedByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}
