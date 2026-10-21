import { publicationTagFilterMaximumIds } from '@postdot/core'

import type { ChannelListItem, ProviderAnalyticsItem, PublicationSummary } from '@/lib/api'
import { getNativePlatform } from '@/lib/native-presentation'

export type PerformanceProvider = 'bluesky' | 'devto' | 'mastodon'

export const providerAnalyticsBatchSize = 25

/**
 * Maximum number of tag IDs a Performance tag selection may carry.
 *
 * The transport rejects a longer selection, so the browser normalizes to the
 * same bound instead of sending a request that is guaranteed to fail.
 */
export const performanceTagSelectionLimit = publicationTagFilterMaximumIds

export interface PerformanceProviderBatch {
    readonly provider: PerformanceProvider
    readonly publicationIds: readonly string[]
}

export interface PerformancePublicationGroup {
    readonly postId: string
    readonly publications: readonly PublicationSummary[]
}

export interface PerformanceChannelIdentity {
    readonly profileId: string | undefined
    readonly execution: ChannelListItem['execution'] | undefined
}

/**
 * Resolve the provider whose observations a destination already exposes.
 *
 * The destination identity alone grants this capability, so it stays limited to
 * the providers that have always been read this way.
 */
export function performanceProvider(profileId: string | undefined): 'bluesky' | 'devto' | null {
    return profileId === 'bluesky' || profileId === 'devto' ? profileId : null
}

/**
 * Resolve the provider whose observations a channel may show.
 *
 * Mastodon observations exist only for the native built-in execution, so that
 * capability is read from the execution summary. A custom profile that happens
 * to be named `mastodon` describes a different destination and gains no provider
 * capability from its name.
 */
export function performanceProviderForChannel(
    channel: PerformanceChannelIdentity | undefined
): PerformanceProvider | null {
    if (channel === undefined) return null
    if (getNativePlatform(channel.execution) === 'mastodon') return 'mastodon'
    return performanceProvider(channel.profileId)
}

export function createPerformanceProviderBatches(
    entries: readonly { readonly publicationId: string; readonly provider: PerformanceProvider }[]
): PerformanceProviderBatch[] {
    const idsByProvider = new Map<PerformanceProvider, string[]>()
    const seen = new Set<string>()
    for (const entry of entries) {
        const key = `${entry.provider}:${entry.publicationId}`
        if (seen.has(key)) continue
        seen.add(key)
        const publicationIds = idsByProvider.get(entry.provider) ?? []
        publicationIds.push(entry.publicationId)
        idsByProvider.set(entry.provider, publicationIds)
    }

    return [...idsByProvider].flatMap(([provider, publicationIds]) => {
        const batches: PerformanceProviderBatch[] = []
        for (let index = 0; index < publicationIds.length; index += providerAnalyticsBatchSize) {
            batches.push({
                provider,
                publicationIds: publicationIds.slice(index, index + providerAnalyticsBatchSize),
            })
        }
        return batches
    })
}

export function groupPerformancePublications(
    publications: readonly PublicationSummary[]
): PerformancePublicationGroup[] {
    const groups = new Map<string, PublicationSummary[]>()
    for (const publication of publications) {
        const group = groups.get(publication.postId)
        if (group === undefined) {
            groups.set(publication.postId, [publication])
        } else {
            group.push(publication)
        }
    }
    return [...groups].map(([postId, groupPublications]) => ({
        postId,
        publications: groupPublications,
    }))
}

/**
 * Normalize a Performance tag selection.
 *
 * Tag IDs form an unordered set: blank values are dropped, duplicates collapse
 * and the remaining IDs are sorted, so the same selection always produces the
 * same query key and the same request. The selection stays within the
 * transport bound.
 */
export function normalizePerformanceTagSelection(tagIds: readonly string[]): string[] {
    const normalized = [
        ...new Set(tagIds.map(tagId => tagId.trim()).filter(tagId => tagId.length > 0)),
    ]
    normalized.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    return normalized.slice(0, performanceTagSelectionLimit)
}

/**
 * Read a Performance tag selection from a route search value.
 *
 * The selection arrives either as a JSON array or as a comma-separated list.
 * An unknown or empty selection resolves to no filter at all.
 */
export function parsePerformanceTagSelection(value: unknown): string[] | undefined {
    const values = Array.isArray(value) ? value : [value]
    const selection = normalizePerformanceTagSelection(
        values.flatMap(item => (typeof item === 'string' ? item.split(',') : []))
    )
    return selection.length > 0 ? selection : undefined
}

/**
 * Stable query-key fragment for a Performance tag selection.
 */
export function performanceTagSelectionKey(tagIds: readonly string[]): string {
    return normalizePerformanceTagSelection(tagIds).join('\u0000')
}

export function groupLatestObservations(observations: readonly ProviderAnalyticsItem[]) {
    const grouped = new Map<string, Map<string, ProviderAnalyticsItem>>()
    for (const observation of observations) {
        if (
            observation.postbotEntityType !== 'publication' ||
            observation.postbotEntityId === null
        ) {
            continue
        }
        const publicationMetrics = grouped.get(observation.postbotEntityId) ?? new Map()
        const current = publicationMetrics.get(observation.metricName)
        if (
            current === undefined ||
            observation.fetchedAt > current.fetchedAt ||
            (observation.fetchedAt === current.fetchedAt && observation.id > current.id)
        ) {
            publicationMetrics.set(observation.metricName, observation)
        }
        grouped.set(observation.postbotEntityId, publicationMetrics)
    }
    return grouped
}
