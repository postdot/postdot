import type { ExternalEffectOutcome } from '@postbot/core'
import type { PublicationReplyWork } from '@postbot/db'
import { createMastodonPublisher, resolveMastodonReplyContext } from '@postbot/mastodon'
import { clientSecretPost, refreshAccessToken } from '@postbot/oauth'

import {
    parseProviderSession,
    mastodonAuthorizationServer,
    expiryFromSeconds,
} from '../publishers/mastodon-session'
import type { PublisherRuntime } from '../publishers/runtime'

export async function performMastodonReply(input: {
    work: PublicationReplyWork
    publisher: PublisherRuntime
    signal: AbortSignal
    stillEligible: () => boolean
    onDispatch: () => void
    now: number
}): Promise<ExternalEffectOutcome> {
    const { work, publisher, signal } = input
    const origin = work.instanceOrigin
    const credential = publisher.credentialStore.getPublisherCredential(
        work.projectId,
        work.credentialId
    )
    const secrets = await publisher.credentialStore.resolvePublisherCredentialSecrets(
        work.projectId,
        work.credentialId
    )
    const session = parseProviderSession(secrets?.providerSession ?? null)
    if (!origin || !credential || !secrets || !session || session.instanceUrl !== origin)
        return failed('Reconnect the original Mastodon account to reply')
    let accessToken = secrets.accessToken
    // The runtime owns the same network-controlled transport used for connection and publication.
    const fetcher = publisher.mastodon.fetcher
    if (!fetcher) return failed('The Mastodon reply transport is unavailable')
    if (credential.expiresAt !== null && credential.expiresAt <= input.now) {
        if (!secrets.refreshToken) return failed('Reconnect the original Mastodon account to reply')
        const refreshed = await refreshAccessToken({
            authorizationServer: mastodonAuthorizationServer(origin),
            clientId: session.clientId,
            clientAuthentication: clientSecretPost(session.clientSecret),
            refreshToken: secrets.refreshToken,
            fetcher: (url, init) => fetcher(url, { ...init, signal }),
        })
        const saved = await publisher.credentialStore.replacePublisherCredentialTokens({
            projectId: work.projectId,
            credentialId: work.credentialId,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? undefined,
            expiresAt: expiryFromSeconds(refreshed.expiresInSeconds, input.now),
        })
        if (saved.kind !== 'updated')
            return failed('The refreshed Mastodon credential could not be saved')
        accessToken = refreshed.accessToken
    }
    const context = await resolveMastodonReplyContext({
        origin,
        rootUri: work.rootUri,
        parentUri: work.parentUri,
        accountId: work.accountId,
        accessToken,
        signal,
        fetcher,
    })
    if (!context)
        return failed('The original Mastodon account or public conversation is no longer available')
    if (signal.aborted || !input.stillEligible())
        return failed('The reply is no longer eligible for dispatch')
    input.onDispatch()
    return createMastodonPublisher({ baseUrl: origin, fetcher }).publishStatus({
        accessToken,
        text: work.text,
        mediaIds: [],
        visibility: context.visibility,
        reply: { parentId: context.parentId, accountId: work.accountId },
        idempotencyKey: `reply:${work.recordKey}`,
        signal,
    })
}
function failed(errorMessage: string): ExternalEffectOutcome {
    return { type: 'permanent_failure', effectOccurred: false, errorMessage }
}
