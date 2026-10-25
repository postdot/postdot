import { providerApi } from '@/providers/api'

import { client, unwrap, ApiError, errorFrom } from './api-transport'
import type { ProfileDefinitionIssue } from './api-transport'
export { ApiError } from './api-transport'
export type { ProfileDefinitionIssue } from './api-transport'
import {
    createAccessInvitationClient,
    type EmailSettings,
    type EmailSettingsInput,
    type WebApiRequests,
    type ChannelProfilePreset,
    type ChannelProfilePresets,
    type ProviderAnalyticsItem as ProviderAnalyticsItemContract,
    type MediaUpload,
    type NotificationPreference,
    type ProjectMemberRole,
    type AccessInstanceMembershipUpdate,
    type UserApiKeyCapability,
    type ProviderApplicationInput,
    type ProviderApplicationUpdateInput,
    type PublicationSummaryPage,
    type WorkspaceRole,
    type PublicationComposerDraftResponse,
    type MediaListOptions,
    type ChannelCreationProfile,
    type DraftProfileAdoptionInput,
} from '@postdot/client'

import * as m from '@/paraglide/messages.js'

import { formatChannelLifecycleConflict } from './channel-lifecycle-feedback'

export type { MediaImportSource } from '@postdot/client'
export type PublicationSummary = PublicationSummaryPage['publications'][number]
export type ProviderAnalyticsItem = ProviderAnalyticsItemContract

export type { PublicationFirstCommentItem, PublicationFirstCommentResponse } from '@postdot/client'

import {
    isPublicationComposerDraftContent,
    type PublicationComposerDraftContent,
} from '@/lib/publication-recovery'

const accessInvitationClient = createAccessInvitationClient(window.location.origin)

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

export type PublicationComposerDraft = Omit<PublicationComposerDraftResponse, 'content'> & {
    readonly content: PublicationComposerDraftContent
}

export interface ChannelCreationOutcome {
    readonly created: boolean
    readonly profileIssues: readonly ProfileDefinitionIssue[]
    readonly profileIssueCount: number
}

export type { ChannelProfilePreset, ChannelProfilePresets }

export type ChannelLifecycleBlocker =
    | 'active_work'
    | 'pending_authorization'
    | 'publications'
    | 'publisher'
    | 'must_be_archived'

type UntypedBoundaryPath =
    | `/api/auth/${string}`
    | '/api/account/avatar'
    | `/api/projects/${string}/media/uploads/${string}`

