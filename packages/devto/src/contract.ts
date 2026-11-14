import type { ExternalEffectOutcome } from '@postdot/core'

export const DEVTO_PROVIDER = 'devto' as const
export const DEVTO_API_BASE_URL = 'https://dev.to' as const
export const DEVTO_API_ACCEPT = 'application/vnd.forem.api-v1+json' as const
export const DEVTO_ARTICLE_V1_EXECUTION_CONTRACT_REVISION = 'article-v1' as const
export const DEVTO_EXECUTION_CONTRACT_REVISION = 'article-v2' as const
export const DEVTO_MAX_TITLE_LENGTH = 10_000 as const
export const DEVTO_MAX_BODY_LENGTH = 1_000_000 as const
export const DEVTO_MAX_IMAGES = 1 as const
export const DEVTO_MAX_TAGS = 4 as const
export const DEVTO_MAX_TAG_LENGTH = 30 as const
export const DEVTO_MAX_DESCRIPTION_LENGTH = 1_000 as const
export const DEVTO_MAX_SERIES_LENGTH = 255 as const
export const DEVTO_MAX_CANONICAL_URL_LENGTH = 2_048 as const
export const DEVTO_DEFAULT_TIMEOUT_MS = 30_000 as const

export const devtoAiDisclosureLevels = [
    'not_disclosed',
    'no_ai',
    'some_ai',
    'fully_autonomous',
] as const

export type DevtoAiDisclosureLevel = (typeof devtoAiDisclosureLevels)[number]

export type DevtoDestination = {
    readonly type: 'account'
    readonly id: string
    readonly name: string | null
}

export type DevtoPermanentFailureCode =
    | 'invalid_input'
    | 'authentication_required'
    | 'forbidden'
    | 'invalid_request'

export type DevtoRetryableFailureCode = 'invalid_response' | 'rate_limited' | 'provider_failure'

export type DevtoAmbiguousFailureCode =
    | 'network_failure'
    | 'provider_timeout'
    | 'provider_failure'
    | 'missing_article_id'
    | 'unexpected_response'

export type DevtoPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
          readonly externalUrl?: string
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> & {
          readonly code: DevtoRetryableFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> & {
          readonly code: DevtoPermanentFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> & {
          readonly code: DevtoAmbiguousFailureCode
      })

export type DevtoOperationFailure = DevtoPublishOutcome extends infer Outcome
    ? Outcome extends { readonly type: 'published' }
        ? never
        : Outcome
    : never

export type DevtoOperationResult<Value> =
    | { readonly kind: 'success'; readonly value: Value }
    | { readonly kind: 'failure'; readonly outcome: DevtoOperationFailure }

export interface DevtoUser {
    readonly id: string
    readonly username: string
    readonly name: string
}

export interface DevtoArticleAnalytics {
    readonly articleId: string
    readonly comments: number
    readonly reactions: number
    readonly pageViews: number
}

export interface PublishDevtoArticleInput {
    readonly apiKey: string
    readonly title: string
    readonly bodyMarkdown: string
    readonly mainImageUrl?: string
    readonly published?: boolean
    readonly tags?: readonly string[]
    readonly canonicalUrl?: string
    readonly description?: string
    readonly series?: string
    readonly aiDisclosureLevel?: DevtoAiDisclosureLevel
    readonly organizationId?: number
}

export interface DevtoPublisher {
    getMe(apiKey: string): Promise<DevtoOperationResult<DevtoUser>>
    getArticleAnalytics(input: {
        readonly apiKey: string
        readonly articleId: string
    }): Promise<DevtoOperationResult<DevtoArticleAnalytics>>
    publishArticle(input: PublishDevtoArticleInput): Promise<DevtoPublishOutcome>
}

export type DevtoFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface DevtoPublisherOptions {
    readonly baseUrl?: string
    readonly fetcher?: DevtoFetcher
    readonly timeoutMs?: number
}
