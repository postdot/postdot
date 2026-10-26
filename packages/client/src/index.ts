import { edenFetch, treaty, type Treaty } from '@elysia/eden'
import type { PostbotApp } from '@postdot/api'
import type {
    AuditEventResponse,
    ChannelResponse,
    ChannelListItemResponse,
    ChannelProfileActivationResponse,
    ChannelProfileAssessmentResponse,
    ChannelProfilePresetResponse,
    ChannelProfilePresetsResponse,
    ChannelProfileStateResponse,
    ChannelProfileVersionResponse,
    DuePublicationResponse,
    MediaAssetResponse,
    MediaAssetUsageResponse,
    MediaImportSourceResponse,
    MediaImportSourcesResponse,
    MediaDeletionResponse,
    MediaDeletionBatchResponse,
    MediaFinalizeResponse,
    MediaIntentResponse,
    MediaPendingResponse,
    MediaReferenceResponse,
    MediaRepresentationResponse,
    MediaReservationResponse,
    MediaUploadPolicyResponse,
    MediaUploadResponse,
    MediaUrlImportResponse,
    EmailAlertPreferenceResponse,
    NotificationInboxResponse,
    NotificationPreferenceResponse,
    NotificationResponse,
    PostResponse,
    PublicationEditorStateResponse,
    PublisherConnectionResponse,
    PublisherConnectionsResponse,
    ProjectResponse,
    PublicationResponse,
    PublicationApprovalRequestResponse,
    PublicationSummaryResponse,
    PublicationSummaryPageResponse,
    PublicationListQuery as PublicationListQueryResponse,
    BlueskyAnalyticsCollectionResponse,
    DevtoAnalyticsCollectionResponse,
    MastodonAnalyticsCollectionResponse,
    PublicationCommentsResponse,
    ProviderAnalyticsObservationPage,
    ProviderAnalyticsObservation,
    ProjectCategoryResponse,
    ProjectTagResponse,
} from '@postdot/api'

type PostbotFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface PostbotClientOptions {
    readonly cookie?: string
    readonly headers?: ConstructorParameters<typeof Headers>[0]
    readonly token?: string
    readonly fetcher?: PostbotFetcher
}

export function createPostbotClient(
    baseURL: string,
    options: PostbotClientOptions = {}
): Treaty.Create<PostbotApp> {
    const headers = new Headers(options.headers)
    if (options.cookie !== undefined) headers.set('cookie', options.cookie)
    if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)

    return treaty<PostbotApp>(baseURL, {
        fetch: {
            credentials: 'same-origin',
        },
        fetcher: options.fetcher as typeof fetch | undefined,
        headers,
    })
}

export type PostbotClient = ReturnType<typeof createPostbotClient>

type ProviderApplicationsRoute = PostbotClient['api']['settings']['provider-applications']
export type ProviderApplication = NonNullable<
    Awaited<ReturnType<ProviderApplicationsRoute['get']>>['data']
>['applications'][number]
export type ProviderApplicationProvider = ProviderApplication['providerId']
export type ProviderApplicationState = ProviderApplication['state']
export type ProviderApplicationOAuthMode = NonNullable<ProviderApplication['oauthMode']>
export type ProviderApplicationInput = Readonly<
    NonNullable<Parameters<ProviderApplicationsRoute['post']>[0]>
>
export type ProviderApplicationUpdateInput = Readonly<
    NonNullable<Parameters<ReturnType<ProviderApplicationsRoute>['patch']>[0]>
>

export type UserApiKey = NonNullable<
    Awaited<ReturnType<PostbotClient['api']['api-keys']['get']>>['data']
>['keys'][number]
export type UserApiKeyCapability = Extract<UserApiKey['actionAccess'], string[]>[number]

type AccessRoute = PostbotClient['api']['access']

export type InstanceSetupStatus = NonNullable<
    Awaited<ReturnType<PostbotClient['api']['instance']['status']['get']>>['data']
>
export type AccessSummary = NonNullable<Awaited<ReturnType<AccessRoute['get']>>['data']>
export type AccessInstanceStateRecord = AccessSummary['instance']
export type AccessInstanceState = AccessInstanceStateRecord['state']
export type AccessInstanceMembership = NonNullable<AccessSummary['membership']>
export type AccessInstanceRole = AccessInstanceMembership['role']
export type AccessInstanceMembershipState = AccessInstanceMembership['state']
export type AccessInstanceMembershipUpdate = NonNullable<
    Parameters<ReturnType<AccessRoute['members']>['patch']>[0]
