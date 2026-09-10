import { createFileRoute } from '@tanstack/react-router'

import { PublicationQueuePage } from '@/components/publication-queue-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/queue')({
    validateSearch: (search: Record<string, unknown>) => ({
        tagIds: parseTagIds(search.tagIds),
    }),
    component: QueueRoute,
})

function QueueRoute() {
    const { tagIds } = Route.useSearch()
    return <PublicationQueuePage initialTagIds={tagIds} />
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
