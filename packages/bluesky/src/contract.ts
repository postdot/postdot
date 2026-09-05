import type { BlobRef } from '@atproto/api'
import type { ExternalEffectOutcome } from '@herald/core'

export const BLUESKY_PROVIDER = 'bluesky' as const
export const BLUESKY_EXECUTION_CONTRACT_REVISION = 'post-v1'
export const BLUESKY_REQUIRED_SCOPES = ['atproto'] as const
export const BLUESKY_MAX_GRAPHEMES = 300
export const BLUESKY_MAX_TEXT_LENGTH = 3_000
export const BLUESKY_MAX_IMAGES = 4
export const BLUESKY_MAX_IMAGE_BYTES = 2_000_000
export const BLUESKY_MAX_ALT_TEXT_LENGTH = 1_000

export type BlueskyDestination = {
    readonly type: 'account'
    readonly id: string
    readonly name: string | null
}

export type BlueskyPermanentFailureCode =
    | 'invalid_input'
    | 'authentication_required'
    | 'forbidden'
    | 'invalid_request'

export type BlueskyRetryableFailureCode = 'rate_limited' | 'conflict'

export type BlueskyAmbiguousFailureCode =
    | 'network_failure'
    | 'provider_timeout'
    | 'provider_failure'
    | 'missing_post_id'
    | 'unexpected_response'

export type BlueskyPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
          readonly externalUrl?: string
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> & {
          readonly code: BlueskyRetryableFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> & {
          readonly code: BlueskyPermanentFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> & {
          readonly code: BlueskyAmbiguousFailureCode
      })

export interface BlueskyPostContent {
    readonly text: string
    readonly media: readonly {
        readonly contentType: 'image/jpeg' | 'image/png'
        readonly size: number
        readonly stream?: ReadableStream<Uint8Array>
        readonly accessibilityText: string
        /** A previously uploaded AT Protocol blob, serialized by the adapter. */
        readonly remoteBlob?: BlobRef
    }[]
}

export type BlueskyMediaUploadedHandler = (input: {
    readonly index: number
    readonly blob: BlobRef
}) => void | Promise<void>

export type BlueskyFetcher = (
    input: string | URL | Request,
    init?: RequestInit
) => Promise<Response>
