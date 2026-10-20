import type { PublicationRepliesResponse } from '@postbot/client'
import {
    createPostbotClient,
    type SearchResponse,
    type EmailSettings,
    type EmailSettingsInput,
    type AuditEvent,
    type Channel,
    type ChannelListItem,
    type ChannelProfileActivation,
    type ChannelProfileAssessment,
    type ChannelProfilePreset,
    type ChannelProfilePresets,
    type ChannelProfileState,
    type ChannelProfileVersion,
    type DuePublication,
    type BlueskyAnalyticsCollection,
    type DevtoAnalyticsCollection,
    type ProviderAnalyticsItem as ProviderAnalyticsItemContract,
    type MediaDeletion,
    type MediaDeletionBatch,
    type MediaFinalize,
    type MediaReference,
    type MediaReservation,
    type MediaAssetUsage,
    type MediaImportSources,
    type MediaUploadPolicy,
    type MediaUpload,
    type MediaUrlImport,
    type Notification,
    type NotificationInbox,
    type NotificationPreference,
    type Post,
    type PublicationEditorState,
    type PublisherConnection,
    type EmailAlertPreference,
    type Project,
    type Publication,
    type PublicationApprovalRequest,
    type PublicationSummaryPage,
    type ProviderAnalyticsPage,
    type ProjectCategory,
    type ProjectTag,
    type PublicationCommentsResponse,
} from '@postbot/client'

import * as m from '@/paraglide/messages.js'

import { formatChannelLifecycleConflict } from './channel-lifecycle-feedback'

export type { MediaImportSource } from '@postbot/client'
export type PublicationSummary = PublicationSummaryPage['publications'][number]
export type ProviderAnalyticsItem = ProviderAnalyticsItemContract

import type { PublicationComposerDraftContent } from '@/lib/publication-recovery'

const client = createPostbotClient(window.location.origin)

export interface Session {
    readonly user: {
        readonly id: string
        readonly name: string
        readonly email: string
        readonly image?: string | null
    }
    readonly session: {
        readonly id: string
    }
}

export interface MediaListOptions {
    readonly cursor?: string
    readonly limit?: number
    readonly view?: 'library' | 'trash'
    readonly search?: string
    readonly sort?: MediaListSort
    readonly family?: MediaListFamilyFilter
    readonly date?: MediaListDateFilter
}

export type MediaListSort = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'largest' | 'smallest'
export type MediaListFamilyFilter = 'all' | 'image' | 'video' | 'audio' | 'document'
export type MediaListDateFilter = 'all' | 'last_24_hours' | 'last_7_days' | 'last_30_days'

export type PublicationListSort =
    | 'queue'
    | 'updated_desc'
    | 'updated_asc'
    | 'created_desc'
    | 'created_asc'
    | 'scheduled_desc'
    | 'scheduled_asc'

export interface PublicationComposerDraft {
    readonly id: string
    readonly projectId: string
    readonly content: PublicationComposerDraftContent
    readonly revision: number
    readonly createdAt: number
    readonly updatedAt: number
}

export interface MediaListPage {
    readonly media: MediaReference[]
    readonly restorableAssetIds: string[]
    readonly nextCursor: string | null
    readonly total: number
    readonly trashCount: number
    readonly retentionMs: number
}

export type LinkedInConnectionDestination =
    | { readonly type: 'member' }
    | { readonly type: 'organization'; readonly id: string }

export interface RuntimeChannelProfile {
    readonly id: string
    readonly version: number
    readonly profileHash: string
    readonly schemaHash: string
    readonly origin: 'custom'
    readonly contentSchema: unknown
    readonly fieldBindings: unknown
    readonly capabilities: unknown
    readonly execution: unknown
}

/**
 * Authoring input for a new custom channel. Declared identity, origin and
 * version are preserved; fingerprints are always derived on the server and
 * may be omitted (legacy supplied values are replaced).
 */
export interface CustomChannelProfileInput {
    readonly id: string
    readonly version: number
    readonly origin: 'custom'
    readonly profileHash?: string
    readonly schemaHash?: string
    readonly contentSchema: unknown
    readonly fieldBindings: unknown
    readonly capabilities: unknown
    readonly execution: unknown
}

export type ChannelCreationProfile =
    | 'manual-message'
    | 'linkedin'
    | 'bluesky'
    | 'mastodon'
    | 'discord'
    | 'telegram'
    | 'facebook'
    | 'devto'
    | 'x'
    | RuntimeChannelProfile
    | CustomChannelProfileInput

export interface ChannelCreationOutcome {
    readonly created: boolean
    readonly profileIssues: readonly ProfileDefinitionIssue[]
    readonly profileIssueCount: number
}

export type { ChannelProfilePreset, ChannelProfilePresets }

export type CustomHttpAuthentication =
    | { readonly kind: 'none' }
    | { readonly kind: 'bearer' }
    | { readonly kind: 'header'; readonly headerName: string }
    | { readonly kind: 'path' }

export interface FacebookPageChoices {
    readonly pages: readonly {
        readonly id: string
        readonly name: string
        readonly hasPublishTask: boolean
    }[]
    readonly nextCursor: string | null
}
export type ProviderApplicationProvider = 'linkedin' | 'bluesky' | 'x' | 'facebook' | 'instagram'
export type ProviderApplicationState = 'active' | 'disabled'
export type ProviderApplicationOAuthMode = 'loopback' | 'web'

export type AccessInstanceRole = 'admin' | 'member'
export type AccessInstanceMembershipState = 'enabled' | 'disabled'
export type AccessInstanceState = 'claimable' | 'claimed'

