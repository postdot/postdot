import { treaty, type Treaty } from '@elysiajs/eden'
import type { HeraldApp } from '@herald/api'
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
    ProviderAnalyticsObservationPage,
    ProviderAnalyticsObservation,
    ProjectCategoryResponse,
    ProjectTagResponse,
} from '@herald/api'

type HeraldFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface HeraldClientOptions {
    readonly cookie?: string
    readonly headers?: ConstructorParameters<typeof Headers>[0]
    readonly token?: string
    readonly fetcher?: HeraldFetcher
}

export function createHeraldClient(
    baseURL: string,
    options: HeraldClientOptions = {}
): Treaty.Create<HeraldApp> {
    const headers = new Headers(options.headers)
    if (options.cookie !== undefined) headers.set('cookie', options.cookie)
    if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)

    return treaty<HeraldApp>(baseURL, {
        fetch: {
            credentials: 'same-origin',
        },
        fetcher: options.fetcher as typeof fetch | undefined,
        headers,
    })
}

export type HeraldClient = ReturnType<typeof createHeraldClient>

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

export type EmailAlertPreference = EmailAlertPreferenceResponse

export type { EmailSettingsResponse as EmailSettings, EmailSettingsInput } from '@herald/api'
