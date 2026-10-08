import type { ExternalEffectOutcome } from '@herald/core'

export const DISCORD_PROVIDER = 'discord' as const
export const DISCORD_API_BASE_URL = 'https://discord.com' as const
export const DISCORD_API_VERSION = 'v10' as const
export const DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION = 'message-v1' as const
export const DISCORD_EXECUTION_CONTRACT_REVISION = 'message-v2' as const
export const DISCORD_MAX_CONTENT_LENGTH = 2_000 as const
export const DISCORD_MAX_ATTACHMENTS = 10 as const
export const DISCORD_MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const DISCORD_MAX_VIDEO_BYTES = 10 * 1024 * 1024
export const DISCORD_MAX_DESCRIPTION_LENGTH = 1_024 as const
export const DISCORD_DEFAULT_TIMEOUT_MS = 30_000 as const

export const DISCORD_TEXT_CHANNEL_TYPES = [0, 5] as const
export type DiscordTextChannelType = (typeof DISCORD_TEXT_CHANNEL_TYPES)[number]

export type DiscordDestination = {
    readonly type: 'channel'
    readonly id: string
    readonly name: string | null
}

export type DiscordPermanentFailureCode =
    | 'invalid_input'
    | 'authentication_required'
    | 'forbidden'
    | 'invalid_request'

export type DiscordRetryableFailureCode = 'rate_limited' | 'provider_failure'

export type DiscordAmbiguousFailureCode =
    | 'network_failure'
    | 'provider_timeout'
    | 'provider_failure'
    | 'missing_message_id'
    | 'missing_attachment_id'
    | 'unexpected_response'

export type DiscordPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
          readonly externalUrl?: string
          readonly attachmentIds?: readonly string[]
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> & {
          readonly code: DiscordRetryableFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> & {
          readonly code: DiscordPermanentFailureCode
      })
    | (Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> & {
          readonly code: DiscordAmbiguousFailureCode
      })

export type DiscordOperationFailure = DiscordPublishOutcome extends infer Outcome
    ? Outcome extends { readonly type: 'published' }
        ? never
        : Outcome
    : never

export type DiscordOperationResult<Value> =
    | { readonly kind: 'success'; readonly value: Value }
    | { readonly kind: 'failure'; readonly outcome: DiscordOperationFailure }

export interface DiscordBotUser {
    readonly id: string
    readonly username: string
}

export interface DiscordChannel {
    readonly id: string
    readonly name: string | null
    readonly type: number
}

export interface DiscordMessageAttachmentInput {
    readonly filename: string
    readonly contentType: 'image/jpeg' | 'image/png' | 'video/mp4'
    readonly description: string
    readonly stream: ReadableStream<Uint8Array>
}

export interface CreateDiscordMessageInput {
    readonly accessToken: string
    readonly channelId: string
    readonly content: string
    readonly attachments: readonly DiscordMessageAttachmentInput[]
}

export interface DiscordPublisher {
    getBotUser(accessToken: string): Promise<DiscordOperationResult<DiscordBotUser>>
    getChannel(
        accessToken: string,
        channelId: string
    ): Promise<DiscordOperationResult<DiscordChannel>>
    createMessage(input: CreateDiscordMessageInput): Promise<DiscordPublishOutcome>
}

export type DiscordFetcher = (
    input: string | URL | Request,
    init?: RequestInit
) => Promise<Response>

export interface DiscordPublisherOptions {
    readonly baseUrl?: string
    readonly fetcher?: DiscordFetcher
    readonly timeoutMs?: number
}
