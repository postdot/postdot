import { treaty, type Treaty } from '@elysiajs/eden'
import type { HeraldApp } from '@herald/api'
import type {
    AuditEventResponse,
    ChannelResponse,
    ChannelProfileActivationResponse,
    ChannelProfileAssessmentResponse,
    ChannelProfileStateResponse,
    ChannelProfileVersionResponse,
    DuePublicationResponse,
    PostResponse,
    PublisherConnectionResponse,
    PublisherConnectionsResponse,
    ProjectResponse,
    PublicationResponse,
} from '@herald/api'

type HeraldFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface HeraldClientOptions {
    readonly cookie?: string
    readonly headers?: ConstructorParameters<typeof Headers>[0]
    readonly fetcher?: HeraldFetcher
}

export function createHeraldClient(
    baseURL: string,
    options: HeraldClientOptions = {}
): Treaty.Create<HeraldApp> {
    const headers = new Headers(options.headers)
    if (options.cookie !== undefined) headers.set('cookie', options.cookie)

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
export type AuditEvent = AuditEventResponse
export type PublisherConnection = PublisherConnectionResponse
export type PublisherConnections = PublisherConnectionsResponse
