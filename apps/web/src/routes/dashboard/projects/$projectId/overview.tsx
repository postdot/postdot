import { createFileRoute } from '@tanstack/react-router'

import { DashboardOverview } from '@/components/dashboard-overview'
import { isCalendarDateKey } from '@/lib/publication-calendar'
import {
    isPublicationCalendarView,
    type PublicationCalendarView,
} from '@/lib/publication-calendar-experiment'

export interface OverviewSearch {
    calendar?: 'legacy' | 'reui'
    date?: string
    view?: PublicationCalendarView
}

export const Route = createFileRoute('/dashboard/projects/$projectId/overview')({
    validateSearch: (search: Record<string, unknown>): OverviewSearch => {
        const validated: OverviewSearch = {}
        if (search.calendar === 'legacy' || search.calendar === 'reui') {
            validated.calendar = search.calendar
        }
        if (isCalendarDateKey(search.date)) {
            validated.date = search.date
        }
        if (isPublicationCalendarView(search.view)) {
            validated.view = search.view
        }
        return validated
    },
    component: DashboardOverview,
})
