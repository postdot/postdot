import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/settings/workspace/')({
    beforeLoad: ({ search }) => {
        throw redirect({ to: '/dashboard/settings/workspace/people', search, replace: true })
    },
})
