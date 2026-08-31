import type { ExternalEffectOutcome } from '@herald/core'

export const LINKEDIN_PROVIDER = 'linkedin' as const
export const LINKEDIN_API_BASE_URL = 'https://api.linkedin.com'
export const LINKEDIN_POSTS_PATH = '/rest/posts'
export const LINKEDIN_USERINFO_PATH = '/v2/userinfo'
export const LINKEDIN_OAUTH_ISSUER = 'https://www.linkedin.com/oauth'
export const LINKEDIN_OAUTH_AUTHORIZATION_ENDPOINT =
    'https://www.linkedin.com/oauth/v2/authorization'
export const LINKEDIN_OAUTH_TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken'
export const LINKEDIN_RESTLI_PROTOCOL_VERSION = '2.0.0'
export const LINKEDIN_DEFAULT_API_VERSION = '202608'
export const LINKEDIN_REQUIRED_SCOPES = ['openid', 'profile', 'w_member_social'] as const
export const LINKEDIN_DEFAULT_TIMEOUT_MS = 30_000

export type LinkedInPermanentFailureCode =
    | 'invalid_input'
    | 'authentication_required'
    | 'forbidden'
    | 'invalid_request'

export type LinkedInRetryableFailureCode = 'rate_limited'

export type LinkedInAmbiguousFailureCode =
    | 'network_failure'
    | 'provider_timeout'
    | 'provider_failure'
    | 'missing_post_id'
    | 'unexpected_response'

export type LinkedInPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> & {
          readonly code: LinkedInRetryableFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> & {
          readonly code: LinkedInPermanentFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> & {
          readonly code: LinkedInAmbiguousFailureCode
      })

export interface PublishLinkedInTextInput {
    readonly accessToken: string
    readonly memberId: string
    readonly commentary: string
}

export type LinkedInFetcher = (
    input: string | URL | Request,
    init?: RequestInit
) => Promise<Response>

export interface LinkedInTextPublisherOptions {
    readonly apiVersion?: string
    readonly baseUrl?: string
    readonly fetcher?: LinkedInFetcher
    readonly timeoutMs?: number
}

export interface LinkedInTextPublisher {
    publishText(input: PublishLinkedInTextInput): Promise<LinkedInPublishOutcome>
}

export interface LinkedInMemberProfile {
    readonly id: string
    readonly name: string | null
}

export interface LinkedInMemberProfileClient {
    getProfile(accessToken: string): Promise<LinkedInMemberProfile>
}