/** Better Auth passthrough and raw binary transfers have separate transport contracts. */
async function requestBoundary<T>(path: UntypedBoundaryPath, init?: RequestInit): Promise<T> {
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

function parsePublicationComposerDraft(
    draft: Omit<PublicationComposerDraft, 'content'> & { readonly content: unknown }
): PublicationComposerDraft {
    const { content } = draft
    if (!isPublicationComposerDraftContent(content)) {
        throw new ApiError(200, 'invalid_response', '')
    }
    return { ...draft, content }
}

export const api = {
    ...providerApi,
    async getRecoveryStatus() {
        return unwrap(await client.api.recovery.status.get())
    },
    async getRecoveryState() {
        return unwrap(await client.api.settings.recovery.get())
    },
    async resumeAfterRestore(token: string) {
        return unwrap(await client.api.settings.recovery.resume.post({ token, confirm: true }))
    },
    async getEmailSettings() {
        return unwrap(await client.api.settings.email.get())
    },
    async saveEmailSettings(input: EmailSettingsInput) {
        return unwrap(await client.api.settings.email.put(input))
    },
    async testEmailSettings() {
        return unwrap(await client.api.settings.email.test.post())
    },
    async getInstanceSetupStatus() {
        return unwrap(await client.api.instance.status.get())
    },

    getSession() {
        return requestBoundary<Session | null>('/api/auth/get-session')
    },

    signIn(email: string, password: string) {
        return requestBoundary<Session>('/api/auth/sign-in/email', jsonBody({ email, password }))
    },

    signUp(name: string, email: string, password: string) {
        return requestBoundary<Session>(
            '/api/auth/sign-up/email',
            jsonBody({ name, email, password })
        )
    },

    sendAccountEmailVerification(email: string) {
        return requestBoundary<{ status: boolean }>(
            '/api/auth/send-verification-email',
            jsonBody({ email, callbackURL: window.location.href })
        )
    },

    requestPasswordReset(email: string, redirectTo: string) {
        return requestBoundary<{ status: boolean }>(
            '/api/auth/request-password-reset',
            jsonBody({ email, redirectTo })
        )
    },

    resetPassword(token: string, newPassword: string) {
        return requestBoundary<{ status: boolean }>(
            '/api/auth/reset-password',
            jsonBody({ token, newPassword })
        )
    },

    updateProfile(name: string) {
        return requestBoundary('/api/auth/update-user', jsonBody({ name: name.trim() }))
    },

    changePassword(currentPassword: string, newPassword: string) {
        return requestBoundary(
            '/api/auth/change-password',
            jsonBody({ currentPassword, newPassword, revokeOtherSessions: true })
        )
    },

    uploadAvatar(file: File) {
        return requestBoundary<{ image: string }>('/api/account/avatar', {
            method: 'POST',
            body: file,
            headers: { 'content-type': file.type || 'application/octet-stream' },
        })
    },

    async removeAvatar() {
        return unwrap(await client.api.account.avatar.delete())
    },

    signOut() {
        return requestBoundary('/api/auth/sign-out', jsonBody({}))
    },

    async listProviderApplications() {
        return unwrap(await client.api.settings['provider-applications'].get())
    },

    async listChannelProfilePresets() {
        return unwrap(await client.api['channel-profile-presets'].get())
    },

    async createProviderApplication(input: ProviderApplicationInput) {
        return unwrap(await client.api.settings['provider-applications'].post(input))
    },

    async updateProviderApplication(applicationId: string, input: ProviderApplicationUpdateInput) {
        return unwrap(
            await client.api.settings['provider-applications']({ applicationId }).patch(input)
        )
    },

    async getReleaseInfo() {
        return unwrap(await client.api.version.get())
    },

    async getInstanceAccess() {
        return unwrap(await client.api.access.get())
    },

    async listAccessMembers() {
        return unwrap(await client.api.access.members.get())
    },

    async updateAccessMember(userId: string, input: AccessInstanceMembershipUpdate) {
        return unwrap(await client.api.access.members({ userId }).patch(input))
    },

    async listAccessInvitations() {
        return unwrap(await client.api.access.invitations.get())
    },

    async createAccessInvitation(targetEmail: string) {
        return unwrap(await client.api.access.invitations.post({ targetEmail }))
    },

    async getAccessInvitationPreview(token: string) {
        return unwrap(await accessInvitationClient.preview(token))
    },

    async revokeAccessInvitation(invitationId: string) {
        return unwrap(await accessInvitationClient.revoke(invitationId))
    },

    async acceptAccessInvitation(token: string) {
        return unwrap(await client.api.access.invitations.accept.post({ token }))
    },

    async search(query: string, projectId?: string) {
        const result = await client.api.search.get({
            query: { q: query, ...(projectId === undefined ? {} : { projectId }) },
        })
        return unwrap(result)
    },

    async listProjects() {
        return unwrap(await client.api.projects.get())
    },

    async createProject(name: string, timeZone?: string, workspaceId?: string) {
        return unwrap(
            await client.api.projects.post({
                name,
                ...(timeZone === undefined ? {} : { timeZone }),
                ...(workspaceId === undefined ? {} : { workspaceId }),
            })
        )
    },

    async updateProjectTimeZone(projectId: string, timeZone: string) {
        return unwrap(await client.api.projects({ projectId }).patch({ timeZone }))
    },

    async listCategories(options: WebApiRequests['listCategories'] = {}) {
        return unwrap(await client.api.categories.get({ query: options }))
    },

    async setProjectPrimaryCategory(projectId: string, categoryId: string | null) {
        return unwrap(await client.api.projects({ projectId }).category.patch({ categoryId }))
    },

    async listProjectTags(projectId: string, options: WebApiRequests['listProjectTags'] = {}) {
        return unwrap(await client.api.projects({ projectId }).tags.get({ query: options }))
    },

    async createProjectTag(projectId: string, name: string) {
        return unwrap(await client.api.projects({ projectId }).tags.post({ name }))
    },

    async renameProjectTag(projectId: string, tagId: string, name: string) {
        return unwrap(await client.api.projects({ projectId }).tags({ tagId }).patch({ name }))
    },

    async archiveProjectTag(projectId: string, tagId: string) {
        return unwrap(await client.api.projects({ projectId }).tags({ tagId }).archive.post())
    },

    async restoreProjectTag(projectId: string, tagId: string) {
        return unwrap(await client.api.projects({ projectId }).tags({ tagId }).restore.post())
    },

    async getPublicationReplies(projectId: string, publicationId: string, before?: string) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .comments.replies.get({ query: { before } })
        )
    },
    async sendPublicationReply(
        projectId: string,
        publicationId: string,
        body: WebApiRequests['sendPublicationReply']
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .comments.replies.post(body)
        )
    },
    async getPublicationComments(projectId: string, publicationId: string) {
        return unwrap(
            await client.api.projects({ projectId }).publications({ publicationId }).comments.get()
        )
    },
    async refreshPublicationComments(projectId: string, publicationId: string) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .comments.refresh.post({})
        )
    },

    /**
     * The prepared first comment of one native publication, through the typed
     * first-comment route.
     */
    async getPublicationFirstComment(projectId: string, publicationId: string) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                ['first-comment'].get()
        )
    },

    async savePublicationFirstComment(
        projectId: string,
        publicationId: string,
        body: WebApiRequests['savePublicationFirstComment']
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                ['first-comment'].put(body)
        )
    },

    async cancelPublicationFirstComment(
        projectId: string,
        publicationId: string,
        body: WebApiRequests['cancelPublicationFirstComment']
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                ['first-comment'].cancel.post(body)
        )
    },

    async listPublicationTags(
        projectId: string,
        publicationId: string,
        options: WebApiRequests['listPublicationTags'] = {}
    ) {
        return unwrap(
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
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .tags.put({ tagIds: [...tagIds] })
        )
    },

    async listUserApiKeys() {
        return unwrap(await client.api['api-keys'].get())
    },

    async createUserApiKey(
        name: string | undefined,
        projectIds: readonly string[] | null,
        expiresAt?: number | null,
        actionAccess?: readonly UserApiKeyCapability[] | null
    ) {
        return unwrap(
            await client.api['api-keys'].post({
                ...(name === undefined ? {} : { name }),
                projectIds: projectIds === null ? null : [...projectIds],
                actionAccess: actionAccess == null ? null : [...actionAccess],
                ...(expiresAt === undefined ? {} : { expiresAt }),
            })
        )
    },

    async updateUserApiKey(keyId: string, input: WebApiRequests['updateUserApiKey']) {
        const { projectIds, actionAccess, ...rest } = input
        return unwrap(
            await client.api['api-keys']({ keyId }).patch({
                ...rest,
                ...(projectIds === undefined
                    ? {}
                    : { projectIds: projectIds === null ? null : [...projectIds] }),
                ...(actionAccess === undefined
                    ? {}
                    : {
                          actionAccess: actionAccess === null ? null : [...actionAccess],
                      }),
            })
        )
    },

    async revokeUserApiKey(keyId: string) {
        return unwrap(await client.api['api-keys']({ keyId }).delete())
    },

    async listProjectMembers(projectId: string) {
        return unwrap(await client.api.projects({ projectId }).members.get())
    },

    async getProjectMembership(projectId: string) {
        return unwrap(await client.api.projects({ projectId }).membership.get())
    },

    async listWorkspaces() {
        return unwrap(await client.api.workspaces.get())
    },

    async createWorkspace(name: string) {
        return unwrap(await client.api.workspaces.post({ name }))
    },

    async getWorkspace(workspaceId: string) {
        return unwrap(await client.api.workspaces({ workspaceId }).get())
    },

    async updateWorkspaceMemberRole(
        workspaceId: string,
        memberId: string,
        role: Exclude<WorkspaceRole, 'owner'>
    ) {
        return unwrap(
            await client.api.workspaces({ workspaceId }).members({ memberId }).patch({ role })
        )
    },

    async removeWorkspaceMember(workspaceId: string, memberId: string) {
        return unwrap(await client.api.workspaces({ workspaceId }).members({ memberId }).delete())
    },

    async createWorkspaceTeam(workspaceId: string, name: string) {
        return unwrap(await client.api.workspaces({ workspaceId }).teams.post({ name }))
    },

    async renameWorkspaceTeam(workspaceId: string, teamId: string, name: string) {
        return unwrap(
            await client.api.workspaces({ workspaceId }).teams({ teamId }).patch({ name })
        )
    },

    async listWorkspaceTeamMembers(workspaceId: string, teamId: string) {
        return unwrap(await client.api.workspaces({ workspaceId }).teams({ teamId }).members.get())
    },

    async addWorkspaceTeamMember(workspaceId: string, teamId: string, userId: string) {
        return unwrap(
            await client.api.workspaces({ workspaceId }).teams({ teamId }).members.post({ userId })
        )
    },

    async removeWorkspaceTeamMember(workspaceId: string, teamId: string, userId: string) {
        return unwrap(
            await client.api
                .workspaces({ workspaceId })
                .teams({ teamId })
                .members({ userId })
                .delete()
        )
    },

    async listWorkspaceInvitations(workspaceId: string) {
        return unwrap(await client.api.workspaces({ workspaceId }).invitations.get())
    },

    async createWorkspaceInvitation(workspaceId: string, email: string, teamId: string) {
        return unwrap(
            await client.api.workspaces({ workspaceId }).invitations.post({ email, teamId })
        )
    },

    async cancelWorkspaceInvitation(workspaceId: string, invitationId: string) {
        return unwrap(
            await client.api.workspaces({ workspaceId }).invitations({ invitationId }).delete()
        )
    },

    async listProjectUserGrants(projectId: string) {
        return unwrap(await client.api.projects({ projectId })['user-grants'].get())
    },

    async createProjectUserGrant(
        projectId: string,
        userId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ) {
        return unwrap(
            await client.api.projects({ projectId })['user-grants'].post({ userId, role })
        )
    },

    async updateProjectUserGrant(
        projectId: string,
        userId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ) {
        return unwrap(
            await client.api.projects({ projectId })['user-grants']({ userId }).patch({ role })
        )
    },

    async removeProjectUserGrant(projectId: string, userId: string) {
        return unwrap(await client.api.projects({ projectId })['user-grants']({ userId }).delete())
    },

    async listProjectTeamGrants(projectId: string) {
        return unwrap(await client.api.projects({ projectId })['team-grants'].get())
    },

    async createProjectTeamGrant(
        projectId: string,
        teamId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ) {
        return unwrap(
            await client.api.projects({ projectId })['team-grants'].post({ teamId, role })
        )
    },

    async updateProjectTeamGrant(
        projectId: string,
        teamId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ) {
        return unwrap(
            await client.api.projects({ projectId })['team-grants']({ teamId }).patch({ role })
        )
    },

    async removeProjectTeamGrant(projectId: string, teamId: string) {
        return unwrap(await client.api.projects({ projectId })['team-grants']({ teamId }).delete())
    },

    async listProjectInvitations(projectId: string) {
        return unwrap(await client.api.projects({ projectId }).invitations.get())
    },

    async createProjectInvitation(
        projectId: string,
        email: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ) {
        return unwrap(await client.api.projects({ projectId }).invitations.post({ email, role }))
    },

    async cancelProjectInvitation(projectId: string, invitationId: string) {
        return unwrap(
            await client.api.projects({ projectId }).invitations({ invitationId }).delete()
        )
    },

    async resendProjectInvitation(projectId: string, invitationId: string) {
        return unwrap(
            await client.api.projects({ projectId }).invitations({ invitationId }).resend.post()
        )
    },

    async updateProjectMember(
        projectId: string,
        memberId: string,
        role: Exclude<ProjectMemberRole, 'owner'>
    ) {
        return unwrap(
            await client.api.projects({ projectId }).members({ memberId }).patch({ role })
        )
    },

    async removeProjectMember(projectId: string, memberId: string) {
        return unwrap(await client.api.projects({ projectId }).members({ memberId }).delete())
    },

    async acceptOrganizationInvitation(invitationId: string) {
        return requestBoundary(
            '/api/auth/organization/accept-invitation',
            jsonBody({ invitationId })
        )
    },

    async acceptProjectInvitation(invitationId: string) {
        return this.acceptOrganizationInvitation(invitationId)
    },

    async listChannels(projectId: string) {
        return unwrap(await client.api.projects({ projectId }).channels.get())
    },

    async listMedia(projectId: string, options: MediaListOptions = {}) {
        return unwrap(await client.api.projects({ projectId }).media.get({ query: options }))
    },

    async getMediaUploadPolicy(projectId: string) {
        return unwrap(await client.api.projects({ projectId }).media['upload-policy'].get())
    },

    async getMediaImportSources(projectId: string) {
        return unwrap(await client.api.projects({ projectId }).media.sources.get())
    },

    async getMedia(projectId: string, assetId: string) {
        return unwrap(await client.api.projects({ projectId }).media({ assetId }).get())
    },

    async getMediaUsage(projectId: string, assetId: string) {
        return unwrap(await client.api.projects({ projectId }).media({ assetId }).usage.get())
    },

    async deleteMedia(projectId: string, assetId: string) {
        return unwrap(await client.api.projects({ projectId }).media({ assetId }).delete())
    },

    async permanentlyDeleteMedia(projectId: string, assetId: string) {
        const response = unwrap(
            await client.api.projects({ projectId }).media({ assetId }).permanent.post()
        )
        return response.status
    },

    async restoreMedia(projectId: string, assetId: string) {
        unwrap(await client.api.projects({ projectId }).media({ assetId }).restore.post())
    },

    async deleteMediaBatch(projectId: string, assetIds: readonly string[]) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .media['deletion-requests'].post({ assetIds: [...assetIds] })
        )
    },

    async reserveMediaUpload(projectId: string, input: WebApiRequests['reserveMediaUpload']) {
        return unwrap(await client.api.projects({ projectId }).media.uploads.post(input))
    },

    async importMediaFromUrl(projectId: string, url: string) {
        return unwrap(await client.api.projects({ projectId }).media.imports.url.post({ url }))
    },

    async uploadMedia(projectId: string, intentId: string, file: Blob) {
        return requestBoundary<MediaUpload>(
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

    async finalizeMediaUpload(projectId: string, intentId: string) {
        return unwrap(
            await client.api.projects({ projectId }).media.uploads({ intentId }).finalize.post()
        )
    },

    mediaContentUrl(projectId: string, assetId: string, variant?: 'thumbnail' | 'preview'): string {
        return `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/content${variant === undefined ? '' : `?variant=${variant}`}`
    },

    async getChannelProfileState(projectId: string, channelId: string) {
        return unwrap(
            await client.api.projects({ projectId }).channels({ channelId }).profile.get()
        )
    },

    async saveChannelProfileDraft(
        projectId: string,
        channelId: string,
        profile: Record<string, unknown>,
        expectedRevision?: number
    ) {
        const body = expectedRevision === undefined ? { profile } : { profile, expectedRevision }
        return unwrap(
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
    ) {
        return unwrap(
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
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                ['profile-drafts']({ profileVersionId })
                .activate.post(expectedRevision === undefined ? {} : { expectedRevision })
        )
    },

    async listPublisherConnections(projectId: string) {
        return unwrap(await client.api.projects({ projectId }).publishers.get())
    },

    async listNotifications(projectId: string, options: WebApiRequests['listNotifications'] = {}) {
        return unwrap(
            await client.api.projects({ projectId }).notifications.get({ query: options })
        )
    },

    async listUserNotifications(
        projectId: string | null,
        options: WebApiRequests['listUserNotifications'] = {}
    ) {
        return unwrap(
            await client.api.notifications.get({
                query: {
                    ...options,
                    ...(projectId === null ? {} : { projectId }),
                },
            })
        )
    },

    async markNotificationRead(projectId: string, notificationId: string) {
        return unwrap(
            await client.api.projects({ projectId }).notifications({ notificationId }).read.post()
        )
    },

    async archiveNotification(projectId: string, notificationId: string) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .notifications({ notificationId })
                .archive.post()
        )
    },

    async markUserNotificationRead(notificationId: string) {
        return unwrap(await client.api.notifications({ notificationId }).read.post())
    },

    async archiveUserNotification(notificationId: string) {
        return unwrap(await client.api.notifications({ notificationId }).archive.post())
    },

    async listNotificationPreferences(projectId: string) {
        return unwrap(await client.api.projects({ projectId })['notification-preferences'].get())
    },

    async updateNotificationPreference(
        projectId: string,
        kind: NotificationPreference['kind'],
        inAppEnabled: boolean
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                ['notification-preferences']({ kind })
                .patch({ inAppEnabled })
        )
    },

    async getProjectEmailAlerts(projectId: string) {
        return unwrap(await client.api.projects({ projectId })['email-alerts'].get())
    },
    async setProjectEmailAlerts(projectId: string, enabled: boolean) {
        return unwrap(await client.api.projects({ projectId })['email-alerts'].patch({ enabled }))
    },
    async listUserNotificationPreferences() {
        return unwrap(await client.api['notification-preferences'].get())
    },

    async updateUserNotificationPreference(
        kind: NotificationPreference['kind'],
        inAppEnabled: boolean
    ) {
        return unwrap(
            await client.api['notification-preferences']({ kind }).patch({ inAppEnabled })
        )
    },

    async disconnectPublisher(projectId: string, channelId: string) {
        return unwrap(
            await client.api.projects({ projectId }).channels({ channelId }).publisher.delete()
        )
    },

    async createChannel(
        projectId: string,
        name: string,
        profile: ChannelCreationProfile = 'manual-message'
    ) {
        return unwrap(await client.api.projects({ projectId }).channels.post({ name, profile }))
    },

    async renameChannel(
        projectId: string,
        channelId: string,
        name: string,
        expectedRevision: number
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .patch({ name, expectedRevision })
        )
    },

    async archiveChannel(projectId: string, channelId: string, expectedRevision: number) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .archive.post({ expectedRevision })
        )
    },

    async restoreChannel(projectId: string, channelId: string, expectedRevision: number) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .restore.post({ expectedRevision })
        )
    },

    async deleteChannel(projectId: string, channelId: string, expectedRevision: number) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .delete({ expectedRevision })
        )
    },

    async connectCustomHttpPublisher(
        projectId: string,
        channelId: string,
        input: WebApiRequests['connectCustomHttpPublisher']
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher['custom-http'].connect.post(input)
        )
    },

    async getPost(projectId: string, postId: string) {
        return unwrap(await client.api.projects({ projectId }).posts({ postId }).get())
    },

    async savePostSource(
        projectId: string,
        postId: string,
        input: WebApiRequests['savePostSource']
    ) {
        return unwrap(await client.api.projects({ projectId }).posts({ postId }).patch(input))
    },

    async addPostDestinations(
        projectId: string,
        postId: string,
        input: WebApiRequests['addPostDestinations']
    ) {
        return unwrap(
            await client.api.projects({ projectId }).posts({ postId }).destinations.post(input)
        )
    },

    async createPost(projectId: string, input: WebApiRequests['createPost']) {
        return unwrap(await client.api.projects({ projectId }).posts.post(input))
    },

    async getPublicationComposerDraft(projectId: string) {
        const { draft } = unwrap(
            await client.api.projects({ projectId })['publication-composer-draft'].get()
        )
        return { draft: draft === null ? null : parsePublicationComposerDraft(draft) }
    },

    async savePublicationComposerDraft(
        projectId: string,
        expectedRevision: number,
        content: PublicationComposerDraftContent
    ) {
        const { draft } = unwrap(
            await client.api
                .projects({ projectId })
                ['publication-composer-draft'].put({ expectedRevision, content })
        )
        return { draft: parsePublicationComposerDraft(draft) }
    },

    async deletePublicationComposerDraft(projectId: string) {
        return unwrap(
            await client.api.projects({ projectId })['publication-composer-draft'].delete()
        )
    },

    async listDuePublications(projectId: string) {
        return unwrap(await client.api.projects({ projectId }).publications.due.get())
    },

    async listPublications(projectId: string, options: WebApiRequests['listPublications'] = {}) {
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
        return unwrap(
            await client.api.projects({ projectId }).publications.get({
                query: Object.keys(query).length === 0 ? undefined : query,
            })
        )
    },

    async listPublicationApprovalRequests(projectId: string) {
        return unwrap(
            await client.api.projects({ projectId }).publications['approval-requests'].get()
        )
    },

    async approvePublicationApprovalRequest(
        projectId: string,
        publicationId: string,
        options: WebApiRequests['approvePublicationApprovalRequest'] = {}
    ) {
        const body = {
            ...(options.scheduledAt === undefined ? {} : { scheduledAt: options.scheduledAt }),
            ...(options.publishNow === undefined ? {} : { publishNow: options.publishNow }),
        }
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                ['approval-request'].approve.post(body)
        )
    },

    async rejectPublicationApprovalRequest(projectId: string, publicationId: string) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                ['approval-request'].reject.post({})
        )
    },

    async getPublicationEditor(projectId: string, publicationId: string) {
        return unwrap(
            await client.api.projects({ projectId }).publications({ publicationId }).editor.get()
        )
    },

    async savePublicationDraft(
        projectId: string,
        publicationId: string,
        input: WebApiRequests['savePublicationDraft']
    ) {
        return unwrap(
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
        return unwrap(
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
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft['adopt-profile'].post(input)
        )
    },
    async listPublicationDraftAdoptions(projectId: string, publicationId: string) {
        return unwrap(
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
    ) {
        return unwrap(
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
    ) {
        return unwrap(
            await client.api.projects({ projectId }).publications.schedule.patch({
                publicationIds: [...publicationIds],
                scheduledAt,
            })
        )
    },

    async cancelPublications(projectId: string, publicationIds: readonly string[]) {
        return unwrap(
            await client.api.projects({ projectId }).publications.cancel.patch({
                publicationIds: [...publicationIds],
            })
        )
    },

    async deleteDraftPublication(projectId: string, publicationId: string) {
        return unwrap(
            await client.api.projects({ projectId }).publications({ publicationId }).delete()
        )
    },

    async duplicateDraftPublication(projectId: string, publicationId: string) {
        return unwrap(
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
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.rebase.post({ expectedRevision, ...sourceUpdate })
        )
    },

    async publishManualPublication(projectId: string, publicationId: string, externalUrl?: string) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .publish.post(externalUrl === undefined ? {} : { externalUrl })
        )
    },

    async retryFailedPublication(projectId: string, publicationId: string) {
        return unwrap(
            await client.api.projects({ projectId }).publications({ publicationId }).retry.post({})
        )
    },

    async reconcileAmbiguousPublication(
        projectId: string,
        publicationId: string,
        input: WebApiRequests['reconcileAmbiguousPublication']
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .reconcile.post(input)
        )
    },

    async listAuditEvents(projectId: string) {
        return unwrap(await client.api.projects({ projectId })['audit-events'].get())
    },
}

