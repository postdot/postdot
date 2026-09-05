import type { PublicationSummary } from '@/lib/api'

export type QueueFilter = 'all' | 'attention' | 'scheduled' | 'manual'

export function filterQueuePublications(
    publications: readonly PublicationSummary[],
    duePublicationIds: ReadonlySet<string>,
    filter: QueueFilter
) {
    if (filter === 'all') return publications
    if (filter === 'attention') {
        return publications.filter(publication => duePublicationIds.has(publication.id))
    }
    if (filter === 'scheduled') {
        return publications.filter(publication => publication.scheduledAt !== null)
    }
    return publications.filter(publication => publication.deliveryMode === 'manual')
}

export function isQueueFilter(value: string): value is QueueFilter {
    return value === 'all' || value === 'attention' || value === 'scheduled' || value === 'manual'
}
