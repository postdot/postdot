import {
    createHeraldClient,
    type AuditEvent,
    type Channel,
    type ChannelProfileActivation,
    type ChannelProfileAssessment,
    type ChannelProfileState,
    type ChannelProfileVersion,
    type DuePublication,
    type MediaFinalize,
    type MediaReference,
    type MediaReservation,
    type MediaUpload,
    type Notification,
    type NotificationInbox,
    type NotificationPreference,
    type Post,
    type PublicationEditorState,
    type ProjectAccessToken,
    type PublisherConnection,
    type Project,
    type Publication,
    type PublicationSummary,
    type ProjectCategory,
    type ProjectTag,
} from '@herald/client'

import * as m from '@/paraglide/messages.js'

const client = createHeraldClient(window.location.origin)

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

export type ChannelCreationProfile =
    | 'manual-message'
    | 'linkedin'
    | 'bluesky'
    | 'mastodon'
    | 'discord'
    | 'devto'
    | RuntimeChannelProfile

export type CustomHttpAuthentication =
    | { readonly kind: 'none' }
    | { readonly kind: 'bearer' }
    | { readonly kind: 'header'; readonly headerName: string }

export type ProviderApplicationProvider = 'linkedin' | 'bluesky' | 'x'
export type ProviderApplicationState = 'active' | 'disabled'
export type ProviderApplicationOAuthMode = 'loopback' | 'web'

