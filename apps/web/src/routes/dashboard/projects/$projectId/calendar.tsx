import { createFileRoute } from '@tanstack/react-router'

import { PublicationCalendarPage } from '@/components/publication-calendar-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/calendar')({
    component: PublicationCalendarPage,
})
