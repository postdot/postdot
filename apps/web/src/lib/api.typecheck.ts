import type {
    WebApiRequests,
    MediaListPage,
    MediaAssetUsage,
    MediaDeletion,
    MediaDeletionBatch,
    MediaUrlImport,
    MediaListOptions,
    PublicationListSort,
    RecoveryState,
    ChannelProfilePresets,
    FacebookPageChoices,
    ProviderApplication,
    ProviderApplicationProvider,
    ProviderApplicationState,
    ProviderApplicationOAuthMode,
    ProviderApplicationInput,
    ProviderApplicationUpdateInput,
    UserApiKey,
    UserApiKeyCapability,
    InstanceSetupStatus,
    AccessSummary,
    AccessInstanceState,
    AccessInstanceMembership,
    AccessInstanceRole,
    AccessInstanceMembershipState,
    AccessInstanceMembershipUpdate,
    CreatedAccessInvitation,
    AccessInvitation,
    AccessInvitationState,
    AccessInvitationPreview,
    ProjectTag,
    ProjectMember,
    ProjectInvitation,
    ProjectMemberRole,
    ProjectInvitationStatus,
    ProjectUserGrant,
    ProjectTeamGrant,
    WorkspaceInvitation,
    WorkspaceListResponse,
    WorkspaceListItem,
    WorkspaceMember,
    WorkspaceTeam,
    WorkspaceRole,
    WorkspaceSummary,
    WorkspaceTeamMember,
} from '@postdot/client'

import type { api } from './api'

type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
        ? true
        : false

type Assert<Value extends true> = Value

/** Compile-time contracts: unknown, any or drifted tag responses must fail. */
export type InferredProjectTagResponses = [
    Assert<Equal<Awaited<ReturnType<typeof api.listProjectTags>>, { tags: ProjectTag[] }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.createProjectTag>>, { tag: ProjectTag }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.renameProjectTag>>, { tag: ProjectTag }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.archiveProjectTag>>, { tag: ProjectTag }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.restoreProjectTag>>, { tag: ProjectTag }>>,
]

/** Workspace reads use the server contract, including its open invitation status. */
export type InferredWorkspaceResponses = [
    Assert<Equal<Awaited<ReturnType<typeof api.listWorkspaces>>, WorkspaceListResponse>>,
    Assert<Equal<Awaited<ReturnType<typeof api.getWorkspace>>, WorkspaceSummary>>,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listWorkspaceTeamMembers>>,
            { members: WorkspaceTeamMember[] }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listWorkspaceInvitations>>,
            { invitations: WorkspaceInvitation[] }
        >
    >,
    Assert<Equal<WorkspaceRole, 'owner' | 'admin' | 'member'>>,
    Assert<Equal<WorkspaceInvitation['status'], string>>,
    Assert<Equal<WorkspaceTeamMember['id'], string>>,
    Assert<Equal<WorkspaceListResponse['canCreateWorkspace'], boolean>>,
]

/** Workspace writes preserve their existing role restrictions and server results. */
export type InferredWorkspaceMutations = [
    Assert<
        Equal<Awaited<ReturnType<typeof api.createWorkspace>>, { workspace: WorkspaceListItem }>
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.updateWorkspaceMemberRole>>,
            { member: WorkspaceMember }
        >
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeWorkspaceMember>>, { removed: true }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.createWorkspaceTeam>>, { team: WorkspaceTeam }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.renameWorkspaceTeam>>, { team: WorkspaceTeam }>>,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.addWorkspaceTeamMember>>,
            { member: WorkspaceTeamMember }
        >
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeWorkspaceTeamMember>>, { removed: true }>>,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.createWorkspaceInvitation>>,
            { invitation: WorkspaceInvitation }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.cancelWorkspaceInvitation>>,
            { invitation: WorkspaceInvitation }
        >
    >,
    Assert<Equal<Parameters<typeof api.updateWorkspaceMemberRole>[2], 'admin' | 'member'>>,
]

/** Project grant results follow the server; writes cannot elevate a role to owner. */
export type InferredProjectGrants = [
    Assert<
        Equal<Awaited<ReturnType<typeof api.listProjectUserGrants>>, { grants: ProjectUserGrant[] }>
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.createProjectUserGrant>>, { grant: ProjectUserGrant }>
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.updateProjectUserGrant>>, { grant: ProjectUserGrant }>
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeProjectUserGrant>>, { removed: true }>>,
    Assert<
        Equal<Awaited<ReturnType<typeof api.listProjectTeamGrants>>, { grants: ProjectTeamGrant[] }>
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.createProjectTeamGrant>>, { grant: ProjectTeamGrant }>
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.updateProjectTeamGrant>>, { grant: ProjectTeamGrant }>
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeProjectTeamGrant>>, { removed: true }>>,
    Assert<Equal<Parameters<typeof api.createProjectUserGrant>[2], 'editor' | 'viewer'>>,
    Assert<Equal<Parameters<typeof api.updateProjectUserGrant>[2], 'editor' | 'viewer'>>,
    Assert<Equal<Parameters<typeof api.createProjectTeamGrant>[2], 'editor' | 'viewer'>>,
    Assert<Equal<Parameters<typeof api.updateProjectTeamGrant>[2], 'editor' | 'viewer'>>,
]

