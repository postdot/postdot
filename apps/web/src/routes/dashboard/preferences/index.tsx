import { createFileRoute } from '@tanstack/react-router'

import { UserPreferencesPage } from '@/components/user-preferences-page'

export const Route = createFileRoute('/dashboard/preferences/')({
    component: UserPreferencesPage,
})
