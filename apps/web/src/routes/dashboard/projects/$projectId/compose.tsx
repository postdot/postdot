import { createFileRoute } from '@tanstack/react-router'

import { PublicationComposer } from '@/components/publication-composer'
import { parseCalendarDate, parseCalendarTime } from '@/lib/publication-authoring'

export interface ComposeSearch {
    date?: string
    time?: string
}

export const Route = createFileRoute('/dashboard/projects/$projectId/compose')({
    validateSearch: (search: Record<string, unknown>): ComposeSearch => {
        const date = parseCalendarDate(search.date)
        const time = parseCalendarTime(search.time)
        return {
            ...(date === undefined ? {} : { date }),
            ...(time === undefined ? {} : { time }),
        }
    },
    component: ComposeRoute,
})

function ComposeRoute() {
    const { date, time } = Route.useSearch()
    return <PublicationComposer calendarDate={date} calendarTime={time} />
}