/** Membership and invitation contracts retain their server-defined roles and states. */
export type InferredProjectMembershipContracts = [
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listProjectMembers>>,
            { members: ProjectMember[]; total: number }
        >
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.getProjectMembership>>, { membership: ProjectMember }>
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listProjectInvitations>>,
            { invitations: ProjectInvitation[] }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.createProjectInvitation>>,
            { invitation: ProjectInvitation }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.cancelProjectInvitation>>,
            { invitation: ProjectInvitation }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.resendProjectInvitation>>,
            { invitation: ProjectInvitation }
        >
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.updateProjectMember>>, { membership: ProjectMember }>
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeProjectMember>>, { removed: true }>>,
    Assert<Equal<Parameters<typeof api.createProjectInvitation>[2], 'editor' | 'viewer'>>,
    Assert<Equal<Parameters<typeof api.updateProjectMember>[2], 'editor' | 'viewer'>>,
    Assert<Equal<ProjectMemberRole, 'owner' | 'editor' | 'viewer'>>,
    Assert<Equal<ProjectInvitationStatus, 'pending' | 'accepted' | 'rejected' | 'canceled'>>,
    Assert<Equal<ProjectMember['state'], 'active'>>,
]

/** Instance access remains server-owned across both Eden request interfaces. */
export type InferredInstanceAccessContracts = [
    Assert<Equal<Awaited<ReturnType<typeof api.getInstanceSetupStatus>>, InstanceSetupStatus>>,
    Assert<Equal<Awaited<ReturnType<typeof api.getInstanceAccess>>, AccessSummary>>,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listAccessMembers>>,
            { members: AccessInstanceMembership[] }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.updateAccessMember>>,
            { membership: AccessInstanceMembership }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listAccessInvitations>>,
            { invitations: AccessInvitation[] }
        >
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.createAccessInvitation>>, CreatedAccessInvitation>>,
    Assert<
        Equal<Awaited<ReturnType<typeof api.getAccessInvitationPreview>>, AccessInvitationPreview>
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.revokeAccessInvitation>>,
            { invitation: AccessInvitation }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.acceptAccessInvitation>>,
            { invitation: AccessInvitation; instanceMembership: AccessInstanceMembership }
        >
    >,
    Assert<Equal<AccessInstanceRole, 'admin' | 'member'>>,
    Assert<Equal<AccessInstanceMembershipState, 'enabled' | 'disabled'>>,
    Assert<Equal<AccessInstanceState, 'claimable' | 'claimed'>>,
    Assert<Equal<AccessInvitationState, 'pending' | 'accepted' | 'revoked' | 'expired'>>,
    Assert<
        Equal<
            AccessInstanceMembershipUpdate,
            { role?: 'admin' | 'member'; state?: 'enabled' | 'disabled' }
        >
    >,
    Assert<Equal<AccessSummary['membership'], AccessInstanceMembership | null>>,
    Assert<Equal<AccessInvitation['instanceRole'], 'member'>>,
]

/** API-key metadata never exposes the creation-only token. */
export type InferredUserApiKeyContracts = [
    Assert<Equal<Awaited<ReturnType<typeof api.listUserApiKeys>>, { keys: UserApiKey[] }>>,
    Assert<
        Equal<Awaited<ReturnType<typeof api.createUserApiKey>>, { key: UserApiKey; token: string }>
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.updateUserApiKey>>, { key: UserApiKey }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.revokeUserApiKey>>, { deleted: true }>>,
    Assert<Equal<Extract<keyof UserApiKey, 'token'>, never>>,
    Assert<Equal<UserApiKey['projectAccess'], 'all' | string[]>>,
    Assert<Equal<UserApiKey['actionAccess'], 'all' | UserApiKeyCapability[]>>,
    Assert<Equal<UserApiKey['expiresAt'], number | null>>,
    Assert<
        Equal<
            UserApiKeyCapability,
            | 'project:read'
            | 'publication:manage'
            | 'publication:dispatch'
            | 'channel:manage'
            | 'media:manage'
            | 'analytics:refresh'
            | 'media:permanently_delete'
            | 'project:manage'
            | 'project:permanently_delete'
        >
    >,
    Assert<
        Equal<
            Parameters<typeof api.createUserApiKey>,
            [
                name: string | undefined,
                projectIds: readonly string[] | null,
                expiresAt?: number | null,
                actionAccess?: readonly UserApiKeyCapability[] | null,
            ]
        >
    >,
    Assert<
        Equal<
            Parameters<typeof api.updateUserApiKey>[1],
            {
                readonly name?: string
                readonly projectIds?: readonly string[] | null
                readonly expiresAt?: number | null
                readonly actionAccess?: readonly UserApiKeyCapability[] | null
            }
        >
    >,
]

