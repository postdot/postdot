import {
    ChannelProfileCompiler,
    createPublisher,
    requireNonBlank,
    requireTimestamp,
    isCustomHttpAuthentication,
    type Actor,
    type Channel,
    type CustomHttpAuthentication,
    type ChannelProfileDefinition,
    type Project,
    type Timestamp,
} from '@herald/core'

import type { HeraldDatabase } from './client'

export interface PublisherConnectionDestination {
    readonly type: 'member' | 'organization'
    readonly id: string
    readonly name: string | null
}

export interface CreatePublisherConnectionInput {
    readonly projectId: string
    readonly channelId: string
    readonly subjectId: string
    readonly kind: string
    readonly credentialId: string
    readonly endpointUrl?: string | null
    readonly authentication?: CustomHttpAuthentication | null
    readonly destination?: PublisherConnectionDestination
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
    readonly endpointUrl: string | null
    readonly authentication: CustomHttpAuthentication | null
    readonly destination: PublisherConnectionDestination | null
    readonly providerId: string
    readonly externalAccountId: string
    readonly externalAccountName: string | null
    readonly scopes: string[]
    readonly state: 'active' | 'reconnect_required' | 'revoked'
    readonly connectedByActorId: string
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

export interface PublisherExecutionMedia {
    readonly id: string
    readonly projectId: string
    readonly executionRevisionId: string
    readonly targetRevisionMediaId: string
    readonly assetId: string
    readonly representationId: string
    readonly position: number
    readonly contentPath: string
    readonly role: string | null
    readonly accessibilityText: string | null
    readonly originalFilename: string
    readonly contentType: string
    readonly family: 'image' | 'video' | 'audio' | 'document'
    readonly byteSize: number
    readonly sha256: string
    readonly width: number | null
    readonly height: number | null
    readonly durationMs: number | null
    readonly storeId: string
    readonly objectKey: string
}

export interface PublisherExecutionTarget {
    readonly jobId: string
    readonly projectId: string
    readonly publicationId: string
    readonly scheduledAt: number | null
    readonly executionRevisionId: string
    readonly profileVersionId: string
    readonly mediaReferenceCount: number
    readonly profile: ChannelProfileDefinition
    readonly content: Readonly<Record<string, unknown>>
    readonly publisherId: string
    readonly channelId: string
    readonly channelName: string
    readonly kind: string
    readonly credentialId: string
    readonly externalAccountId: string
    readonly destination: PublisherConnectionDestination | null
    readonly providerId: string
    readonly credentialState: 'active' | 'reconnect_required' | 'revoked'
    readonly credentialExpiresAt: number | null
    readonly endpointUrl: string | null
    readonly authentication: CustomHttpAuthentication | null
    readonly attempt: number
    readonly media: readonly PublisherExecutionMedia[]
}

export type CreatePublisherConnectionResult =
    | { readonly kind: 'created'; readonly connection: PublisherConnection }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'invalid_credential' }
    | { readonly kind: 'credential_unavailable' }
    | { readonly kind: 'publisher_exists' }
    | { readonly kind: 'incompatible_profile' }
    | { readonly kind: 'invalid_connection' }

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
    readonly profileId: string
    readonly profileVersionId: string
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
    'externalAccountName' | 'scopes' | 'state' | 'authentication' | 'destination'
> {
    readonly externalAccountName: string | null
    readonly scopesJson: string
    readonly state: 'active' | 'reconnect_required' | 'revoked'
    readonly authenticationJson: string | null
    readonly destinationType: string | null
    readonly destinationId: string | null
    readonly destinationName: string | null
}

interface PublisherRow {
    readonly id: string
}

interface ChannelProfileRow {
    readonly profileJson: string
}

interface PublisherExecutionTargetRow extends Omit<
    PublisherExecutionTarget,
    'content' | 'media' | 'profile' | 'authentication' | 'destination'
