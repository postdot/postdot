import { treaty, type Treaty } from '@elysiajs/eden'
import type { HeraldApp } from '@herald/api'
import type {
    AuditEventResponse,
    CreatedProjectAccessTokenResponse,
    ChannelResponse,
    ChannelProfileActivationResponse,
    ChannelProfileAssessmentResponse,
    ChannelProfileStateResponse,
    ChannelProfileVersionResponse,
    DuePublicationResponse,
    MediaAssetResponse,
    MediaDeletionResponse,
    MediaFinalizeResponse,
    MediaIntentResponse,
    MediaPendingResponse,
    MediaReferenceResponse,
    MediaRepresentationResponse,
    MediaReservationResponse,
    MediaUploadResponse,
    NotificationInboxResponse,
    NotificationPreferenceResponse,
    NotificationResponse,
    PostResponse,
    PublicationEditorStateResponse,
    PublisherConnectionResponse,
    PublisherConnectionsResponse,
    ProjectAccessTokenResponse,
    ProjectAccessTokensResponse,
    ProjectResponse,
    PublicationResponse,
    PublicationSummaryResponse,
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
export type Channel = ChannelResponse
export type ChannelProfileVersion = ChannelProfileVersionResponse
export type ChannelProfileState = ChannelProfileStateResponse
export type ChannelProfileAssessment = ChannelProfileAssessmentResponse
export type ChannelProfileActivation = ChannelProfileActivationResponse
export type Post = PostResponse
export type Publication = PublicationResponse
export type DuePublication = DuePublicationResponse
export type MediaAsset = MediaAssetResponse
export type MediaRepresentation = MediaRepresentationResponse
export type MediaIntent = MediaIntentResponse
export type MediaReference = MediaReferenceResponse
export type MediaReservation = MediaReservationResponse
export type MediaUpload = MediaUploadResponse
export type MediaPending = MediaPendingResponse
export type MediaFinalize = MediaFinalizeResponse
export type MediaDeletion = MediaDeletionResponse
export type PublicationEditorState = PublicationEditorStateResponse
export type PublicationSummary = PublicationSummaryResponse
export type AuditEvent = AuditEventResponse
export type CreatedProjectAccessToken = CreatedProjectAccessTokenResponse
export type ProjectAccessToken = ProjectAccessTokenResponse
export type ProjectAccessTokens = ProjectAccessTokensResponse
export type PublisherConnection = PublisherConnectionResponse
export type PublisherConnections = PublisherConnectionsResponse
export type Notification = NotificationResponse
export type NotificationInbox = NotificationInboxResponse
export type NotificationPreference = NotificationPreferenceResponse
