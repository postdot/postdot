import type { ExternalEffectOutcome } from '@herald/core'

export const X_PROVIDER = 'x' as const
export const X_EXECUTION_CONTRACT_REVISION = 'post-v1'
export const X_API_BASE_URL = 'https://api.x.com'
export const X_OAUTH_ISSUER = 'https://twitter.com'
export const X_OAUTH_AUTHORIZATION_ENDPOINT = 'https://x.com/i/oauth2/authorize'
export const X_OAUTH_TOKEN_ENDPOINT = 'https://api.x.com/2/oauth2/token'
export const X_MEDIA_CATEGORY_TWEET_IMAGE = 'tweet_image' as const
export const X_REQUIRED_SCOPES = [
    'tweet.read',
    'tweet.write',
    'users.read',
    'offline.access',
    'media.write',
] as const
export const X_DEFAULT_MAX_CHARACTERS = 280
export const X_MAX_IMAGES = 4
export const X_MAX_ALT_TEXT_LENGTH = 1_000
export const X_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const X_DEFAULT_TIMEOUT_MS = 30_000
/**
 * Conservative reuse horizon for uploaded media checkpoints.
 *
 * The v2 upload flow reports `expires_after_secs` for the uploaded media.
 * Herald persists the resulting delivery expiry and also applies this shorter
 * conservative horizon as a safety bound when the provider omits it.
 */
export const X_UPLOADED_MEDIA_REUSE_TTL_MS = 20 * 60 * 60 * 1_000

export type XDestination = {
    readonly type: 'account'
    readonly id: string
    readonly name: string | null
}

export type XPermanentFailureCode =
    | 'invalid_input'
    | 'authentication_required'
    | 'forbidden'
    | 'invalid_request'

export type XRetryableFailureCode = 'rate_limited' | 'conflict' | 'provider_failure'

export type XAmbiguousFailureCode =
    | 'network_failure'
    | 'provider_timeout'
    | 'provider_failure'
    | 'missing_post_id'
    | 'missing_media_id'
    | 'unexpected_response'

export type XPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
          readonly externalUrl?: string
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> & {
          readonly code: XRetryableFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> & {
          readonly code: XPermanentFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> & {
          readonly code: XAmbiguousFailureCode
      })

export type XMediaUploadOutcome =
    | {
          readonly type: 'uploaded'
          readonly remoteMediaId: string
          readonly ready: boolean
          /**
           * Provider-reported upload-session lifetime in seconds, when the
           * upload response includes `expires_after_secs`. Null when the
           * provider omits it; Herald then applies its conservative reuse
           * horizon instead of assuming indefinite reuse.
           */
          readonly expiresAfterSecs: number | null
      }
    | (Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> & {
          readonly code: XRetryableFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> & {
          readonly code: XPermanentFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> & {
          readonly code: XAmbiguousFailureCode
          readonly remoteMediaId?: string
      })

export type XOperationFailure = XPublishOutcome extends infer Outcome
    ? Outcome extends { readonly type: 'published' }
        ? never
        : Outcome
    : never

export type XOperationResult<Value> =
    | { readonly kind: 'success'; readonly value: Value }
    | { readonly kind: 'failure'; readonly outcome: XOperationFailure }

export interface XUser {
    readonly id: string
    readonly name: string
    readonly username: string
}

export interface XMediaInput {
    readonly contentType: 'image/jpeg' | 'image/png'
    readonly size: number
    readonly filename: string
    readonly accessibilityText?: string | null
    readonly stream: ReadableStream<Uint8Array>
}

export interface XTweetInput {
    readonly accessToken: string
    readonly text: string
    readonly mediaIds?: readonly string[]
    readonly idempotencyKey?: string
}

export interface XPublisher {
    getMe(accessToken: string): Promise<XOperationResult<XUser>>
    uploadMedia(accessToken: string, input: XMediaInput): Promise<XMediaUploadOutcome>
    publishTweet(input: XTweetInput): Promise<XPublishOutcome>
}

export type XFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface XPublisherOptions {
    readonly apiBaseUrl?: string
    readonly fetcher?: XFetcher
    readonly timeoutMs?: number
}
