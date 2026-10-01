import { createFileRoute } from '@tanstack/react-router'

import { UserAccountPage } from '@/components/user-account-page'

export const Route = createFileRoute('/dashboard/preferences/account')({
    component: UserAccountPage,
})
