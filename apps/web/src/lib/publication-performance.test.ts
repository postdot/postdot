import { describe, expect, test } from 'bun:test'

import type { ProviderAnalyticsItem, PublicationSummary } from '@/lib/api'
import {
    createPerformanceProviderBatches,
    groupLatestObservations,
    groupPerformancePublications,
    normalizePerformanceTagSelection,
    parsePerformanceTagSelection,
    performanceProvider,
    performanceProviderForChannel,
    performanceTagSelectionKey,
    performanceTagSelectionLimit,
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
            { provider: 'mastodon' as const, publicationId: 'mastodon-0' },
            { provider: 'mastodon' as const, publicationId: 'mastodon-0' },
            { provider: 'bluesky' as const, publicationId: 'bluesky-0' },
        ]

        const batches = createPerformanceProviderBatches(entries)

        expect(batches.map(batch => [batch.provider, batch.publicationIds.length])).toEqual([
            ['bluesky', providerAnalyticsBatchSize],
            ['bluesky', 3],
            ['devto', 1],
            ['mastodon', 1],
        ])
        expect(
            batches.flatMap(batch => batch.publicationIds).every(id => !id.includes('undefined'))
        ).toBe(true)
        expect(new Set(batches.flatMap(batch => batch.publicationIds)).size).toBe(
            providerAnalyticsBatchSize + 5
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

describe('performance provider resolution', () => {
    test('reads Mastodon capability from the native built-in execution', () => {
        expect(
            performanceProviderForChannel({
                profileId: 'mastodon',
                execution: { kind: 'built_in', contractId: 'mastodon' },
            })
        ).toBe('mastodon')
    })

    test('does not grant Mastodon capability to a custom profile named mastodon', () => {
        expect(
            performanceProviderForChannel({
                profileId: 'mastodon',
                execution: { kind: 'declarative_http' },
            })
        ).toBeNull()
        expect(
            performanceProviderForChannel({
                profileId: 'mastodon',
                execution: { kind: 'manual' },
            })
        ).toBeNull()
        expect(
            performanceProviderForChannel({
                profileId: 'mastodon',
                execution: undefined,
            })
        ).toBeNull()
    })

    test('keeps the existing Bluesky and DEV.to destinations on their identity', () => {
        expect(
            performanceProviderForChannel({
                profileId: 'bluesky',
                execution: { kind: 'built_in', contractId: 'bluesky' },
            })
        ).toBe('bluesky')
        expect(
            performanceProviderForChannel({
                profileId: 'devto',
                execution: { kind: 'built_in', contractId: 'devto' },
            })
        ).toBe('devto')
        expect(performanceProvider('bluesky')).toBe('bluesky')
        expect(performanceProvider('devto')).toBe('devto')
        expect(performanceProvider('mastodon')).toBeNull()
        expect(performanceProvider(undefined)).toBeNull()
    })

    test('reports no provider for a destination that is not in the channel list', () => {
        expect(performanceProviderForChannel(undefined)).toBeNull()
    })
})

describe('performance tag selection', () => {
    test('treats the selection as a sorted set and drops blank values', () => {
        expect(normalizePerformanceTagSelection(['tag-b', ' tag-a ', 'tag-b', '  '])).toEqual([
            'tag-a',
            'tag-b',
        ])
    })

    test('keeps the selection within the transport bound', () => {
        const selection = normalizePerformanceTagSelection(
            Array.from({ length: performanceTagSelectionLimit + 5 }, (_, index) => `tag-${index}`)
        )

        expect(selection).toHaveLength(performanceTagSelectionLimit)
        expect(selection).toEqual([...selection].toSorted())
    })

    test('reads a selection from an array, a comma list or an unknown value', () => {
        expect(parsePerformanceTagSelection(['tag-b', 'tag-a'])).toEqual(['tag-a', 'tag-b'])
        expect(parsePerformanceTagSelection('tag-b,tag-a')).toEqual(['tag-a', 'tag-b'])
        expect(parsePerformanceTagSelection(['tag-a', 'tag-a'])).toEqual(['tag-a'])
        expect(parsePerformanceTagSelection(undefined)).toBeUndefined()
        expect(parsePerformanceTagSelection('')).toBeUndefined()
        expect(parsePerformanceTagSelection(['', '   '])).toBeUndefined()
        expect(parsePerformanceTagSelection(42)).toBeUndefined()
    })

    test('gives the same query key to the same selection whatever its order', () => {
        expect(performanceTagSelectionKey(['tag-b', 'tag-a'])).toBe(
            performanceTagSelectionKey(['tag-a', 'tag-b'])
        )
        expect(performanceTagSelectionKey(['tag-a', 'tag-a'])).toBe(
            performanceTagSelectionKey(['tag-a'])
        )
        expect(performanceTagSelectionKey([])).toBe('')
    })
})
