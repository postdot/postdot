import { createFileRoute } from '@tanstack/react-router'

import { NewPublicationPage } from '@/components/new-publication-page'
import { parseCalendarDate, parseCalendarTime } from '@/lib/publication-authoring'

export interface NewPublicationSearch {
    date?: string
    time?: string
}

export const Route = createFileRoute('/dashboard/projects/$projectId/publications/new')({
    validateSearch: (search: Record<string, unknown>): NewPublicationSearch => {
        const date = parseCalendarDate(search.date)
        const time = parseCalendarTime(search.time)
        return {
            ...(date === undefined ? {} : { date }),
            ...(time === undefined ? {} : { time }),
        }
    },
    component: NewPublicationRoute,
})

function NewPublicationRoute() {
    const { date, time } = Route.useSearch()
    return <NewPublicationPage calendarDate={date} calendarTime={time} />
}
