import { createFileRoute } from '@tanstack/react-router'

import { PublicationPerformancePage } from '@/components/publication-performance-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/performance')({
    component: PublicationPerformancePage,
})
