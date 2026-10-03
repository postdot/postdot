import { createFileRoute, Navigate } from '@tanstack/react-router'

import { NewPublicationPage } from '@/components/new-publication-page'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { parseCalendarDate, parseCalendarTime } from '@/lib/publication-authoring'

export interface NewPublicationSearch {
    date?: string
    time?: string
    editor?: 'tiptap'
}

export const Route = createFileRoute('/dashboard/projects/$projectId/publications/new')({
    validateSearch: (search: Record<string, unknown>): NewPublicationSearch => {
        const date = parseCalendarDate(search.date)
        const time = parseCalendarTime(search.time)
        return {
            ...(date === undefined ? {} : { date }),
            ...(time === undefined ? {} : { time }),
            ...(import.meta.env.DEV && search.editor === 'tiptap'
                ? { editor: 'tiptap' as const }
                : {}),
        }
    },
    component: NewPublicationRoute,
})

function NewPublicationRoute() {
    const { date, time, editor } = Route.useSearch()
    const { activeChannels, project, projectRole } = useProjectDashboard()
    if (projectRole === 'viewer') {
        return (
            <Navigate
                to="/dashboard/projects/$projectId/queue"
                params={{ projectId: project.id }}
                search={{ filter: undefined, sort: undefined, tagIds: undefined }}
                replace
            />
        )
    }
    if (activeChannels.length === 0) {
        return (
            <Navigate
                to="/dashboard/projects/$projectId/channels"
                params={{ projectId: project.id }}
                replace
            />
        )
    }
    return (
        <NewPublicationPage
            calendarDate={date}
            calendarTime={time}
            experimentalEditor={editor === 'tiptap' && import.meta.env.DEV}
        />
    )
}
