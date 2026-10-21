import {
    providerAnalyticsContractVersion,
    requireNonBlank,
    requireTimestamp,
    type ProviderAnalyticsAvailability,
    type ProviderAnalyticsObservation,
    type ProviderAnalyticsObservationInput,
} from '@postdot/core'
import type { ProviderAnalyticsStore } from '@postdot/db'
import {
    DEVTO_PROVIDER,
    createDevtoPublisher,
    type DevtoFetcher,
    type DevtoOperationFailure,
} from '@postdot/devto'

import type { PublisherRuntime } from '../publishers/runtime'

const metricNames = ['comments', 'reactions', 'page_views'] as const

export interface DevtoAnalyticsCollectionResponse {
    readonly contractVersion: typeof providerAnalyticsContractVersion
    readonly projectId: string
    readonly provider: typeof DEVTO_PROVIDER
    readonly fetchedAt: number
    readonly inserted: number
    readonly duplicates: number
    readonly observations: readonly ProviderAnalyticsObservation[]
}

export interface DevtoAnalyticsServiceOptions {
    readonly providerAnalytics: ProviderAnalyticsStore
    readonly publisher: PublisherRuntime
    readonly fetcher?: DevtoFetcher
    readonly now?: () => number
}

export interface CollectDevtoAnalyticsRequest {
    readonly projectId: string
    readonly subjectId: string
    readonly channelId: string
    readonly publicationId: string
}

function availabilityForFailure(failure: DevtoOperationFailure): ProviderAnalyticsAvailability {
    if (failure.type === 'retryable_failure') {
        return failure.code === 'rate_limited' ? 'rate_limited' : 'temporarily_unavailable'
    }
    if (failure.type === 'permanent_failure') {
        switch (failure.code) {
            case 'authentication_required':
            case 'forbidden':
                return 'not_authorized'
            case 'invalid_request':
                return 'not_found'
            case 'invalid_input':
                return 'invalid_response'
        }
    }
    return 'temporarily_unavailable'
}

export function createDevtoAnalyticsService(options: DevtoAnalyticsServiceOptions) {
    const devto = createDevtoPublisher(
        options.fetcher === undefined ? {} : { fetcher: options.fetcher }
    )
    const now = options.now ?? Date.now

    return {
        async collect(
            input: CollectDevtoAnalyticsRequest
        ): Promise<DevtoAnalyticsCollectionResponse | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            const knownContent = options.providerAnalytics.listKnownProviderContent({
                projectId,
                subjectId,
                provider: DEVTO_PROVIDER,
                channelId,
                publicationIds: [publicationId],
                limit: 1,
            })
            if (knownContent === null || knownContent.length !== 1) return null

            const content = knownContent[0]
            if (content === undefined) return null

            const connections = options.publisher.publisherStore.listPublisherConnections(
                projectId,
                subjectId
            )
            if (connections === null) return null

            const connection = connections.find(
                candidate =>
                    candidate.channelId === channelId &&
                    candidate.kind === DEVTO_PROVIDER &&
                    candidate.providerId === DEVTO_PROVIDER
            )
            const fetchedAt = requireTimestamp(now(), 'analytics fetchedAt')
            let values: Readonly<Record<(typeof metricNames)[number], number>> | null = null
            let availability: ProviderAnalyticsAvailability = 'measured'

            if (connection === undefined) {
                availability = 'not_configured'
            } else if (connection.state !== 'active') {
                availability = 'not_authorized'
            } else {
                const secrets =
                    await options.publisher.credentialStore.resolvePublisherCredentialSecrets(
                        projectId,
                        connection.credentialId
                    )
                if (secrets === null) {
                    availability = 'not_authorized'
                } else {
                    const result = await devto.getArticleAnalytics({
                        apiKey: secrets.accessToken,
                        articleId: content.providerSubjectId,
                    })
                    if (result.kind === 'success') {
                        values = {
                            comments: result.value.comments,
                            reactions: result.value.reactions,
                            page_views: result.value.pageViews,
                        }
                    } else {
                        availability = availabilityForFailure(result.outcome)
                    }
                }
            }

            const observations: ProviderAnalyticsObservationInput[] = metricNames.map(
                metricName => ({
                    projectId,
                    provider: DEVTO_PROVIDER,
                    subjectType: 'content',
                    providerSubjectId: content.providerSubjectId,
                    providerSubjectLabel: null,
                    providerContentRevisionId: null,
                    postbotEntityType: 'publication',
                    postbotEntityId: content.postbotEntityId,
                    metricName,
                    value: values?.[metricName] ?? null,
                    unit: 'count',
                    aggregation: 'cumulative_snapshot',
                    reportingPeriodStart: null,
                    reportingPeriodEnd: null,
                    observedAt: null,
                    fetchedAt,
                    availability: values === null ? availability : 'measured',
                    freshness: 'unknown',
                    provenance: 'forem.api.analytics.totals',
                })
            )
            const recorded = options.providerAnalytics.recordObservations({
                projectId,
                subjectId,
                observations,
            })
            if (recorded === null) return null

            return {
                contractVersion: providerAnalyticsContractVersion,
                projectId,
                provider: DEVTO_PROVIDER,
                fetchedAt,
                inserted: recorded.inserted,
                duplicates: recorded.duplicates,
                observations: recorded.observations,
            }
        },
    }
}

export type DevtoAnalyticsService = ReturnType<typeof createDevtoAnalyticsService>
