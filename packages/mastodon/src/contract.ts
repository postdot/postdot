import type { ExternalEffectOutcome } from '@herald/core'

export const MASTODON_PROVIDER = 'mastodon' as const
export const MASTODON_EXECUTION_CONTRACT_REVISION = 'status-v1'
export const MASTODON_REQUIRED_SCOPES = ['read:accounts', 'write:media', 'write:statuses'] as const
export const MASTODON_DEFAULT_MAX_CHARACTERS = 500
export const MASTODON_DEFAULT_MAX_MEDIA_ATTACHMENTS = 4
export const MASTODON_MAX_ALT_TEXT_LENGTH = 1_500
export const MASTODON_MAX_SPOILER_TEXT_LENGTH = 500
export const MASTODON_MAX_LANGUAGE_LENGTH = 35
export const MASTODON_MAX_IMAGE_BYTES = 16 * 1024 * 1024
export const MASTODON_DEFAULT_TIMEOUT_MS = 30_000
export const MASTODON_DEFAULT_MEDIA_PROCESSING_TIMEOUT_MS = 30_000
export const MASTODON_DEFAULT_MEDIA_PROCESSING_INTERVAL_MS = 500

export const mastodonVisibilityValues = ['public', 'unlisted', 'private', 'direct'] as const
export type MastodonVisibility = (typeof mastodonVisibilityValues)[number]

export type MastodonDestination = {
    readonly type: 'account'
    readonly id: string
    readonly name: string | null
}

export type MastodonPermanentFailureCode =
    | 'invalid_input'
    | 'authentication_required'
    | 'forbidden'
    | 'invalid_request'
    | 'network_policy_denied'

export type MastodonRetryableFailureCode = 'rate_limited' | 'conflict' | 'provider_failure'

export type MastodonAmbiguousFailureCode =
    | 'network_failure'
    | 'provider_timeout'
    | 'provider_failure'
    | 'missing_post_id'
    | 'missing_media_id'
    | 'unexpected_response'

export type MastodonPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
          readonly externalUrl?: string
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> & {
          readonly code: MastodonRetryableFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> & {
          readonly code: MastodonPermanentFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> & {
          readonly code: MastodonAmbiguousFailureCode
      })

export type MastodonMediaUploadOutcome =
    | {
          readonly type: 'uploaded'
          readonly remoteMediaId: string
          readonly ready: boolean
      }
    | (Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> & {
          readonly code: MastodonRetryableFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> & {
          readonly code: MastodonPermanentFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> & {
          readonly code: MastodonAmbiguousFailureCode
          readonly remoteMediaId?: string
      })

export type MastodonOperationFailure = MastodonPublishOutcome extends infer Outcome
    ? Outcome extends { readonly type: 'published' }
        ? never
        : Outcome
    : never

export type MastodonOperationResult<Value> =
    | { readonly kind: 'success'; readonly value: Value }
    | { readonly kind: 'failure'; readonly outcome: MastodonOperationFailure }

export interface MastodonApplication {
    readonly clientId: string
    readonly clientSecret: string
}

export interface MastodonAccount {
    readonly id: string
    readonly acct: string
    readonly username: string
    readonly displayName: string | null
}

export interface MastodonMediaAttachment {
    readonly id: string
    readonly type: string
    readonly url: string | null
}

export interface MastodonMediaInput {
    readonly contentType: 'image/jpeg' | 'image/png'
    readonly size: number
    readonly filename: string
    readonly accessibilityText: string
    readonly stream: ReadableStream<Uint8Array>
}

export interface MastodonStatusInput {
    readonly accessToken: string
    readonly text: string
    readonly mediaIds: readonly string[]
    readonly visibility?: MastodonVisibility
    readonly sensitive?: boolean
    readonly spoilerText?: string
    readonly language?: string
    readonly idempotencyKey: string
}

export interface MastodonPublisher {
    registerApplication(input: {
        readonly clientName: string
        readonly redirectUri: string
        readonly scopes: readonly string[]
        readonly website?: string
    }): Promise<MastodonOperationResult<MastodonApplication>>
    verifyCredentials(accessToken: string): Promise<MastodonOperationResult<MastodonAccount>>
    uploadMedia(accessToken: string, input: MastodonMediaInput): Promise<MastodonMediaUploadOutcome>
    getMedia(
        accessToken: string,
        mediaId: string
    ): Promise<MastodonOperationResult<MastodonMediaAttachment>>
    publishStatus(input: MastodonStatusInput): Promise<MastodonPublishOutcome>
}

export type MastodonFetcher = (
    input: string | URL | Request,
    init?: RequestInit
) => Promise<Response>

export interface MastodonPublisherOptions {
    readonly baseUrl: string
    readonly fetcher?: MastodonFetcher
    readonly timeoutMs?: number
}
