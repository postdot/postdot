import {
    actorKinds,
    deliveryModes,
    jobStates,
    mediaAssetStates,
    mediaFamilies,
    mediaRepresentationKinds,
    mediaRepresentationStates,
    mediaUploadIntentStates,
    notificationKinds,
    notificationSeverities,
    providerAnalyticsAvailabilityStates,
    providerAnalyticsPostbotEntityTypes,
    providerAnalyticsFreshnessStates,
    providerAnalyticsSubjectTypes,
    providerMediaDeliveryStates,
    publicationReviewStates,
    publicationApprovalRequestStates,
    publicationStates,
    publisherCredentialStates,
    channelProfileVersionStates,
    channelStates,
    type ChannelProfileDefinition,
    type CustomHttpAuthentication,
    type SourceContent,
} from '@postdot/core'
import { sql } from 'drizzle-orm'
import {
    check,
    blob,
    foreignKey,
    index,
    integer,
    primaryKey,
    real,
    sqliteTable,
    text,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { organization, team, user } from './auth-schema'

const epochMilliseconds = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const oauthAuthorizationAttemptStatuses = ['pending', 'consumed', 'expired'] as const
const channelProfileStates = channelProfileVersionStates
const notificationDestinationStates = ['active', 'disabled'] as const
const notificationDestinationSecretStates = ['active', 'retired'] as const
const notificationDeliveryStates = [
    'pending',
    'running',
    'delivered',
    'failed',
    'ambiguous',
] as const
const providerApplicationStates = ['active', 'disabled'] as const
const taxonomyStates = ['active', 'archived'] as const
const instanceStates = ['claimable', 'claimed'] as const
const instanceMembershipStates = ['enabled', 'disabled'] as const
const instanceRoles = ['admin', 'member'] as const
const invitationStates = ['pending', 'accepted', 'revoked', 'expired'] as const
const projectAccessRoles = ['owner', 'editor', 'viewer'] as const

const timestamps = () => ({
    createdAt: integer('created_at').default(epochMilliseconds).notNull(),
    updatedAt: integer('updated_at').default(epochMilliseconds).notNull(),
})

export const projectCategories = sqliteTable(
    'project_categories',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        normalizedName: text('normalized_name').notNull(),
        state: text('state', { enum: taxonomyStates }).default('active').notNull(),
        archivedAt: integer('archived_at'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('project_categories_normalized_name_uidx').on(table.normalizedName),
        check('project_categories_name_nonblank', sql`length(trim(${table.name})) > 0`),
        check(
            'project_categories_normalized_name_nonblank',
            sql`length(trim(${table.normalizedName})) > 0`
        ),
        check(
            'project_categories_name_length_valid',
            sql`length(${table.name}) <= 120 and length(${table.normalizedName}) <= 120`
        ),
        check('project_categories_state_valid', sql`${table.state} in ('active', 'archived')`),
        check(
            'project_categories_archived_timestamp_valid',
            sql`(${table.state} = 'active' and ${table.archivedAt} is null)
                or (${table.state} = 'archived' and ${table.archivedAt} is not null)`
        ),
    ]
)

/**
 * Postdot's user-facing workspace boundary. Better Auth owns the organization
 * and member rows referenced here; this projection gives the domain model a
 * stable name for the boundary without making projects organizations.
 */
export const workspaces = sqliteTable(
    'workspaces',
    {
        id: text('id').primaryKey(),
        organizationId: text('organization_id')
            .notNull()
            .references(() => organization.id, { onDelete: 'restrict' }),
        name: text('name').notNull(),
        slug: text('slug').notNull(),
        isDefault: integer('is_default', { mode: 'boolean' }).default(false).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('workspaces_organization_id_uidx').on(table.organizationId),
        uniqueIndex('workspaces_slug_uidx').on(table.slug),
        check('workspaces_name_nonblank', sql`length(trim(${table.name})) > 0`),
        check('workspaces_slug_nonblank', sql`length(trim(${table.slug})) > 0`),
    ]
)

export const projects = sqliteTable(
    'projects',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        timeZone: text('time_zone').notNull().default('UTC'),
        workspaceId: text('workspace_id').references(() => workspaces.id, {
            onDelete: 'restrict',
        }),
        primaryCategoryId: text('primary_category_id').references(() => projectCategories.id, {
            onDelete: 'restrict',
        }),
        ...timestamps(),
    },
    table => [check('projects_name_nonblank', sql`length(trim(${table.name})) > 0`)]
)

/**
 * Direct Postdot project access. Better Auth owns identity and workspace
 * membership; this table owns the project-specific role for an individual.
 */
export const projectUserGrants = sqliteTable(
    'project_user_grants',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        role: text('role', { enum: projectAccessRoles }).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('project_user_grants_project_user_uidx').on(table.projectId, table.userId),
        index('project_user_grants_user_project_idx').on(table.userId, table.projectId),
        check(
            'project_user_grants_role_valid',
            sql`${table.role} in ('owner', 'editor', 'viewer')`
        ),
    ]
)

/**
 * Workspace-team project access. The team must belong to the project's
 * workspace; that cross-table invariant is checked by AccessStore because
 * the Better Auth team table is intentionally outside the domain schema.
 */
export const projectTeamGrants = sqliteTable(
    'project_team_grants',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        teamId: text('team_id')
            .notNull()
            .references(() => team.id, { onDelete: 'cascade' }),
        role: text('role', { enum: projectAccessRoles }).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('project_team_grants_project_team_uidx').on(table.projectId, table.teamId),
        index('project_team_grants_team_project_idx').on(table.teamId, table.projectId),
        check(
            'project_team_grants_role_valid',
            sql`${table.role} in ('owner', 'editor', 'viewer')`
        ),
    ]
)

export const actors = sqliteTable(
    'actors',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id').references(() => projects.id, { onDelete: 'no action' }),
        workspaceId: text('workspace_id').references(() => workspaces.id, {
            onDelete: 'no action',
        }),
        // Provenance only: the originating project actor may later be deleted.
        originActorId: text('origin_actor_id'),
        kind: text('kind', { enum: actorKinds }).notNull(),
        subjectId: text('subject_id'),
        displayName: text('display_name').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('actors_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('actors_workspace_id_id_uidx').on(table.workspaceId, table.id),
        uniqueIndex('actors_workspace_origin_uidx').on(table.workspaceId, table.originActorId),
        check(
            'actors_scope_valid',
            sql`(${table.projectId} is not null and ${table.workspaceId} is null and ${table.originActorId} is null) or (${table.projectId} is null and ${table.workspaceId} is not null)`
        ),
        check(
            'actors_origin_nonblank',
            sql`${table.originActorId} is null or length(trim(${table.originActorId})) > 0`
        ),
        check('actors_kind_valid', sql`${table.kind} in ('human', 'agent', 'api_token', 'system')`),
        check('actors_display_name_nonblank', sql`length(trim(${table.displayName})) > 0`),
        check(
            'actors_subject_id_nonblank',
            sql`${table.subjectId} is null or length(trim(${table.subjectId})) > 0`
        ),
    ]
)

/**
 * Postdot owns the instance boundary separately from Better Auth identity.
 * There is exactly one row per database, seeded by the access migration.
 */
export const instanceState = sqliteTable(
    'instance_state',
    {
        id: text('id').primaryKey(),
        state: text('state', { enum: instanceStates }).notNull(),
        bootstrapBlocked: integer('bootstrap_blocked', { mode: 'boolean' })
            .default(false)
            .notNull(),
        claimedByUserId: text('claimed_by_user_id').references(() => user.id, {
            onDelete: 'restrict',
        }),
        defaultWorkspaceId: text('default_workspace_id').references(() => workspaces.id, {
            onDelete: 'restrict',
        }),
        claimedAt: integer('claimed_at'),
        ...timestamps(),
    },
    table => [
        check('instance_state_singleton', sql`${table.id} = 'default'`),
        check('instance_state_value_valid', sql`${table.state} in ('claimable', 'claimed')`),
        check(
            'instance_state_bootstrap_block_valid',
            sql`${table.bootstrapBlocked} = 0 or ${table.state} = 'claimable'`
        ),
        check(
            'instance_state_claim_consistency',
            sql`(${table.state} = 'claimable' and ${table.claimedByUserId} is null and ${table.claimedAt} is null)
                or (${table.state} = 'claimed' and ${table.claimedByUserId} is not null and ${table.claimedAt} is not null)`
        ),
    ]
)