>
export type CreatedAccessInvitation = NonNullable<
    Awaited<ReturnType<AccessRoute['invitations']['post']>>['data']
>
export type AccessInvitation = CreatedAccessInvitation['invitation']
export type AccessInvitationState = AccessInvitation['state']
type InvitationRoutes = PostbotApp['~Routes']['api']['access']['invitations']
type InvitationResult<ResponseSchema extends Record<number, unknown>> = Pick<
    Treaty.TreatyResponse<ResponseSchema>,
    'data' | 'error' | 'status'
>

/** Explicit paths keep the public token GET distinct from the invitation-id DELETE. */
export function createAccessInvitationClient(baseURL: string): {
    preview(token: string): Promise<InvitationResult<InvitationRoutes[':token']['get']['response']>>
    revoke(
        invitationId: string
    ): Promise<InvitationResult<InvitationRoutes[':invitationId']['delete']['response']>>
} {
    const request = edenFetch<PostbotApp>(baseURL)
    return {
        preview(token: string) {
            return request('/api/access/invitations/:token', {
                method: 'GET',
                credentials: 'same-origin',
                params: { token: encodeURIComponent(token) },
            })
        },
        revoke(invitationId: string) {
            return request('/api/access/invitations/:invitationId', {
                method: 'DELETE',
                headers: {},
                body: {},
                credentials: 'same-origin',
                params: { invitationId: encodeURIComponent(invitationId) },
            })
        },
    }
}

export type AccessInvitationPreview = NonNullable<
    Awaited<ReturnType<ReturnType<typeof createAccessInvitationClient>['preview']>>['data']
>

type WorkspaceRoute = ReturnType<PostbotClient['api']['workspaces']>
type WorkspaceTeamRoute = ReturnType<WorkspaceRoute['teams']>

export type WorkspaceListResponse = NonNullable<
    Awaited<ReturnType<PostbotClient['api']['workspaces']['get']>>['data']
>
export type WorkspaceSummary = NonNullable<Awaited<ReturnType<WorkspaceRoute['get']>>['data']>
export type WorkspaceListItem = WorkspaceListResponse['workspaces'][number]
export type WorkspaceRole = WorkspaceListItem['role']
export type WorkspaceMember = WorkspaceSummary['members'][number]
export type WorkspaceTeam = WorkspaceSummary['teams'][number]
export type WorkspaceTeamMember = NonNullable<
    Awaited<ReturnType<WorkspaceTeamRoute['members']['get']>>['data']
>['members'][number]
export type WorkspaceInvitation = NonNullable<
    Awaited<ReturnType<WorkspaceRoute['invitations']['get']>>['data']
>['invitations'][number]

type ProjectRoute = ReturnType<PostbotClient['api']['projects']>

type ChannelRoute = ReturnType<ProjectRoute['channels']>
type PublicationRoute = ReturnType<ProjectRoute['publications']>
type MediaListQuery = NonNullable<NonNullable<Parameters<ProjectRoute['media']['get']>[0]>['query']>
export type MediaListOptions = Readonly<MediaListQuery>
export type MediaListSort = NonNullable<MediaListQuery['sort']>
export type MediaListFamilyFilter = NonNullable<MediaListQuery['family']>
export type MediaListDateFilter = NonNullable<MediaListQuery['date']>
export type MediaListPage = NonNullable<Awaited<ReturnType<ProjectRoute['media']['get']>>['data']>
export type PublicationListSort = NonNullable<
    NonNullable<NonNullable<Parameters<ProjectRoute['publications']['get']>[0]>['query']>['sort']
>
export type RecoveryState = NonNullable<
    Awaited<ReturnType<PostbotClient['api']['settings']['recovery']['get']>>['data']
>
export type LinkedInConnectionDestination = Readonly<
    NonNullable<
        NonNullable<
            Parameters<ChannelRoute['publisher']['linkedin']['connect']['post']>[0]
        >['destination']
    >
>
export type FacebookPageChoices = NonNullable<
    Awaited<ReturnType<ChannelRoute['publisher']['facebook']['pages']['get']>>['data']
