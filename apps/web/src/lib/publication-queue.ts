import type { PublicationSummary } from '@/lib/api'

export type QueueFilter = 'all' | 'attention' | 'draft' | 'scheduled' | 'manual'
export type PublicationQueueSort =
    | 'queue'
    | 'updated_desc'
    | 'updated_asc'
    | 'created_desc'
    | 'created_asc'
    | 'scheduled_desc'
    | 'scheduled_asc'

export function defaultPublicationQueueSort(filter: QueueFilter): PublicationQueueSort {
    return filter === 'draft' ? 'updated_desc' : 'queue'
}

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

export function isPublicationQueueSort(value: string): value is PublicationQueueSort {
    return (
        value === 'queue' ||
        value === 'updated_desc' ||
        value === 'updated_asc' ||
        value === 'created_desc' ||
        value === 'created_asc' ||
        value === 'scheduled_desc' ||
        value === 'scheduled_asc'
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