export const instanceMemberships = sqliteTable(
    'instance_memberships',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'restrict' }),
        role: text('role', { enum: instanceRoles }).notNull(),
        state: text('state', { enum: instanceMembershipStates }).default('enabled').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('instance_memberships_user_uidx').on(table.userId),
        check('instance_memberships_role_valid', sql`${table.role} in ('admin', 'member')`),
        check('instance_memberships_state_valid', sql`${table.state} in ('enabled', 'disabled')`),
    ]
)

/**
 * Instance invitations are Postdot-owned because the instance itself is not a
 * Better Auth organization. Project invitations use Better Auth workspace
 * invitations with custom project fields and therefore have no duplicate
 * Postdot invitation table.
 */
export const instanceAccessInvitations = sqliteTable(
    'instance_access_invitations',
    {
        id: text('id').primaryKey(),
        targetEmail: text('target_email').notNull(),
        tokenHash: text('token_hash').notNull(),
        instanceRole: text('instance_role', { enum: ['member'] })
            .default('member')
            .notNull(),
        state: text('state', { enum: invitationStates }).default('pending').notNull(),
        createdByUserId: text('created_by_user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'restrict' }),
        expiresAt: integer('expires_at').notNull(),
        acceptedAt: integer('accepted_at'),
        acceptedByUserId: text('accepted_by_user_id').references(() => user.id, {
            onDelete: 'restrict',
        }),
        revokedAt: integer('revoked_at'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('instance_access_invitations_token_hash_uidx').on(table.tokenHash),
        index('instance_access_invitations_target_state_idx').on(table.targetEmail, table.state),
        index('instance_access_invitations_expiry_idx').on(table.state, table.expiresAt),
        check(
            'instance_access_invitations_email_nonblank',
            sql`length(trim(${table.targetEmail})) > 0`
        ),
        check(
            'instance_access_invitations_token_hash_nonblank',
            sql`length(trim(${table.tokenHash})) > 0`
        ),
        check(
            'instance_access_invitations_instance_role_valid',
            sql`${table.instanceRole} = 'member'`
        ),
        check(
            'instance_access_invitations_state_valid',
            sql`(${table.state} = 'pending' and ${table.acceptedAt} is null and ${table.acceptedByUserId} is null and ${table.revokedAt} is null)
                or (${table.state} = 'accepted' and ${table.acceptedAt} is not null and ${table.acceptedByUserId} is not null and ${table.revokedAt} is null)
                or (${table.state} = 'revoked' and ${table.acceptedAt} is null and ${table.acceptedByUserId} is null and ${table.revokedAt} is not null)
                or (${table.state} = 'expired' and ${table.acceptedAt} is null and ${table.acceptedByUserId} is null and ${table.revokedAt} is null)`
        ),
        check(
            'instance_access_invitations_expiry_valid',
            sql`${table.expiresAt} > ${table.createdAt}`
        ),
    ]
)

export const projectTags = sqliteTable(
    'project_tags',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        normalizedName: text('normalized_name').notNull(),
        state: text('state', { enum: taxonomyStates }).default('active').notNull(),
        archivedAt: integer('archived_at'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('project_tags_project_id_id_uidx').on(table.projectId, table.id),
        uniqueIndex('project_tags_project_id_normalized_name_uidx').on(
            table.projectId,
            table.normalizedName
        ),
        check('project_tags_name_nonblank', sql`length(trim(${table.name})) > 0`),
        check(
            'project_tags_normalized_name_nonblank',
            sql`length(trim(${table.normalizedName})) > 0`
        ),
        check(
            'project_tags_name_length_valid',
            sql`length(${table.name}) <= 120 and length(${table.normalizedName}) <= 120`
        ),
        check('project_tags_state_valid', sql`${table.state} in ('active', 'archived')`),
        check(
            'project_tags_archived_timestamp_valid',
            sql`(${table.state} = 'active' and ${table.archivedAt} is null)
                or (${table.state} = 'archived' and ${table.archivedAt} is not null)`
        ),
    ]
)

export const providerApplicationConfigurations = sqliteTable(
    'provider_application_configurations',
    {
        id: text('id').primaryKey(),
        providerId: text('provider_id').notNull(),
        name: text('name').notNull(),
        clientId: text('client_id'),
        clientMetadataUrl: text('client_metadata_url'),
        handleResolver: text('handle_resolver'),
        state: text('state', { enum: providerApplicationStates }).default('active').notNull(),
        isDefault: integer('is_default', { mode: 'boolean' }).default(false).notNull(),
        createdByUserId: text('created_by_user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'restrict' }),
        encryptionVersion: integer('encryption_version'),
        encryptionKeyId: text('encryption_key_id'),
        clientSecretCiphertext: blob('client_secret_ciphertext', { mode: 'buffer' }),
        clientSecretNonce: blob('client_secret_nonce', { mode: 'buffer' }),
        ...timestamps(),
    },
    table => [
        uniqueIndex('provider_application_configurations_provider_id_id_uidx').on(
            table.providerId,
            table.id
        ),
        index('provider_application_configurations_provider_state_idx').on(
            table.providerId,
            table.state
        ),
        uniqueIndex('provider_application_configurations_provider_default_uidx')
            .on(table.providerId)
            .where(sql`${table.isDefault} = 1`),
        check(
            'provider_application_configurations_provider_valid',
            sql`${table.providerId} in ('linkedin', 'bluesky', 'x', 'facebook', 'instagram')`
        ),
        check(
            'provider_application_configurations_name_nonblank',
            sql`length(trim(${table.name})) > 0`
        ),
        check(
            'provider_application_configurations_state_valid',
            sql`${table.state} in ('active', 'disabled')`
        ),
        check(
            'provider_application_configurations_shape_valid',
            sql`(
                ${table.providerId} in ('linkedin', 'x', 'facebook', 'instagram')
                and ${table.clientId} is not null
                and length(trim(${table.clientId})) > 0
                and ${table.clientMetadataUrl} is null
                and ${table.handleResolver} is null
                and ${table.encryptionVersion} is not null
                and ${table.encryptionKeyId} is not null
                and ${table.clientSecretCiphertext} is not null
                and ${table.clientSecretNonce} is not null
            ) or (
                ${table.providerId} = 'bluesky'
                and ${table.clientId} is null
                and (${table.clientMetadataUrl} is null or length(trim(${table.clientMetadataUrl})) > 0)
                and ${table.handleResolver} is not null
                and length(trim(${table.handleResolver})) > 0
                and ${table.encryptionVersion} is null
                and ${table.encryptionKeyId} is null
                and ${table.clientSecretCiphertext} is null
                and ${table.clientSecretNonce} is null
            )`
        ),
        check(
            'provider_application_configurations_encryption_version_valid',
            sql`(${table.encryptionVersion} is null and ${table.encryptionKeyId} is null)
                or (${table.encryptionVersion} > 0 and ${table.encryptionKeyId} is not null
                    and length(trim(${table.encryptionKeyId})) > 0)`
        ),
        check(
            'provider_application_configurations_secret_envelope_valid',
            sql`(${table.clientSecretCiphertext} is null and ${table.clientSecretNonce} is null)
                or (${table.clientSecretCiphertext} is not null
                    and length(${table.clientSecretCiphertext}) > 16
                    and ${table.clientSecretNonce} is not null
                    and length(${table.clientSecretNonce}) = 12)`
        ),
    ]
)

export const channels = sqliteTable(
    'channels',
    {
        id: text('id').primaryKey(),
        workspaceId: text('workspace_id')
            .notNull()
            .references(() => workspaces.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        destinationRevision: integer('destination_revision').default(0).notNull(),
        destinationIdentityJson: text('destination_identity_json', { mode: 'json' }).$type<Record<
            string,
            unknown
        > | null>(),
        profileVersionId: text('profile_version_id').notNull(),
        state: text('state', { enum: channelStates }).default('active').notNull(),
        archivedAt: integer('archived_at'),
        revision: integer('revision').default(1).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('channels_workspace_id_id_uidx').on(table.workspaceId, table.id),
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
        workspaceId: text('workspace_id')
            .notNull()
            .references(() => workspaces.id, { onDelete: 'cascade' }),
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
        uniqueIndex('channel_profile_versions_workspace_id_id_uidx').on(
            table.workspaceId,
            table.id
        ),
        uniqueIndex('channel_profiles_channel_id_id_uidx').on(table.channelId, table.id),
        uniqueIndex('channel_profile_versions_workspace_channel_version_uidx').on(
            table.workspaceId,
            table.channelId,
            table.version
        ),
        index('channel_profile_versions_workspace_channel_state_idx').on(
            table.workspaceId,
            table.channelId,
            table.state
        ),
        uniqueIndex('channel_profile_versions_workspace_channel_active_uidx')
            .on(table.workspaceId, table.channelId)
            .where(sql`${table.state} = 'active'`),
        uniqueIndex('channel_profile_versions_workspace_channel_draft_uidx')
            .on(table.workspaceId, table.channelId)
            .where(sql`${table.state} = 'draft'`),
        foreignKey({
            name: 'channel_profile_versions_workspace_channel_fk',
            columns: [table.workspaceId, table.channelId],
            foreignColumns: [channels.workspaceId, channels.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'channel_profile_versions_workspace_actor_fk',
            columns: [table.workspaceId, table.createdByActorId],
            foreignColumns: [actors.workspaceId, actors.id],
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
        workspaceId: text('workspace_id')
            .notNull()
            .references(() => workspaces.id, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        kind: text('kind').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('publishers_workspace_id_id_uidx').on(table.workspaceId, table.id),
        uniqueIndex('publishers_channel_id_id_uidx').on(table.channelId, table.id),
        uniqueIndex('publishers_workspace_id_channel_id_uidx').on(
            table.workspaceId,
            table.channelId
        ),
        foreignKey({
            name: 'publishers_workspace_channel_fk',
            columns: [table.workspaceId, table.channelId],
            foreignColumns: [channels.workspaceId, channels.id],
        }).onDelete('cascade'),
        check('publishers_kind_nonblank', sql`length(trim(${table.kind})) > 0`),
    ]
)

export const publisherCredentials = sqliteTable(
    'publisher_credentials',
    {
        id: text('id').primaryKey(),
        workspaceId: text('workspace_id')
            .notNull()
            .references(() => workspaces.id, { onDelete: 'cascade' }),
        providerId: text('provider_id').notNull(),
        externalAccountId: text('external_account_id').notNull(),
        externalAccountName: text('external_account_name'),
        scopes: text('scopes', { mode: 'json' }).$type<readonly string[]>().notNull(),
        state: text('state', { enum: publisherCredentialStates }).notNull(),
        expiresAt: integer('expires_at'),
        connectedByActorId: text('connected_by_actor_id').notNull(),
        providerApplicationId: text('provider_application_id'),
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
        uniqueIndex('publisher_credentials_workspace_id_id_uidx').on(table.workspaceId, table.id),
        index('publisher_credentials_workspace_provider_external_idx').on(
            table.workspaceId,
            table.providerId,
            table.externalAccountId
        ),
        index('publisher_credentials_workspace_state_expires_idx').on(
            table.workspaceId,
            table.state,
            table.expiresAt
        ),
        index('publisher_credentials_workspace_actor_idx').on(
            table.workspaceId,
            table.connectedByActorId
        ),
        foreignKey({
            name: 'publisher_credentials_workspace_actor_fk',
            columns: [table.workspaceId, table.connectedByActorId],
            foreignColumns: [actors.workspaceId, actors.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publisher_credentials_provider_application_fk',
            columns: [table.providerId, table.providerApplicationId],
            foreignColumns: [
                providerApplicationConfigurations.providerId,
                providerApplicationConfigurations.id,
            ],
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
        providerApplicationId: text('provider_application_id'),
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
            foreignColumns: [
                projectChannelAttachments.projectId,
                projectChannelAttachments.channelId,
            ],
        }).onDelete('cascade'),
        foreignKey({
            name: 'oauth_authorization_attempts_project_actor_fk',
            columns: [table.projectId, table.connectedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'oauth_authorization_attempts_provider_application_fk',
            columns: [table.providerId, table.providerApplicationId],
            foreignColumns: [
                providerApplicationConfigurations.providerId,
                providerApplicationConfigurations.id,
            ],
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
        workspaceId: text('workspace_id')
            .notNull()
            .references(() => workspaces.id, { onDelete: 'cascade' }),
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
        uniqueIndex('publisher_connections_workspace_id_publisher_id_uidx').on(
            table.workspaceId,
            table.publisherId
        ),
        index('publisher_connections_credential_id_idx').on(table.credentialId),
        index('publisher_connections_workspace_id_actor_id_idx').on(
            table.workspaceId,
            table.connectedByActorId
        ),
        foreignKey({
            name: 'publisher_connections_workspace_publisher_fk',
            columns: [table.workspaceId, table.publisherId],
            foreignColumns: [publishers.workspaceId, publishers.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publisher_connections_workspace_credential_fk',
            columns: [table.workspaceId, table.credentialId],
            foreignColumns: [publisherCredentials.workspaceId, publisherCredentials.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publisher_connections_workspace_actor_fk',
            columns: [table.workspaceId, table.connectedByActorId],
            foreignColumns: [actors.workspaceId, actors.id],
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

/** Explicit project use of a workspace channel. Not ownership; the managing relation is separate. */
export const projectChannelAttachments = sqliteTable(
    'project_channel_attachments',
    {
        projectId: text('project_id').notNull(),
        channelId: text('channel_id').notNull(),
        workspaceId: text('workspace_id').notNull(),
        state: text('state', { enum: ['active', 'detached'] })
            .default('active')
            .notNull(),
        origin: text('origin', { enum: ['migrated', 'explicit'] }).notNull(),
        attachedByActorId: text('attached_by_actor_id'),
        attachedAt: integer('attached_at').notNull(),
        detachedAt: integer('detached_at'),
        revision: integer('revision').default(1).notNull(),
    },
    table => [
        primaryKey({ columns: [table.projectId, table.channelId] }),
        index('project_channel_attachments_channel_state_idx').on(
            table.channelId,
            table.state,
            table.projectId
        ),
        foreignKey({
            columns: [table.workspaceId, table.projectId],
            foreignColumns: [projects.workspaceId, projects.id],
        }).onDelete('no action'),
        foreignKey({
            columns: [table.workspaceId, table.channelId],
            foreignColumns: [channels.workspaceId, channels.id],
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.workspaceId, table.attachedByActorId],
            foreignColumns: [actors.workspaceId, actors.id],
        }).onDelete('restrict'),
        check(
            'project_channel_attachments_state_valid',
            sql`${table.state} in ('active', 'detached')`
        ),
        check(
            'project_channel_attachments_origin_valid',
            sql`${table.origin} in ('migrated', 'explicit')`
        ),
        check('project_channel_attachments_revision_positive', sql`${table.revision} > 0`),
        check(
            'project_channel_attachments_detached_valid',
            sql`(${table.state} = 'active' and ${table.detachedAt} is null) or (${table.state} = 'detached' and ${table.detachedAt} is not null)`
        ),
        check(
            'project_channel_attachments_origin_actor_valid',
            sql`(${table.origin} = 'migrated' and ${table.attachedByActorId} is null) or (${table.origin} = 'explicit' and ${table.attachedByActorId} is not null)`
        ),
    ]
)

/** Derived binding that lets project-scoped rows reference only profiles of attached channels. */
export const projectChannelProfiles = sqliteTable(
    'project_channel_profiles',
    {
        projectId: text('project_id').notNull(),
        channelId: text('channel_id').notNull(),
        profileId: text('profile_id').notNull(),
    },
    table => [
        primaryKey({ columns: [table.projectId, table.profileId] }),
        foreignKey({
            columns: [table.projectId, table.channelId],
            foreignColumns: [
                projectChannelAttachments.projectId,
                projectChannelAttachments.channelId,
            ],
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.channelId, table.profileId],
            foreignColumns: [channelProfileVersions.channelId, channelProfileVersions.id],
        }).onDelete('cascade'),
    ]
)

/** Derived binding that lets project-scoped execution rows reference only publishers of attached channels. */
export const projectChannelPublishers = sqliteTable(
    'project_channel_publishers',
    {
        projectId: text('project_id').notNull(),
        channelId: text('channel_id').notNull(),
        publisherId: text('publisher_id').notNull(),
    },
    table => [
        primaryKey({ columns: [table.projectId, table.publisherId] }),
        foreignKey({
            columns: [table.projectId, table.channelId],
            foreignColumns: [
                projectChannelAttachments.projectId,
                projectChannelAttachments.channelId,
            ],
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.channelId, table.publisherId],
            foreignColumns: [publishers.channelId, publishers.id],
        }).onDelete('cascade'),
    ]
)

/** One stable managing project per channel; its removal never promotes another project. */
export const channelManagers = sqliteTable(
    'channel_managers',
    {
        channelId: text('channel_id').primaryKey(),
        projectId: text('project_id').notNull(),
        workspaceId: text('workspace_id').notNull(),
    },
    table => [
        index('channel_managers_workspace_project_idx').on(table.workspaceId, table.projectId),
        foreignKey({
            columns: [table.projectId, table.channelId],
            foreignColumns: [
                projectChannelAttachments.projectId,
                projectChannelAttachments.channelId,
            ],
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.workspaceId, table.channelId],
            foreignColumns: [channels.workspaceId, channels.id],
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.workspaceId, table.projectId],
            foreignColumns: [projects.workspaceId, projects.id],
        }).onDelete('cascade'),
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

/**
 * A composer draft is deliberately separate from a publication draft. It is
 * the durable, pre-publication recovery point for the new-publication screen;
 * it must not appear in the delivery queue until the operator explicitly
 * saves or schedules the publication.
 */
export const publicationComposerDrafts = sqliteTable(
    'publication_composer_drafts',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        ownerActorId: text('owner_actor_id').notNull(),
        contentJson: text('content_json', { mode: 'json' })
            .$type<Readonly<Record<string, unknown>>>()
            .notNull(),
        revision: integer('revision').default(1).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('publication_composer_drafts_project_actor_uidx').on(
            table.projectId,
            table.ownerActorId
        ),
        foreignKey({
            name: 'publication_composer_drafts_project_actor_fk',
            columns: [table.projectId, table.ownerActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'publication_composer_drafts_content_object',
            sql`json_valid(${table.contentJson}) and json_type(${table.contentJson}) = 'object'`
        ),
        check('publication_composer_drafts_revision_positive', sql`${table.revision} > 0`),
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
        deletionRestoreState: text('deletion_restore_state', { enum: mediaAssetStates }),
        deletionRestoreFailureCode: text('deletion_restore_failure_code'),
        deletionRestoreFailureMessage: text('deletion_restore_failure_message'),
        deletedAt: integer('deleted_at'),
        failureCode: text('failure_code'),
        failureMessage: text('failure_message'),
        createdByActorId: text('created_by_actor_id').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('media_assets_project_id_id_uidx').on(table.projectId, table.id),
        index('media_assets_project_state_idx').on(table.projectId, table.state),
        index('media_assets_project_trash_idx')
            .on(table.projectId, table.deletionRequestedAt)
            .where(sql`${table.state} = 'deletion_requested'`),
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
        deletionRestoreState: text('deletion_restore_state', {
            enum: mediaRepresentationStates,
        }),
        deletionRestoreFailureCode: text('deletion_restore_failure_code'),
        deletionRestoreFailureMessage: text('deletion_restore_failure_message'),
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
        confirmedDestinationRevision: integer('confirmed_destination_revision')
            .default(0)
            .notNull(),
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
            foreignColumns: [
                projectChannelAttachments.projectId,
                projectChannelAttachments.channelId,
            ],
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
            foreignColumns: [projectChannelProfiles.projectId, projectChannelProfiles.profileId],
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

export const publicationTags = sqliteTable(
    'publication_tags',
    {
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        publicationId: text('publication_id').notNull(),
        tagId: text('tag_id').notNull(),
        createdAt: integer('created_at').default(epochMilliseconds).notNull(),
    },
    table => [
        primaryKey({ columns: [table.projectId, table.publicationId, table.tagId] }),
        foreignKey({
            name: 'publication_tags_project_publication_fk',
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_tags_project_tag_fk',
            columns: [table.projectId, table.tagId],
            foreignColumns: [projectTags.projectId, projectTags.id],
        }).onDelete('restrict'),
        index('publication_tags_project_publication_idx').on(table.projectId, table.publicationId),
        index('publication_tags_project_tag_idx').on(table.projectId, table.tagId),
        check(
            'publication_tags_publication_id_nonblank',
            sql`length(trim(${table.publicationId})) > 0`
        ),
        check('publication_tags_tag_id_nonblank', sql`length(trim(${table.tagId})) > 0`),
    ]
)

export const providerAnalyticsObservations = sqliteTable(
    'provider_analytics_observations',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        provider: text('provider').notNull(),
        subjectType: text('subject_type', { enum: providerAnalyticsSubjectTypes }).notNull(),
        providerSubjectId: text('provider_subject_id').notNull(),
        providerSubjectLabel: text('provider_subject_label'),
        providerContentRevisionId: text('provider_content_revision_id'),
        postbotEntityType: text('postbot_entity_type', {
            enum: providerAnalyticsPostbotEntityTypes,
        }),
        postbotEntityId: text('postbot_entity_id'),
        metricName: text('metric_name').notNull(),
        value: real('value'),
        unit: text('unit').notNull(),
        aggregation: text('aggregation').notNull(),
        reportingPeriodStart: integer('reporting_period_start'),
        reportingPeriodEnd: integer('reporting_period_end'),
        observedAt: integer('observed_at'),
        fetchedAt: integer('fetched_at').notNull(),
        availability: text('availability', {
            enum: providerAnalyticsAvailabilityStates,
        }).notNull(),
        freshness: text('freshness', { enum: providerAnalyticsFreshnessStates }).notNull(),
        provenance: text('provenance').notNull(),
    },
    table => [
        uniqueIndex('provider_analytics_observations_project_id_id_uidx').on(
            table.projectId,
            table.id
        ),
        uniqueIndex('provider_analytics_observations_snapshot_uidx').on(
            table.projectId,
            table.provider,
            table.subjectType,
            table.providerSubjectId,
            table.metricName,
            table.fetchedAt
        ),
        index('provider_analytics_observations_project_subject_idx').on(
            table.projectId,
            table.provider,
            table.subjectType,
            table.providerSubjectId,
            table.fetchedAt
        ),
        index('provider_analytics_observations_project_entity_idx').on(
            table.projectId,
            table.postbotEntityType,
            table.postbotEntityId,
            table.fetchedAt
        ),
        check(
            'provider_analytics_observations_provider_nonblank',
            sql`length(trim(${table.provider})) > 0`
        ),
        check(
            'provider_analytics_observations_subject_id_nonblank',
            sql`length(trim(${table.providerSubjectId})) > 0`
        ),
        check(
            'provider_analytics_observations_subject_label_nonblank',
            sql`${table.providerSubjectLabel} is null or length(trim(${table.providerSubjectLabel})) > 0`
        ),
        check(
            'provider_analytics_observations_content_revision_nonblank',
            sql`${table.providerContentRevisionId} is null or length(trim(${table.providerContentRevisionId})) > 0`
        ),
        check(
            'provider_analytics_observations_entity_pair_valid',
            sql`(${table.postbotEntityType} is null and ${table.postbotEntityId} is null)
                or (${table.postbotEntityType} is not null
                    and ${table.postbotEntityId} is not null
                    and length(trim(${table.postbotEntityId})) > 0)`
        ),
        check(
            'provider_analytics_observations_metric_nonblank',
            sql`length(trim(${table.metricName})) > 0`
        ),
        check(
            'provider_analytics_observations_unit_nonblank',
            sql`length(trim(${table.unit})) > 0`
        ),
        check(
            'provider_analytics_observations_aggregation_nonblank',
            sql`length(trim(${table.aggregation})) > 0`
        ),
        check(
            'provider_analytics_observations_provenance_nonblank',
            sql`length(trim(${table.provenance})) > 0`
        ),
        check(
            'provider_analytics_observations_value_valid',
            sql`${table.value} is null or (${table.value} >= 0 and ${table.value} = ${table.value})`
        ),
        check(
            'provider_analytics_observations_availability_value_valid',
            sql`(${table.availability} = 'measured' and ${table.value} is not null)
                or (${table.availability} <> 'measured' and ${table.value} is null)`
        ),
        check(
            'provider_analytics_observations_period_valid',
            sql`(${table.reportingPeriodStart} is null and ${table.reportingPeriodEnd} is null)
                or (${table.reportingPeriodStart} is not null
                    and ${table.reportingPeriodEnd} is not null
                    and ${table.reportingPeriodStart} >= 0
                    and ${table.reportingPeriodEnd} > ${table.reportingPeriodStart})`
        ),
        check(
            'provider_analytics_observations_timestamps_valid',
            sql`(${table.observedAt} is null or ${table.observedAt} >= 0)
                and ${table.fetchedAt} >= 0`
        ),
        check(
            'provider_analytics_observations_enum_valid',
            sql`${table.subjectType} in ('account', 'content')
                and (${table.postbotEntityType} is null or ${table.postbotEntityType} in ('channel', 'publication'))
                and ${table.availability} in ('measured', 'not_reported', 'not_found', 'blocked', 'disabled', 'temporarily_unavailable', 'rate_limited', 'invalid_response', 'partial_response', 'not_configured', 'not_authorized', 'not_supported')
                and ${table.freshness} in ('fresh', 'stale', 'unknown')`
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
            foreignColumns: [projectChannelProfiles.projectId, projectChannelProfiles.profileId],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_working_drafts_project_assessed_profile_fk',
            columns: [table.projectId, table.lastAssessedProfileVersionId],
            foreignColumns: [projectChannelProfiles.projectId, projectChannelProfiles.profileId],
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

// Adoption snapshots preserve even invalid saved work; they are never execution targets.
export const publicationDraftAdoptions = sqliteTable(
    'publication_draft_adoptions',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        publicationId: text('publication_id').notNull(),
        profileVersionId: text('profile_version_id').notNull(),
        adoptedProfileVersionId: text('adopted_profile_version_id').notNull(),
        snapshotJson: text('snapshot_json').notNull(),
        localContentJson: text('local_content_json'),
        targetRevisionId: text('target_revision_id').notNull(),
        createdByActorId: text('created_by_actor_id').notNull(),
        createdAt: integer('created_at').notNull(),
    },
    table => [
        index('publication_draft_adoptions_publication_idx').on(
            table.projectId,
            table.publicationId
        ),
        foreignKey({
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.projectId, table.profileVersionId],
            foreignColumns: [projectChannelProfiles.projectId, projectChannelProfiles.profileId],
        }).onDelete('restrict'),
        foreignKey({
            columns: [table.projectId, table.adoptedProfileVersionId],
            foreignColumns: [projectChannelProfiles.projectId, projectChannelProfiles.profileId],
        }).onDelete('restrict'),
        foreignKey({
            columns: [table.projectId, table.createdByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        foreignKey({
            columns: [table.projectId, table.targetRevisionId],
            foreignColumns: [publicationTargetRevisions.projectId, publicationTargetRevisions.id],
        }).onDelete('restrict'),
        check(
            'publication_draft_adoptions_snapshot_object',
            sql`json_valid(${table.snapshotJson}) and json_type(${table.snapshotJson}) = 'object'`
        ),
        check(
            'publication_draft_adoptions_local_object',
            sql`${table.localContentJson} is null or (json_valid(${table.localContentJson}) and json_type(${table.localContentJson}) = 'object')`
        ),
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
            foreignColumns: [projectChannelProfiles.projectId, projectChannelProfiles.profileId],
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

export const publicationApprovalRequests = sqliteTable(
    'publication_approval_requests',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        publicationId: text('publication_id').notNull(),
        targetRevisionId: text('target_revision_id').notNull(),
        draftRevision: integer('draft_revision').notNull(),
        proposedScheduledAt: integer('proposed_scheduled_at').notNull(),
        state: text('state', { enum: publicationApprovalRequestStates }).notNull(),
        requestedByActorId: text('requested_by_actor_id').notNull(),
        decidedByActorId: text('decided_by_actor_id'),
        decidedAt: integer('decided_at'),
        scheduledAt: integer('scheduled_at'),
        rejectionReason: text('rejection_reason'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('publication_approval_requests_project_id_id_uidx').on(
            table.projectId,
            table.id
        ),
        uniqueIndex('publication_approval_requests_one_pending_per_publication_uidx')
            .on(table.projectId, table.publicationId)
            .where(sql`${table.state} = 'pending'`),
        index('publication_approval_requests_project_state_created_idx').on(
            table.projectId,
            table.state,
            table.createdAt
        ),
        index('publication_approval_requests_project_publication_created_idx').on(
            table.projectId,
            table.publicationId,
            table.createdAt
        ),
        foreignKey({
            name: 'publication_approval_requests_project_publication_fk',
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_approval_requests_project_revision_fk',
            columns: [table.projectId, table.targetRevisionId],
            foreignColumns: [publicationTargetRevisions.projectId, publicationTargetRevisions.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_approval_requests_project_requester_fk',
            columns: [table.projectId, table.requestedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'publication_approval_requests_project_decider_fk',
            columns: [table.projectId, table.decidedByActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        check(
            'publication_approval_requests_draft_revision_positive',
            sql`${table.draftRevision} > 0`
        ),
        check(
            'publication_approval_requests_proposed_time_valid',
            sql`${table.proposedScheduledAt} > 0`
        ),
        check(
            'publication_approval_requests_state_valid',
            sql`${table.state} in ('pending', 'approved', 'rejected', 'superseded')`
        ),
        check(
            'publication_approval_requests_decision_valid',
            sql`(${table.state} = 'pending'
                    and ${table.decidedByActorId} is null
                    and ${table.decidedAt} is null
                    and ${table.scheduledAt} is null
                    and ${table.rejectionReason} is null)
                or (${table.state} = 'approved'
                    and ${table.decidedByActorId} is not null
                    and ${table.decidedAt} is not null
                    and ${table.scheduledAt} is not null
                    and ${table.rejectionReason} is null)
                or (${table.state} = 'rejected'
                    and ${table.decidedByActorId} is not null
                    and ${table.decidedAt} is not null
                    and ${table.scheduledAt} is null)
                or (${table.state} = 'superseded'
                    and ${table.decidedByActorId} is not null
                    and ${table.decidedAt} is not null
                    and ${table.scheduledAt} is null
                    and ${table.rejectionReason} is null)`
        ),
        check(
            'publication_approval_requests_rejection_reason_valid',
            sql`${table.rejectionReason} is null or length(trim(${table.rejectionReason})) > 0`
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
        destinationSnapshotJson: text('destination_snapshot_json', { mode: 'json' }).$type<Record<
            string,
            unknown
        > | null>(),
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
            foreignColumns: [projectChannelProfiles.projectId, projectChannelProfiles.profileId],
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
        remoteMediaExpiresAt: integer('remote_media_expires_at'),
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
            foreignColumns: [
                projectChannelPublishers.projectId,
                projectChannelPublishers.publisherId,
            ],
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
                and (${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt})
                and (${table.remoteMediaExpiresAt} is null
                    or (${table.completedAt} is not null and ${table.remoteMediaExpiresAt} >= ${table.completedAt}))`
        ),
        check(
            'provider_media_deliveries_state_data_valid',
            sql`(${table.state} = 'pending'
                    and ${table.attempts} >= 0
                    and (${table.lastAttemptAt} is null or ${table.lastAttemptAt} >= ${table.createdAt})
                    and ${table.completedAt} is null
                    and ${table.remoteMediaId} is null
                    and ${table.remoteMediaUrl} is null
                    and ${table.remoteMediaExpiresAt} is null
                    and ${table.errorCode} is null
                    and ${table.errorMessage} is null)
                or (${table.state} = 'uploading'
                    and ${table.attempts} > 0
                    and ${table.lastAttemptAt} is not null
                    and ${table.completedAt} is null
                    and ${table.remoteMediaExpiresAt} is null
                    and ${table.errorCode} is null
                    and ${table.errorMessage} is null)
                or (${table.state} = 'uploaded'
                    and ${table.attempts} > 0
                    and ${table.completedAt} is not null
                    and ${table.remoteMediaId} is not null
                    and length(trim(${table.remoteMediaId})) > 0
                    and (${table.remoteMediaExpiresAt} is null
                        or ${table.remoteMediaExpiresAt} >= ${table.completedAt})
                    and ${table.errorCode} is null
                    and ${table.errorMessage} is null)
                or (${table.state} in ('failed', 'ambiguous')
                    and ${table.attempts} > 0
                    and ${table.completedAt} is not null
                    and ${table.remoteMediaExpiresAt} is null
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
        projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
        workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
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
        uniqueIndex('audit_events_project_id_id_uidx').on(table.projectId, table.id),
        index('audit_events_workspace_sequence_idx').on(table.workspaceId, table.sequence),
        check(
            'audit_events_scope_valid',
            sql`(${table.projectId} is not null and ${table.workspaceId} is null) or (${table.projectId} is null and ${table.workspaceId} is not null)`
        ),
        foreignKey({
            name: 'audit_events_workspace_actor_fk',
            columns: [table.workspaceId, table.actorId],
            foreignColumns: [actors.workspaceId, actors.id],
        }).onDelete('restrict'),
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

export const notificationPreferences = sqliteTable(
    'notification_preferences',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        recipientActorId: text('recipient_actor_id').notNull(),
        kind: text('kind', { enum: notificationKinds }).notNull(),
        inAppEnabled: integer('in_app_enabled', { mode: 'boolean' }).default(true).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('notification_preferences_recipient_kind_uidx').on(
            table.projectId,
            table.recipientActorId,
            table.kind
        ),
        foreignKey({
            name: 'notification_preferences_project_actor_fk',
            columns: [table.projectId, table.recipientActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('cascade'),
        check(
            'notification_preferences_kind_valid',
            sql`${table.kind} in ('publication_published', 'publication_failed', 'publication_ambiguous')`
        ),
    ]
)

/**
 * User-level preferences apply across every project in the signed-in user's
 * inbox. Project preferences remain available as a backwards-compatible
 * fallback for the project notification API.
 */
export const notificationUserPreferences = sqliteTable(
    'notification_user_preferences',
    {
        id: text('id').primaryKey(),
        userId: text('user_id').notNull(),
        kind: text('kind', { enum: notificationKinds }).notNull(),
        inAppEnabled: integer('in_app_enabled', { mode: 'boolean' }).default(true).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('notification_user_preferences_user_kind_uidx').on(table.userId, table.kind),
        check(
            'notification_user_preferences_user_nonblank',
            sql`length(trim(${table.userId})) > 0`
        ),
        check(
            'notification_user_preferences_kind_valid',
            sql`${table.kind} in ('publication_published', 'publication_failed', 'publication_ambiguous')`
        ),
    ]
)

export const notificationProjectionCursors = sqliteTable(
    'notification_projection_cursors',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        projection: text('projection').notNull(),
        cursor: text('cursor'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('notification_projection_cursors_project_projection_uidx').on(
            table.projectId,
            table.projection
        ),
        check(
            'notification_projection_cursors_projection_nonblank',
            sql`length(trim(${table.projection})) > 0`
        ),
        check(
            'notification_projection_cursors_cursor_nonblank',
            sql`${table.cursor} is null or length(trim(${table.cursor})) > 0`
        ),
    ]
)

export const notifications = sqliteTable(
    'notifications',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
        recipientUserId: text('recipient_user_id').notNull(),
        recipientActorId: text('recipient_actor_id'),
        sourceEventId: text('source_event_id').notNull(),
        kind: text('kind', { enum: notificationKinds }).notNull(),
        severity: text('severity', { enum: notificationSeverities }).notNull(),
        subjectType: text('subject_type').notNull(),
        subjectId: text('subject_id').notNull(),
        title: text('title').notNull(),
        body: text('body').notNull(),
        readAt: integer('read_at'),
        archivedAt: integer('archived_at'),
        createdAt: integer('created_at').notNull(),
    },
    table => [
        uniqueIndex('notifications_user_project_source_event_uidx').on(
            table.recipientUserId,
            table.projectId,
            table.sourceEventId
        ),
        index('notifications_user_inbox_idx').on(
            table.recipientUserId,
            table.projectId,
            table.archivedAt,
            table.createdAt
        ),
        index('notifications_user_unread_idx').on(
            table.recipientUserId,
            table.projectId,
            table.readAt,
            table.archivedAt
        ),
        foreignKey({
            name: 'notifications_project_actor_fk',
            columns: [table.projectId, table.recipientActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'notifications_project_source_event_fk',
            columns: [table.projectId, table.sourceEventId],
            foreignColumns: [auditEvents.projectId, auditEvents.id],
        }).onDelete('cascade'),
        check(
            'notifications_kind_valid',
            sql`${table.kind} in ('publication_published', 'publication_failed', 'publication_ambiguous')`
        ),
        check(
            'notifications_severity_valid',
            sql`${table.severity} in ('success', 'warning', 'error')`
        ),
        check(
            'notifications_project_actor_scope_valid',
            sql`(${table.projectId} is null and ${table.recipientActorId} is null)
                or (${table.projectId} is not null and ${table.recipientActorId} is not null)`
        ),
        check(
            'notifications_recipient_user_nonblank',
            sql`length(trim(${table.recipientUserId})) > 0`
        ),
        check('notifications_subject_type_nonblank', sql`length(trim(${table.subjectType})) > 0`),
        check('notifications_subject_id_nonblank', sql`length(trim(${table.subjectId})) > 0`),
        check('notifications_title_nonblank', sql`length(trim(${table.title})) > 0`),
        check('notifications_body_nonblank', sql`length(trim(${table.body})) > 0`),
        check(
            'notifications_read_at_valid',
            sql`${table.readAt} is null or ${table.readAt} >= ${table.createdAt}`
        ),
        check(
            'notifications_archived_at_valid',
            sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`
        ),
    ]
)

export const notificationDestinations = sqliteTable(
    'notification_destinations',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        recipientActorId: text('recipient_actor_id').notNull(),
        transportId: text('transport_id').notNull(),
        label: text('label').notNull(),
        configurationJson: text('configuration_json', { mode: 'json' })
            .$type<Readonly<Record<string, unknown>>>()
            .notNull(),
        state: text('state', { enum: notificationDestinationStates }).default('active').notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('notification_destinations_project_id_id_uidx').on(table.projectId, table.id),
        index('notification_destinations_project_actor_state_idx').on(
            table.projectId,
            table.recipientActorId,
            table.state
        ),
        foreignKey({
            name: 'notification_destinations_project_actor_fk',
            columns: [table.projectId, table.recipientActorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('cascade'),
        check(
            'notification_destinations_transport_nonblank',
            sql`length(trim(${table.transportId})) > 0`
        ),
        check('notification_destinations_label_nonblank', sql`length(trim(${table.label})) > 0`),
        check(
            'notification_destinations_configuration_object',
            sql`json_valid(${table.configurationJson}) and json_type(${table.configurationJson}) = 'object'`
        ),
        check(
            'notification_destinations_state_valid',
            sql`${table.state} in ('active', 'disabled')`
        ),
    ]
)

export const notificationDestinationSecrets = sqliteTable(
    'notification_destination_secrets',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        destinationId: text('destination_id').notNull(),
        version: integer('version').notNull(),
        transportId: text('transport_id').notNull(),
        state: text('state', { enum: notificationDestinationSecretStates })
            .default('active')
            .notNull(),
        encryptionVersion: integer('encryption_version').notNull(),
        encryptionKeyId: text('encryption_key_id').notNull(),
        ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
        nonce: blob('nonce', { mode: 'buffer' }).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('notification_destination_secrets_project_id_id_uidx').on(
            table.projectId,
            table.id
        ),
        uniqueIndex('notification_destination_secrets_project_destination_id_uidx').on(
            table.projectId,
            table.destinationId,
            table.id
        ),
        uniqueIndex('notification_destination_secrets_project_destination_version_uidx').on(
            table.projectId,
            table.destinationId,
            table.version
        ),
        uniqueIndex('notification_destination_secrets_project_destination_active_uidx')
            .on(table.projectId, table.destinationId)
            .where(sql`${table.state} = 'active'`),
        foreignKey({
            name: 'notification_destination_secrets_project_destination_fk',
            columns: [table.projectId, table.destinationId],
            foreignColumns: [notificationDestinations.projectId, notificationDestinations.id],
        }).onDelete('cascade'),
        check('notification_destination_secrets_version_valid', sql`${table.version} > 0`),
        check(
            'notification_destination_secrets_transport_nonblank',
            sql`length(trim(${table.transportId})) > 0`
        ),
        check(
            'notification_destination_secrets_state_valid',
            sql`${table.state} in ('active', 'retired')`
        ),
        check(
            'notification_destination_secrets_encryption_version_valid',
            sql`${table.encryptionVersion} > 0`
        ),
        check(
            'notification_destination_secrets_encryption_key_nonblank',
            sql`length(trim(${table.encryptionKeyId})) > 0`
        ),
        check(
            'notification_destination_secrets_ciphertext_valid',
            sql`length(${table.ciphertext}) > 16`
        ),
        check('notification_destination_secrets_nonce_valid', sql`length(${table.nonce}) = 12`),
    ]
)

export const notificationSubscriptions = sqliteTable(
    'notification_subscriptions',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        destinationId: text('destination_id').notNull(),
        kind: text('kind', { enum: notificationKinds }).notNull(),
        enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
        ...timestamps(),
    },
    table => [
        uniqueIndex('notification_subscriptions_project_destination_kind_uidx').on(
            table.projectId,
            table.destinationId,
            table.kind
        ),
        foreignKey({
            name: 'notification_subscriptions_project_destination_fk',
            columns: [table.projectId, table.destinationId],
            foreignColumns: [notificationDestinations.projectId, notificationDestinations.id],
        }).onDelete('cascade'),
        check(
            'notification_subscriptions_kind_valid',
            sql`${table.kind} in ('publication_published', 'publication_failed', 'publication_ambiguous')`
        ),
    ]
)

export const notificationDeliveryProjectionCursors = sqliteTable(
    'notification_delivery_projection_cursors',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        projection: text('projection').notNull(),
        cursor: text('cursor'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('notification_delivery_cursors_project_projection_uidx').on(
            table.projectId,
            table.projection
        ),
        check(
            'notification_delivery_cursors_projection_nonblank',
            sql`length(trim(${table.projection})) > 0`
        ),
        check(
            'notification_delivery_cursors_cursor_nonblank',
            sql`${table.cursor} is null or length(trim(${table.cursor})) > 0`
        ),
    ]
)

export const notificationDeliveries = sqliteTable(
    'notification_deliveries',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        destinationId: text('destination_id').notNull(),
        secretId: text('secret_id'),
        sourceEventId: text('source_event_id').notNull(),
        transportId: text('transport_id').notNull(),
        configurationJson: text('configuration_json', { mode: 'json' })
            .$type<Readonly<Record<string, unknown>>>()
            .notNull(),
        kind: text('kind', { enum: notificationKinds }).notNull(),
        severity: text('severity', { enum: notificationSeverities }).notNull(),
        subjectType: text('subject_type').notNull(),
        subjectId: text('subject_id').notNull(),
        title: text('title').notNull(),
        body: text('body').notNull(),
        state: text('state', { enum: notificationDeliveryStates }).default('pending').notNull(),
        attemptCount: integer('attempt_count').default(0).notNull(),
        nextAttemptAt: integer('next_attempt_at').notNull(),
        leaseToken: text('lease_token'),
        leaseExpiresAt: integer('lease_expires_at'),
        effectStartedAt: integer('effect_started_at'),
        deliveredAt: integer('delivered_at'),
        failedAt: integer('failed_at'),
        ambiguousAt: integer('ambiguous_at'),
        externalId: text('external_id'),
        lastError: text('last_error'),
        ...timestamps(),
    },
    table => [
        uniqueIndex('notification_deliveries_project_destination_source_uidx').on(
            table.projectId,
            table.destinationId,
            table.sourceEventId
        ),
        index('notification_deliveries_project_due_idx').on(
            table.projectId,
            table.state,
            table.nextAttemptAt
        ),
        index('notification_deliveries_project_destination_idx').on(
            table.projectId,
            table.destinationId,
            table.createdAt
        ),
        foreignKey({
            name: 'notification_deliveries_project_destination_fk',
            columns: [table.projectId, table.destinationId],
            foreignColumns: [notificationDestinations.projectId, notificationDestinations.id],
        }).onDelete('restrict'),
        foreignKey({
            name: 'notification_deliveries_project_secret_fk',
            columns: [table.projectId, table.destinationId, table.secretId],
            foreignColumns: [
                notificationDestinationSecrets.projectId,
                notificationDestinationSecrets.destinationId,
                notificationDestinationSecrets.id,
            ],
        }).onDelete('restrict'),
        foreignKey({
            name: 'notification_deliveries_project_source_event_fk',
            columns: [table.projectId, table.sourceEventId],
            foreignColumns: [auditEvents.projectId, auditEvents.id],
        }).onDelete('cascade'),
        check(
            'notification_deliveries_transport_nonblank',
            sql`length(trim(${table.transportId})) > 0`
        ),
        check(
            'notification_deliveries_configuration_object',
            sql`json_valid(${table.configurationJson}) and json_type(${table.configurationJson}) = 'object'`
        ),
        check(
            'notification_deliveries_kind_valid',
            sql`${table.kind} in ('publication_published', 'publication_failed', 'publication_ambiguous')`
        ),
        check(
            'notification_deliveries_severity_valid',
            sql`${table.severity} in ('success', 'warning', 'error')`
        ),
        check(
            'notification_deliveries_subject_type_nonblank',
            sql`length(trim(${table.subjectType})) > 0`
        ),
        check(
            'notification_deliveries_subject_id_nonblank',
            sql`length(trim(${table.subjectId})) > 0`
        ),
        check('notification_deliveries_title_nonblank', sql`length(trim(${table.title})) > 0`),
        check('notification_deliveries_body_nonblank', sql`length(trim(${table.body})) > 0`),
        check(
            'notification_deliveries_state_valid',
            sql`${table.state} in ('pending', 'running', 'delivered', 'failed', 'ambiguous')`
        ),
        check('notification_deliveries_attempt_count_valid', sql`${table.attemptCount} >= 0`),
        check(
            'notification_deliveries_next_attempt_valid',
            sql`${table.nextAttemptAt} >= ${table.createdAt}`
        ),
        check(
            'notification_deliveries_lease_valid',
            sql`(
            (${table.leaseToken} is null and ${table.leaseExpiresAt} is null)
            or (${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null and ${table.leaseExpiresAt} >= ${table.createdAt})
        )`
        ),
        check(
            'notification_deliveries_terminal_time_valid',
            sql`(
            (${table.deliveredAt} is null or ${table.deliveredAt} >= ${table.createdAt})
            and (${table.failedAt} is null or ${table.failedAt} >= ${table.createdAt})
            and (${table.ambiguousAt} is null or ${table.ambiguousAt} >= ${table.createdAt})
        )`
        ),
    ]
)

/** Personal images deliberately do not belong to project media libraries. */
export const userAvatars = sqliteTable(
    'user_avatars',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'restrict' }),
        state: text('state', { enum: ['pending', 'ready', 'retired'] }).notNull(),
        storeId: text('store_id').notNull(),
        objectKey: text('object_key').notNull().unique(),
        contentType: text('content_type').notNull(),
        byteSize: integer('byte_size').notNull(),
        sha256: text('sha256').notNull(),
        ...timestamps(),
    },
    table => [
        index('user_avatars_owner_state').on(table.userId, table.state),
        check('user_avatars_state_valid', sql`${table.state} in ('pending', 'ready', 'retired')`),
        check(
            'user_avatars_size_valid',
            sql`${table.byteSize} > 0 and ${table.byteSize} <= 5242880`
        ),
    ]
)

/** Installation-owned SMTP configuration; the complete payload is encrypted. */
export const installationEmailSettings = sqliteTable('installation_email_settings', {
    id: text('id').primaryKey(),
    encryptionVersion: integer('encryption_version').notNull(),
    encryptionKeyId: text('encryption_key_id').notNull(),
    nonce: blob('nonce', { mode: 'buffer' }).notNull(),
    ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
    updatedAt: integer('updated_at').notNull(),
})

export const publicationCommentSnapshots = sqliteTable(
    'publication_comment_snapshots',
    {
        projectId: text('project_id').notNull(),
        publicationId: text('publication_id').notNull(),
        rootUri: text('root_uri').notNull(),
        snapshotJson: text('snapshot_json'),
        lastAttemptAt: integer('last_attempt_at').notNull(),
        lastError: text('last_error'),
    },
    table => [
        primaryKey({ columns: [table.projectId, table.publicationId] }),
        foreignKey({
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        check(
            'publication_comment_snapshots_attempt_nonnegative',
            sql`${table.lastAttemptAt} >= 0`
        ),
    ]
)

/** Outgoing conversation effects are independent from publication drafts and calendar entries. */
export const publicationCommentReplies = sqliteTable(
    'publication_comment_replies',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id').notNull(),
        publicationId: text('publication_id').notNull(),
        actorId: text('actor_id').notNull(),
        rootUri: text('root_uri').notNull(),
        parentUri: text('parent_uri').notNull(),
        text: text('text').notNull(),
        connectionId: text('connection_id').notNull(),
        credentialId: text('credential_id').notNull(),
        providerId: text('provider_id').notNull().default('bluesky'),
        accountId: text('account_id').notNull(),
        instanceOrigin: text('instance_origin'),
        recordKey: text('record_key').notNull(),
        state: text('state', {
            enum: ['pending', 'running', 'sent', 'failed', 'ambiguous'],
        }).notNull(),
        attempts: integer('attempts').notNull().default(0),
        claimToken: text('claim_token'),
        leaseExpiresAt: integer('lease_expires_at'),
        effectStartedAt: integer('effect_started_at'),
        externalId: text('external_id'),
        externalUrl: text('external_url'),
        lastError: text('last_error'),
        createdAt: integer('created_at').notNull(),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [
        foreignKey({
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.projectId, table.actorId],
            foreignColumns: [actors.projectId, actors.id],
        }),
        index('publication_comment_replies_due').on(table.state, table.createdAt),
        index('publication_comment_replies_history').on(
            table.projectId,
            table.publicationId,
            table.createdAt
        ),
        uniqueIndex('publication_comment_replies_record').on(
            table.providerId,
            table.accountId,
            table.recordKey
        ),
        check(
            'publication_comment_replies_state_valid',
            sql`${table.state} in ('pending', 'running', 'sent', 'failed', 'ambiguous')`
        ),
        check('publication_comment_replies_text_nonblank', sql`length(trim(${table.text})) > 0`),
        check('publication_comment_replies_attempts_valid', sql`${table.attempts} >= 0`),
        check(
            'publication_comment_replies_time_valid',
            sql`${table.createdAt} >= 0 and ${table.updatedAt} >= ${table.createdAt}`
        ),
        check(
            'publication_comment_replies_claim_valid',
            sql`(${table.state} = 'running' and ${table.claimToken} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} != 'running' and ${table.claimToken} is null and ${table.leaseExpiresAt} is null)`
        ),
    ]
)

/**
 * Lifecycle of a prepared first comment.
 *
 * `waiting` means the parent publication is not confirmed yet, `pending` means
 * the comment is armed against an exact parent receipt, `running` means a
 * worker claimed it, `suspended` means the enabling editor lost access, and
 * the remaining states are terminal outcomes of the send itself.
 */
export const publicationFirstCommentStates = [
    'waiting',
    'pending',
    'running',
    'suspended',
    'sent',
    'failed',
    'ambiguous',
    'cancelled',
] as const

/**
 * A prepared first comment is publication-owned: it exists before the remote
 * parent does, and it is independent from the conversation reply ledger.
 *
 * Foreign keys use the same project scoping as the reply store. The pinned
 * receipt, connection, credential and account are validated with scoped
 * queries instead of foreign keys because those tables are owned by the
 * publisher lifecycle, not by the comment.
 */
export const publicationFirstComments = sqliteTable(
    'publication_first_comments',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id')
            .notNull()
            .references(() => projects.id, { onDelete: 'cascade' }),
        publicationId: text('publication_id').notNull(),
        actorId: text('actor_id').notNull(),
        text: text('text').notNull(),
        delaySeconds: integer('delay_seconds').notNull(),
        state: text('state', { enum: publicationFirstCommentStates }).notNull(),
        // The provider is pinned when the comment is configured. Historical
        // rows predate the Mastodon extension and stay Bluesky.
        providerId: text('provider_id').notNull().default('bluesky'),
        // The instance that owns the pinned Mastodon status. Bluesky has no
        // instance boundary, so it stays null.
        instanceOrigin: text('instance_origin'),
        // Configuration revision: it advances on an editor save or cancel and
        // never on a lifecycle transition such as arming or suspension.
        revision: integer('revision').default(1).notNull(),
        dueAt: integer('due_at'),
        rootUri: text('root_uri'),
        executionRevisionId: text('execution_revision_id'),
        connectionId: text('connection_id'),
        credentialId: text('credential_id'),
        accountId: text('account_id'),
        recordKey: text('record_key').notNull(),
        attempts: integer('attempts').notNull().default(0),
        claimToken: text('claim_token'),
        leaseExpiresAt: integer('lease_expires_at'),
        effectStartedAt: integer('effect_started_at'),
        externalId: text('external_id'),
        externalUrl: text('external_url'),
        lastError: text('last_error'),
        ...timestamps(),
    },
    table => [
        foreignKey({
            name: 'publication_first_comments_project_publication_fk',
            columns: [table.projectId, table.publicationId],
            foreignColumns: [publications.projectId, publications.id],
        }).onDelete('cascade'),
        foreignKey({
            name: 'publication_first_comments_project_actor_fk',
            columns: [table.projectId, table.actorId],
            foreignColumns: [actors.projectId, actors.id],
        }).onDelete('restrict'),
        uniqueIndex('publication_first_comments_project_publication_uidx').on(
            table.projectId,
            table.publicationId
        ),
        uniqueIndex('publication_first_comments_project_record_key_uidx').on(
            table.projectId,
            table.recordKey
        ),
        index('publication_first_comments_state_due_at_idx').on(table.state, table.dueAt),
        index('publication_first_comments_project_publication_idx').on(
            table.projectId,
            table.publicationId
        ),
        check(
            'publication_first_comments_state_valid',
            sql`${table.state} in ('waiting', 'pending', 'running', 'suspended', 'sent', 'failed', 'ambiguous', 'cancelled')`
        ),
        check('publication_first_comments_text_nonblank', sql`length(trim(${table.text})) > 0`),
        check(
            'publication_first_comments_delay_seconds_valid',
            sql`${table.delaySeconds} >= 0 and ${table.delaySeconds} <= 604800`
        ),
        check('publication_first_comments_attempts_valid', sql`${table.attempts} >= 0`),
        check('publication_first_comments_revision_valid', sql`${table.revision} > 0`),
        check(
            'publication_first_comments_record_key_nonblank',
            sql`length(trim(${table.recordKey})) > 0`
        ),
        check(
            'publication_first_comments_time_valid',
            sql`${table.createdAt} >= 0 and ${table.updatedAt} >= ${table.createdAt}`
        ),
        check(
            'publication_first_comments_claim_valid',
            sql`(${table.state} = 'running' and ${table.claimToken} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} != 'running' and ${table.claimToken} is null and ${table.leaseExpiresAt} is null)`
        ),
        check(
            'publication_first_comments_armed_identity',
            sql`${table.state} not in ('pending', 'running') or (${table.dueAt} is not null and ${table.rootUri} is not null and ${table.executionRevisionId} is not null and ${table.connectionId} is not null and ${table.credentialId} is not null and ${table.accountId} is not null)`
        ),
        check(
            'publication_first_comments_external_result_only_sent',
            sql`(${table.externalId} is null and ${table.externalUrl} is null) or ${table.state} = 'sent'`
        ),
    ]
)

/** Lifecycle receipts intentionally survive project/workspace deletion. */
export const resourceLifecycles = sqliteTable(
    'resource_lifecycles',
    {
        kind: text('kind', { enum: ['project', 'workspace'] }).notNull(),
        resourceId: text('resource_id').notNull(),
        name: text('name').notNull(),
        state: text('state', {
            enum: ['active', 'archiving', 'archived', 'deleting', 'deleted'],
        }).notNull(),
        revision: integer('revision').notNull().default(1),
        actorId: text('actor_id').notNull(),
        impactJson: text('impact_json').notNull(),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [
        primaryKey({ columns: [table.kind, table.resourceId] }),
        index('resource_lifecycles_state_updated_idx').on(table.state, table.updatedAt),
        check('resource_lifecycles_kind_valid', sql`${table.kind} in ('project', 'workspace')`),
        check(
            'resource_lifecycles_state_valid',
            sql`${table.state} in ('active', 'archiving', 'archived', 'deleting', 'deleted')`
        ),
        check('resource_lifecycles_revision_valid', sql`${table.revision} > 0`),
        check(
            'resource_lifecycles_impact_valid',
            sql`json_valid(${table.impactJson}) and json_type(${table.impactJson}) = 'object'`
        ),
    ]
)

/** Object ownership is copied before its SQL resource is removed. */
export const resourceCleanupObjects = sqliteTable(
    'resource_cleanup_objects',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id').notNull(),
        workspaceId: text('workspace_id'),
        storeId: text('store_id').notNull(),
        objectKey: text('object_key').notNull(),
        attempts: integer('attempts').notNull().default(0),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [
        index('resource_cleanup_project_idx').on(table.projectId),
        index('resource_cleanup_workspace_idx').on(table.workspaceId),
        index('resource_cleanup_updated_idx').on(table.updatedAt),
        check('resource_cleanup_attempts_valid', sql`${table.attempts} >= 0`),
    ]
)

export const resourceLifecycleEvents = sqliteTable('resource_lifecycle_events', {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    resourceId: text('resource_id').notNull(),
    action: text('action').notNull(),
    actorId: text('actor_id').notNull(),
    impactJson: text('impact_json').notNull(),
    createdAt: integer('created_at').notNull(),
})