>
export type ChannelCreationProfile = NonNullable<
    NonNullable<Parameters<ProjectRoute['channels']['post']>[0]>['profile']
>
export type CustomChannelProfileInput = Readonly<
    Extract<ChannelCreationProfile, { origin: 'custom' }>
>
/** Locally materialized templates always include the server-derived fingerprints. */
export type RuntimeChannelProfile = CustomChannelProfileInput &
    Required<Pick<CustomChannelProfileInput, 'profileHash' | 'schemaHash'>>
export type CustomHttpAuthentication = Readonly<
    NonNullable<
        Parameters<ChannelRoute['publisher']['custom-http']['connect']['post']>[0]
    >['authentication']
>
export type DraftProfileAdoptionInput = NonNullable<
    Parameters<PublicationRoute['draft']['adopt-profile']['post']>[0]
>
export type PublicationComposerDraftResponse = NonNullable<
    NonNullable<
        Awaited<ReturnType<ProjectRoute['publication-composer-draft']['get']>>['data']
    >['draft']
>

type RequestBody<Method extends (...args: never[]) => unknown> = NonNullable<Parameters<Method>[0]>
type RequestQuery<Method extends (...args: never[]) => unknown> = NonNullable<
    RequestBody<Method> extends { query?: infer Query } ? Query : never
>
type ReadonlyInput<Value> = Value extends unknown[] ? Readonly<Value> : Value
type ReadonlyRequest<Body> = { readonly [Key in keyof Body]: ReadonlyInput<Body[Key]> }

/** Schema-owned bodies and query subsets accepted by the web's convenience methods. */
export type WebApiRequests = {
    confirmPublicationDestination: Readonly<
        RequestBody<PublicationRoute['confirm-destination']['post']>
    >
    sendPublicationReply: RequestBody<PublicationRoute['comments']['replies']['post']>
    savePublicationFirstComment: Readonly<RequestBody<PublicationRoute['first-comment']['put']>>
    cancelPublicationFirstComment: Readonly<
        RequestBody<PublicationRoute['first-comment']['cancel']['post']>
    >
    updateUserApiKey: ReadonlyRequest<
        RequestBody<ReturnType<PostbotClient['api']['api-keys']>['patch']>
    >
    reserveMediaUpload: RequestBody<ProjectRoute['media']['uploads']['post']>
    selectFacebookPage: RequestBody<ChannelRoute['publisher']['facebook']['select']['post']>
    connectDiscordPublisher: RequestBody<ChannelRoute['publisher']['discord']['connect']['post']>
    connectTelegramPublisher: RequestBody<ChannelRoute['publisher']['telegram']['connect']['post']>
    connectCustomHttpPublisher: RequestBody<
        ChannelRoute['publisher']['custom-http']['connect']['post']
    >
    savePostSource: RequestBody<ReturnType<ProjectRoute['posts']>['patch']>
    addPostDestinations: RequestBody<ReturnType<ProjectRoute['posts']>['destinations']['post']>
    createPost: Omit<RequestBody<ProjectRoute['posts']['post']>, 'title'> & {
        title?: NonNullable<RequestBody<ProjectRoute['posts']['post']>['title']>
    }
    approvePublicationApprovalRequest: Readonly<
        RequestBody<PublicationRoute['approval-request']['approve']['post']>
    >
    savePublicationDraft: RequestBody<PublicationRoute['draft']['patch']>
    reconcileAmbiguousPublication: RequestBody<PublicationRoute['reconcile']['post']>
    listCategories: Pick<RequestQuery<PostbotClient['api']['categories']['get']>, 'includeArchived'>
    listProjectTags: Pick<RequestQuery<ProjectRoute['tags']['get']>, 'includeArchived'>
    listPublicationTags: Pick<RequestQuery<PublicationRoute['tags']['get']>, 'includeArchived'>
    listBlueskyProviderAnalytics: Pick<
        RequestQuery<ProjectRoute['analytics']['provider']['bluesky']['get']>,
        'limit' | 'providerSubjectId' | 'postbotEntityId'
    >
    listDevtoProviderAnalytics: Pick<
        RequestQuery<ProjectRoute['analytics']['provider']['devto']['get']>,
        'limit' | 'providerSubjectId' | 'postbotEntityId'
    >
    listNotifications: Pick<
        RequestQuery<ProjectRoute['notifications']['get']>,
        'before' | 'limit' | 'view'
    >
    listUserNotifications: Pick<
        RequestQuery<PostbotClient['api']['notifications']['get']>,
        'before' | 'limit' | 'view'
    >
    listPublications: Omit<
        Pick<
            RequestQuery<ProjectRoute['publications']['get']>,
            'tagIds' | 'cursor' | 'limit' | 'sort' | 'state' | 'from' | 'to'
        >,
        'tagIds'
    > & {
        tagIds?: readonly string[]
    }
}

