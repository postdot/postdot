import { describe, expect, test } from 'bun:test'

import type { ProviderAnalyticsItem, PublicationSummary } from '@/lib/api'
import {
    createPerformanceProviderBatches,
    groupLatestObservations,
    groupPerformancePublications,
    providerAnalyticsBatchSize,
} from '@/lib/publication-performance'

function publication(id: string, postId: string): PublicationSummary {
    return {
        channelName: `${id} channel`,
        id,
        postId,
        postTitle: `${postId} title`,
        state: 'published',
    } as PublicationSummary
}

function observation(
    id: string,
    publicationId: string,
    metricName: string,
    fetchedAt: number,
    overrides: Partial<ProviderAnalyticsItem> = {}
): ProviderAnalyticsItem {
    return {
        availability: 'measured',
        fetchedAt,
        id,
        metricName,
        postbotEntityId: publicationId,
        postbotEntityType: 'publication',
        value: 1,
        ...overrides,
    } as ProviderAnalyticsItem
}

describe('publication performance reads', () => {
    test('batches each provider independently within the read bound', () => {
        const entries = [
            ...Array.from({ length: providerAnalyticsBatchSize + 3 }, (_, index) => ({
                provider: 'bluesky' as const,
                publicationId: `bluesky-${index}`,
            })),
            { provider: 'devto' as const, publicationId: 'devto-0' },
            { provider: 'bluesky' as const, publicationId: 'bluesky-0' },
        ]

        const batches = createPerformanceProviderBatches(entries)

        expect(batches.map(batch => [batch.provider, batch.publicationIds.length])).toEqual([
            ['bluesky', providerAnalyticsBatchSize],
            ['bluesky', 3],
            ['devto', 1],
        ])
        expect(
            batches.flatMap(batch => batch.publicationIds).every(id => !id.includes('undefined'))
        ).toBe(true)
        expect(new Set(batches.flatMap(batch => batch.publicationIds)).size).toBe(
            providerAnalyticsBatchSize + 4
        )
    })

    test('groups only the loaded destinations by source post in first-seen order', () => {
        const groups = groupPerformancePublications([
            publication('first', 'post-a'),
            publication('second', 'post-b'),
            publication('third', 'post-a'),
        ])

        expect(groups.map(group => [group.postId, group.publications.length])).toEqual([
            ['post-a', 2],
            ['post-b', 1],
        ])
        expect(groups[0]?.publications.map(item => item.id)).toEqual(['first', 'third'])
    })

    test('keeps the newest observation per metric and preserves measured zero', () => {
        const grouped = groupLatestObservations([
            observation('older', 'publication-1', 'likeCount', 10, { value: 4 }),
            observation('newer', 'publication-1', 'likeCount', 20, { value: 0 }),
            observation('same-time-a', 'publication-1', 'replyCount', 30),
            observation('same-time-b', 'publication-1', 'replyCount', 30),
            observation('unavailable', 'publication-1', 'repostCount', 40, {
                availability: 'not_found',
                value: null,
            }),
        ])

        expect(grouped.get('publication-1')?.get('likeCount')?.value).toBe(0)
        expect(grouped.get('publication-1')?.get('replyCount')?.id).toBe('same-time-b')
        expect(grouped.get('publication-1')?.get('repostCount')).toMatchObject({
            availability: 'not_found',
            value: null,
        })
    })
})
