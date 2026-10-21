import { createFileRoute } from '@tanstack/react-router'

import { PublicationPerformancePage } from '@/components/publication-performance-page'
import { parsePerformanceTagSelection } from '@/lib/publication-performance'

export const Route = createFileRoute('/dashboard/projects/$projectId/performance')({
    validateSearch: (search: Record<string, unknown>) => ({
        tagIds: parsePerformanceTagSelection(search.tagIds),
    }),
    component: PerformanceRoute,
})

function PerformanceRoute() {
    const { tagIds } = Route.useSearch()
    return <PublicationPerformancePage initialTagIds={tagIds ?? []} />
}