/** Provider secrets are write-only; callbacks and configuration follow the server. */
export type InferredProviderApplicationContracts = [
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listProviderApplications>>,
            {
                applications: ProviderApplication[]
                xCallbackUri: string
                facebookCallbackUri: string
                instagramCallbackUri: string
            }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.createProviderApplication>>,
            { application: ProviderApplication }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.updateProviderApplication>>,
            { application: ProviderApplication }
        >
    >,
    Assert<
        Equal<ProviderApplicationProvider, 'linkedin' | 'bluesky' | 'x' | 'facebook' | 'instagram'>
    >,
    Assert<Equal<ProviderApplicationState, 'active' | 'disabled'>>,
    Assert<Equal<ProviderApplicationOAuthMode, 'loopback' | 'web'>>,
    Assert<Equal<Extract<keyof ProviderApplication, 'clientSecret'>, never>>,
    Assert<Equal<ProviderApplication['hasClientSecret'], boolean>>,
    Assert<Equal<ProviderApplication['oauthMode'], ProviderApplicationOAuthMode | null>>,
    Assert<
        Equal<
            ProviderApplicationInput,
            {
                readonly providerId: ProviderApplicationProvider
                readonly name: string
                readonly clientId?: string | null
                readonly clientMetadataUrl?: string | null
                readonly handleResolver?: string | null
                readonly clientSecret?: string | null
                readonly state?: ProviderApplicationState
                readonly isDefault?: boolean
            }
        >
    >,
    Assert<
        Equal<ProviderApplicationUpdateInput, Partial<Omit<ProviderApplicationInput, 'providerId'>>>
    >,
    Assert<
        Equal<Parameters<typeof api.updateProviderApplication>[1], ProviderApplicationUpdateInput>
    >,
]

/** Every application JSON method has a concrete response, including void adapters. */
type BoundaryMethod =
    | 'getSession'
    | 'signIn'
    | 'signUp'
    | 'requestPasswordReset'
    | 'resetPassword'
    | 'sendAccountEmailVerification'
    | 'updateProfile'
    | 'changePassword'
    | 'uploadAvatar'
    | 'uploadMedia'
    | 'signOut'
    | 'acceptOrganizationInvitation'
    | 'acceptProjectInvitation'
type UntypedApplicationMethods = {
    [Key in Exclude<keyof typeof api, BoundaryMethod>]: unknown extends Awaited<
        ReturnType<(typeof api)[Key]>
    >
        ? Key
        : never
}[Exclude<keyof typeof api, BoundaryMethod>]

export type InferredApplicationJsonContracts = [
    Assert<Equal<UntypedApplicationMethods, never>>,
    Assert<Equal<Awaited<ReturnType<typeof api.listMedia>>, MediaListPage>>,
    Assert<Equal<Awaited<ReturnType<typeof api.getMediaUsage>>, MediaAssetUsage>>,
    Assert<Equal<Awaited<ReturnType<typeof api.deleteMedia>>, MediaDeletion>>,
    Assert<Equal<Awaited<ReturnType<typeof api.deleteMediaBatch>>, MediaDeletionBatch>>,
    Assert<Equal<Awaited<ReturnType<typeof api.importMediaFromUrl>>, MediaUrlImport>>,
    Assert<
        Equal<Awaited<ReturnType<typeof api.permanentlyDeleteMedia>>, 'deleted' | 'cleanup_pending'>
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.restoreMedia>>, void>>,
    Assert<Equal<Awaited<ReturnType<typeof api.removeAvatar>>, { success: boolean }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.listChannelProfilePresets>>, ChannelProfilePresets>>,
    Assert<Equal<Awaited<ReturnType<typeof api.getRecoveryState>>, RecoveryState>>,
    Assert<Equal<Awaited<ReturnType<typeof api.listFacebookPages>>, FacebookPageChoices>>,
    Assert<Equal<MediaListOptions['view'], 'library' | 'trash' | undefined>>,
    Assert<
        Equal<
            PublicationListSort,
            | 'queue'
            | 'updated_desc'
            | 'updated_asc'
            | 'created_desc'
            | 'created_asc'
            | 'scheduled_desc'
            | 'scheduled_asc'
        >
    >,
]

/** No schema extraction may silently degrade a request body or query to unknown/any. */
type UntypedRequestContracts = {
    [Key in keyof WebApiRequests]: unknown extends WebApiRequests[Key] ? Key : never
}[keyof WebApiRequests]
export type InferredApplicationRequestContracts = Assert<Equal<UntypedRequestContracts, never>>
