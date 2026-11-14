import { createFileRoute, redirect } from '@tanstack/react-router'

// Invitations are part of the People page (ADR-103 §4); keep old links working.
export const Route = createFileRoute('/dashboard/projects/$projectId/invitations')({
    beforeLoad: ({ params }) => {
        throw redirect({ to: '/dashboard/projects/$projectId/access', params, replace: true })
    },
})