export type {
    WebApiRequests,
    MediaListOptions,
    MediaListSort,
    MediaListFamilyFilter,
    MediaListDateFilter,
    MediaListPage,
    PublicationListSort,
    LinkedInConnectionDestination,
    RuntimeChannelProfile,
    CustomChannelProfileInput,
    ChannelCreationProfile,
    CustomHttpAuthentication,
    FacebookPageChoices,
    RecoveryState,
    DraftProfileAdoptionInput,
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
    AccessInstanceStateRecord,
    AccessInstanceState,
    AccessInstanceMembership,
    AccessInstanceRole,
    AccessInstanceMembershipState,
    AccessInstanceMembershipUpdate,
    CreatedAccessInvitation,
    AccessInvitation,
    AccessInvitationState,
    AccessInvitationPreview,
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
    MastodonAnalyticsCollection,
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
    WorkspaceListResponse,
    WorkspaceSummary,
    WorkspaceListItem,
    WorkspaceRole,
    ProjectUserGrant,
    ProjectMember,
    ProjectInvitation,
    ProjectMemberRole,
    ProjectInvitationStatus,
    ProjectTeamGrant,
    WorkspaceMember,
    WorkspaceTeam,
    WorkspaceTeamMember,
    WorkspaceInvitation,
} from '@postdot/client'

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

export type { EmailSettings, EmailSettingsInput }
