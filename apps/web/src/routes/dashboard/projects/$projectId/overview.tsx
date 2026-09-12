import { createFileRoute } from '@tanstack/react-router'

import { DashboardOverview } from '@/components/dashboard-overview'
import {
    isPublicationCalendarView,
    type PublicationCalendarView,
} from '@/lib/publication-calendar-experiment'

export interface OverviewSearch {
    calendar?: 'legacy' | 'reui'
    view?: PublicationCalendarView
}

export const Route = createFileRoute('/dashboard/projects/$projectId/overview')({
    validateSearch: (search: Record<string, unknown>): OverviewSearch => {
        const validated: OverviewSearch = {}
        if (search.calendar === 'legacy' || search.calendar === 'reui') {
            validated.calendar = search.calendar
        }
        if (isPublicationCalendarView(search.view)) {
            validated.view = search.view
        }
        return validated
    },
    component: DashboardOverview,
})
