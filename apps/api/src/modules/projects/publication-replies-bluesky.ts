import { Agent } from '@atproto/api'
import {
    createBlueskyReplyPublisher,
    resolveBlueskyReplyContext,
    readBlueskySessionTokenSet,
    restoreBlueskySession,
    type BlueskyFetcher,
} from '@postdot/bluesky'
import type { ExternalEffectOutcome } from '@postdot/core'

import type { PublisherRuntime } from '../publishers/runtime'

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
    const oauth = await options.publisher.resolveBlueskyOAuth(
        options.publisher.credentialStore.getPublisherCredential(work.projectId, work.credentialId)
            ?.providerApplicationId ?? null
    )
    const secrets = await options.publisher.credentialStore.resolvePublisherCredentialSecrets(
        work.projectId,
        work.credentialId
    )
    if (!oauth || !secrets?.providerSession)
        return failed('Reconnect the original Bluesky account to reply')
    const restored = await (options.restoreSession ?? restoreBlueskySession)({
        sub: work.accountId,
        serializedSession: secrets.providerSession,
        client: oauth,
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
    const serialized = restored.getSerializedSession()
    const token = readBlueskySessionTokenSet(serialized)
    if (!token || token.sub !== work.accountId) return failed('The Bluesky session is invalid')
    if (serialized !== secrets.providerSession) {
        const result = await options.publisher.credentialStore.replacePublisherCredentialTokens({
            projectId: work.projectId,
            credentialId: work.credentialId,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken ?? undefined,
            providerSession: serialized,
            expiresAt:
                token.expiresAt === null
                    ? null
                    : Number.isSafeInteger(Date.parse(token.expiresAt))
                      ? Date.parse(token.expiresAt)
                      : null,
        })
        if (result.kind !== 'updated')
            return failed('The refreshed Bluesky session could not be saved')
    }
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
