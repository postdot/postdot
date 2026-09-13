import { PublicationCalendarPage } from '@/components/publication-calendar-page'
import { Route } from '@/routes/dashboard/projects/$projectId/overview'

export function DashboardOverview() {
    const { date, view } = Route.useSearch()
    return <PublicationCalendarPage initialCalendarDateKey={date} initialCalendarView={view} />
}
