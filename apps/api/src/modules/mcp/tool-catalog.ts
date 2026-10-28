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
    // Projects and lifecycle
    { operationId: 'listProjects' },
    { operationId: 'getProjectLifecycleState' },
    { operationId: 'getProjectLifecycleImpact' },
    {
        operationId: 'archiveProject',
        destructive: true,
        confirm: true,
        guidance: 'Archiving stops scheduled work. Inspect the lifecycle impact first.',
    },
    { operationId: 'restoreProject' },

    // Channels, profiles and sharing
    { operationId: 'listProjectChannels' },
    { operationId: 'getChannelProfileState' },
    { operationId: 'listProjectPublishers' },
    {
        operationId: 'createProjectChannel',
        guidance:
            'Creates an unconnected destination; it cannot publish until it is connected in Studio.',
    },
    { operationId: 'renameProjectChannel' },
    { operationId: 'archiveProjectChannel', destructive: true },
    { operationId: 'restoreProjectChannel' },
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
