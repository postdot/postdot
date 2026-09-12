import { PublicationCalendarPage } from '@/components/publication-calendar-page'
import { Route } from '@/routes/dashboard/projects/$projectId/overview'

export function DashboardOverview() {
    const { calendar, view } = Route.useSearch()
    return (
        <PublicationCalendarPage
            experimentalCalendar={calendar !== 'legacy'}
            initialCalendarView={view}
            mode="overview"
        />
    )
}
