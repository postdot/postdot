import { createFileRoute } from '@tanstack/react-router'

import { PublicationQueuePage } from '@/components/publication-queue-page'
import {
    isPublicationQueueSort,
    isQueueFilter,
    type PublicationQueueSort,
    type QueueFilter,
} from '@/lib/publication-queue'

export const Route = createFileRoute('/dashboard/projects/$projectId/queue')({
    validateSearch: (search: Record<string, unknown>) => ({
        ...(search.view === 'posts' ? { view: 'posts' as const } : {}),
        filter: parseQueueFilter(search.filter),
        sort: parseQueueSort(search.sort),
        tagIds: parseTagIds(search.tagIds),
    }),
    component: QueueRoute,
})

function QueueRoute() {
    const { filter, sort, tagIds, view } = Route.useSearch()
    return (
        <PublicationQueuePage
            initialView={view}
            initialFilter={filter}
            initialSort={sort}
            initialTagIds={tagIds}
        />
    )
}

function parseQueueSort(value: unknown): PublicationQueueSort | undefined {
    const candidate = Array.isArray(value) ? value[0] : value
    if (typeof candidate !== 'string' || !isPublicationQueueSort(candidate)) return undefined
    return candidate === 'queue' ? undefined : candidate
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
