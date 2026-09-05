import { createFileRoute } from '@tanstack/react-router'

import { PublicationComposer } from '@/components/publication-composer'
import { parseCalendarDate } from '@/lib/publication-authoring'

export const Route = createFileRoute('/dashboard/projects/$projectId/compose')({
    validateSearch: (search: Record<string, unknown>) => ({
        date: parseCalendarDate(search.date),
    }),
    component: ComposeRoute,
})

function ComposeRoute() {
    const { date } = Route.useSearch()
    return <PublicationComposer calendarDate={date} />
}
