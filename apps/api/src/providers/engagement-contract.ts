import type { BlueskyFetcher, restoreBlueskySession } from '@postdot/bluesky'
import type { ExternalEffectOutcome } from '@postdot/core'
import type { PublicationFirstComment, PublicationReplyWork } from '@postdot/db'

import type { PublisherRuntime } from '../modules/publishers/runtime'
export interface EngagementContext {
    readonly publisher: PublisherRuntime
    readonly signal: AbortSignal
    readonly now: number
    readonly stillEligible: () => boolean
    readonly onDispatch: () => void
    readonly restoreSession?: typeof restoreBlueskySession
    readonly contextFetcher?: BlueskyFetcher
}
export type PreparedFirstComment = PublicationFirstComment & {
    rootUri: string
    accountId: string
    credentialId: string
}
export interface ProviderEngagement {
    readonly id: string
    readonly textValid: (text: string) => boolean
    readonly resolveReply: (
        externalId: string,
        externalUrl: string | null
    ) => { rootUri: string; accountId: string | null; origin: string | null } | null
    readonly parentAllowed: (parentUri: string, origin: string | null) => boolean
    readonly recordKey: (requestId: string) => string
    readonly firstComment: (
        work: PreparedFirstComment,
        context: EngagementContext
    ) => Promise<ExternalEffectOutcome>
    readonly reply: (
        work: PublicationReplyWork,
        context: EngagementContext
    ) => Promise<ExternalEffectOutcome>
}
