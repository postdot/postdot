import { createFileRoute } from '@tanstack/react-router'

import { PublicationQueuePage } from '@/components/publication-queue-page'
import { isQueueFilter, type QueueFilter } from '@/lib/publication-queue'

export const Route = createFileRoute('/dashboard/projects/$projectId/queue')({
    validateSearch: (search: Record<string, unknown>) => ({
        filter: parseQueueFilter(search.filter),
        tagIds: parseTagIds(search.tagIds),
    }),
    component: QueueRoute,
})

function QueueRoute() {
    const { filter, tagIds } = Route.useSearch()
    return <PublicationQueuePage initialFilter={filter} initialTagIds={tagIds} />
}

function parseQueueFilter(value: unknown): QueueFilter | undefined {
    const candidate = Array.isArray(value) ? value[0] : value
    if (typeof candidate !== 'string' || !isQueueFilter(candidate) || candidate === 'all') {
        return undefined
    }
    return candidate
}

function parseTagIds(value: unknown): string[] | undefined {
    const values = Array.isArray(value) ? value : [value]
    const tagIds = [
        ...new Set(
            values
                .flatMap(item => (typeof item === 'string' ? item.split(',') : []))
                .map(item => item.trim())
                .filter(item => item.length > 0)
        ),
    ]
    return tagIds.length > 0 ? tagIds : undefined
}
