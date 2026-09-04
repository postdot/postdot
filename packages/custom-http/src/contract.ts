import type {
    CustomHttpAuthentication,
    DeclarativeHttpExecutionContract,
    DeclarativeHttpMultipartMediaPart,
    DeclarativeHttpRequestMapping,
    DeclarativeHttpValueExpression,
    ExternalEffectOutcome,
} from '@herald/core'

export const CUSTOM_HTTP_PUBLISHER_KIND = 'custom_http' as const
export const HERALD_WEBHOOK_VERSION = '1' as const
export const HERALD_WEBHOOK_EVENT = 'publication.delivery' as const

export const customHttpLimits = {
    minimumSecretBytes: 32,
    maximumRequestBytes: 100 * 1024 * 1024,
    maximumResponseBytes: 64 * 1024,
    maximumErrorMessageLength: 256,
    maximumTimeoutMs: 120_000,
    defaultTimeoutMs: 30_000,
} as const

export interface CustomHttpConnection {
    readonly endpointUrl: string
    readonly authentication: CustomHttpAuthentication
    readonly secret: string
}

export interface CustomHttpDeliveryContext {
    readonly deliveryId: string
    readonly jobId: string
    readonly projectId: string
    readonly publicationId: string
    readonly channelId: string
    readonly channelName: string
    readonly scheduledAt: number | null
    readonly attempt: number
    readonly externalAccountId: string
    readonly deliveredAt: number
}

export interface CustomHttpMediaDescriptor {
    readonly assetId: string
    readonly representationId: string
    readonly contentPath: string
    readonly position: number
    readonly role: string | null
    readonly accessibilityText: string | null
    readonly originalFilename: string
    readonly contentType: string
    readonly family: 'image' | 'video' | 'audio' | 'document'
    readonly byteSize: number
    readonly sha256: string
    readonly width: number | null
    readonly height: number | null
    readonly durationMs: number | null
    readonly storeId: string
    readonly objectKey: string
}

export interface OpenedCustomHttpMedia {
    readonly size: number
    readonly contentType: string
    readonly sha256: string
    readonly stream: ReadableStream<Uint8Array>
}

export interface CustomHttpResponse {
    readonly status: number
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
    readonly bodyTruncated: boolean
}

export interface CustomHttpRequestBody {
    readonly contentType: string
    readonly contentLength: number | null
    write(writeChunk: (chunk: Uint8Array) => Promise<void>): Promise<void>
}

export interface CustomHttpRequest {
    readonly method: DeclarativeHttpRequestMapping['method']
    readonly url: URL
    readonly address: ResolvedNetworkAddress
    readonly headers: Readonly<Record<string, string>>
    readonly body: CustomHttpRequestBody | null
    readonly maxResponseBytes: number
}

export interface CustomHttpRequester {
    request(input: CustomHttpRequest, signal: AbortSignal): Promise<CustomHttpResponse>
}

export interface ResolvedNetworkAddress {
    readonly address: string
    readonly family: 4 | 6
}

export interface CustomHttpMediaReader {
    open(media: CustomHttpMediaDescriptor): Promise<OpenedCustomHttpMedia | null>
}

export interface CustomHttpDeliveryInput {
    readonly execution: DeclarativeHttpExecutionContract
    readonly content: Readonly<Record<string, unknown>>
    readonly context: CustomHttpDeliveryContext
    readonly media: readonly CustomHttpMediaDescriptor[]
    readonly connection: CustomHttpConnection
    readonly mediaReader?: CustomHttpMediaReader
    readonly resolveMediaUrl?: (
        media: CustomHttpMediaDescriptor,
        context: CustomHttpDeliveryContext
    ) => string | null | Promise<string | null>
}

export interface PrivateDestinationHostnameRule {
    readonly kind: 'hostname'
    readonly hostname: string
    readonly port: number
    readonly schemes: readonly ('http' | 'https')[]
}

export interface PrivateDestinationCidrRule {
    readonly kind: 'cidr'
    readonly cidr: string
    readonly port: number
    readonly schemes: readonly ('http' | 'https')[]
}

export type PrivateDestinationRule = PrivateDestinationHostnameRule | PrivateDestinationCidrRule

export interface CustomHttpEgressOptions {
    readonly privateDestinations?: readonly PrivateDestinationRule[]
    readonly resolveHostname?: ResolveHostname
}

export type ResolveHostname = (hostname: string) => Promise<readonly ResolvedNetworkAddress[]>

export interface CustomHttpTransportOptions extends CustomHttpEgressOptions {
    readonly requester?: CustomHttpRequester
    readonly timeoutMs?: number
    readonly maxResponseBytes?: number
    readonly now?: () => number
}

export type CustomHttpDeliveryOutcome = ExternalEffectOutcome

export type {
    CustomHttpAuthentication,
    DeclarativeHttpMultipartMediaPart,
    DeclarativeHttpValueExpression,
}
