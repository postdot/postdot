import { createFileRoute } from '@tanstack/react-router'

import { DashboardOverview } from '@/components/dashboard-overview'
import { isCalendarDateKey } from '@/lib/publication-calendar'
import {
    isPublicationCalendarView,
    type PublicationCalendarView,
} from '@/lib/publication-calendar-events'

export interface OverviewSearch {
    channelIds?: string
    states?: string
    date?: string
    view?: PublicationCalendarView
}

export const Route = createFileRoute('/dashboard/projects/$projectId/overview')({
    validateSearch: (search: Record<string, unknown>): OverviewSearch => {
        const validated: OverviewSearch = {}
        if (typeof search.channelIds === 'string') validated.channelIds = search.channelIds
        if (typeof search.states === 'string') validated.states = search.states
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