export type AccessInstanceRole = 'admin' | 'member'
export type AccessInstanceMembershipState = 'enabled' | 'disabled'
export type AccessInstanceState = 'claimable' | 'claimed'
export type AccessInvitationState = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface AccessInstanceStateRecord {
    readonly id: 'default'
    readonly state: AccessInstanceState
    readonly bootstrapBlocked: boolean
    readonly claimedByUserId: string | null
    readonly claimedAt: number | null
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

export interface AccessProjectMembership {
    readonly id: string
    readonly projectId: string
    readonly userId: string
    readonly email: string
    readonly name: string
    readonly role: 'owner' | 'editor' | 'viewer'
    readonly state: 'active' | 'removed'
    readonly createdAt: number
    readonly updatedAt: number
}

export interface AccessInvitation {
    readonly id: string
    readonly targetEmail: string
    readonly instanceRole: 'member'
    readonly projectId: string | null
    readonly projectRole: 'owner' | 'editor' | 'viewer' | null
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

export type ChannelLifecycleBlocker =
    | 'active_work'
    | 'pending_authorization'
    | 'publications'
    | 'publisher'
    | 'must_be_archived'

export class ApiError extends Error {
    readonly status: number
    readonly code: string
    readonly blockers: readonly string[]

    constructor(status: number, code: string, message: string, blockers: readonly string[] = []) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.blockers = blockers
    }
}

interface ErrorBody {
    readonly error?: {
        readonly code?: string
        readonly message?: string
        readonly blockers?: readonly string[]
    }
}

function isErrorBody(value: unknown): value is ErrorBody {
    return typeof value === 'object' && value !== null && 'error' in value
}

function errorFrom(status: number, value: unknown) {
    const body = isErrorBody(value) ? value.error : undefined
    return new ApiError(
        status,
        body?.code ?? 'request_failed',
        body?.message ?? '',
        body?.blockers?.filter((blocker): blocker is string => typeof blocker === 'string') ?? []
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

export const api = {
    getSession(): Promise<Session | null> {
        return requestAuth<Session | null>('/api/auth/get-session')
    },

    signIn(email: string, password: string): Promise<Session> {
        return requestAuth<Session>('/api/auth/sign-in/email', jsonBody({ email, password }))
    },

    signUp(name: string, email: string, password: string): Promise<Session> {
        return requestAuth<Session>('/api/auth/sign-up/email', jsonBody({ name, email, password }))
    },

    signOut(): Promise<unknown> {
        return requestAuth('/api/auth/sign-out', jsonBody({}))
    },

    async listProviderApplications(): Promise<{ applications: ProviderApplication[] }> {
        return requestAuth<{ applications: ProviderApplication[] }>(
            '/api/settings/provider-applications'
        )
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

    async listAccessInvitations(): Promise<{ invitations: AccessInvitation[] }> {
        return requestAuth<{ invitations: AccessInvitation[] }>('/api/access/invitations')
    },

    async createAccessInvitation(targetEmail: string): Promise<CreatedAccessInvitation> {
        return requestAuth<CreatedAccessInvitation>(
            '/api/access/invitations',
            jsonBody({ targetEmail })
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
        projectMembership: AccessProjectMembership | null
    }> {
        return requestAuth<{
            invitation: AccessInvitation
            instanceMembership: AccessInstanceMembership
            projectMembership: AccessProjectMembership | null
        }>('/api/access/invitations/accept', jsonBody({ token }))
    },

    async listProjects(): Promise<{ projects: Project[] }> {
        return unwrap<{ projects: Project[] }>(await client.api.projects.get())
    },

    async createProject(name: string, timeZone?: string): Promise<{ project: Project }> {
        return unwrap<{ project: Project }>(
            await client.api.projects.post(timeZone === undefined ? { name } : { name, timeZone })
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

    async listProjectAccessTokens(
        projectId: string
    ): Promise<{ accessTokens: ProjectAccessToken[] }> {
        return unwrap<{ accessTokens: ProjectAccessToken[] }>(
            await client.api.projects({ projectId })['access-tokens'].get()
        )
    },

    async createProjectAccessToken(
        projectId: string,
        name: string
    ): Promise<{ accessToken: ProjectAccessToken; token: string }> {
        return unwrap<{ accessToken: ProjectAccessToken; token: string }>(
            await client.api.projects({ projectId })['access-tokens'].post({ name })
        )
    },

    async revokeProjectAccessToken(
        projectId: string,
        tokenId: string
    ): Promise<{ accessToken: ProjectAccessToken }> {
        return unwrap<{ accessToken: ProjectAccessToken }>(
            await client.api.projects({ projectId })['access-tokens']({ tokenId }).delete()
        )
    },

    async listChannels(projectId: string): Promise<{ channels: Channel[] }> {
        return unwrap<{ channels: Channel[] }>(
            await client.api.projects({ projectId }).channels.get()
        )
    },

    async listMedia(projectId: string): Promise<{ media: MediaReference[] }> {
        return unwrap<{ media: MediaReference[] }>(
            await client.api.projects({ projectId }).media.get()
        )
    },

    async getMedia(projectId: string, assetId: string): Promise<MediaReference> {
        return unwrap<MediaReference>(
            await client.api.projects({ projectId }).media({ assetId }).get()
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

    async uploadMedia(projectId: string, intentId: string, file: File): Promise<MediaUpload> {
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

    mediaContentUrl(projectId: string, assetId: string): string {
        return `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/content`
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

    async listPublisherConnections(
        projectId: string
    ): Promise<{ connections: PublisherConnection[] }> {
        return unwrap<{ connections: PublisherConnection[] }>(
            await client.api.projects({ projectId }).publishers.get()
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

    async listDuePublications(projectId: string): Promise<{ publications: DuePublication[] }> {
        return unwrap<{ publications: DuePublication[] }>(
            await client.api.projects({ projectId }).publications.due.get()
        )
    },

    async listPublications(
        projectId: string,
        options: { tagIds?: readonly string[] } = {}
    ): Promise<{ publications: PublicationSummary[] }> {
        return unwrap<{ publications: PublicationSummary[] }>(
            await client.api.projects({ projectId }).publications.get({
                query:
                    options.tagIds === undefined || options.tagIds.length === 0
                        ? undefined
                        : { tagIds: [...options.tagIds] },
            })
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

    async rebasePublicationDraft(
        projectId: string,
        publicationId: string,
        expectedRevision: number
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.rebase.post({ expectedRevision })
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
    Channel,
    ChannelProfileActivation,
    ChannelProfileAssessment,
    ChannelProfileState,
    ChannelProfileVersion,
    DuePublication,
    MediaFinalize,
    MediaReference,
    MediaReservation,
    Post,
    PublicationEditorState,
    ProjectAccessToken,
    PublisherConnection,
    Project,
    ProjectCategory,
    ProjectTag,
    Publication,
    PublicationSummary,
    Notification,
    NotificationInbox,
    NotificationPreference,
} from '@herald/client'

export function formatApiError(error: unknown): string {
    if (!(error instanceof ApiError)) return m.api_request_failed()
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
        case 'access_tokens_unavailable':
            return m.api_access_tokens_unavailable()
        case 'media_unavailable':
            return m.api_media_unavailable()
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
