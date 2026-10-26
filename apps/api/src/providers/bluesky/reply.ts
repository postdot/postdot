import { Agent } from '@atproto/api'
import {
    createBlueskyReplyPublisher,
    resolveBlueskyReplyContext,
    type restoreBlueskySession,
    type BlueskyFetcher,
} from '@postdot/bluesky'
import type { ExternalEffectOutcome } from '@postdot/core'

import type { PublisherRuntime } from '../../modules/publishers/runtime'
import { restoreCredentialBlueskySession } from './credential-session'

export interface BlueskyOutgoingReply {
    readonly projectId: string
    readonly credentialId: string
    readonly accountId: string
    readonly rootUri: string
    readonly parentUri: string
    readonly text: string
    readonly recordKey: string
    readonly createdAt: number
}

/** Both outgoing intents retain their own authorization and durable claim boundaries. */
export async function performBlueskyReply(options: {
    readonly work: BlueskyOutgoingReply
    readonly publisher: PublisherRuntime
    readonly restoreSession?: typeof restoreBlueskySession
    readonly contextFetcher?: BlueskyFetcher
    readonly signal: AbortSignal
    readonly stillEligible: () => boolean
    readonly onDispatch: () => void
}): Promise<ExternalEffectOutcome> {
    const { work, signal } = options
    const restored = await restoreCredentialBlueskySession({
        projectId: work.projectId,
        credentialId: work.credentialId,
        accountId: work.accountId,
        credentials: options.publisher.credentialStore,
        resolveOAuth: options.publisher.resolveBlueskyOAuth,
        restoreSession: options.restoreSession,
        signal,
    })
    const grant = await restored.session.getTokenInfo()
    if (
        restored.session.did !== work.accountId ||
        !grant.scope
            .split(/\s+/)
            .some(
                scope =>
                    scope === 'repo:app.bsky.feed.post?action=create' ||
                    scope === 'transition:generic'
            )
    )
        return failed('The Bluesky account has not granted permission to create replies')
    const context = await resolveBlueskyReplyContext({
        rootUri: work.rootUri,
        parentUri: work.parentUri,
        signal,
        fetcher: options.contextFetcher,
    })
    if (!context) return failed('The comment or its conversation is no longer available')
    if (signal.aborted || !options.stillEligible())
        return failed('The reply is no longer eligible for dispatch')
    const agent = new Agent(restored.session)
    options.onDispatch()
    return await createBlueskyReplyPublisher({
        did: agent.did,
        createRecord: (input, callOptions) =>
            agent.com.atproto.repo.createRecord(input, callOptions),
    }).publish(
        {
            ...context,
            text: work.text,
            recordKey: work.recordKey,
            createdAt: work.createdAt,
        },
        signal
    )
}

function failed(errorMessage: string): ExternalEffectOutcome {
    return { type: 'permanent_failure', effectOccurred: false, errorMessage }
}
