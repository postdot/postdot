import {
    providerAnalyticsContractVersion,
    requireNonBlank,
    requireTimestamp,
    type ProviderAnalyticsAvailability,
    type ProviderAnalyticsObservation,
    type ProviderAnalyticsObservationInput,
} from '@postbot/core'
import { createNetworkControlledFetcher } from '@postbot/custom-http'
import type { AccessStore, ProviderAnalyticsStore } from '@postbot/db'
import {
    createMastodonAnalyticsReader,
    resolveMastodonStatusReference,
    type MastodonAnalyticsReader,
} from '@postbot/mastodon'

import type { ManualStore } from './types'

const metricNames = ['favourites_count', 'reblogs_count', 'replies_count'] as const

export interface MastodonAnalyticsCollectionResponse {
    readonly contractVersion: typeof providerAnalyticsContractVersion
    readonly projectId: string
    readonly provider: 'mastodon'
    readonly fetchedAt: number
    readonly inserted: number
    readonly duplicates: number
    readonly observations: readonly ProviderAnalyticsObservation[]
}

export function createMastodonAnalyticsService(options: {
    readonly providerAnalytics: ProviderAnalyticsStore
    readonly manual: Pick<ManualStore, 'getPublicationEditorState'>
    readonly access: Pick<AccessStore, 'canAccessProject'>
    readonly reader?: MastodonAnalyticsReader
    readonly now?: () => number
}) {
    const reader =
        options.reader ??
        createMastodonAnalyticsReader({ fetcher: createNetworkControlledFetcher() })
    const now = options.now ?? Date.now
    function identity(
        projectId: string,
        publicationId: string,
        subjectId: string,
        channelId: string
    ) {
        const editor = options.manual.getPublicationEditorState(projectId, publicationId, subjectId)
        if (
            !editor ||
            editor.publication.state !== 'published' ||
            editor.publication.channelId !== channelId ||
            editor.publication.externalId === null
        )
            return null
        const execution = editor.profile.profile.execution
        if (execution.kind !== 'built_in' || execution.contractId !== 'mastodon') return null
        return {
            externalId: editor.publication.externalId,
            externalUrl: editor.publication.externalUrl,
        }
    }
    return {
        async collect(input: {
            readonly projectId: string
            readonly subjectId: string
            readonly channelId: string
            readonly publicationId: string
        }): Promise<MastodonAnalyticsCollectionResponse | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            if (!options.access.canAccessProject(projectId, subjectId, 'editor')) return null
            const initial = identity(projectId, publicationId, subjectId, channelId)
            if (!initial) return null
            const reference = resolveMastodonStatusReference(
                initial.externalId,
                initial.externalUrl
            )
            let availability: ProviderAnalyticsAvailability = 'not_supported'
            let metrics:
                | Extract<
                      Awaited<ReturnType<MastodonAnalyticsReader['getStatusMetrics']>>,
                      { kind: 'available' }
                  >['metrics']
                | null = null
            if (reference) {
                try {
                    const result = await reader.getStatusMetrics(reference)
                    if (result.requestedUri !== reference.rootUri) availability = 'invalid_response'
                    else if (result.kind === 'available') metrics = result.metrics
                    else availability = result.availability
                } catch {
                    availability = 'temporarily_unavailable'
                }
            }
            // Provider reads are asynchronous; lost editor access or a changed
            // retained receipt must not be recorded under the original identity.
            if (!options.access.canAccessProject(projectId, subjectId, 'editor')) return null
            const current = identity(projectId, publicationId, subjectId, channelId)
            if (
                !current ||
                current.externalId !== initial.externalId ||
                current.externalUrl !== initial.externalUrl
            )
                return null
            const fetchedAt = requireTimestamp(now(), 'analytics fetchedAt')
            const observations: ProviderAnalyticsObservationInput[] = metricNames.map(
                metricName => ({
                    projectId,
                    provider: 'mastodon',
                    subjectType: 'content',
                    providerSubjectId:
                        reference?.rootUri ?? initial.externalUrl ?? initial.externalId,
                    providerSubjectLabel: null,
                    providerContentRevisionId: null,
                    postbotEntityType: 'publication',
                    postbotEntityId: publicationId,
                    metricName,
                    value: metrics?.[metricName].value ?? null,
                    unit: 'count',
                    aggregation: 'cumulative_snapshot',
                    reportingPeriodStart: null,
                    reportingPeriodEnd: null,
                    observedAt: null,
                    fetchedAt,
                    availability: metrics?.[metricName].availability ?? availability,
                    freshness: 'unknown',
                    provenance: 'mastodon.api.status.counts',
                })
            )
            const recorded = options.providerAnalytics.recordObservations({
                projectId,
                subjectId,
                observations,
            })
            if (!recorded) return null
            return {
                contractVersion: providerAnalyticsContractVersion,
                projectId,
                provider: 'mastodon',
                fetchedAt,
                inserted: recorded.inserted,
                duplicates: recorded.duplicates,
                observations: recorded.observations,
            }
        },
    }
}

export type MastodonAnalyticsService = ReturnType<typeof createMastodonAnalyticsService>
