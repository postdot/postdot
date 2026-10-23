import type { ExternalEffectOutcome } from '@postdot/core'
import { createMastodonPublisher, resolveMastodonFirstCommentContext } from '@postdot/mastodon'

import type { PublisherRuntime } from '../../modules/publishers/runtime'
import { prepareMastodonReplyAccount } from './reply'

export async function performMastodonFirstComment(input: {
    readonly work: {
        readonly projectId: string
        readonly credentialId: string
        readonly instanceOrigin: string | null
        readonly accountId: string
        readonly rootUri: string
        readonly text: string
        readonly recordKey: string
    }
    readonly publisher: PublisherRuntime
    readonly signal: AbortSignal
    readonly now: number
    readonly stillEligible: () => boolean
    readonly onDispatch: () => void
}): Promise<ExternalEffectOutcome> {
    const prepared = await prepareMastodonReplyAccount(input)
    if (prepared.kind === 'failed') return prepared.outcome
    const { origin, fetcher, accessToken } = prepared
    const context = await resolveMastodonFirstCommentContext({
        origin,
        rootUri: input.work.rootUri,
        accountId: input.work.accountId,
        accessToken,
        fetcher,
        signal: input.signal,
    })
    if (!context)
        return failed('The original Mastodon account or public parent is no longer available')
    if (input.signal.aborted || !input.stillEligible())
        return failed('The first comment is no longer eligible for dispatch')
    input.onDispatch()
    return createMastodonPublisher({ baseUrl: origin, fetcher }).publishStatus({
        accessToken,
        text: input.work.text,
        mediaIds: [],
        visibility: context.visibility,
        reply: { parentId: context.parentId, accountId: input.work.accountId },
        idempotencyKey: `first-comment:${input.work.recordKey}`,
        signal: input.signal,
    })
}
function failed(errorMessage: string): ExternalEffectOutcome {
    return { type: 'permanent_failure', effectOccurred: false, errorMessage }
}