export type ProjectMember = NonNullable<
    Awaited<ReturnType<ProjectRoute['members']['get']>>['data']
>['members'][number]
export type ProjectInvitation = NonNullable<
    Awaited<ReturnType<ProjectRoute['invitations']['get']>>['data']
>['invitations'][number]
export type ProjectMemberRole = ProjectMember['role']
export type ProjectInvitationStatus = ProjectInvitation['status']

export type ProjectUserGrant = NonNullable<
    Awaited<ReturnType<ProjectRoute['user-grants']['get']>>['data']
>['grants'][number]
export type ProjectTeamGrant = NonNullable<
    Awaited<ReturnType<ProjectRoute['team-grants']['get']>>['data']
>['grants'][number]

export type Project = ProjectResponse
export type ProjectCategory = ProjectCategoryResponse
export type ProjectTag = ProjectTagResponse
export type ChannelListItem = ChannelListItemResponse
export type Channel = ChannelResponse
export type ChannelProfileVersion = ChannelProfileVersionResponse
export type ChannelProfilePreset = ChannelProfilePresetResponse
export type ChannelProfilePresets = ChannelProfilePresetsResponse
export type ChannelProfileState = ChannelProfileStateResponse
export type ChannelProfileAssessment = ChannelProfileAssessmentResponse
export type ChannelProfileActivation = ChannelProfileActivationResponse
export type Post = PostResponse
export type Publication = PublicationResponse
export type PublicationApprovalRequest = PublicationApprovalRequestResponse
export type DuePublication = DuePublicationResponse
export type MediaAsset = MediaAssetResponse
export type MediaAssetUsage = MediaAssetUsageResponse
export type MediaImportSource = MediaImportSourceResponse
export type MediaImportSources = MediaImportSourcesResponse
export type MediaRepresentation = MediaRepresentationResponse
export type MediaIntent = MediaIntentResponse
export type MediaReference = MediaReferenceResponse
export type MediaReservation = MediaReservationResponse
export type MediaUploadPolicy = MediaUploadPolicyResponse
export type MediaUpload = MediaUploadResponse
export type MediaUrlImport = MediaUrlImportResponse
export type MediaPending = MediaPendingResponse
export type MediaFinalize = MediaFinalizeResponse
export type MediaDeletion = MediaDeletionResponse
export type MediaDeletionBatch = MediaDeletionBatchResponse
export type PublicationEditorState = PublicationEditorStateResponse
export type PublicationSummary = PublicationSummaryResponse
export type PublicationSummaryPage = PublicationSummaryPageResponse
export type PublicationListQuery = PublicationListQueryResponse
export type AuditEvent = AuditEventResponse
export type PublisherConnection = PublisherConnectionResponse
export type PublisherConnections = PublisherConnectionsResponse
export type Notification = NotificationResponse
export type NotificationInbox = NotificationInboxResponse
export type NotificationPreference = NotificationPreferenceResponse
export type ProviderAnalyticsPage = ProviderAnalyticsObservationPage
export type ProviderAnalyticsItem = ProviderAnalyticsObservation
export type BlueskyAnalyticsCollection = BlueskyAnalyticsCollectionResponse
export type DevtoAnalyticsCollection = DevtoAnalyticsCollectionResponse
export type MastodonAnalyticsCollection = MastodonAnalyticsCollectionResponse

export type EmailAlertPreference = EmailAlertPreferenceResponse

export type { EmailSettingsResponse as EmailSettings, EmailSettingsInput } from '@postdot/api'

export type { SearchResponse } from '@postdot/api'

export type { PublicationCommentsResponse }

export type { PublicationRepliesResponse } from '@postdot/api'

export type { PublicationFirstCommentResponse, PublicationFirstCommentItem } from '@postdot/api'
