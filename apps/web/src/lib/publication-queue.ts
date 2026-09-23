import type { PublicationSummary } from '@/lib/api'

export type QueueFilter = 'all' | 'attention' | 'draft' | 'scheduled' | 'manual'

export function filterQueuePublications(
    publications: readonly PublicationSummary[],
    duePublicationIds: ReadonlySet<string>,
    filter: QueueFilter
) {
    if (filter === 'all') return publications
    if (filter === 'attention') {
        return publications.filter(
            publication =>
                duePublicationIds.has(publication.id) ||
                publication.state === 'failed' ||
                publication.state === 'ambiguous' ||
                publication.draftReviewState === 'review_required'
        )
    }
    if (filter === 'draft') {
        return publications.filter(publication => publication.state === 'draft')
    }
    if (filter === 'scheduled') {
        return publications.filter(publication => publication.state === 'scheduled')
    }
    return publications.filter(publication => publication.deliveryMode === 'manual')
}

export function isQueueFilter(value: string): value is QueueFilter {
    return (
        value === 'all' ||
        value === 'attention' ||
        value === 'draft' ||
        value === 'scheduled' ||
        value === 'manual'
    )
}

export function filterQueueByTags(
    publications: readonly PublicationSummary[],
    selectedTagIds: readonly string[]
) {
    if (selectedTagIds.length === 0) return publications

    return publications.filter(publication => {
        const publicationTagIds = new Set(publication.tagIds)
        return selectedTagIds.every(tagId => publicationTagIds.has(tagId))
    })
}
