import { createFileRoute } from '@tanstack/react-router'

import { DashboardOverview } from '@/components/dashboard-overview'

export const Route = createFileRoute('/dashboard/projects/$projectId/overview')({
    validateSearch: (search: Record<string, unknown>): { calendar?: 'legacy' | 'reui' } => {
        if (search.calendar === 'legacy' || search.calendar === 'reui') {
            return { calendar: search.calendar }
        }

        return {}
    },
    component: DashboardOverview,
})