export interface InstanceSetupStatus {
    readonly setupAvailable: boolean
}
export type AccessInvitationState = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface AccessInstanceStateRecord {
    readonly id: 'default'
    readonly state: AccessInstanceState
    readonly bootstrapBlocked: boolean
    readonly claimedByUserId: string | null
    readonly claimedAt: number | null
    readonly defaultWorkspaceId: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessInstanceMembership {
    readonly id: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly role: AccessInstanceRole
    readonly state: AccessInstanceMembershipState
    readonly createdAt: number
    readonly updatedAt: number
}

export type AccessInstanceMembershipUpdate = Partial<
    Pick<AccessInstanceMembership, 'role' | 'state'>
>

export interface AccessProjectMembership {
    readonly id: string
    readonly projectId: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly image: string | null
    readonly role: 'owner' | 'editor' | 'viewer'
    readonly state: 'active'
    readonly createdAt: number
    readonly updatedAt: number
}

export type ProjectMemberRole = 'owner' | 'editor' | 'viewer'
export type ProjectInvitationStatus = 'pending' | 'accepted' | 'rejected' | 'canceled'

export interface ProjectMember {
    readonly id: string
    readonly projectId: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly image: string | null
    readonly role: ProjectMemberRole
    readonly state: 'active'
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ProjectInvitation {
    readonly id: string
    readonly email: string
    readonly role: ProjectMemberRole
    readonly organizationId: string
    readonly inviterId: string
    readonly status: ProjectInvitationStatus
    readonly expiresAt: number
    readonly createdAt: number
}

export type WorkspaceRole = 'owner' | 'admin' | 'member'

export interface WorkspaceListItem {
    readonly id: string
    readonly name: string
    readonly slug: string
    readonly isDefault: boolean
    readonly role: WorkspaceRole
    readonly createdAt: number
    readonly updatedAt: number
}

export interface WorkspaceListResponse {
    readonly workspaces: WorkspaceListItem[]
    readonly canCreateWorkspace: boolean
}

export interface WorkspaceMember {
    readonly id: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly image: string | null
    readonly role: string
    readonly createdAt: number
}

export interface WorkspaceTeam {
    readonly id: string
    readonly name: string
    readonly memberCount: number
    readonly isDefault: boolean
    readonly createdAt: number
    readonly updatedAt: number
}

export interface WorkspaceTeamMember {
    readonly id: string
    readonly teamId: string
    readonly userId: string
    readonly createdAt: number
}

export interface WorkspaceInvitation {
    readonly id: string
    readonly email: string
    readonly role: string
    readonly teamId?: string
    readonly inviterId: string
    readonly status: ProjectInvitationStatus
    readonly expiresAt: number
    readonly createdAt: number
}

export interface WorkspaceSummary {
    readonly workspace: {
        readonly id: string
        readonly name: string
        readonly slug: string
        readonly isDefault: boolean
        readonly createdAt: number
        readonly updatedAt: number
    }
    readonly membership: { readonly role: WorkspaceRole }
    readonly members: WorkspaceMember[]
    readonly teams: WorkspaceTeam[]
}

export interface ProjectUserGrant {
    readonly id: string
    readonly projectId: string
    readonly userId: string
    readonly role: ProjectMemberRole
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ProjectTeamGrant {
    readonly id: string
    readonly projectId: string
    readonly teamId: string
    readonly teamName: string
    readonly role: ProjectMemberRole
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessInvitation {
    readonly id: string
    readonly targetEmail: string
    readonly instanceRole: 'member'
    readonly state: AccessInvitationState
    readonly createdByUserId: string
    readonly expiresAt: number
    readonly acceptedAt: number | null
    readonly acceptedByUserId: string | null
    readonly revokedAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessSummary {
    readonly instance: AccessInstanceStateRecord
    readonly membership: AccessInstanceMembership | null
    readonly isAdmin: boolean
}

export interface CreatedAccessInvitation {
    readonly invitation: AccessInvitation
    readonly token: string
}

export interface AccessInvitationPreview {
    readonly targetEmail: string
    readonly expiresAt: number
}

export interface ProviderApplication {
    readonly id: string
    readonly providerId: ProviderApplicationProvider
    readonly name: string
    readonly clientId: string | null
    readonly clientMetadataUrl: string | null
    readonly handleResolver: string | null
    readonly oauthMode: ProviderApplicationOAuthMode | null
    readonly state: ProviderApplicationState
    readonly isDefault: boolean
    readonly createdByUserId: string
    readonly hasClientSecret: boolean
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ProviderApplicationInput {
    readonly providerId: ProviderApplicationProvider
    readonly name: string
    readonly clientId?: string | null
    readonly clientMetadataUrl?: string | null
    readonly handleResolver?: string | null
    readonly clientSecret?: string | null
    readonly state?: ProviderApplicationState
    readonly isDefault?: boolean
}

export type UserApiKeyCapability =
    | 'project:read'
    | 'publication:manage'
    | 'publication:dispatch'
    | 'channel:manage'
    | 'media:manage'
    | 'analytics:refresh'
    | 'media:permanently_delete'

export interface UserApiKey {
    readonly id: string
    readonly name: string
    readonly tokenPrefix: string
    readonly projectAccess: 'all' | string[]
    readonly actionAccess: 'all' | UserApiKeyCapability[]
    readonly expiresAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

export type ChannelLifecycleBlocker =
    | 'active_work'
    | 'pending_authorization'
    | 'publications'
    | 'publisher'
    | 'must_be_archived'

export interface ProfileDefinitionIssue {
    readonly code: string
    readonly path: string
}

export class ApiError extends Error {
    readonly status: number
    readonly code: string
    readonly blockers: readonly string[]

    constructor(
        status: number,
        code: string,
        message: string,
        blockers: readonly string[] = [],
        readonly profileIssues: readonly ProfileDefinitionIssue[] = [],
        readonly profileIssueCount: number = profileIssues.length
    ) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.blockers = blockers
    }
}

function errorFrom(status: number, value: unknown) {
    const envelope =
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
    const payload =
        envelope?.value !== null && typeof envelope?.value === 'object'
            ? (envelope.value as Record<string, unknown>)
            : envelope
    const details =
        payload?.error !== null && typeof payload?.error === 'object'
            ? (payload.error as Record<string, unknown>)
            : payload
    const blockers = Array.isArray(details?.blockers)
        ? details.blockers.filter((blocker): blocker is string => typeof blocker === 'string')
        : []
    return new ApiError(
        status,
        typeof details?.code === 'string' ? details.code : 'request_failed',
        typeof details?.message === 'string' ? details.message : '',
        blockers,
        Array.isArray(details?.issues)
            ? details.issues
                  .filter(
                      (issue): issue is ProfileDefinitionIssue =>
                          typeof issue === 'object' &&
                          issue !== null &&
                          typeof issue.code === 'string' &&
                          typeof issue.path === 'string' &&
                          issue.path.length <= 512
                  )
                  .slice(0, 20)
            : [],
        typeof details?.issueCount === 'number' &&
            Number.isSafeInteger(details.issueCount) &&
            details.issueCount > 0
            ? details.issueCount
            : 0
    )
}

async function requestAuth<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        credentials: 'same-origin',
        ...init,
        headers: {
            ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...init?.headers,
        },
    })
    const body = (await response.json().catch(() => null)) as unknown

    if (!response.ok) throw errorFrom(response.status, body)
    return body as T
}

function jsonBody(value: unknown, method: 'POST' | 'PATCH' = 'POST'): RequestInit {
    return { method, body: JSON.stringify(value) }
}

function unwrap<T>(result: {
    readonly data: unknown
    readonly error: unknown
    readonly status: number
}): T {
    if (result.error !== null) throw errorFrom(result.status, result.error)
    if (result.data === null) throw new ApiError(result.status, 'empty_response', '')
    return result.data as T
}

export interface RecoveryState {
    held: boolean
    hold: {
        version: 1
        token: string
        createdAt: string
        reason: 'restore' | 'external_restore'
    } | null
}

export const api = {
    async getRecoveryStatus() {
        return unwrap<{ held: boolean }>(await client.api.recovery.status.get())
    },
    async getRecoveryState() {
        return unwrap<RecoveryState>(await client.api.settings.recovery.get())
    },
    async resumeAfterRestore(token: string) {
        return unwrap<RecoveryState>(
            await client.api.settings.recovery.resume.post({ token, confirm: true })
        )
    },
    async getEmailSettings(): Promise<EmailSettings> {
        return unwrap<EmailSettings>(await client.api.settings.email.get())
    },
    async saveEmailSettings(input: EmailSettingsInput): Promise<EmailSettings> {
        return unwrap<EmailSettings>(await client.api.settings.email.put(input))
    },
    async testEmailSettings() {
        return unwrap<{ accepted: true }>(await client.api.settings.email.test.post())
    },
    getInstanceSetupStatus(): Promise<InstanceSetupStatus> {
        return requestAuth<InstanceSetupStatus>('/api/instance/status')
    },

    getSession(): Promise<Session | null> {
        return requestAuth<Session | null>('/api/auth/get-session')
    },

    signIn(email: string, password: string): Promise<Session> {
        return requestAuth<Session>('/api/auth/sign-in/email', jsonBody({ email, password }))
    },

    signUp(name: string, email: string, password: string): Promise<Session> {
        return requestAuth<Session>('/api/auth/sign-up/email', jsonBody({ name, email, password }))
    },

    sendAccountEmailVerification(email: string): Promise<{ status: boolean }> {
        return requestAuth<{ status: boolean }>(
            '/api/auth/send-verification-email',
            jsonBody({ email, callbackURL: window.location.href })
        )
    },

    requestPasswordReset(email: string, redirectTo: string): Promise<{ status: boolean }> {
        return requestAuth<{ status: boolean }>(
            '/api/auth/request-password-reset',
            jsonBody({ email, redirectTo })
        )
    },

    resetPassword(token: string, newPassword: string): Promise<{ status: boolean }> {
        return requestAuth<{ status: boolean }>(
            '/api/auth/reset-password',
            jsonBody({ token, newPassword })
        )
    },

    updateProfile(name: string): Promise<{ status: boolean }> {
        return requestAuth('/api/auth/update-user', jsonBody({ name: name.trim() }))
    },

    changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
        return requestAuth(
            '/api/auth/change-password',
            jsonBody({ currentPassword, newPassword, revokeOtherSessions: true })
        )
    },

    uploadAvatar(file: File): Promise<{ image: string }> {
        return requestAuth('/api/account/avatar', {
            method: 'POST',
            body: file,
            headers: { 'content-type': file.type || 'application/octet-stream' },
        })
    },

    removeAvatar(): Promise<{ success: boolean }> {
        return requestAuth('/api/account/avatar', { method: 'DELETE' })
    },

    signOut(): Promise<unknown> {
        return requestAuth('/api/auth/sign-out', jsonBody({}))
    },

    async listProviderApplications(): Promise<{
        applications: ProviderApplication[]
        xCallbackUri: string
        facebookCallbackUri: string
        instagramCallbackUri: string
    }> {
        return requestAuth<{
            applications: ProviderApplication[]
            xCallbackUri: string
            facebookCallbackUri: string
            instagramCallbackUri: string
        }>('/api/settings/provider-applications')
    },

    listChannelProfilePresets(): Promise<ChannelProfilePresets> {
        return requestAuth<ChannelProfilePresets>('/api/channel-profile-presets')
    },

    async createProviderApplication(
        input: ProviderApplicationInput
    ): Promise<{ application: ProviderApplication }> {
        return requestAuth<{ application: ProviderApplication }>(
            '/api/settings/provider-applications',
            jsonBody(input)
        )
    },

    async updateProviderApplication(
        applicationId: string,
        input: Partial<Omit<ProviderApplicationInput, 'providerId'>>
    ): Promise<{ application: ProviderApplication }> {
        return requestAuth<{ application: ProviderApplication }>(
            `/api/settings/provider-applications/${encodeURIComponent(applicationId)}`,
            jsonBody(input, 'PATCH')
        )
    },

    async getInstanceAccess(): Promise<AccessSummary> {
        return requestAuth<AccessSummary>('/api/access')
    },

    async listAccessMembers(): Promise<{ members: AccessInstanceMembership[] }> {
        return requestAuth<{ members: AccessInstanceMembership[] }>('/api/access/members')
    },

    async updateAccessMember(
        userId: string,
        input: AccessInstanceMembershipUpdate
    ): Promise<{ membership: AccessInstanceMembership }> {
        return requestAuth<{ membership: AccessInstanceMembership }>(
            `/api/access/members/${encodeURIComponent(userId)}`,
            jsonBody(input, 'PATCH')
        )
    },

    async listAccessInvitations(): Promise<{ invitations: AccessInvitation[] }> {
        return requestAuth<{ invitations: AccessInvitation[] }>('/api/access/invitations')
    },

    async createAccessInvitation(targetEmail: string): Promise<CreatedAccessInvitation> {
        return requestAuth<CreatedAccessInvitation>(
            '/api/access/invitations',
            jsonBody({ targetEmail })
        )
    },

    getAccessInvitationPreview(token: string): Promise<AccessInvitationPreview> {
        return requestAuth<AccessInvitationPreview>(
            `/api/access/invitations/${encodeURIComponent(token)}`
        )
    },

    async revokeAccessInvitation(invitationId: string): Promise<{ invitation: AccessInvitation }> {
        return requestAuth<{ invitation: AccessInvitation }>(
            `/api/access/invitations/${encodeURIComponent(invitationId)}`,
            { method: 'DELETE' }
        )
    },

    async acceptAccessInvitation(token: string): Promise<{
        invitation: AccessInvitation
        instanceMembership: AccessInstanceMembership
    }> {
        return requestAuth<{
            invitation: AccessInvitation
            instanceMembership: AccessInstanceMembership
        }>('/api/access/invitations/accept', jsonBody({ token }))
    },

    async search(query: string, projectId?: string) {
        const result = await client.api.search.get({
            query: { q: query, ...(projectId === undefined ? {} : { projectId }) },
        })
        return unwrap<SearchResponse>(result)
    },

    async listProjects(): Promise<{ projects: Project[] }> {
        return unwrap<{ projects: Project[] }>(await client.api.projects.get())
    },

    async createProject(
        name: string,
        timeZone?: string,
        workspaceId?: string
    ): Promise<{ project: Project }> {
        return unwrap<{ project: Project }>(
            await client.api.projects.post({
                name,
                ...(timeZone === undefined ? {} : { timeZone }),
                ...(workspaceId === undefined ? {} : { workspaceId }),
            })
        )
    },

    async updateProjectTimeZone(projectId: string, timeZone: string): Promise<Project> {
        return unwrap<Project>(await client.api.projects({ projectId }).patch({ timeZone }))
    },

    async listCategories(options: { includeArchived?: boolean } = {}): Promise<{
        categories: ProjectCategory[]
    }> {
        return unwrap<{ categories: ProjectCategory[] }>(
            await client.api.categories.get({ query: options })
        )
    },

    async setProjectPrimaryCategory(
        projectId: string,
        categoryId: string | null
    ): Promise<Project> {
        return unwrap<Project>(
            await client.api.projects({ projectId }).category.patch({ categoryId })
        )
    },

    async listProjectTags(
        projectId: string,
        options: { includeArchived?: boolean } = {}
    ): Promise<{ tags: ProjectTag[] }> {
        return unwrap<{ tags: ProjectTag[] }>(
            await client.api.projects({ projectId }).tags.get({ query: options })
        )
    },

    async createProjectTag(projectId: string, name: string): Promise<{ tag: ProjectTag }> {
        return unwrap<{ tag: ProjectTag }>(
            await client.api.projects({ projectId }).tags.post({ name })
        )
    },

    async renameProjectTag(
        projectId: string,
        tagId: string,
        name: string
    ): Promise<{ tag: ProjectTag }> {
        return unwrap<{ tag: ProjectTag }>(
            await client.api.projects({ projectId }).tags({ tagId }).patch({ name })
        )
    },

    async archiveProjectTag(projectId: string, tagId: string): Promise<{ tag: ProjectTag }> {
        return unwrap<{ tag: ProjectTag }>(
            await client.api.projects({ projectId }).tags({ tagId }).archive.post()
        )
    },

    async restoreProjectTag(projectId: string, tagId: string): Promise<{ tag: ProjectTag }> {
        return unwrap<{ tag: ProjectTag }>(
            await client.api.projects({ projectId }).tags({ tagId }).restore.post()
        )
    },

    async getPublicationReplies(
        projectId: string,
        publicationId: string,
        before?: string
    ): Promise<PublicationRepliesResponse> {
        return unwrap<PublicationRepliesResponse>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .comments.replies.get({ query: { before } })
        )
    },
    async sendPublicationReply(
        projectId: string,
        publicationId: string,
        body: { requestId: string; parentUri: string; text: string }
    ): Promise<PublicationRepliesResponse> {
        return unwrap<PublicationRepliesResponse>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .comments.replies.post(body)
        )
    },
    async getPublicationComments(
        projectId: string,
        publicationId: string
    ): Promise<PublicationCommentsResponse> {
        return unwrap<PublicationCommentsResponse>(
            await client.api.projects({ projectId }).publications({ publicationId }).comments.get()
        )
    },
    async refreshPublicationComments(
        projectId: string,
        publicationId: string
    ): Promise<PublicationCommentsResponse> {
        return unwrap<PublicationCommentsResponse>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .comments.refresh.post({})
        )
    },

    async listPublicationTags(
        projectId: string,
        publicationId: string,
        options: { includeArchived?: boolean } = {}
    ): Promise<{ tags: ProjectTag[] }> {
        return unwrap<{ tags: ProjectTag[] }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .tags.get({ query: options })
        )
    },

    async replacePublicationTags(
        projectId: string,
        publicationId: string,
        tagIds: readonly string[]
    ): Promise<{ tags: ProjectTag[] }> {
        return unwrap<{ tags: ProjectTag[] }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .tags.put({ tagIds: [...tagIds] })
        )
    },

    async listUserApiKeys(): Promise<{ keys: UserApiKey[] }> {
        return requestAuth<{ keys: UserApiKey[] }>('/api/api-keys')
    },

    async createUserApiKey(
        name: string | undefined,
        projectIds: readonly string[] | null,
        expiresAt?: number | null,
        actionAccess?: readonly UserApiKeyCapability[] | null
    ): Promise<{ key: UserApiKey; token: string }> {
        return requestAuth<{ key: UserApiKey; token: string }>(
            '/api/api-keys',
            jsonBody({
                ...(name === undefined ? {} : { name }),
                projectIds: projectIds === null ? null : [...projectIds],
                actionAccess: actionAccess == null ? null : [...actionAccess],
                ...(expiresAt === undefined ? {} : { expiresAt }),
            })
        )
    },

    async updateUserApiKey(
        keyId: string,
        input: {
            readonly name?: string
            readonly projectIds?: readonly string[] | null
            readonly expiresAt?: number | null
            readonly actionAccess?: readonly UserApiKeyCapability[] | null
        }
    ): Promise<{ key: UserApiKey }> {
        return requestAuth<{ key: UserApiKey }>(
            `/api/api-keys/${encodeURIComponent(keyId)}`,
            jsonBody(
                {
                    ...input,
                    ...(input.projectIds === undefined
                        ? {}
                        : { projectIds: input.projectIds === null ? null : [...input.projectIds] }),
                    ...(input.actionAccess === undefined
                        ? {}
                        : {
                              actionAccess:
                                  input.actionAccess === null ? null : [...input.actionAccess],
                          }),
                },
                'PATCH'
            )
        )
    },

    async revokeUserApiKey(keyId: string): Promise<{ deleted: true }> {
        return requestAuth<{ deleted: true }>(`/api/api-keys/${encodeURIComponent(keyId)}`, {
            method: 'DELETE',
        })
    },

    async listProjectMembers(projectId: string): Promise<{
        members: ProjectMember[]
        total: number
    }> {
        return requestAuth<{ members: ProjectMember[]; total: number }>(
            `/api/projects/${encodeURIComponent(projectId)}/members`
        )
    },

    async getProjectMembership(projectId: string): Promise<{ membership: ProjectMember }> {
        return requestAuth<{ membership: ProjectMember }>(
            `/api/projects/${encodeURIComponent(projectId)}/membership`
        )
    },

    async listWorkspaces(): Promise<WorkspaceListResponse> {
        return requestAuth<WorkspaceListResponse>('/api/workspaces')
    },

    async createWorkspace(name: string): Promise<{ workspace: WorkspaceListItem }> {
        return requestAuth<{ workspace: WorkspaceListItem }>('/api/workspaces', jsonBody({ name }))
    },

    async getWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
        return requestAuth<WorkspaceSummary>(`/api/workspaces/${encodeURIComponent(workspaceId)}`)
    },

    async updateWorkspaceMemberRole(
        workspaceId: string,
        memberId: string,
        role: Exclude<WorkspaceRole, 'owner'>
    ): Promise<{ member: WorkspaceMember }> {
        return requestAuth<{ member: WorkspaceMember }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
            jsonBody({ role }, 'PATCH')
        )
    },

    async removeWorkspaceMember(workspaceId: string, memberId: string): Promise<{ removed: true }> {
        return requestAuth<{ removed: true }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
            { method: 'DELETE' }
        )
    },

    async createWorkspaceTeam(workspaceId: string, name: string): Promise<{ team: WorkspaceTeam }> {
        return requestAuth<{ team: WorkspaceTeam }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/teams`,
            jsonBody({ name })
        )
    },

    async renameWorkspaceTeam(
        workspaceId: string,
        teamId: string,
        name: string
    ): Promise<{ team: WorkspaceTeam }> {
        return requestAuth<{ team: WorkspaceTeam }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(teamId)}`,
            jsonBody({ name }, 'PATCH')
        )
    },

    async listWorkspaceTeamMembers(
        workspaceId: string,
        teamId: string
    ): Promise<{ members: WorkspaceTeamMember[] }> {
        return requestAuth<{ members: WorkspaceTeamMember[] }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(teamId)}/members`
        )
    },

    async addWorkspaceTeamMember(
        workspaceId: string,
        teamId: string,
        userId: string
    ): Promise<{ member: WorkspaceTeamMember }> {
        return requestAuth<{ member: WorkspaceTeamMember }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(teamId)}/members`,
            jsonBody({ userId })
        )
    },

    async removeWorkspaceTeamMember(
        workspaceId: string,
        teamId: string,
        userId: string
    ): Promise<{ removed: true }> {
        return requestAuth<{ removed: true }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
            { method: 'DELETE' }
        )
    },

    async listWorkspaceInvitations(workspaceId: string): Promise<{
        invitations: WorkspaceInvitation[]
    }> {
        return requestAuth<{ invitations: WorkspaceInvitation[] }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/invitations`
        )
    },

    async createWorkspaceInvitation(
        workspaceId: string,
        email: string,
        teamId: string
    ): Promise<{ invitation: WorkspaceInvitation }> {
        return requestAuth<{ invitation: WorkspaceInvitation }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
            jsonBody({ email, teamId })
        )
    },

    async cancelWorkspaceInvitation(
        workspaceId: string,
        invitationId: string
    ): Promise<{ invitation: WorkspaceInvitation }> {
        return requestAuth<{ invitation: WorkspaceInvitation }>(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
            { method: 'DELETE' }
        )
    },

    async listProjectUserGrants(projectId: string): Promise<{ grants: ProjectUserGrant[] }> {
        return requestAuth<{ grants: ProjectUserGrant[] }>(
            `/api/projects/${encodeURIComponent(projectId)}/user-grants`
        )
    },

    async createProjectUserGrant(
        projectId: string,
        userId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ): Promise<{ grant: ProjectUserGrant }> {
        return requestAuth<{ grant: ProjectUserGrant }>(
            `/api/projects/${encodeURIComponent(projectId)}/user-grants`,
            jsonBody({ userId, role })
        )
    },

    async updateProjectUserGrant(
        projectId: string,
        userId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ): Promise<{ grant: ProjectUserGrant }> {
        return requestAuth<{ grant: ProjectUserGrant }>(
            `/api/projects/${encodeURIComponent(projectId)}/user-grants/${encodeURIComponent(userId)}`,
            jsonBody({ role }, 'PATCH')
        )
    },

    async removeProjectUserGrant(projectId: string, userId: string): Promise<{ removed: true }> {
        return requestAuth<{ removed: true }>(
            `/api/projects/${encodeURIComponent(projectId)}/user-grants/${encodeURIComponent(userId)}`,
            { method: 'DELETE' }
        )
    },

    async listProjectTeamGrants(projectId: string): Promise<{ grants: ProjectTeamGrant[] }> {
        return requestAuth<{ grants: ProjectTeamGrant[] }>(
            `/api/projects/${encodeURIComponent(projectId)}/team-grants`
        )
    },

    async createProjectTeamGrant(
        projectId: string,
        teamId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ): Promise<{ grant: ProjectTeamGrant }> {
        return requestAuth<{ grant: ProjectTeamGrant }>(
            `/api/projects/${encodeURIComponent(projectId)}/team-grants`,
            jsonBody({ teamId, role })
        )
    },

    async updateProjectTeamGrant(
        projectId: string,
        teamId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ): Promise<{ grant: ProjectTeamGrant }> {
        return requestAuth<{ grant: ProjectTeamGrant }>(
            `/api/projects/${encodeURIComponent(projectId)}/team-grants/${encodeURIComponent(teamId)}`,
            jsonBody({ role }, 'PATCH')
        )
    },

    async removeProjectTeamGrant(projectId: string, teamId: string): Promise<{ removed: true }> {
        return requestAuth<{ removed: true }>(
            `/api/projects/${encodeURIComponent(projectId)}/team-grants/${encodeURIComponent(teamId)}`,
            { method: 'DELETE' }
        )
    },

    async listProjectInvitations(projectId: string): Promise<{
        invitations: ProjectInvitation[]
    }> {
        return requestAuth<{ invitations: ProjectInvitation[] }>(
            `/api/projects/${encodeURIComponent(projectId)}/invitations`
        )
    },

    async createProjectInvitation(
        projectId: string,
        email: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ): Promise<{ invitation: ProjectInvitation }> {
        return requestAuth<{ invitation: ProjectInvitation }>(
            `/api/projects/${encodeURIComponent(projectId)}/invitations`,
            jsonBody({ email, role })
        )
    },

    async cancelProjectInvitation(
        projectId: string,
        invitationId: string
    ): Promise<{ invitation: ProjectInvitation }> {
        return requestAuth<{ invitation: ProjectInvitation }>(
            `/api/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(invitationId)}`,
            { method: 'DELETE' }
        )
    },

    async resendProjectInvitation(
        projectId: string,
        invitationId: string
    ): Promise<{ invitation: ProjectInvitation }> {
        return requestAuth<{ invitation: ProjectInvitation }>(
            `/api/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
            { method: 'POST' }
        )
    },

    async updateProjectMember(
        projectId: string,
        memberId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ): Promise<{ membership: ProjectMember }> {
        return requestAuth<{ membership: ProjectMember }>(
            `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`,
            jsonBody({ role }, 'PATCH')
        )
    },

    async removeProjectMember(projectId: string, memberId: string): Promise<{ removed: true }> {
        return requestAuth<{ removed: true }>(
            `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`,
            { method: 'DELETE' }
        )
    },

    async acceptOrganizationInvitation(invitationId: string): Promise<unknown> {
        return requestAuth('/api/auth/organization/accept-invitation', jsonBody({ invitationId }))
    },

    async acceptProjectInvitation(invitationId: string): Promise<unknown> {
        return this.acceptOrganizationInvitation(invitationId)
    },

    async listChannels(projectId: string): Promise<{ channels: ChannelListItem[] }> {
        return unwrap<{ channels: ChannelListItem[] }>(
            await client.api.projects({ projectId }).channels.get()
        )
    },

    async listMedia(projectId: string, options: MediaListOptions = {}): Promise<MediaListPage> {
        return unwrap<MediaListPage>(
            await client.api.projects({ projectId }).media.get({ query: options })
        )
    },

    async getMediaUploadPolicy(projectId: string): Promise<MediaUploadPolicy> {
        return unwrap<MediaUploadPolicy>(
            await client.api.projects({ projectId }).media['upload-policy'].get()
        )
    },

    async getMediaImportSources(projectId: string): Promise<MediaImportSources> {
        return unwrap<MediaImportSources>(
            await client.api.projects({ projectId }).media.sources.get()
        )
    },

    async getMedia(projectId: string, assetId: string): Promise<MediaReference> {
        return unwrap<MediaReference>(
            await client.api.projects({ projectId }).media({ assetId }).get()
        )
    },

    async getMediaUsage(projectId: string, assetId: string): Promise<MediaAssetUsage> {
        return requestAuth<MediaAssetUsage>(
            `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/usage`
        )
    },

    async deleteMedia(projectId: string, assetId: string): Promise<MediaDeletion> {
        return requestAuth<MediaDeletion>(
            `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}`,
            { method: 'DELETE' }
        )
    },

    async permanentlyDeleteMedia(
        projectId: string,
        assetId: string
    ): Promise<'deleted' | 'cleanup_pending'> {
        const response = await requestAuth<{
            readonly status: 'deleted' | 'cleanup_pending'
        }>(
            `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/permanent`,
            { method: 'POST' }
        )
        return response.status
    },

    async restoreMedia(projectId: string, assetId: string): Promise<void> {
        await requestAuth<{ readonly status: 'restored'; readonly media: MediaReference }>(
            `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/restore`,
            { method: 'POST' }
        )
    },

    async deleteMediaBatch(
        projectId: string,
        assetIds: readonly string[]
    ): Promise<MediaDeletionBatch> {
        return requestAuth<MediaDeletionBatch>(
            `/api/projects/${encodeURIComponent(projectId)}/media/deletion-requests`,
            jsonBody({ assetIds })
        )
    },

    async reserveMediaUpload(
        projectId: string,
        input: {
            originalFilename: string
            defaultAccessibilityText?: string
            expectedSize?: number
            contentType?: string
        }
    ): Promise<MediaReservation> {
        return unwrap<MediaReservation>(
            await client.api.projects({ projectId }).media.uploads.post(input)
        )
    },

    async importMediaFromUrl(projectId: string, url: string): Promise<MediaUrlImport> {
        return requestAuth<MediaUrlImport>(
            `/api/projects/${encodeURIComponent(projectId)}/media/imports/url`,
            jsonBody({ url })
        )
    },

    async uploadMedia(projectId: string, intentId: string, file: Blob): Promise<MediaUpload> {
        return requestAuth<MediaUpload>(
            `/api/projects/${encodeURIComponent(projectId)}/media/uploads/${encodeURIComponent(intentId)}`,
            {
                method: 'PUT',
                body: file,
                headers: {
                    'content-type': file.type || 'application/octet-stream',
                },
            }
        )
    },

    async finalizeMediaUpload(
        projectId: string,
        intentId: string
    ): Promise<MediaFinalize | { status: 'pending'; media: MediaReservation }> {
        return unwrap<MediaFinalize | { status: 'pending'; media: MediaReservation }>(
            await client.api.projects({ projectId }).media.uploads({ intentId }).finalize.post()
        )
    },

    mediaContentUrl(projectId: string, assetId: string, variant?: 'thumbnail' | 'preview'): string {
        return `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/content${variant === undefined ? '' : `?variant=${variant}`}`
    },

    async getChannelProfileState(
        projectId: string,
        channelId: string
    ): Promise<ChannelProfileState> {
        return unwrap<ChannelProfileState>(
            await client.api.projects({ projectId }).channels({ channelId }).profile.get()
        )
    },

    async saveChannelProfileDraft(
        projectId: string,
        channelId: string,
        profile: Record<string, unknown>,
        expectedRevision?: number
    ): Promise<{ profile: ChannelProfileVersion }> {
        const body = expectedRevision === undefined ? { profile } : { profile, expectedRevision }
        return unwrap<{ profile: ChannelProfileVersion }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                ['profile-drafts'].post(body)
        )
    },

    async previewChannelProfileActivation(
        projectId: string,
        channelId: string,
        profileVersionId: string
    ): Promise<{ assessment: ChannelProfileAssessment }> {
        return unwrap<{ assessment: ChannelProfileAssessment }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                ['profile-drafts']({ profileVersionId })
                .preview.post()
        )
    },

    async activateChannelProfile(
        projectId: string,
        channelId: string,
        profileVersionId: string,
        expectedRevision?: number
    ): Promise<ChannelProfileActivation> {
        return unwrap<ChannelProfileActivation>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                ['profile-drafts']({ profileVersionId })
                .activate.post(expectedRevision === undefined ? {} : { expectedRevision })
        )
    },

    async listPublisherConnections(projectId: string): Promise<{
        connections: PublisherConnection[]
        oauthReadiness: Record<
            ProviderApplicationProvider,
            'ready' | 'not_configured' | 'unavailable'
        >
    }> {
        return unwrap<{
            connections: PublisherConnection[]
            oauthReadiness: Record<
                ProviderApplicationProvider,
                'ready' | 'not_configured' | 'unavailable'
            >
        }>(await client.api.projects({ projectId }).publishers.get())
    },

    async listBlueskyProviderAnalytics(
        projectId: string,
        options: { limit?: number; providerSubjectId?: string; postbotEntityId?: string } = {}
    ): Promise<ProviderAnalyticsPage> {
        return unwrap<ProviderAnalyticsPage>(
            await client.api.projects({ projectId }).analytics.provider.bluesky.get({
                query: options,
            })
        )
    },

    async listDevtoProviderAnalytics(
        projectId: string,
        options: { limit?: number; providerSubjectId?: string; postbotEntityId?: string } = {}
    ): Promise<ProviderAnalyticsPage> {
        return unwrap<ProviderAnalyticsPage>(
            await client.api.projects({ projectId }).analytics.provider.devto.get({
                query: options,
            })
        )
    },

    async listLatestBlueskyProviderAnalytics(
        projectId: string,
        publicationIds: readonly string[]
    ): Promise<ProviderAnalyticsPage> {
        return unwrap<ProviderAnalyticsPage>(
            await client.api.projects({ projectId }).analytics.provider.bluesky.latest.get({
                query: { publicationIds: [...publicationIds] },
            })
        )
    },

    async listLatestDevtoProviderAnalytics(
        projectId: string,
        publicationIds: readonly string[]
    ): Promise<ProviderAnalyticsPage> {
        return unwrap<ProviderAnalyticsPage>(
            await client.api.projects({ projectId }).analytics.provider.devto.latest.get({
                query: { publicationIds: [...publicationIds] },
            })
        )
    },

    async collectBlueskyProviderAnalytics(
        projectId: string,
        channelId: string,
        publicationId: string
    ): Promise<BlueskyAnalyticsCollection> {
        return unwrap<BlueskyAnalyticsCollection>(
            await client.api.projects({ projectId }).analytics.provider.bluesky.collect.post({
                channelId,
                publicationIds: [publicationId],
            })
        )
    },

    async collectDevtoProviderAnalytics(
        projectId: string,
        channelId: string,
        publicationId: string
    ): Promise<DevtoAnalyticsCollection> {
        return unwrap<DevtoAnalyticsCollection>(
            await client.api.projects({ projectId }).analytics.provider.devto.collect.post({
                channelId,
                publicationId,
            })
        )
    },

    async listNotifications(
        projectId: string,
        options: {
            before?: string
            limit?: number
            view?: 'active' | 'all'
        } = {}
    ): Promise<NotificationInbox> {
        return unwrap<NotificationInbox>(
            await client.api.projects({ projectId }).notifications.get({ query: options })
        )
    },

    async listUserNotifications(
        projectId: string | null,
        options: {
            before?: string
            limit?: number
            view?: 'active' | 'all'
        } = {}
    ): Promise<NotificationInbox> {
        return unwrap<NotificationInbox>(
            await client.api.notifications.get({
                query: {
                    ...options,
                    ...(projectId === null ? {} : { projectId }),
                },
            })
        )
    },

    async markNotificationRead(projectId: string, notificationId: string): Promise<Notification> {
        return unwrap<Notification>(
            await client.api.projects({ projectId }).notifications({ notificationId }).read.post()
        )
    },

    async archiveNotification(projectId: string, notificationId: string): Promise<Notification> {
        return unwrap<Notification>(
            await client.api
                .projects({ projectId })
                .notifications({ notificationId })
                .archive.post()
        )
    },

    async markUserNotificationRead(notificationId: string): Promise<Notification> {
        return unwrap<Notification>(await client.api.notifications({ notificationId }).read.post())
    },

    async archiveUserNotification(notificationId: string): Promise<Notification> {
        return unwrap<Notification>(
            await client.api.notifications({ notificationId }).archive.post()
        )
    },

    async listNotificationPreferences(
        projectId: string
    ): Promise<{ preferences: NotificationPreference[] }> {
        return unwrap<{ preferences: NotificationPreference[] }>(
            await client.api.projects({ projectId })['notification-preferences'].get()
        )
    },

    async updateNotificationPreference(
        projectId: string,
        kind: NotificationPreference['kind'],
        inAppEnabled: boolean
    ): Promise<NotificationPreference> {
        return unwrap<NotificationPreference>(
            await client.api
                .projects({ projectId })
                ['notification-preferences']({ kind })
                .patch({ inAppEnabled })
        )
    },

    async getProjectEmailAlerts(projectId: string) {
        return unwrap<EmailAlertPreference>(
            await client.api.projects({ projectId })['email-alerts'].get()
        )
    },
    async setProjectEmailAlerts(projectId: string, enabled: boolean) {
        return unwrap<EmailAlertPreference>(
            await client.api.projects({ projectId })['email-alerts'].patch({ enabled })
        )
    },
    async listUserNotificationPreferences(): Promise<{ preferences: NotificationPreference[] }> {
        return unwrap<{ preferences: NotificationPreference[] }>(
            await client.api['notification-preferences'].get()
        )
    },

    async updateUserNotificationPreference(
        kind: NotificationPreference['kind'],
        inAppEnabled: boolean
    ): Promise<NotificationPreference> {
        return unwrap<NotificationPreference>(
            await client.api['notification-preferences']({ kind }).patch({ inAppEnabled })
        )
    },

    async startFacebookPublisherConnection(
        projectId: string,
        channelId: string,
        providerApplicationId?: string
    ): Promise<{ url: string }> {
        return unwrap<{ url: string }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.facebook.connect.post({ providerApplicationId })
        )
    },
    async listFacebookPages(
        projectId: string,
        channelId: string,
        selection: string,
        after?: string
    ): Promise<FacebookPageChoices> {
        return unwrap<FacebookPageChoices>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.facebook.pages.get({ query: { selection, after } })
        )
    },
    async selectFacebookPage(
        projectId: string,
        channelId: string,
        input: { selection: string; pageId: string; after?: string }
    ): Promise<{ connection: PublisherConnection }> {
        return unwrap<{ connection: PublisherConnection }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.facebook.select.post(input)
        )
    },
    async startLinkedInPublisherConnection(
        projectId: string,
        channelId: string,
        destination?: LinkedInConnectionDestination,
        providerApplicationId?: string
    ): Promise<{ provider: 'linkedin'; scopes: string[]; authorizationUrl: string }> {
        return unwrap<{ provider: 'linkedin'; scopes: string[]; authorizationUrl: string }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.linkedin.connect.post({
                    ...(destination === undefined ? {} : { destination }),
                    ...(providerApplicationId === undefined ? {} : { providerApplicationId }),
                })
        )
    },

    async startBlueskyPublisherConnection(
        projectId: string,
        channelId: string,
        handle: string,
        providerApplicationId?: string
    ): Promise<{ provider: 'bluesky'; scopes: string[]; authorizationUrl: string }> {
        return unwrap<{ provider: 'bluesky'; scopes: string[]; authorizationUrl: string }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.bluesky.connect.post({
                    handle,
                    ...(providerApplicationId === undefined ? {} : { providerApplicationId }),
                })
        )
    },

    async startXPublisherConnection(
        projectId: string,
        channelId: string,
        providerApplicationId?: string
    ): Promise<{ provider: 'x'; scopes: string[]; authorizationUrl: string }> {
        return unwrap<{ provider: 'x'; scopes: string[]; authorizationUrl: string }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.x.connect.post(
                    providerApplicationId === undefined ? {} : { providerApplicationId }
                )
        )
    },

    async startMastodonPublisherConnection(
        projectId: string,
        channelId: string,
        instanceUrl: string
    ): Promise<{ provider: 'mastodon'; scopes: string[]; authorizationUrl: string }> {
        return unwrap<{ provider: 'mastodon'; scopes: string[]; authorizationUrl: string }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.mastodon.connect.post({ instanceUrl })
        )
    },

    async connectDiscordPublisher(
        projectId: string,
        channelId: string,
        input: { botToken: string; channelId: string }
    ): Promise<{ connection: PublisherConnection }> {
        return unwrap<{ connection: PublisherConnection }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.discord.connect.post(input)
        )
    },

    async connectTelegramPublisher(
        projectId: string,
        channelId: string,
        input: { botToken: string; chatReference: string }
    ): Promise<{ connection: PublisherConnection }> {
        return unwrap<{ connection: PublisherConnection }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.telegram.connect.post(input)
        )
    },

    async connectDevtoPublisher(
        projectId: string,
        channelId: string,
        apiKey: string
    ): Promise<{ connection: PublisherConnection }> {
        return unwrap<{ connection: PublisherConnection }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.devto.connect.post({ apiKey })
        )
    },

    async disconnectPublisher(
        projectId: string,
        channelId: string
    ): Promise<{ disconnected: true }> {
        return unwrap<{ disconnected: true }>(
            await client.api.projects({ projectId }).channels({ channelId }).publisher.delete()
        )
    },

    async createChannel(
        projectId: string,
        name: string,
        profile: ChannelCreationProfile = 'manual-message'
    ): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api.projects({ projectId }).channels.post({ name, profile })
        )
    },

    async renameChannel(
        projectId: string,
        channelId: string,
        name: string,
        expectedRevision: number
    ): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .patch({ name, expectedRevision })
        )
    },

    async archiveChannel(
        projectId: string,
        channelId: string,
        expectedRevision: number
    ): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .archive.post({ expectedRevision })
        )
    },

    async restoreChannel(
        projectId: string,
        channelId: string,
        expectedRevision: number
    ): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .restore.post({ expectedRevision })
        )
    },

    async deleteChannel(
        projectId: string,
        channelId: string,
        expectedRevision: number
    ): Promise<{ deleted: true }> {
        return unwrap<{ deleted: true }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .delete({ expectedRevision })
        )
    },

    async connectCustomHttpPublisher(
        projectId: string,
        channelId: string,
        input: {
            endpointUrl: string
            authentication: CustomHttpAuthentication
            externalAccountName?: string | null
            secret: string
        }
    ): Promise<{ connection: PublisherConnection }> {
        return unwrap<{ connection: PublisherConnection }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher['custom-http'].connect.post(input)
        )
    },

    async getPost(projectId: string, postId: string): Promise<{ post: Post }> {
        return unwrap<{ post: Post }>(
            await client.api.projects({ projectId }).posts({ postId }).get()
        )
    },

    async savePostSource(
        projectId: string,
        postId: string,
        input: { expectedSourceRevision: number; sourceContent: Post['sourceContent'] }
    ): Promise<{ post: Post }> {
        return unwrap<{ post: Post }>(
            await client.api.projects({ projectId }).posts({ postId }).patch(input)
        )
    },

    async addPostDestinations(
        projectId: string,
        postId: string,
        input: {
            expectedSourceRevision: number
            confirmExistingChannels?: boolean
            publications: Array<{ channelId: string; deliveryMode: 'manual' | 'automatic' }>
        }
    ): Promise<{ post: Post; publications: Publication[] }> {
        return unwrap<{ post: Post; publications: Publication[] }>(
            await client.api.projects({ projectId }).posts({ postId }).destinations.post(input)
        )
    },

    async createPost(
        projectId: string,
        input: {
            title?: string
            sourceContent: PublicationEditorState['post']['sourceContent']
            publications: Array<{
                channelId: string
                targetContent?: Record<string, unknown>
                deliveryMode: 'manual' | 'automatic'
                scheduledAt?: number | null
            }>
        }
    ): Promise<{ post: Post; publications: Publication[] }> {
        return unwrap<{ post: Post; publications: Publication[] }>(
            await client.api.projects({ projectId }).posts.post(input)
        )
    },

    async getPublicationComposerDraft(
        projectId: string
    ): Promise<{ draft: PublicationComposerDraft | null }> {
        return unwrap<{ draft: PublicationComposerDraft | null }>(
            await client.api.projects({ projectId })['publication-composer-draft'].get()
        )
    },

    async savePublicationComposerDraft(
        projectId: string,
        expectedRevision: number,
        content: PublicationComposerDraftContent
    ): Promise<{ draft: PublicationComposerDraft }> {
        return unwrap<{ draft: PublicationComposerDraft }>(
            await client.api
                .projects({ projectId })
                ['publication-composer-draft'].put({ expectedRevision, content })
        )
    },

    async deletePublicationComposerDraft(projectId: string): Promise<{ deleted: boolean }> {
        return unwrap<{ deleted: boolean }>(
            await client.api.projects({ projectId })['publication-composer-draft'].delete()
        )
    },

    async listDuePublications(projectId: string): Promise<{ publications: DuePublication[] }> {
        return unwrap<{ publications: DuePublication[] }>(
            await client.api.projects({ projectId }).publications.due.get()
        )
    },

    async listPublications(
        projectId: string,
        options: {
            tagIds?: readonly string[]
            cursor?: string
            limit?: number
            sort?: PublicationListSort
            state?: 'draft' | 'scheduled'
            from?: number
            to?: number
        } = {}
    ): Promise<PublicationSummaryPage> {
        const query = {
            ...(options.tagIds === undefined || options.tagIds.length === 0
                ? {}
                : { tagIds: [...options.tagIds] }),
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
            ...(options.limit === undefined ? {} : { limit: options.limit }),
            ...(options.sort === undefined ? {} : { sort: options.sort }),
            ...(options.state === undefined ? {} : { state: options.state }),
            ...(options.from === undefined ? {} : { from: options.from }),
            ...(options.to === undefined ? {} : { to: options.to }),
        }
        return unwrap<PublicationSummaryPage>(
            await client.api.projects({ projectId }).publications.get({
                query: Object.keys(query).length === 0 ? undefined : query,
            })
        )
    },

    async listPublicationApprovalRequests(
        projectId: string
    ): Promise<{ requests: PublicationApprovalRequest[] }> {
        return unwrap<{ requests: PublicationApprovalRequest[] }>(
            await client.api.projects({ projectId }).publications['approval-requests'].get()
        )
    },

    async approvePublicationApprovalRequest(
        projectId: string,
        publicationId: string,
        options: { readonly scheduledAt?: number; readonly publishNow?: boolean } = {}
    ): Promise<{ publication: Publication }> {
        const body = {
            ...(options.scheduledAt === undefined ? {} : { scheduledAt: options.scheduledAt }),
            ...(options.publishNow === undefined ? {} : { publishNow: options.publishNow }),
        }
        return unwrap<{ publication: Publication }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                ['approval-request'].approve.post(body)
        )
    },

    async rejectPublicationApprovalRequest(
        projectId: string,
        publicationId: string
    ): Promise<{ request: PublicationApprovalRequest }> {
        return unwrap<{ request: PublicationApprovalRequest }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                ['approval-request'].reject.post({})
        )
    },

    async getPublicationEditor(
        projectId: string,
        publicationId: string
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api.projects({ projectId }).publications({ publicationId }).editor.get()
        )
    },

    async savePublicationDraft(
        projectId: string,
        publicationId: string,
        input: {
            expectedRevision: number
            sourceContent?: PublicationEditorState['post']['sourceContent']
            targetContent?: Record<string, unknown>
        }
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.patch(input)
        )
    },

    async assessPublicationDraftAdoption(
        projectId: string,
        publicationId: string,
        input: DraftProfileAdoptionInput
    ) {
        return unwrap<{ valid: boolean; issues: Record<string, unknown>[] }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft['assess-adoption'].post(input)
        )
    },
    async adoptPublicationDraftProfile(
        projectId: string,
        publicationId: string,
        input: DraftProfileAdoptionInput
    ) {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft['adopt-profile'].post(input)
        )
    },
    async listPublicationDraftAdoptions(projectId: string, publicationId: string) {
        return unwrap<{
            adoptions: {
                id: string
                draft: PublicationEditorState['draft']
                localContent: Record<string, unknown> | null
                adoptedProfileVersionId: string
                targetRevisionId: string
                createdAt: number
            }[]
        }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.adoptions.get()
        )
    },

    async promotePublicationDraft(
        projectId: string,
        publicationId: string,
        expectedRevision: number,
        scheduledAt?: number | null
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.promote.post(
                    scheduledAt === undefined
                        ? { expectedRevision }
                        : { expectedRevision, scheduledAt }
                )
        )
    },

    async reschedulePublications(
        projectId: string,
        publicationIds: readonly string[],
        scheduledAt: number
    ): Promise<{ publications: Publication[] }> {
        return unwrap<{ publications: Publication[] }>(
            await client.api.projects({ projectId }).publications.schedule.patch({
                publicationIds: [...publicationIds],
                scheduledAt,
            })
        )
    },

    async cancelPublications(
        projectId: string,
        publicationIds: readonly string[]
    ): Promise<{ publications: Publication[] }> {
        return unwrap<{ publications: Publication[] }>(
            await client.api.projects({ projectId }).publications.cancel.patch({
                publicationIds: [...publicationIds],
            })
        )
    },

    async deleteDraftPublication(
        projectId: string,
        publicationId: string
    ): Promise<{ deleted: true; postDeleted: boolean }> {
        return unwrap<{ deleted: true; postDeleted: boolean }>(
            await client.api.projects({ projectId }).publications({ publicationId }).delete()
        )
    },

    async duplicateDraftPublication(
        projectId: string,
        publicationId: string
    ): Promise<{ post: Post; publication: Publication }> {
        return unwrap<{ post: Post; publication: Publication }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .duplicate.post({})
        )
    },

    async rebasePublicationDraft(
        projectId: string,
        publicationId: string,
        expectedRevision: number,
        sourceUpdate?: { expectedSourceRevision: number; replaceContent: boolean }
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.rebase.post({ expectedRevision, ...sourceUpdate })
        )
    },

    async publishManualPublication(
        projectId: string,
        publicationId: string,
        externalUrl?: string
    ): Promise<{ publication: Publication }> {
        return unwrap<{ publication: Publication }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .publish.post(externalUrl === undefined ? {} : { externalUrl })
        )
    },

    async retryFailedPublication(
        projectId: string,
        publicationId: string
    ): Promise<{ publication: Publication }> {
        return unwrap<{ publication: Publication }>(
            await client.api.projects({ projectId }).publications({ publicationId }).retry.post({})
        )
    },

    async reconcileAmbiguousPublication(
        projectId: string,
        publicationId: string,
        input: {
            resolution: 'published' | 'failed'
            externalId?: string
            externalUrl?: string
            errorMessage?: string
        }
    ): Promise<{ publication: Publication }> {
        return unwrap<{ publication: Publication }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .reconcile.post(input)
        )
    },

    async listAuditEvents(projectId: string): Promise<{ events: AuditEvent[] }> {
        return unwrap<{ events: AuditEvent[] }>(
            await client.api.projects({ projectId })['audit-events'].get()
        )
    },
}

