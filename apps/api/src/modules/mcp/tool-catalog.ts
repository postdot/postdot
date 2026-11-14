import type { PostdotApiKeyCapability } from '../projects/api-key-permissions'

type Arguments = Readonly<Record<string, unknown>>

/**
 * One exposed API operation. The operation ID selects the route and its input contract from the
 * live OpenAPI document; nothing about request or response shapes is repeated here.
 */
export interface McpToolEntry {
    readonly operationId: string
    /** Appended to the API summary so the agent learns what the operation does and when not to use it. */
    readonly guidance?: string
    /**
     * Requires `confirm: true`. Operations whose capability is `publication:dispatch` always do;
     * a predicate limits the confirmation to the calls that can reach a destination or change timing.
     */
    readonly confirm?: boolean | ((input: Arguments) => boolean)
    /** The operation fetches a remote resource or reaches a provider. */
    readonly openWorld?: boolean
    readonly destructive?: boolean
    /** Body field → tool input name, for fields that would collide with a path parameter. */
    readonly rename?: Readonly<Record<string, string>>
}

function publicationsOf(input: Arguments): readonly Record<string, unknown>[] {
    const value = input.publications
    return Array.isArray(value)
        ? value.filter(
              (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
          )
        : []
}

/** Creation can schedule real delivery: automatic mode or a requested time. */
const schedulesDelivery = (input: Arguments) =>
    publicationsOf(input).some(
        publication =>
            publication.deliveryMode === 'automatic' ||
            (publication.scheduledAt !== undefined && publication.scheduledAt !== null)
    )

export const mcpToolCatalog: readonly McpToolEntry[] = [
    // Instance access, members, invitations, and API keys
    { operationId: 'getCurrentInstanceAccess' },
    { operationId: 'listAccessMembers' },
    {
        operationId: 'createAccessMember',
        confirm: true,
        guidance:
            'Creates an enabled user or agent service account directly. When apiKey is provided, the plaintext API key token is returned once in the tool output; handle and store it securely without logging.',
    },
    {
        operationId: 'updateAccessMember',
        confirm: true,
        guidance: 'Updates an instance member role or enabled status.',
    },
    { operationId: 'listMemberApiKeys' },
    {
        operationId: 'revokeMemberApiKey',
        destructive: true,
        confirm: true,
        guidance: 'Immediately revokes an instance member API key.',
    },
    { operationId: 'listAccessInvitations' },
    {
        operationId: 'createAccessInvitation',
        confirm: true,
        guidance:
            'Creates an instance invitation whose returned token grants account registration and appears in tool output.',
    },
    { operationId: 'revokeAccessInvitation', destructive: true, confirm: true },
    { operationId: 'listUserApiKeys' },
    {
        operationId: 'createUserApiKey',
        confirm: true,
        guidance:
            'Mints an API key bounded by the caller scopes and capabilities. Security notice: the plaintext token is returned once in the tool output — transfer it securely and avoid exposing it in logs or prompts.',
    },
    {
        operationId: 'updateUserApiKey',
        confirm: true,
        guidance: 'Updates API key name, expiry, or bounded project/action scopes.',
    },
    { operationId: 'deleteUserApiKey', destructive: true, confirm: true },

    // Instance settings & recovery
    { operationId: 'getEmailSettings' },
    {
        operationId: 'saveEmailSettings',
        confirm: true,
        guidance: 'Updates instance SMTP host, sender, and credentials.',
    },
    { operationId: 'testEmailSettings', openWorld: true, confirm: true },
    { operationId: 'getRecoveryState' },
    {
        operationId: 'resumeAfterRestore',
        rename: { confirm: 'acknowledgeRecovery' },
        confirm: true,
        guidance:
            'Clears the restore hold and resumes scheduled dispatch. Pass confirm:true and acknowledgeRecovery:true with the hold token.',
    },
    { operationId: 'listProviderApplicationConfigurations' },
    {
        operationId: 'createProviderApplicationConfiguration',
        confirm: true,
        guidance:
            'Stores OAuth client credentials for a provider. Keep client secrets confidential.',
    },
    {
        operationId: 'updateProviderApplicationConfiguration',
        confirm: true,
        guidance: 'Updates or disables OAuth client credentials for a provider.',
    },

    // Search, retirements, and categories
    { operationId: 'searchPostdot' },
    { operationId: 'listResourceRetirements' },
    { operationId: 'listProjectCategories' },
    { operationId: 'createProjectCategory', confirm: true },
    { operationId: 'renameProjectCategory', confirm: true },
    { operationId: 'archiveProjectCategory', destructive: true, confirm: true },
    { operationId: 'restoreProjectCategory', confirm: true },

    // Workspaces, teams, projects, access, and lifecycle
    { operationId: 'listWorkspaces' },
    { operationId: 'getWorkspace' },
    { operationId: 'createWorkspace', confirm: true },
    { operationId: 'getWorkspaceLifecycleImpact' },
    {
        operationId: 'archiveWorkspace',
        destructive: true,
        confirm: true,
        guidance:
            'Archiving stops scheduled work across every project in the workspace. Inspect lifecycle impact first.',
    },
    { operationId: 'restoreWorkspace', confirm: true },
    {
        operationId: 'deleteWorkspace',
        destructive: true,
        confirm: true,
        guidance:
            'Permanently deletes an archived workspace and all of its projects and channels. Inspect lifecycle impact first.',
    },
    { operationId: 'updateWorkspaceMemberRole', confirm: true },
    { operationId: 'removeWorkspaceMember', destructive: true, confirm: true },
    { operationId: 'createWorkspaceTeam', confirm: true },
    { operationId: 'renameWorkspaceTeam', confirm: true },
    { operationId: 'listWorkspaceTeamMembers' },
    { operationId: 'addWorkspaceTeamMember', confirm: true },
    { operationId: 'removeWorkspaceTeamMember', destructive: true, confirm: true },
    { operationId: 'listWorkspaceInvitations' },
    {
        operationId: 'createWorkspaceInvitation',
        confirm: true,
        guidance:
            'Creates a workspace invitation; handle any returned invitation token or link securely.',
    },
    { operationId: 'cancelWorkspaceInvitation', destructive: true, confirm: true },

    { operationId: 'listProjects' },
    {
        operationId: 'createProject',
        guidance:
            'Creates a project in the specified workspace or the key owner default workspace. Requires an API key with access to all projects.',
    },
    {
        operationId: 'updateProjectTimeZone',
        guidance:
            'Updates how schedules are entered and displayed without moving existing scheduled publications.',
    },
    { operationId: 'setProjectPrimaryCategory' },
    { operationId: 'getProjectLifecycleState' },
    { operationId: 'getProjectLifecycleImpact' },
    {
        operationId: 'archiveProject',
        destructive: true,
        confirm: true,
        guidance: 'Archiving stops scheduled work. Inspect the lifecycle impact first.',
    },
    { operationId: 'restoreProject' },
    {
        operationId: 'deleteProject',
        destructive: true,
        confirm: true,
        guidance:
            'Permanently deletes an archived project and retains a minimal receipt. Inspect lifecycle impact first.',
    },

    // Project membership, invitations, and grants
    { operationId: 'getProjectMembership' },
    { operationId: 'listProjectMembers' },
    { operationId: 'updateProjectMemberRole', confirm: true },
    { operationId: 'removeProjectMember', destructive: true, confirm: true },
    { operationId: 'listProjectUserGrants' },
    { operationId: 'createProjectUserGrant', confirm: true },
    { operationId: 'updateProjectUserGrant', confirm: true },
    { operationId: 'removeProjectUserGrant', destructive: true, confirm: true },
    { operationId: 'listProjectTeamGrants' },
    { operationId: 'createProjectTeamGrant', confirm: true },
    { operationId: 'updateProjectTeamGrant', confirm: true },
    { operationId: 'removeProjectTeamGrant', destructive: true, confirm: true },
    { operationId: 'listProjectInvitations' },
    { operationId: 'createProjectInvitation', confirm: true },
    { operationId: 'cancelProjectInvitation', destructive: true, confirm: true },
    { operationId: 'resendProjectInvitation', openWorld: true, confirm: true },

    // Channels, non-OAuth connections, profiles and sharing
    { operationId: 'listProjectChannels' },
    { operationId: 'getChannelProfileState' },
    { operationId: 'listProjectPublishers' },
    {
        operationId: 'createProjectChannel',
        guidance:
            'Creates an unconnected destination; it cannot publish until a provider connection is attached.',
    },
    { operationId: 'renameProjectChannel' },
    { operationId: 'archiveProjectChannel', destructive: true },
    { operationId: 'restoreProjectChannel' },
    { operationId: 'deleteProjectChannel', destructive: true, confirm: true },
    {
        operationId: 'createCustomHttpPublisherConnection',
        openWorld: true,
        confirm: true,
        guidance: 'Connects a custom HTTP webhook destination using supplied endpoint credentials.',
    },
    {
        operationId: 'createDevtoPublisherConnection',
        openWorld: true,
        confirm: true,
        guidance: 'Connects a DEV Community publisher using an API key stored encrypted at rest.',
    },
    {
        operationId: 'createDiscordPublisherConnection',
        rename: { channelId: 'discordChannelId' },
        openWorld: true,
        confirm: true,
        guidance:
            'Connects a Discord bot token and target Discord channel ID stored encrypted at rest.',
    },
    {
        operationId: 'createTelegramPublisherConnection',
        openWorld: true,
        confirm: true,
        guidance: 'Connects a Telegram bot token and chat ID stored encrypted at rest.',
    },
    { operationId: 'disconnectProjectPublisher', destructive: true, confirm: true },
    { operationId: 'getProjectChannelSharing' },
    { operationId: 'listProjectChannelOccupancy' },
    {
        operationId: 'attachProjectChannel',
        rename: { projectId: 'targetProjectId' },
        confirm: true,
        guidance: 'Grants another project publication use of this channel.',
    },
    { operationId: 'withdrawProjectChannel', destructive: true, confirm: true },
    {
        operationId: 'transferProjectChannelManagement',
        rename: { projectId: 'managingProjectId' },
        confirm: true,
    },
    { operationId: 'getChannelCadence' },
    {
        operationId: 'configureChannelCadence',
        confirm: true,
        guidance: 'Changes planning limits for every project using the channel.',
    },

    // Posts and publications
    { operationId: 'getSourcePost' },
    {
        operationId: 'createPost',
        confirm: schedulesDelivery,
        guidance:
            'Without automatic delivery or a time it only creates drafts. Pass confirm:true to schedule.',
    },
    { operationId: 'savePostSource' },
    { operationId: 'addPostDestinationDrafts' },
    { operationId: 'listPublicationSummaries' },
    { operationId: 'listPublicationApprovalRequests' },
    { operationId: 'getPublicationEditor' },
    { operationId: 'getPublicationDestination' },
    { operationId: 'getPublicationCadence' },
    { operationId: 'getPublicationFirstComment' },
    { operationId: 'listDueManualPublications' },
    { operationId: 'listPublicationDraftAdoptions' },
    { operationId: 'savePublicationDraft' },
    { operationId: 'duplicateDraftPublication' },
    { operationId: 'deleteDraftPublication', destructive: true },
    { operationId: 'rebasePublicationDraft' },
    { operationId: 'assessPublicationDraftAdoption' },
    { operationId: 'adoptPublicationDraftProfile' },
    { operationId: 'submitPublicationForApproval' },
    {
        operationId: 'approvePublicationRequest',
        confirm: true,
        guidance: 'Approves a publication request so it can proceed to scheduling or dispatch.',
    },
    { operationId: 'rejectPublicationRequest', destructive: true, confirm: true },
    {
        operationId: 'movePublication',
        confirm: true,
        guidance: 'Moves pending work to another channel and may change when it is delivered.',
    },
    { operationId: 'promotePublicationDraft', guidance: 'Turns a draft into scheduled work.' },
    { operationId: 'reschedulePublications' },
    { operationId: 'cancelPublications', destructive: true },
    {
        operationId: 'overridePublicationCadence',
        guidance: 'Accepts one planning exception; provider limits still apply.',
    },
    { operationId: 'confirmPublicationDestination' },
    { operationId: 'savePublicationFirstComment' },
    { operationId: 'cancelPublicationFirstComment', destructive: true },
    {
        operationId: 'publishManualPublication',
        openWorld: true,
        guidance: 'Marks a manual publication as published by a human.',
    },
    { operationId: 'retryFailedPublication', openWorld: true },
    {
        operationId: 'reconcileAmbiguousPublication',
        guidance: 'Record what actually happened at the destination; never guess.',
    },

    // Taxonomy
    { operationId: 'listProjectTags' },
    { operationId: 'listPublicationTags' },
    { operationId: 'createProjectTag' },
    { operationId: 'renameProjectTag' },
    { operationId: 'archiveProjectTag', destructive: true },
    { operationId: 'restoreProjectTag' },
    { operationId: 'replacePublicationTags' },

    // Media (file bytes are not transferable over MCP; import from a URL instead)
    { operationId: 'getProjectMediaUploadPolicy' },
    { operationId: 'getProjectMediaImportSources' },
    { operationId: 'listProjectMedia' },
    { operationId: 'getProjectMedia' },
    { operationId: 'getProjectMediaUsage' },
    { operationId: 'importMediaFromUrl', openWorld: true },
    { operationId: 'requestMediaDeletion', destructive: true },
    { operationId: 'requestMediaDeletions', destructive: true },
    { operationId: 'restoreProjectMedia' },

    // Analytics
    { operationId: 'getProjectAnalytics' },
    { operationId: 'getLatestBlueskyProviderAnalytics' },
    { operationId: 'getLatestMastodonProviderAnalytics' },
    { operationId: 'getLatestDevtoProviderAnalytics' },
    { operationId: 'collectBlueskyProviderAnalytics', openWorld: true, confirm: true },
    { operationId: 'collectMastodonProviderAnalytics', openWorld: true, confirm: true },
    { operationId: 'collectDevtoProviderAnalytics', openWorld: true, confirm: true },
]

export type { PostdotApiKeyCapability }
