import {
    BLUESKY_PROVIDER,
    collectBlueskyAnalytics,
    createBlueskyAnalyticsReader,
    type BlueskyFetcher,
} from '@herald/bluesky'
import {
    providerAnalyticsContractVersion,
    requireNonBlank,
    requireTimestamp,
    type ProviderAnalyticsObservation,
} from '@herald/core'
import type { ProviderAnalyticsStore } from '@herald/db'

import type { PublisherRuntime } from '../publishers/runtime'

export interface BlueskyAnalyticsCollectionResponse {
    readonly contractVersion: typeof providerAnalyticsContractVersion
    readonly projectId: string
    readonly provider: typeof BLUESKY_PROVIDER
    readonly fetchedAt: number
    readonly inserted: number
    readonly duplicates: number
    readonly observations: readonly ProviderAnalyticsObservation[]
}

export interface BlueskyAnalyticsServiceOptions {
    readonly providerAnalytics: ProviderAnalyticsStore
    readonly publisher: PublisherRuntime
    readonly fetcher?: BlueskyFetcher
    readonly now?: () => number
}

export interface CollectBlueskyAnalyticsRequest {
    readonly projectId: string
    readonly subjectId: string
    readonly channelId: string
    readonly publicationIds?: readonly string[]
}

export function createBlueskyAnalyticsService(options: BlueskyAnalyticsServiceOptions) {
    const reader = createBlueskyAnalyticsReader({ fetcher: options.fetcher })
    const now = options.now ?? Date.now

    return {
        async collect(
            input: CollectBlueskyAnalyticsRequest
        ): Promise<BlueskyAnalyticsCollectionResponse | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const connections = options.publisher.publisherStore.listPublisherConnections(
                projectId,
                subjectId
            )
            if (connections === null) return null

            const connection = connections.find(
                candidate =>
                    candidate.channelId === channelId &&
                    candidate.kind === BLUESKY_PROVIDER &&
                    candidate.providerId === BLUESKY_PROVIDER
            )
            if (connection === undefined) return null

            const knownContent = options.providerAnalytics.listKnownProviderContent({
                projectId,
                subjectId,
                provider: BLUESKY_PROVIDER,
                channelId,
                publicationIds: input.publicationIds,
                limit: 25,
            })
            if (knownContent === null) return null

            const accountId = connection.destination?.id ?? connection.externalAccountId
            const accountLabel =
                connection.destination?.name ?? connection.externalAccountName ?? null
            const fetchedAt = requireTimestamp(now(), 'analytics fetchedAt')
            const collection = await collectBlueskyAnalytics({
                reader,
                projectId,
                account: {
                    providerSubjectId: accountId,
                    providerSubjectLabel: accountLabel,
                    heraldEntityId: channelId,
                },
                contents: knownContent.map(content => ({
                    providerSubjectId: content.providerSubjectId,
                    heraldEntityId: content.heraldEntityId,
                })),
                fetchedAt,
            })
            const recorded = options.providerAnalytics.recordObservations({
                projectId,
                subjectId,
                observations: collection.observations,
            })
            if (recorded === null) return null

            return {
                contractVersion: providerAnalyticsContractVersion,
                projectId,
                provider: BLUESKY_PROVIDER,
                fetchedAt,
                inserted: recorded.inserted,
                duplicates: recorded.duplicates,
                observations: recorded.observations,
            }
        },
    }
}

export type BlueskyAnalyticsService = ReturnType<typeof createBlueskyAnalyticsService>