> {
    readonly contentJson: string
    readonly profileJson: string
    readonly authenticationJson: string | null
    readonly destinationType: string | null
    readonly destinationId: string | null
    readonly destinationName: string | null
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
          and kind in ('human', 'agent', 'api_token')
        order by created_at, id
        limit 1
    `)
    const loadChannelStatement = client.query<ChannelRow, [projectId: string, channelId: string]>(`
        select channels.id,
               channels.project_id as projectId,
               channels.name,
               channel_profiles.profile_id as profileId,
               channels.profile_version_id as profileVersionId,
               channels.created_at as createdAt,
               channels.updated_at as updatedAt
        from channels
        inner join channel_profile_versions as channel_profiles
            on channel_profiles.project_id = channels.project_id
           and channel_profiles.channel_id = channels.id
           and channel_profiles.id = channels.profile_version_id
        where channels.project_id = ?1
          and channels.id = ?2
    `)
    const loadChannelProfileStatement = client.query<
        ChannelProfileRow,
        [projectId: string, profileVersionId: string]
    >(`
        select profile_json as profileJson
        from channel_profile_versions
        where project_id = ?1
          and id = ?2
          and state <> 'disabled'
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
        publisher_connections.endpoint_url as endpointUrl,
        publisher_connections.authentication_json as authenticationJson,
        publisher_connections.destination_type as destinationType,
        publisher_connections.destination_id as destinationId,
        publisher_connections.destination_name as destinationName,
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
        PublisherExecutionTargetRow,
        [jobId: string, claimToken: string]
    >(`
        select jobs.id as jobId,
               jobs.project_id as projectId,
               jobs.publication_id as publicationId,
               publications.scheduled_at as scheduledAt,
               jobs.attempts as attempt,
               execution.id as executionRevisionId,
               execution.profile_version_id as profileVersionId,
               execution.media_reference_count as mediaReferenceCount,
               execution.content_json as contentJson,
               channel_profiles.profile_json as profileJson,
               publishers.id as publisherId,
               publishers.channel_id as channelId,
               channels.name as channelName,
               publishers.kind,
               publisher_connections.credential_id as credentialId,
               publisher_connections.endpoint_url as endpointUrl,
               publisher_connections.authentication_json as authenticationJson,
               publisher_connections.destination_type as destinationType,
               publisher_connections.destination_id as destinationId,
               publisher_connections.destination_name as destinationName,
               publisher_credentials.external_account_id as externalAccountId,
               publisher_credentials.provider_id as providerId,
               publisher_credentials.state as credentialState,
               publisher_credentials.expires_at as credentialExpiresAt
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        inner join publication_execution_revisions as execution
            on execution.project_id = jobs.project_id
           and execution.job_id = jobs.id
           and execution.publication_id = jobs.publication_id
        inner join publishers
            on publishers.project_id = publications.project_id
           and publishers.channel_id = publications.channel_id
        inner join channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        inner join channel_profile_versions as channel_profiles
            on channel_profiles.project_id = execution.project_id
           and channel_profiles.id = execution.profile_version_id
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
          and publications.state = 'publishing'
        limit 1
    `)
    const listPublisherExecutionMediaStatement = client.query<
        PublisherExecutionMedia,
        [projectId: string, executionRevisionId: string]
    >(`
        select execution_media.id,
               execution_media.project_id as projectId,
               execution_media.execution_revision_id as executionRevisionId,
               execution_media.target_revision_media_id as targetRevisionMediaId,
               execution_media.asset_id as assetId,
               execution_media.representation_id as representationId,
               execution_media.position,
               execution_media.content_path as contentPath,
               execution_media.role,
               execution_media.accessibility_text as accessibilityText,
               assets.original_filename as originalFilename,
               representations.detected_content_type as contentType,
               representations.family,
               representations.byte_size as byteSize,
               representations.sha256,
               representations.width,
               representations.height,
               representations.duration_ms as durationMs,
               representations.store_id as storeId,
               representations.object_key as objectKey
        from publication_execution_revision_media as execution_media
        inner join media_assets as assets
            on assets.project_id = execution_media.project_id
           and assets.id = execution_media.asset_id
        inner join media_representations as representations
            on representations.project_id = execution_media.project_id
           and representations.asset_id = execution_media.asset_id
           and representations.id = execution_media.representation_id
           and representations.state = 'ready'
        where execution_media.project_id = ?1
          and execution_media.execution_revision_id = ?2
        order by execution_media.position, execution_media.id
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
          and publications.delivery_mode = 'automatic'
          and publications.review_state = 'compatible'
          and publications.target_revision_id is not null
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
            endpointUrl: string | null,
            authenticationJson: string | null,
            destinationType: string | null,
            destinationId: string | null,
            destinationName: string | null,
            connectedByActorId: string,
            timestamp: number,
        ]
    >(`
        insert into publisher_connections (
            id,
            project_id,
            publisher_id,
            credential_id,
            endpoint_url,
            authentication_json,
            destination_type,
            destination_id,
            destination_name,
            connected_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
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

            const connectionSettings = normalizeConnectionSettings(input, credentialRow)
            if (!connectionSettings.valid) return { kind: 'invalid_connection' }

            const profileRow = loadChannelProfileStatement.get(
                input.projectId,
                channelRow.profileVersionId
            )
            if (
                profileRow === null ||
                !isCompatiblePublisherProfile(profileRow.profileJson, input.kind)
            ) {
                return { kind: 'incompatible_profile' }
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
                connectionSettings.endpointUrl,
                connectionSettings.authentication === null
                    ? null
                    : JSON.stringify(connectionSettings.authentication),
                connectionSettings.destination?.type ?? null,
                connectionSettings.destination?.id ?? null,
                connectionSettings.destination?.name ?? null,
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
                    endpointUrl: connectionSettings.endpointUrl,
                    authentication: connectionSettings.authentication,
                    destination: connectionSettings.destination,
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

        getProjectActorId(projectId: string, subjectId: string): string | null {
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
            const row = loadPublisherExecutionTargetStatement.get(
                requireNonBlank(jobId, 'jobId'),
                requireNonBlank(claimToken, 'claimToken')
            )
            if (row === null) return null
            const media = listPublisherExecutionMediaStatement.all(
                row.projectId,
                row.executionRevisionId
            )
            if (media.length !== row.mediaReferenceCount) {
                throw new Error(
                    `Execution revision ${row.executionRevisionId} has incomplete media references`
                )
            }
            return {
                jobId: row.jobId,
                projectId: row.projectId,
                publicationId: row.publicationId,
                scheduledAt: row.scheduledAt,
                executionRevisionId: row.executionRevisionId,
                profileVersionId: row.profileVersionId,
                mediaReferenceCount: row.mediaReferenceCount,
                profile: parseProfile(row.profileJson),
                content: parseJsonObject(row.contentJson),
                publisherId: row.publisherId,
                channelId: row.channelId,
                channelName: row.channelName,
                kind: row.kind,
                credentialId: row.credentialId,
                externalAccountId: row.externalAccountId,
                destination: parseDestination(row),
                providerId: row.providerId,
                credentialState: row.credentialState,
                credentialExpiresAt: row.credentialExpiresAt,
                endpointUrl: row.endpointUrl,
                authentication: parseAuthentication(row.authenticationJson),
                attempt: row.attempt,
                media,
            }
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
        profileId: row.profileId,
        profileVersionId: row.profileVersionId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function isCompatiblePublisherProfile(profileJson: string, kind: string): boolean {
    let parsed: unknown
    try {
        parsed = JSON.parse(profileJson)
    } catch {
        return false
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const profile = parsed as ChannelProfileDefinition
    const compiled = new ChannelProfileCompiler().compile(profile)
    if (!compiled.ok) return false
    const execution = compiled.value.profile.execution
    return kind === 'custom_http'
        ? execution.kind === 'declarative_http'
        : execution.kind === 'built_in' && execution.contractId === kind
}

function normalizeConnectionSettings(
    input: CreatePublisherConnectionInput,
    credential: CredentialRow
):
    | {
          readonly valid: true
          readonly endpointUrl: string | null
          readonly authentication: CustomHttpAuthentication | null
          readonly destination: PublisherConnectionDestination | null
      }
    | { readonly valid: false } {
    const endpointUrl = input.endpointUrl ?? null
    if (
        endpointUrl !== null &&
        (typeof endpointUrl !== 'string' || endpointUrl.trim().length === 0)
    ) {
        return { valid: false }
    }

    const authentication = input.authentication ?? null
    if (authentication !== null && !isCustomHttpAuthentication(authentication)) {
        return { valid: false }
    }

    if (input.kind === 'custom_http') {
        return endpointUrl !== null && authentication !== null && input.destination === undefined
            ? { valid: true, endpointUrl, authentication, destination: null }
            : { valid: false }
    }

    if (endpointUrl !== null || authentication !== null) return { valid: false }
    if (input.kind !== 'linkedin' && input.destination !== undefined) return { valid: false }

    const destination =
        input.destination ??
        (input.kind === 'linkedin'
            ? {
                  type: 'member',
                  id: credential.externalAccountId,
                  name: credential.externalAccountName,
              }
            : null)
    if (destination !== null && !isValidLinkedInDestination(destination)) {
        return { valid: false }
    }
    return { valid: true, endpointUrl, authentication, destination }
}

function isValidLinkedInDestination(destination: PublisherConnectionDestination): boolean {
    return (
        (destination.type === 'member' || destination.type === 'organization') &&
        destination.id.trim().length > 0 &&
        !/\s/.test(destination.id) &&
        !destination.id.startsWith('urn:') &&
        (destination.type !== 'organization' || /^[1-9]\d*$/.test(destination.id)) &&
        (destination.name === null || destination.name.trim().length > 0)
    )
}

function parseProfile(value: string): ChannelProfileDefinition {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new Error('Stored channel profile is not valid JSON')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Stored channel profile must be a JSON object')
    }
    const compiled = new ChannelProfileCompiler().compile(parsed as ChannelProfileDefinition)
    if (!compiled.ok) throw new Error('Stored channel profile is invalid')
    return compiled.value.profile
}

function parseAuthentication(value: string | null): CustomHttpAuthentication | null {
    if (value === null) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new Error('Stored publisher authentication is not valid JSON')
    }
    if (!isCustomHttpAuthentication(parsed)) {
        throw new Error('Stored publisher authentication is invalid')
    }
    return parsed
}

function parseJsonObject(value: string): Readonly<Record<string, unknown>> {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new Error('Stored execution content is not valid JSON')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Stored execution content must be a JSON object')
    }
    return parsed as Readonly<Record<string, unknown>>
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
        endpointUrl: row.endpointUrl,
        authentication: parseAuthentication(row.authenticationJson),
        destination: parseDestination(row),
        connectedByActorId: row.connectedByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function parseDestination(
    row: Pick<PublisherConnectionRow, 'destinationType' | 'destinationId' | 'destinationName'>
): PublisherConnectionDestination | null {
    if (
        row.destinationType === null &&
        row.destinationId === null &&
        row.destinationName === null
    ) {
        return null
    }
    if (row.destinationType === null || row.destinationId === null) {
        throw new Error('Stored publisher connection destination is incomplete')
    }
    if (row.destinationType !== 'member' && row.destinationType !== 'organization') {
        throw new Error('Stored publisher connection destination type is invalid')
    }
    return {
        type: row.destinationType,
        id: requireNonBlank(row.destinationId, 'destination id'),
        name:
            row.destinationName === null
                ? null
                : requireNonBlank(row.destinationName, 'destination name'),
    }
}
