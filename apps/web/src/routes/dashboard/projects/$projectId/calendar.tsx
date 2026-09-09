import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/projects/$projectId/calendar')({
    loader: ({ params }) => {
        throw redirect({
            to: '/dashboard/projects/$projectId/overview',
            params,
            replace: true,
        })
    },
    component: LegacyCalendarRedirect,
})

function LegacyCalendarRedirect() {
    return null
}
