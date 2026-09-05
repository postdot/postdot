import {
    actorKinds,
    deliveryModes,
    jobStates,
    mediaAssetStates,
    mediaFamilies,
    mediaRepresentationKinds,
    mediaRepresentationStates,
    mediaUploadIntentStates,
    providerMediaDeliveryStates,
    publicationReviewStates,
    publicationStates,
    publisherCredentialStates,
    channelProfileVersionStates,
    channelStates,
    type ChannelProfileDefinition,
    type CustomHttpAuthentication,
    type SourceContent,
} from '@herald/core'
import { sql } from 'drizzle-orm'
import {
    check,
    blob,
    foreignKey,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const epochMilliseconds = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const oauthAuthorizationAttemptStatuses = ['pending', 'consumed', 'expired'] as const
const channelProfileStates = channelProfileVersionStates

const timestamps = () => ({
    createdAt: integer('created_at').default(epochMilliseconds).notNull(),
    updatedAt: integer('updated_at').default(epochMilliseconds).notNull(),
})

export const projects = sqliteTable(
    'projects',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        timeZone: text('time_zone').notNull().default('UTC'),
        ...timestamps(),
    },
    table => [check('projects_name_nonblank', sql`length(trim(${table.name})) > 0`)]
)

export const actors = sqliteTable(
    'actors',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        kind: text('kind', { enum: actorKinds }).notNull(),
        subjectId: text('subject_id'),
        displayName: text('display_name').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('actors_project_id_id_uidx').on(table.projectId, table.id),
        check('actors_kind_valid', sql`${table.kind} in ('human', 'agent', 'api_token', 'system')`),
        check('actors_display_name_nonblank', sql`length(trim(${table.displayName})) > 0`),
        check(
            'actors_subject_id_nonblank',
            sql`${table.subjectId} is null or length(trim(${table.subjectId})) > 0`
        ),
    ]
)