export type {
    AuditEvent,
    BlueskyAnalyticsCollection,
    Channel,
    ChannelListItem,
    ChannelProfileActivation,
    ChannelProfileAssessment,
    ChannelProfileState,
    ChannelProfileVersion,
    DuePublication,
    DevtoAnalyticsCollection,
    MediaDeletion,
    MediaAssetUsage,
    MediaFinalize,
    MediaReference,
    MediaReservation,
    Post,
    PublicationEditorState,
    PublisherConnection,
    Project,
    ProjectCategory,
    ProjectTag,
    Publication,
    PublicationSummaryPage,
    ProviderAnalyticsPage,
    Notification,
    NotificationInbox,
    NotificationPreference,
} from '@postbot/client'

export function formatApiError(error: unknown): string {
    if (!(error instanceof ApiError)) return m.api_request_failed()
    if (error.code === 'channel_lifecycle_conflict')
        return formatChannelLifecycleConflict(error.blockers)
    const message = apiErrorMessage(error.code)
    if (error.blockers.length === 0) return message

    const labels = error.blockers.map(channelLifecycleBlockerLabel).join(', ')
    return m.api_blockers({ message, blockers: labels })
}

function channelLifecycleBlockerLabel(blocker: string): string {
    if (blocker === 'active_work') return m.api_blocker_active_work()
    if (blocker === 'pending_authorization') return m.api_blocker_pending_authorization()
    if (blocker === 'publications') return m.api_blocker_publications()
    if (blocker === 'publisher') return m.api_blocker_publisher()
    if (blocker === 'must_be_archived') return m.api_blocker_must_be_archived()
    return m.api_validation_issue({ code: blocker })
}

