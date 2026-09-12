import { createFileRoute } from '@tanstack/react-router'

import { DashboardOverview } from '@/components/dashboard-overview'

export const Route = createFileRoute('/dashboard/projects/$projectId/overview')({
    validateSearch: (search: Record<string, unknown>): { calendar?: 'reui' } =>
        search.calendar === 'reui' ? { calendar: 'reui' } : {},
    component: DashboardOverview,
})