export const projectAccessTokens = sqliteTable(
    'project_access_tokens',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        actorId: text('actor_id').notNull(),
        name: text('name').notNull(),
        tokenPrefix: text('token_prefix').notNull(),
        tokenHash: text('token_hash').notNull(),
        expiresAt: integer('expires_at'),
        revokedAt: integer('revoked_at'),
        createdByActorId: text('created_by_actor_id').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('project_access_tokens_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('project_access_tokens_token_hash_uidx').on(table.tokenHash),
        index('project_access_tokens_project_revoked_idx').on(table.projectId, table.revokedAt),
        foreignKey({
            name: 'project_access_tokens_project_actor_fk',
            columns: [table.projectId, table.actorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'project_access_tokens_project_creator_fk',
            columns: [table.projectId, table.createdByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check('project_access_tokens_name_nonblank', sql`length(trim(${table.name})) > 0`),
        check('project_access_tokens_prefix_nonblank', sql`length(trim(${table.tokenPrefix})) > 0`),
        check('project_access_tokens_hash_nonblank', sql`length(trim(${table.tokenHash})) > 0`),
        check(
            'project_access_tokens_expiry_valid',
            sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}`
        ),
        check(
            'project_access_tokens_revocation_valid',
            sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`
        ),
    ]
)

export const channels = sqliteTable(
    'channels',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        profileVersionId: text('profile_version_id').notNull(),
        state: text('state', { enum: channelStates }).default('active').notNull(),
        archivedAt: integer('archived_at'),
        revision: integer('revision').default(1).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('channels_project_id_id_uidx').on(table.projectId, table.id),
        check(
            'channels_profile_version_id_nonblank',
            sql`length(trim(${table.profileVersionId})) > 0`
        ),
        check('channels_name_nonblank', sql`length(trim(${table.name})) > 0`),
        check('channels_state_valid', sql`${table.state} in ('active', 'archived')`),
        check(
            'channels_archived_timestamp_valid',
            sql`(${table.state} = 'active' and ${table.archivedAt} is null)
                or (${table.state} = 'archived' and ${table.archivedAt} is not null)`
        ),
        check('channels_revision_positive', sql`${table.revision} > 0`),
    ]
)

export const channelProfileVersions = sqliteTable(
    'channel_profile_versions',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        profileId: text('profile_id').notNull(),
        version: integer('version').notNull(),
        origin: text('origin', { enum: ['built_in', 'custom'] }).notNull(),
        state: text('state', { enum: channelProfileStates }).notNull(),
        revision: integer('revision').default(1).notNull(),
        profileJson: text('profile_json', { mode: 'json' })
            .$type<ChannelProfileDefinition>()
            .notNull(),
        profileHash: text('profile_hash').notNull(),
        schemaHash: text('schema_hash').notNull(),
        createdByActorId: text('created_by_actor_id').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('channel_profile_versions_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('channel_profile_versions_project_channel_version_uidx').on(
            table.projectId,
            table.channelId,
            table.version
        ),
        index('channel_profile_versions_project_channel_state_idx').on(
            table.projectId,
            table.channelId,
            table.state
        ),
        uniqueIndex('channel_profile_versions_project_channel_active_uidx')
            .on(table.projectId, table.channelId)
            .where(sql`${table.state} = 'active'`),
        uniqueIndex('channel_profile_versions_project_channel_draft_uidx')
            .on(table.projectId, table.channelId)
            .where(sql`${table.state} = 'draft'`),
        foreignKey({
            name: 'channel_profile_versions_project_channel_fk',
            columns: [table.projectId, table.channelId],
            foreignColumns: [channels.projectId, channels.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'channel_profile_versions_project_actor_fk',
            columns: [table.projectId, table.createdByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'channel_profile_versions_profile_id_nonblank',
            sql`length(trim(${table.profileId})) > 0`
        ),
        check('channel_profile_versions_version_positive', sql`${table.version} > 0`),
        check('channel_profile_versions_revision_positive', sql`${table.revision} > 0`),
        check(
            'channel_profile_versions_profile_json_object',
            sql`json_valid(${table.profileJson}) and json_type(${table.profileJson}) = 'object'`
        ),
        check(
            'channel_profile_versions_hashes_nonblank',
            sql`length(trim(${table.profileHash})) > 0 and length(trim(${table.schemaHash})) > 0`
        ),
        check(
            'channel_profile_versions_origin_valid',
            sql`${table.origin} in ('built_in', 'custom')`
        ),
        check(
            'channel_profile_versions_state_valid',
            sql`${table.state} in ('draft', 'active', 'superseded', 'disabled')`
        ),
    ]
)

export const publishers = sqliteTable(
    'publishers',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        kind: text('kind').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('publishers_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('publishers_project_id_channel_id_uidx').on(table.projectId, table.channelId),
        foreignKey({
            name: 'publishers_project_channel_fk',
            columns: [table.projectId, table.channelId],
            foreignColumns: [channels.projectId, channels.id],
        }).onDelete('cascade'),
        check('publishers_kind_nonblank', sql`length(trim(${table.kind})) > 0`),
    ]
)

export const publisherCredentials = sqliteTable(
    'publisher_credentials',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        providerId: text('provider_id').notNull(),
        externalAccountId: text('external_account_id').notNull(),
        externalAccountName: text('external_account_name'),
        scopes: text('scopes', { mode: 'json' }).$type<readonly string[]>().notNull(),
        state: text('state', { enum: publisherCredentialStates }).notNull(),
        expiresAt: integer('expires_at'),
        connectedByActorId: text('connected_by_actor_id').notNull(),
        encryptionVersion: integer('encryption_version'),
        encryptionKeyId: text('encryption_key_id'),
        accessTokenCiphertext: blob('access_token_ciphertext', { mode: 'buffer' }),
        accessTokenNonce: blob('access_token_nonce', { mode: 'buffer' }),
        refreshTokenCiphertext: blob('refresh_token_ciphertext', { mode: 'buffer' }),
        refreshTokenNonce: blob('refresh_token_nonce', { mode: 'buffer' }),
        providerSessionCiphertext: blob('provider_session_ciphertext', { mode: 'buffer' }),
        providerSessionNonce: blob('provider_session_nonce', { mode: 'buffer' }),
        revision: integer('revision').default(1).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('publisher_credentials_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('publisher_credentials_project_provider_external_uidx').on(
            table.projectId,
            table.providerId,
            table.externalAccountId
        ),
        index('publisher_credentials_project_state_expires_idx').on(
            table.projectId,
            table.state,
            table.expiresAt
        ),
        index('publisher_credentials_project_actor_idx').on(
            table.projectId,
            table.connectedByActorId
        ),
        foreignKey({
            name: 'publisher_credentials_project_actor_fk',
            columns: [table.projectId, table.connectedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'publisher_credentials_provider_nonblank',
            sql`length(trim(${table.providerId})) > 0`
        ),
        check(
            'publisher_credentials_external_account_nonblank',
            sql`length(trim(${table.externalAccountId})) > 0`
        ),
        check(
            'publisher_credentials_external_name_nonblank',
            sql`${table.externalAccountName} is null or length(trim(${table.externalAccountName})) > 0`
        ),
        check(
            'publisher_credentials_scopes_json_array',
            sql`json_valid(${table.scopes}) and json_type(${table.scopes}) = 'array'`
        ),
        check(
            'publisher_credentials_state_valid',
            sql`${table.state} in ('active', 'reconnect_required', 'revoked')`
        ),
        check(
            'publisher_credentials_expiry_valid',
            sql`${table.expiresAt} is null or ${table.expiresAt} >= 0`
        ),
        check(
            'publisher_credentials_encryption_version_valid',
            sql`${table.encryptionVersion} is null or ${table.encryptionVersion} > 0`
        ),
        check(
            'publisher_credentials_encryption_key_nonblank',
            sql`${table.encryptionKeyId} is null or length(trim(${table.encryptionKeyId})) > 0`
        ),
        check(
            'publisher_credentials_secret_state_valid',
            sql`(
                    ${table.state} in ('active', 'reconnect_required')
                    and ${table.encryptionVersion} is not null
                    and ${table.encryptionKeyId} is not null
                    and ${table.accessTokenCiphertext} is not null
                    and ${table.accessTokenNonce} is not null
                    and length(${table.accessTokenCiphertext}) > 16
                    and length(${table.accessTokenNonce}) = 12
                ) or (
                    ${table.state} = 'revoked'
                    and ${table.encryptionVersion} is null
                    and ${table.encryptionKeyId} is null
                    and ${table.accessTokenCiphertext} is null
                    and ${table.accessTokenNonce} is null
                    and ${table.refreshTokenCiphertext} is null
                    and ${table.refreshTokenNonce} is null
                    and ${table.providerSessionCiphertext} is null
                    and ${table.providerSessionNonce} is null
                )`
        ),
        check(
            'publisher_credentials_refresh_token_envelope_valid',
            sql`(${table.refreshTokenCiphertext} is null and ${table.refreshTokenNonce} is null)
                or (${table.refreshTokenCiphertext} is not null
                    and ${table.refreshTokenNonce} is not null
                    and length(${table.refreshTokenCiphertext}) > 16
                    and length(${table.refreshTokenNonce}) = 12)`
        ),
        check(
            'publisher_credentials_provider_session_envelope_valid',
            sql`(${table.providerSessionCiphertext} is null and ${table.providerSessionNonce} is null)
                or (${table.providerSessionCiphertext} is not null
                    and ${table.providerSessionNonce} is not null
                    and length(${table.providerSessionCiphertext}) > 16
                    and length(${table.providerSessionNonce}) = 12)`
        ),
        check('publisher_credentials_revision_valid', sql`${table.revision} > 0`),
    ]
)

export const oauthAuthorizationAttempts = sqliteTable(
    'oauth_authorization_attempts',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        providerId: text('provider_id').notNull(),
        connectedByActorId: text('connected_by_actor_id').notNull(),
        callbackUri: text('callback_uri').notNull(),
        scopes: text('scopes', { mode: 'json' }).$type<readonly string[]>().notNull(),
        returnPath: text('return_path').notNull(),
        contextJson: text('context_json').default('{}').notNull(),
        stateDigest: blob('state_digest', { mode: 'buffer' }).notNull(),
        status: text('status', { enum: oauthAuthorizationAttemptStatuses })
            .default('pending')
            .notNull(),
        pkceEncryptionVersion: integer('pkce_encryption_version'),
        pkceEncryptionKeyId: text('pkce_encryption_key_id'),
        pkceVerifierCiphertext: blob('pkce_verifier_ciphertext', { mode: 'buffer' }),
        pkceVerifierNonce: blob('pkce_verifier_nonce', { mode: 'buffer' }),
        providerStateEncryptionVersion: integer('provider_state_encryption_version'),
        providerStateEncryptionKeyId: text('provider_state_encryption_key_id'),
        providerStateCiphertext: blob('provider_state_ciphertext', { mode: 'buffer' }),
        providerStateNonce: blob('provider_state_nonce', { mode: 'buffer' }),
        expiresAt: integer('expires_at').notNull(),
        completedAt: integer('completed_at'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('oauth_authorization_attempts_state_digest_uidx').on(table.stateDigest),
        index('oauth_authorization_attempts_project_channel_idx').on(
            table.projectId,
            table.channelId
        ),
        index('oauth_authorization_attempts_status_expires_idx').on(table.status, table.expiresAt),
        foreignKey({
            name: 'oauth_authorization_attempts_project_channel_fk',
            columns: [table.projectId, table.channelId],
            foreignColumns: [channels.projectId, channels.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'oauth_authorization_attempts_project_actor_fk',
            columns: [table.projectId, table.connectedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'oauth_authorization_attempts_provider_nonblank',
            sql`length(trim(${table.providerId})) > 0`
        ),
        check(
            'oauth_authorization_attempts_callback_nonblank',
            sql`length(trim(${table.callbackUri})) > 0`
        ),
        check(
            'oauth_authorization_attempts_return_path_local',
            sql`substr(${table.returnPath}, 1, 1) = '/'
                and substr(${table.returnPath}, 1, 2) != '//'
                and instr(${table.returnPath}, char(92)) = 0`
        ),
        check(
            'oauth_authorization_attempts_scopes_json_array',
            sql`json_valid(${table.scopes}) and json_type(${table.scopes}) = 'array'`
        ),
        check(
            'oauth_authorization_attempts_context_json_object',
            sql`json_valid(${table.contextJson}) and json_type(${table.contextJson}) = 'object'`
        ),
        check(
            'oauth_authorization_attempts_state_digest_length',
            sql`length(${table.stateDigest}) = 32`
        ),
        check(
            'oauth_authorization_attempts_status_valid',
            sql`${table.status} in ('pending', 'consumed', 'expired')`
        ),
        check(
            'oauth_authorization_attempts_time_valid',
            sql`${table.expiresAt} > ${table.createdAt}
                and (${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt})`
        ),
        check(
            'oauth_authorization_attempts_secret_state_valid',
            sql`(
                    ${table.status} = 'pending'
                    and ${table.completedAt} is null
                    and (
                        (
                            ${table.pkceEncryptionVersion} is null
                            and ${table.pkceEncryptionKeyId} is null
                            and ${table.pkceVerifierCiphertext} is null
                            and ${table.pkceVerifierNonce} is null
                        ) or (
                            ${table.pkceEncryptionVersion} is not null
                            and ${table.pkceEncryptionVersion} > 0
                            and ${table.pkceEncryptionKeyId} is not null
                            and length(trim(${table.pkceEncryptionKeyId})) > 0
                            and ${table.pkceVerifierCiphertext} is not null
                            and length(${table.pkceVerifierCiphertext}) > 16
                            and ${table.pkceVerifierNonce} is not null
                            and length(${table.pkceVerifierNonce}) = 12
                        )
                    )
                    and (
                        (
                            ${table.providerStateEncryptionVersion} is null
                            and ${table.providerStateEncryptionKeyId} is null
                            and ${table.providerStateCiphertext} is null
                            and ${table.providerStateNonce} is null
                        ) or (
                            ${table.providerStateEncryptionVersion} is not null
                            and ${table.providerStateEncryptionVersion} > 0
                            and ${table.providerStateEncryptionKeyId} is not null
                            and length(trim(${table.providerStateEncryptionKeyId})) > 0
                            and ${table.providerStateCiphertext} is not null
                            and length(${table.providerStateCiphertext}) > 16
                            and ${table.providerStateNonce} is not null
                            and length(${table.providerStateNonce}) = 12
                        )
                    )
                ) or (
                    ${table.status} in ('consumed', 'expired')
                    and ${table.completedAt} is not null
                    and ${table.pkceEncryptionVersion} is null
                    and ${table.pkceEncryptionKeyId} is null
                    and ${table.pkceVerifierCiphertext} is null
                    and ${table.pkceVerifierNonce} is null
                    and ${table.providerStateEncryptionVersion} is null
                    and ${table.providerStateEncryptionKeyId} is null
                    and ${table.providerStateCiphertext} is null
                    and ${table.providerStateNonce} is null
                )`
        ),
    ]
)

export const publisherConnections = sqliteTable(
    'publisher_connections',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        publisherId: text('publisher_id').notNull(),
        credentialId: text('credential_id').notNull(),
        endpointUrl: text('endpoint_url'),
        authenticationJson: text('authentication_json', {
            mode: 'json',
        }).$type<CustomHttpAuthentication | null>(),
        destinationType: text('destination_type'),
        destinationId: text('destination_id'),
        destinationName: text('destination_name'),
        connectedByActorId: text('connected_by_actor_id').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('publisher_connections_project_id_publisher_id_uidx').on(
            table.projectId,
            table.publisherId
        ),
        index('publisher_connections_credential_id_idx').on(table.credentialId),
        index('publisher_connections_project_id_actor_id_idx').on(
            table.projectId,
            table.connectedByActorId
        ),
        foreignKey({
            name: 'publisher_connections_project_publisher_fk',
            columns: [table.projectId, table.publisherId],
            foreignColumns: [publishers.projectId, publishers.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publisher_connections_project_credential_fk',
            columns: [table.projectId, table.credentialId],
            foreignColumns: [publisherCredentials.projectId, publisherCredentials.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publisher_connections_project_actor_fk',
            columns: [table.projectId, table.connectedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'publisher_connections_endpoint_url_nonblank',
            sql`${table.endpointUrl} is null or length(trim(${table.endpointUrl})) > 0`
        ),
        check(
            'publisher_connections_authentication_json_object',
            sql`${table.authenticationJson} is null or (json_valid(${table.authenticationJson}) and json_type(${table.authenticationJson}) = 'object')`
        ),
        check(
            'publisher_connections_destination_pair_valid',
            sql`(
                (${table.destinationType} is null and ${table.destinationId} is null and ${table.destinationName} is null)
                or (${table.destinationType} is not null
                    and length(trim(${table.destinationType})) > 0
                    and ${table.destinationId} is not null
                    and length(trim(${table.destinationId})) > 0
                    and (${table.destinationName} is null or length(trim(${table.destinationName})) > 0))
            )`
        ),
    ]
)

export const posts = sqliteTable(
    'posts',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        title: text('title'),
        sourceContent: text('source_content', { mode: 'json' }).$type<SourceContent>().notNull(),
        sourceRevision: integer('source_revision').default(1).notNull(),
        createdByActorId: text('created_by_actor_id').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('posts_project_id_id_uidx').on(table.projectId, table.id),
        index('posts_project_id_created_by_actor_id_idx').on(
            table.projectId,
            table.createdByActorId
        ),
        foreignKey({
            name: 'posts_project_created_by_actor_fk',
            columns: [table.projectId, table.createdByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'posts_title_nonblank',
            sql`${table.title} is null or length(trim(${table.title})) > 0`
        ),
        check(
            'posts_source_content_object',
            sql`json_valid(${table.sourceContent}) and json_type(${table.sourceContent}) = 'object'`
        ),
        check('posts_source_revision_positive', sql`${table.sourceRevision} > 0`),
    ]
)

export const mediaAssets = sqliteTable(
    'media_assets',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        originalFilename: text('original_filename').notNull(),
        defaultAccessibilityText: text('default_accessibility_text'),
        state: text('state', { enum: mediaAssetStates }).notNull(),
        archivedAt: integer('archived_at'),
        deletionRequestedAt: integer('deletion_requested_at'),
        deletedAt: integer('deleted_at'),
        failureCode: text('failure_code'),
        failureMessage: text('failure_message'),
        createdByActorId: text('created_by_actor_id').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('media_assets_project_id_id_uidx').on(table.projectId, table.id),
        index('media_assets_project_state_idx').on(table.projectId, table.state),
        foreignKey({
            name: 'media_assets_project_actor_fk',
            columns: [table.projectId, table.createdByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'media_assets_filename_valid',
            sql`length(trim(${table.originalFilename})) > 0 and length(${table.originalFilename}) <= 255`
        ),
        check(
            'media_assets_accessibility_text_valid',
            sql`${table.defaultAccessibilityText} is null or length(trim(${table.defaultAccessibilityText})) > 0`
        ),
        check(
            'media_assets_state_valid',
            sql`${table.state} in ('reserved', 'stored', 'inspecting', 'ready', 'failed', 'deletion_requested', 'deleted')`
        ),
        check(
            'media_assets_failure_valid',
            sql`(${table.state} = 'failed'
                    and ${table.failureCode} is not null
                    and length(trim(${table.failureCode})) > 0
                    and ${table.failureMessage} is not null
                    and length(trim(${table.failureMessage})) > 0)
                or (${table.state} <> 'failed'
                    and ${table.failureCode} is null
                    and ${table.failureMessage} is null)`
        ),
        check(
            'media_assets_deletion_timestamps_valid',
            sql`((${table.state} in ('deletion_requested', 'deleted')
                    and ${table.deletionRequestedAt} is not null)
                or (${table.state} not in ('deletion_requested', 'deleted')
                    and ${table.deletionRequestedAt} is null))
                and ((${table.state} = 'deleted'
                    and ${table.deletedAt} is not null
                    or ${table.state} <> 'deleted'
                    and ${table.deletedAt} is null))`
        ),
        check(
            'media_assets_archived_timestamp_valid',
            sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`
        ),
    ]
)

export const mediaRepresentations = sqliteTable(
    'media_representations',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        assetId: text('asset_id').notNull(),
        kind: text('kind', { enum: mediaRepresentationKinds }).notNull(),
        sourceRepresentationId: text('source_representation_id'),
        state: text('state', { enum: mediaRepresentationStates }).notNull(),
        storeId: text('store_id').notNull(),
        objectKey: text('object_key').notNull(),
        declaredContentType: text('declared_content_type'),
        detectedContentType: text('detected_content_type'),
        detectedFormat: text('detected_format'),
        family: text('family', { enum: mediaFamilies }),
        byteSize: integer('byte_size'),
        sha256: text('sha256'),
        width: integer('width'),
        height: integer('height'),
        durationMs: integer('duration_ms'),
        pageCount: integer('page_count'),
        isAnimated: integer('is_animated', { mode: 'boolean' }),
        processorId: text('processor_id'),
        processorVersion: text('processor_version'),
        recipeJson: text('recipe_json', { mode: 'json' }).$type<
            Readonly<Record<string, unknown>>
        >(),
        failureCode: text('failure_code'),
        failureMessage: text('failure_message'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('media_representations_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('media_representations_project_asset_id_uidx').on(
            table.projectId,
            table.assetId,
            table.id
        ),
        uniqueIndex('media_representations_project_original_uidx')
            .on(table.projectId, table.assetId)
            .where(sql`${table.kind} = 'original'`),
        uniqueIndex('media_representations_store_object_uidx').on(table.storeId, table.objectKey),
        index('media_representations_project_asset_idx').on(table.projectId, table.assetId),
        index('media_representations_project_state_idx').on(table.projectId, table.state),
        foreignKey({
            name: 'media_representations_project_asset_fk',
            columns: [table.projectId, table.assetId],
            foreignColumns: [mediaAssets.projectId, mediaAssets.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'media_representations_project_source_fk',
            columns: [table.projectId, table.assetId, table.sourceRepresentationId],
            foreignColumns: [table.projectId, table.assetId, table.id],
        }).onDelete('restrict'),
        check('media_representations_kind_valid', sql`${table.kind} in ('original', 'derived')`),
        check(
            'media_representations_state_valid',
            sql`${table.state} in ('reserved', 'stored', 'inspecting', 'ready', 'failed', 'deletion_requested', 'deleted')`
        ),
        check(
            'media_representations_store_locator_valid',
            sql`length(trim(${table.storeId})) > 0
                and length(trim(${table.objectKey})) > 0
                and length(${table.objectKey}) <= 1024`
        ),
        check(
            'media_representations_declared_type_valid',
            sql`${table.declaredContentType} is null or length(trim(${table.declaredContentType})) > 0`
        ),
        check(
            'media_representations_dimensions_valid',
            sql`(${table.width} is null or ${table.width} > 0)
                and (${table.height} is null or ${table.height} > 0)
                and (${table.durationMs} is null or ${table.durationMs} >= 0)
                and (${table.pageCount} is null or ${table.pageCount} > 0)`
        ),
        check(
            'media_representations_hash_valid',
            sql`${table.sha256} is null or length(${table.sha256}) = 64`
        ),
        check(
            'media_representations_family_valid',
            sql`${table.family} is null or ${table.family} in ('image', 'video', 'audio', 'document')`
        ),
        check(
            'media_representations_ready_facts_valid',
            sql`${table.state} <> 'ready'
                or (${table.detectedContentType} is not null
                    and ${table.detectedFormat} is not null
                    and ${table.family} is not null
                    and ${table.byteSize} is not null
                    and ${table.sha256} is not null)`
        ),
        check(
            'media_representations_failure_valid',
            sql`(${table.state} = 'failed'
                    and ${table.failureCode} is not null
                    and length(trim(${table.failureCode})) > 0
                    and ${table.failureMessage} is not null
                    and length(trim(${table.failureMessage})) > 0)
                or (${table.state} <> 'failed'
                    and ${table.failureCode} is null
                    and ${table.failureMessage} is null)`
        ),
        check(
            'media_representations_derivation_valid',
            sql`(${table.kind} = 'original'
                    and ${table.sourceRepresentationId} is null
                    and ${table.processorId} is null
                    and ${table.processorVersion} is null
                    and ${table.recipeJson} is null)
                or (${table.kind} = 'derived'
                    and ${table.sourceRepresentationId} is not null
                    and ${table.processorId} is not null
                    and length(trim(${table.processorId})) > 0
                    and ${table.processorVersion} is not null
                    and length(trim(${table.processorVersion})) > 0
                    and ${table.recipeJson} is not null
                    and json_valid(${table.recipeJson})
                    and json_type(${table.recipeJson}) = 'object')`
        ),
    ]
)

export const mediaUploadIntents = sqliteTable(
    'media_upload_intents',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        assetId: text('asset_id').notNull(),
        representationId: text('representation_id').notNull(),
        state: text('state', { enum: mediaUploadIntentStates }).notNull(),
        expectedSize: integer('expected_size'),
        maxBytes: integer('max_bytes').notNull(),
        contentTypeHint: text('content_type_hint'),
        expiresAt: integer('expires_at').notNull(),
        uploadStartedAt: integer('upload_started_at'),
        completedAt: integer('completed_at'),
        failureCode: text('failure_code'),
        failureMessage: text('failure_message'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('media_upload_intents_project_representation_uidx').on(
            table.projectId,
            table.representationId
        ),
        index('media_upload_intents_state_expires_idx').on(table.state, table.expiresAt),
        foreignKey({
            name: 'media_upload_intents_project_asset_fk',
            columns: [table.projectId, table.assetId],
            foreignColumns: [mediaAssets.projectId, mediaAssets.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'media_upload_intents_project_asset_representation_fk',
            columns: [table.projectId, table.assetId, table.representationId],
            foreignColumns: [
                mediaRepresentations.projectId,
                mediaRepresentations.assetId,
                mediaRepresentations.id,
            ],
        }).onDelete('cascade'),
        check(
            'media_upload_intents_state_valid',
            sql`${table.state} in ('pending', 'uploading', 'uploaded', 'consumed', 'expired', 'failed')`
        ),
        check(
            'media_upload_intents_limits_valid',
            sql`${table.maxBytes} > 0
                and (${table.expectedSize} is null or (${table.expectedSize} >= 0 and ${table.expectedSize} <= ${table.maxBytes}))`
        ),
        check(
            'media_upload_intents_content_type_valid',
            sql`${table.contentTypeHint} is null or length(trim(${table.contentTypeHint})) > 0`
        ),
        check('media_upload_intents_expiry_valid', sql`${table.expiresAt} > ${table.createdAt}`),
        check(
            'media_upload_intents_terminal_state_valid',
            sql`(${table.state} in ('pending', 'uploading', 'uploaded')
                    and ${table.completedAt} is null
                    and ${table.failureCode} is null
                    and ${table.failureMessage} is null)
                or (${table.state} in ('consumed', 'expired')
                    and ${table.completedAt} is not null
                    and ${table.failureCode} is null
                    and ${table.failureMessage} is null)
                or (${table.state} = 'failed'
                    and ${table.completedAt} is not null
                    and ${table.failureCode} is not null
                    and length(trim(${table.failureCode})) > 0
                    and ${table.failureMessage} is not null
                    and length(trim(${table.failureMessage})) > 0)`
        ),
        check(
            'media_upload_intents_upload_start_valid',
            sql`${table.uploadStartedAt} is null or ${table.uploadStartedAt} >= ${table.createdAt}`
        ),
        check(
            'media_upload_intents_upload_start_state_valid',
            sql`(${table.state} = 'pending' and ${table.uploadStartedAt} is null)
                or (${table.state} in ('uploading', 'uploaded', 'consumed')
                    and ${table.uploadStartedAt} is not null)
                or (${table.state} in ('expired', 'failed'))`
        ),
    ]
)

export const mediaBackupFences = sqliteTable(
    'media_backup_fences',
    {
        id: integer('id').primaryKey(),
        ownerId: text('owner_id').notNull(),
        expiresAt: integer('expires_at').notNull(),
        createdAt: integer('created_at').default(epochMilliseconds).notNull(),
        updatedAt: integer('updated_at').default(epochMilliseconds).notNull(),
    },
    table => [
        check('media_backup_fences_singleton', sql`${table.id} = 1`),
        check('media_backup_fences_owner_nonblank', sql`length(trim(${table.ownerId})) > 0`),
        check('media_backup_fences_expiry_valid', sql`${table.expiresAt} > ${table.createdAt}`),
    ]
)

export const publications = sqliteTable(
    'publications',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        postId: text('post_id').notNull(),
        channelId: text('channel_id').notNull(),
        targetRevisionId: text('target_revision_id'),
        deliveryMode: text('delivery_mode', { enum: deliveryModes }).notNull(),
        reviewState: text('review_state', { enum: publicationReviewStates }).notNull(),
        state: text('state', { enum: publicationStates }).notNull(),
        scheduledAt: integer('scheduled_at'),
        publishedAt: integer('published_at'),
        externalId: text('external_id'),
        externalUrl: text('external_url'),
        errorMessage: text('error_message'),
        createdByActorId: text('created_by_actor_id').notNull(),
        scheduledByActorId: text('scheduled_by_actor_id'),
        stateChangedByActorId: text('state_changed_by_actor_id').notNull(),
        publishedByActorId: text('published_by_actor_id'),
        lastAssessedProfileVersionId: text('last_assessed_profile_version_id'),
        profileAssessmentIssuesJson: text('profile_assessment_issues_json', { mode: 'json' })
            .$type<readonly Record<string, unknown>[]>()
            .notNull()
            .default(sql`'[]'`),
        ...timestamps(),
    },
    table => [
        uniqueIndex('publications_project_id_id_uidx').on(table.projectId, table.id),
        index('publications_project_id_post_id_idx').on(table.projectId, table.postId),
        index('publications_project_id_channel_id_idx').on(table.projectId, table.channelId),
        index('publications_state_scheduled_at_idx').on(table.state, table.scheduledAt),
        index('publications_project_id_created_by_actor_id_idx').on(
            table.projectId,
            table.createdByActorId
        ),
        index('publications_project_id_scheduled_by_actor_id_idx').on(
            table.projectId,
            table.scheduledByActorId
        ),
        index('publications_project_id_state_changed_by_actor_id_idx').on(
            table.projectId,
            table.stateChangedByActorId
        ),
        index('publications_project_id_published_by_actor_id_idx').on(
            table.projectId,
            table.publishedByActorId
        ),
        foreignKey({
            name: 'publications_project_post_fk',
            columns: [table.projectId, table.postId],
            foreignColumns: [posts.projectId, posts.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publications_project_channel_fk',
            columns: [table.projectId, table.channelId],
            foreignColumns: [channels.projectId, channels.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publications_project_created_by_actor_fk',
            columns: [table.projectId, table.createdByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publications_project_scheduled_by_actor_fk',
            columns: [table.projectId, table.scheduledByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publications_project_state_changed_by_actor_fk',
            columns: [table.projectId, table.stateChangedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publications_project_published_by_actor_fk',
            columns: [table.projectId, table.publishedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publications_project_assessed_profile_fk',
            columns: [table.projectId, table.lastAssessedProfileVersionId],
            foreignColumns: [channelProfileVersions.projectId, channelProfileVersions.id],
        }).onDelete('restrict'),
        check(
            'publications_target_revision_id_nonblank',
            sql`${table.targetRevisionId} is null or length(trim(${table.targetRevisionId})) > 0`
        ),
        check(
            'publications_delivery_mode_valid',
            sql`${table.deliveryMode} in ('manual', 'automatic')`
        ),
        check(
            'publications_review_state_valid',
            sql`${table.reviewState} in ('compatible', 'review_required')`
        ),
        check(
            'publications_profile_assessment_issues_array',
            sql`json_valid(${table.profileAssessmentIssuesJson}) and json_type(${table.profileAssessmentIssuesJson}) = 'array'`
        ),
        check(
            'publications_scheduled_target_valid',
            sql`${table.state} <> 'scheduled' or ${table.targetRevisionId} is not null`
        ),
        check(
            'publications_state_valid',
            sql`${table.state} in ('draft', 'scheduled', 'ready', 'publishing', 'published', 'failed', 'ambiguous', 'cancelled')`
        ),
        check(
            'publications_schedule_consistent',
            sql`(${table.scheduledAt} is null and ${table.scheduledByActorId} is null) or (${table.scheduledAt} is not null and ${table.scheduledByActorId} is not null)`
        ),
        check(
            'publications_scheduled_state_has_time',
            sql`${table.state} <> 'scheduled' or ${table.scheduledAt} is not null`
        ),
        check(
            'publications_published_state_complete',
            sql`${table.state} <> 'published' or (${table.publishedAt} is not null and ${table.publishedByActorId} is not null)`
        ),
        check(
            'publications_unpublished_state_has_no_result',
            sql`${table.state} = 'published' or (${table.publishedAt} is null and ${table.publishedByActorId} is null)`
        ),
        check(
            'publications_failure_has_error',
            sql`${table.state} not in ('failed', 'ambiguous') or (${table.errorMessage} is not null and length(trim(${table.errorMessage})) > 0)`
        ),
        check(
            'publications_nonfailure_has_no_error',
            sql`${table.state} in ('failed', 'ambiguous') or ${table.errorMessage} is null`
        ),
    ]
)

export const publicationWorkingDrafts = sqliteTable(
    'publication_working_drafts',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        publicationId: text('publication_id').notNull(),
        profileVersionId: text('profile_version_id').notNull(),
        sourceRevision: integer('source_revision').notNull(),
        baseSourceContent: text('base_source_content', { mode: 'json' })
            .$type<SourceContent>()
            .default(sql`'{}'`)
            .notNull(),
        contentJson: text('content_json', { mode: 'json' })
            .$type<Readonly<Record<string, unknown>>>()
            .notNull(),
        reviewState: text('review_state', { enum: publicationReviewStates }).notNull(),
        validationIssuesJson: text('validation_issues_json', { mode: 'json' })
            .$type<readonly Record<string, unknown>[]>()
            .notNull(),
        lastAssessedProfileVersionId: text('last_assessed_profile_version_id'),
        revision: integer('revision').default(1).notNull(),
        updatedByActorId: text('updated_by_actor_id').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('publication_working_drafts_project_publication_uidx').on(
            table.projectId,
            table.publicationId
        ),
        index('publication_working_drafts_project_review_idx').on(
            table.projectId,
            table.reviewState
        ),
        foreignKey({
            name: 'publication_working_drafts_project_publication_fk',
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_working_drafts_project_profile_fk',
            columns: [table.projectId, table.profileVersionId],
            foreignColumns: [channelProfileVersions.projectId, channelProfileVersions.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_working_drafts_project_assessed_profile_fk',
            columns: [table.projectId, table.lastAssessedProfileVersionId],
            foreignColumns: [channelProfileVersions.projectId, channelProfileVersions.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_working_drafts_project_actor_fk',
            columns: [table.projectId, table.updatedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'publication_working_drafts_source_revision_positive',
            sql`${table.sourceRevision} > 0`
        ),
        check(
            'publication_working_drafts_content_object',
            sql`json_valid(${table.contentJson}) and json_type(${table.contentJson}) = 'object'`
        ),
        check(
            'publication_working_drafts_validation_issues_array',
            sql`json_valid(${table.validationIssuesJson}) and json_type(${table.validationIssuesJson}) = 'array'`
        ),
        check(
            'publication_working_drafts_review_state_valid',
            sql`${table.reviewState} in ('compatible', 'review_required')`
        ),
        check('publication_working_drafts_revision_positive', sql`${table.revision} > 0`),
    ]
)

export const publicationTargetRevisions = sqliteTable(
    'publication_target_revisions',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        publicationId: text('publication_id').notNull(),
        sequence: integer('sequence').notNull(),
        profileVersionId: text('profile_version_id').notNull(),
        sourceRevision: integer('source_revision').notNull(),
        deliveryMode: text('delivery_mode', { enum: deliveryModes }).notNull(),
        mediaReferenceCount: integer('media_reference_count').default(0).notNull(),
        contentJson: text('content_json', { mode: 'json' })
            .$type<Readonly<Record<string, unknown>>>()
            .notNull(),
        contentHash: text('content_hash').notNull(),
        profileHash: text('profile_hash').notNull(),
        schemaHash: text('schema_hash').notNull(),
        validationIssuesJson: text('validation_issues_json', { mode: 'json' })
            .$type<readonly Record<string, unknown>[]>()
            .notNull(),
        createdByActorId: text('created_by_actor_id').notNull(),
        createdAt: integer('created_at').default(epochMilliseconds).notNull(),
    },
    table => [
        uniqueIndex('publication_target_revisions_project_id_id_uidx').on(
            table.projectId,
            table.id
        ),
        uniqueIndex('publication_target_revisions_project_publication_sequence_uidx').on(
            table.projectId,
            table.publicationId,
            table.sequence
        ),
        index('publication_target_revisions_project_publication_idx').on(
            table.projectId,
            table.publicationId
        ),
        foreignKey({
            name: 'publication_target_revisions_project_publication_fk',
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_target_revisions_project_profile_fk',
            columns: [table.projectId, table.profileVersionId],
            foreignColumns: [channelProfileVersions.projectId, channelProfileVersions.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_target_revisions_project_actor_fk',
            columns: [table.projectId, table.createdByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check('publication_target_revisions_sequence_positive', sql`${table.sequence} > 0`),
        check(
            'publication_target_revisions_source_revision_positive',
            sql`${table.sourceRevision} > 0`
        ),
        check(
            'publication_target_revisions_content_object',
            sql`json_valid(${table.contentJson}) and json_type(${table.contentJson}) = 'object'`
        ),
        check(
            'publication_target_revisions_validation_issues_array',
            sql`json_valid(${table.validationIssuesJson}) and json_type(${table.validationIssuesJson}) = 'array'`
        ),
        check(
            'publication_target_revisions_hashes_nonblank',
            sql`length(trim(${table.contentHash})) > 0 and length(trim(${table.profileHash})) > 0 and length(trim(${table.schemaHash})) > 0`
        ),
        check(
            'publication_target_revisions_delivery_mode_valid',
            sql`${table.deliveryMode} in ('manual', 'automatic')`
        ),
        check(
            'publication_target_revisions_media_reference_count_valid',
            sql`${table.mediaReferenceCount} >= 0`
        ),
    ]
)

export const publicationRevisionMedia = sqliteTable(
    'publication_revision_media',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        targetRevisionId: text('target_revision_id').notNull(),
        assetId: text('asset_id').notNull(),
        representationId: text('representation_id').notNull(),
        position: integer('position').notNull(),
        contentPath: text('content_path').notNull(),
        role: text('role'),
        accessibilityText: text('accessibility_text'),
        createdAt: integer('created_at').default(epochMilliseconds).notNull(),
    },
    table => [
        uniqueIndex('publication_revision_media_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('publication_revision_media_project_revision_position_uidx').on(
            table.projectId,
            table.targetRevisionId,
            table.position
        ),
        index('publication_revision_media_project_asset_idx').on(table.projectId, table.assetId),
        foreignKey({
            name: 'publication_revision_media_project_revision_fk',
            columns: [table.projectId, table.targetRevisionId],
            foreignColumns: [publicationTargetRevisions.projectId, publicationTargetRevisions.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_revision_media_project_asset_fk',
            columns: [table.projectId, table.assetId],
            foreignColumns: [mediaAssets.projectId, mediaAssets.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_revision_media_project_representation_fk',
            columns: [table.projectId, table.assetId, table.representationId],
            foreignColumns: [
                mediaRepresentations.projectId,
                mediaRepresentations.assetId,
                mediaRepresentations.id,
            ],
        }).onDelete('restrict'),
        check('publication_revision_media_position_nonnegative', sql`${table.position} >= 0`),
        check(
            'publication_revision_media_content_path_valid',
            sql`length(${table.contentPath}) > 1 and substr(${table.contentPath}, 1, 1) = '/'`
        ),
        check(
            'publication_revision_media_role_valid',
            sql`${table.role} is null or length(trim(${table.role})) > 0`
        ),
        check(
            'publication_revision_media_accessibility_text_valid',
            sql`${table.accessibilityText} is null or length(trim(${table.accessibilityText})) > 0`
        ),
    ]
)

export const jobs = sqliteTable(
    'jobs',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        publicationId: text('publication_id').notNull(),
        state: text('state', { enum: jobStates }).notNull(),
        runAt: integer('run_at').notNull(),
        attempts: integer('attempts').default(0).notNull(),
        claimToken: text('claim_token'),
        claimedByActorId: text('claimed_by_actor_id'),
        claimedAt: integer('claimed_at'),
        leaseExpiresAt: integer('lease_expires_at'),
        effectStartedAt: integer('effect_started_at'),
        startedAt: integer('started_at'),
        completedAt: integer('completed_at'),
        errorMessage: text('error_message'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('jobs_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('jobs_project_publication_active_uidx')
            .on(table.projectId, table.publicationId)
            .where(sql`${table.state} in ('pending', 'running')`),
        index('jobs_project_id_publication_id_idx').on(table.projectId, table.publicationId),
        index('jobs_state_run_at_idx').on(table.state, table.runAt),
        index('jobs_state_lease_expires_at_idx').on(table.state, table.leaseExpiresAt),
        index('jobs_project_id_claimed_by_actor_id_idx').on(
            table.projectId,
            table.claimedByActorId
        ),
        foreignKey({
            name: 'jobs_project_publication_fk',
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'jobs_project_claimed_by_actor_fk',
            columns: [table.projectId, table.claimedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'jobs_state_valid',
            sql`${table.state} in ('pending', 'running', 'succeeded', 'failed', 'cancelled')`
        ),
        check('jobs_attempts_nonnegative', sql`${table.attempts} >= 0`),
        check(
            'jobs_running_has_started',
            sql`${table.state} <> 'running' or (${table.claimToken} is not null and length(trim(${table.claimToken})) > 0 and ${table.claimedByActorId} is not null and ${table.claimedAt} is not null and ${table.leaseExpiresAt} is not null and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.errorMessage} is null)`
        ),
        check(
            'jobs_pending_is_clean',
            sql`${table.state} <> 'pending' or (${table.claimToken} is null and ${table.claimedByActorId} is null and ${table.claimedAt} is null and ${table.leaseExpiresAt} is null and ${table.effectStartedAt} is null and ${table.startedAt} is null and ${table.completedAt} is null and ${table.errorMessage} is null)`
        ),
        check(
            'jobs_nonrunning_has_no_fence',
            sql`${table.state} = 'running' or (${table.claimToken} is null and ${table.leaseExpiresAt} is null)`
        ),
        check(
            'jobs_lease_after_claim',
            sql`${table.leaseExpiresAt} is null or (${table.claimedAt} is not null and ${table.leaseExpiresAt} > ${table.claimedAt})`
        ),
        check(
            'jobs_effect_after_claim',
            sql`${table.effectStartedAt} is null or (${table.claimedAt} is not null and ${table.effectStartedAt} >= ${table.claimedAt})`
        ),
        check(
            'jobs_terminal_has_completed',
            sql`${table.state} not in ('succeeded', 'failed', 'cancelled') or ${table.completedAt} is not null`
        ),
        check(
            'jobs_failed_has_error',
            sql`${table.state} <> 'failed' or (${table.errorMessage} is not null and length(trim(${table.errorMessage})) > 0)`
        ),
        check(
            'jobs_completed_attempt_has_started',
            sql`${table.state} not in ('succeeded', 'failed') or ${table.startedAt} is not null`
        ),
    ]
)

export const publicationExecutionRevisions = sqliteTable(
    'publication_execution_revisions',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        jobId: text('job_id').notNull(),
        publicationId: text('publication_id').notNull(),
        targetRevisionId: text('target_revision_id').notNull(),
        profileVersionId: text('profile_version_id').notNull(),
        deliveryMode: text('delivery_mode', { enum: deliveryModes }).notNull(),
        mediaReferenceCount: integer('media_reference_count').default(0).notNull(),
        contentJson: text('content_json', { mode: 'json' })
            .$type<Readonly<Record<string, unknown>>>()
            .notNull(),
        contentHash: text('content_hash').notNull(),
        profileHash: text('profile_hash').notNull(),
        schemaHash: text('schema_hash').notNull(),
        createdAt: integer('created_at').default(epochMilliseconds).notNull(),
    },
    table => [
        uniqueIndex('publication_execution_revisions_project_job_uidx').on(
            table.projectId,
            table.jobId
        ),
        uniqueIndex('publication_execution_revisions_project_id_id_uidx').on(
            table.projectId,
            table.id
        ),
        foreignKey({
            name: 'publication_execution_revisions_project_job_fk',
            columns: [table.projectId, table.jobId],
            foreignColumns: [jobs.projectId, jobs.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_execution_revisions_project_publication_fk',
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_execution_revisions_project_target_fk',
            columns: [table.projectId, table.targetRevisionId],
            foreignColumns: [publicationTargetRevisions.projectId, publicationTargetRevisions.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_execution_revisions_project_profile_fk',
            columns: [table.projectId, table.profileVersionId],
            foreignColumns: [channelProfileVersions.projectId, channelProfileVersions.id],
        }).onDelete('restrict'),
        check(
            'publication_execution_revisions_delivery_mode_automatic',
            sql`${table.deliveryMode} = 'automatic'`
        ),
        check(
            'publication_execution_revisions_content_object',
            sql`json_valid(${table.contentJson}) and json_type(${table.contentJson}) = 'object'`
        ),
        check(
            'publication_execution_revisions_hashes_nonblank',
            sql`length(trim(${table.contentHash})) > 0 and length(trim(${table.profileHash})) > 0 and length(trim(${table.schemaHash})) > 0`
        ),
        check(
            'publication_execution_revisions_media_reference_count_valid',
            sql`${table.mediaReferenceCount} >= 0`
        ),
    ]
)

export const publicationExecutionRevisionMedia = sqliteTable(
    'publication_execution_revision_media',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        executionRevisionId: text('execution_revision_id').notNull(),
        targetRevisionMediaId: text('target_revision_media_id').notNull(),
        assetId: text('asset_id').notNull(),
        representationId: text('representation_id').notNull(),
        position: integer('position').notNull(),
        contentPath: text('content_path').notNull(),
        role: text('role'),
        accessibilityText: text('accessibility_text'),
        createdAt: integer('created_at').default(epochMilliseconds).notNull(),
    },
    table => [
        uniqueIndex('publication_execution_revision_media_project_id_id_uidx').on(
            table.projectId,
            table.id
        ),
        uniqueIndex('publication_execution_revision_media_revision_position_uidx').on(
            table.projectId,
            table.executionRevisionId,
            table.position
        ),
        uniqueIndex('publication_execution_revision_media_revision_target_uidx').on(
            table.projectId,
            table.executionRevisionId,
            table.targetRevisionMediaId
        ),
        index('publication_execution_revision_media_project_asset_idx').on(
            table.projectId,
            table.assetId
        ),
        foreignKey({
            name: 'publication_execution_revision_media_project_execution_fk',
            columns: [table.projectId, table.executionRevisionId],
            foreignColumns: [
                publicationExecutionRevisions.projectId,
                publicationExecutionRevisions.id,
            ],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_execution_revision_media_project_target_media_fk',
            columns: [table.projectId, table.targetRevisionMediaId],
            foreignColumns: [publicationRevisionMedia.projectId, publicationRevisionMedia.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_execution_revision_media_project_asset_fk',
            columns: [table.projectId, table.assetId],
            foreignColumns: [mediaAssets.projectId, mediaAssets.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_execution_revision_media_project_representation_fk',
            columns: [table.projectId, table.assetId, table.representationId],
            foreignColumns: [
                mediaRepresentations.projectId,
                mediaRepresentations.assetId,
                mediaRepresentations.id,
            ],
        }).onDelete('restrict'),
        check(
            'publication_execution_revision_media_position_nonnegative',
            sql`${table.position} >= 0`
        ),
        check(
            'publication_execution_revision_media_content_path_valid',
            sql`length(${table.contentPath}) > 1 and substr(${table.contentPath}, 1, 1) = '/'`
        ),
        check(
            'publication_execution_revision_media_role_valid',
            sql`${table.role} is null or length(trim(${table.role})) > 0`
        ),
        check(
            'publication_execution_revision_media_accessibility_text_valid',
            sql`${table.accessibilityText} is null or length(trim(${table.accessibilityText})) > 0`
        ),
    ]
)

export const providerMediaDeliveries = sqliteTable(
    'provider_media_deliveries',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        executionMediaId: text('execution_media_id').notNull(),
        publisherId: text('publisher_id').notNull(),
        providerId: text('provider_id').notNull(),
        state: text('state', { enum: providerMediaDeliveryStates }).notNull(),
        attempts: integer('attempts').default(0).notNull(),
        remoteMediaId: text('remote_media_id'),
        remoteMediaUrl: text('remote_media_url'),
        lastAttemptAt: integer('last_attempt_at'),
        completedAt: integer('completed_at'),
        errorCode: text('error_code'),
        errorMessage: text('error_message'),
        createdAt: integer('created_at').default(epochMilliseconds).notNull(),
        updatedAt: integer('updated_at').default(epochMilliseconds).notNull(),
    },
    table => [
        uniqueIndex('provider_media_deliveries_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('provider_media_deliveries_execution_provider_uidx').on(
            table.projectId,
            table.executionMediaId,
            table.publisherId,
            table.providerId
        ),
        index('provider_media_deliveries_project_state_idx').on(table.projectId, table.state),
        foreignKey({
            name: 'provider_media_deliveries_project_execution_media_fk',
            columns: [table.projectId, table.executionMediaId],
            foreignColumns: [
                publicationExecutionRevisionMedia.projectId,
                publicationExecutionRevisionMedia.id,
            ],
        }).onDelete('cascade'),
        foreignKey({
            name: 'provider_media_deliveries_project_publisher_fk',
            columns: [table.projectId, table.publisherId],
            foreignColumns: [publishers.projectId, publishers.id],
        }).onDelete('cascade'),
        check(
            'provider_media_deliveries_provider_nonblank',
            sql`length(trim(${table.providerId})) > 0`
        ),
        check('provider_media_deliveries_attempts_nonnegative', sql`${table.attempts} >= 0`),
        check(
            'provider_media_deliveries_state_valid',
            sql`${table.state} in ('pending', 'uploading', 'uploaded', 'failed', 'ambiguous')`
        ),
        check(
            'provider_media_deliveries_timestamps_valid',
            sql`(${table.lastAttemptAt} is null or ${table.lastAttemptAt} >= ${table.createdAt})
                and (${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt})`
        ),
        check(
            'provider_media_deliveries_state_data_valid',
            sql`(${table.state} = 'pending'
                    and ${table.attempts} >= 0
                    and (${table.lastAttemptAt} is null or ${table.lastAttemptAt} >= ${table.createdAt})
                    and ${table.completedAt} is null
                    and ${table.remoteMediaId} is null
                    and ${table.remoteMediaUrl} is null
                    and ${table.errorCode} is null
                    and ${table.errorMessage} is null)
                or (${table.state} = 'uploading'
                    and ${table.attempts} > 0
                    and ${table.lastAttemptAt} is not null
                    and ${table.completedAt} is null
                    and ${table.errorCode} is null
                    and ${table.errorMessage} is null)
                or (${table.state} = 'uploaded'
                    and ${table.attempts} > 0
                    and ${table.completedAt} is not null
                    and ${table.remoteMediaId} is not null
                    and length(trim(${table.remoteMediaId})) > 0
                    and ${table.errorCode} is null
                    and ${table.errorMessage} is null)
                or (${table.state} in ('failed', 'ambiguous')
                    and ${table.attempts} > 0
                    and ${table.completedAt} is not null
                    and ${table.errorCode} is not null
                    and length(trim(${table.errorCode})) > 0
                    and ${table.errorMessage} is not null
                    and length(trim(${table.errorMessage})) > 0)`
        ),
        check(
            'provider_media_deliveries_url_valid',
            sql`${table.remoteMediaUrl} is null or length(trim(${table.remoteMediaUrl})) > 0`
        ),
    ]
)

export const auditEvents = sqliteTable(
    'audit_events',
    {
        sequence: integer('sequence').primaryKey({ autoIncrement: true }),
        id: text('id').notNull(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        actorId: text('actor_id').notNull(),
        action: text('action').notNull(),
        entityType: text('entity_type').notNull(),
        entityId: text('entity_id').notNull(),
        metadataJson: text('metadata_json'),
        eventVersion: integer('event_version').default(1).notNull(),
        correlationId: text('correlation_id'),
        causationId: text('causation_id'),
        createdAt: integer('created_at').default(epochMilliseconds).notNull(),
    },
    table => [
        uniqueIndex('audit_events_id_uidx').on(table.id),
        index('audit_events_project_id_sequence_idx').on(table.projectId, table.sequence),
        index('audit_events_project_id_created_at_idx').on(table.projectId, table.createdAt),
        index('audit_events_project_id_entity_idx').on(
            table.projectId,
            table.entityType,
            table.entityId
        ),
        foreignKey({
            name: 'audit_events_project_actor_fk',
            columns: [table.projectId, table.actorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check('audit_events_action_nonblank', sql`length(trim(${table.action})) > 0`),
        check('audit_events_entity_type_nonblank', sql`length(trim(${table.entityType})) > 0`),
        check('audit_events_entity_id_nonblank', sql`length(trim(${table.entityId})) > 0`),
        check('audit_events_event_version_valid', sql`${table.eventVersion} > 0`),
        check(
            'audit_events_metadata_json_valid',
            sql`${table.metadataJson} is null or (json_valid(${table.metadataJson}) and json_type(${table.metadataJson}) = 'object')`
        ),
        check(
            'audit_events_correlation_id_nonblank',
            sql`${table.correlationId} is null or length(trim(${table.correlationId})) > 0`
        ),
        check(
            'audit_events_causation_id_nonblank',
            sql`${table.causationId} is null or length(trim(${table.causationId})) > 0`
        ),
    ]
)