function apiErrorMessage(code: string): string {
    switch (code) {
        case 'empty_response':
            return m.api_empty_response()
        case 'unauthorized':
            return m.api_unauthorized()
        case 'authentication_required':
            return m.api_authentication_required()
        case 'forbidden':
            return m.api_forbidden()
        case 'not_found':
            return m.api_not_found()
        case 'validation_error':
            return m.api_validation_error()
        case 'invalid_input':
            return m.api_invalid_input()
        case 'invalid_transition':
            return m.api_invalid_transition()
        case 'write_conflict':
            return m.api_write_conflict()
        case 'provider_unavailable':
            return m.api_provider_unavailable()
        case 'publisher_exists':
            return m.api_publisher_exists()
        case 'credential_exists':
            return m.api_credential_exists()
        case 'invalid_connection':
            return m.api_invalid_connection()
        case 'invalid_provider_application':
            return m.api_invalid_provider_application()
        case 'invalid_destination':
            return m.api_invalid_destination()
        case 'invalid_token':
            return m.api_invalid_token()
        case 'invalid_api_key':
            return m.api_invalid_api_key()
        case 'invalid_instance':
            return m.api_invalid_instance()
        case 'network_policy_denied':
            return m.api_network_policy_denied()
        case 'unknown_channel':
            return m.api_unknown_channel()
        case 'unsupported_channel':
            return m.api_unsupported_channel()
        case 'insufficient_permissions':
            return m.api_insufficient_permissions()
        case 'publisher_has_active_work':
            return m.api_publisher_has_active_work()
        case 'media_unavailable':
            return m.api_media_unavailable()
        case 'media_in_use':
            return m.api_media_in_use()
        case 'media_url_invalid':
            return m.api_media_url_invalid()
        case 'media_url_unavailable':
            return m.api_media_url_unavailable()
        case 'media_url_redirect':
            return m.api_media_url_redirect()
        case 'media_url_http_error':
            return m.api_media_url_http_error()
        case 'media_url_missing_type':
            return m.api_media_url_missing_type()
        case 'media_url_unsupported_type':
            return m.api_media_url_unsupported_type()
        case 'media_url_too_large':
            return m.api_media_url_too_large()
        case 'media_url_empty':
            return m.api_media_url_empty()
        case 'media_url_upload_failed':
            return m.api_media_url_upload_failed()
        case 'media_storage_unavailable':
        case 'media_storage_failure':
            return m.api_media_storage_unavailable()
        case 'upload_expired':
            return m.api_upload_expired()
        case 'size_mismatch':
            return m.api_size_mismatch()
        case 'provider_failure':
            return m.api_provider_failure()
        case 'rate_limited':
            return m.api_rate_limited()
        case 'internal_error':
            return m.api_internal_error()
        default:
            return m.api_request_failed()
    }
}

export interface DraftProfileAdoptionInput {
    expectedRevision: number
    expectedSourceRevision: number
    expectedProfileVersionId: string
    activeProfileVersionId: string
    targetContent: Record<string, unknown>
    previousLocalContent?: Record<string, unknown>
}

export type { EmailSettings, EmailSettingsInput }
