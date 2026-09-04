import { createFileRoute, redirect } from '@tanstack/react-router'

import { api } from '@/lib/api'

export const Route = createFileRoute('/')({
    loader: async () => {
        const session = await api.getSession()
        throw redirect({ to: session === null ? '/login' : '/dashboard', replace: true })
    },
})
