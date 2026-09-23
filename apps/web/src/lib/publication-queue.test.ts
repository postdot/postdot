import { describe, expect, test } from 'bun:test'

import type { PublicationSummary } from '@/lib/api'
import { filterQueueByTags, filterQueuePublications } from '@/lib/publication-queue'

type TestPublicationSummary = PublicationSummary & {
    readonly tagIds?: readonly string[]
}

function publication(
    id: string,
    overrides: Partial<TestPublicationSummary> = {}
): TestPublicationSummary {
    return {
        channelName: 'Channel',
        createdAt: 1,
        deliveryMode: 'automatic',
        draftDiffersFromTarget: false,
        draftReviewState: 'compatible',
        draftRevision: 1,
        id,
        postId: `post-${id}`,
        postTitle: id,
        projectId: 'project-1',
        scheduledAt: null,
        state: 'draft',
        tagIds: [],
        updatedAt: 1,
        ...overrides,
    } as PublicationSummary
}

describe('publication queue filters', () => {
    const publications = [
        publication('draft'),
        publication('scheduled', { scheduledAt: 2, state: 'scheduled' }),
        publication('manual', { deliveryMode: 'manual' }),
        publication('due', { deliveryMode: 'manual', scheduledAt: 3, state: 'ready' }),
        publication('failed', { scheduledAt: 4, state: 'failed' }),
        publication('review', { draftReviewState: 'review_required' }),
    ]

    test('keeps the source order for the all filter', () => {
        expect(filterQueuePublications(publications, new Set(['due']), 'all')).toEqual(publications)
    })

    test('uses durable due ids for the attention filter', () => {
        expect(filterQueuePublications(publications, new Set(['due']), 'attention')).toEqual([
            publications[3]!,
            publications[4]!,
            publications[5]!,
        ])
    })

    test('filters scheduled and manual work without changing order', () => {
        expect(filterQueuePublications(publications, new Set(), 'scheduled')).toEqual([
            publications[1]!,
        ])
        expect(filterQueuePublications(publications, new Set(), 'manual')).toEqual([
            publications[2]!,
            publications[3]!,
        ])
        expect(filterQueuePublications(publications, new Set(), 'draft')).toEqual([
            publications[0]!,
            publications[2]!,
            publications[5]!,
        ])
    })

    test('requires every selected tag', () => {
        const tagged = [
            publication('release', { tagIds: ['release', 'external'] }),
            publication('internal', { tagIds: ['release'] }),
        ]

        expect(filterQueueByTags(tagged, ['release'])).toEqual(tagged)
        expect(filterQueueByTags(tagged, ['release', 'external'])).toEqual([tagged[0]!])
        expect(filterQueueByTags(tagged, [])).toEqual(tagged)
    })
})
