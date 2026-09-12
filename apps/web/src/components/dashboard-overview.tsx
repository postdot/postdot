import { PublicationCalendarPage } from '@/components/publication-calendar-page'
import { Route } from '@/routes/dashboard/projects/$projectId/overview'

export function DashboardOverview() {
    const { calendar, date, view } = Route.useSearch()
    return (
        <PublicationCalendarPage
            experimentalCalendar={calendar !== 'legacy'}
            initialCalendarDateKey={date}
            initialCalendarView={view}
            mode="overview"
        />
    )
}
