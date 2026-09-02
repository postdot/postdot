import { createFileRoute } from '@tanstack/react-router'

import { DashboardOverview } from '@/components/dashboard-overview'

export const Route = createFileRoute('/dashboard/projects/$projectId/overview')({
    component: DashboardOverview,
})
