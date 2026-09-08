import { createFileRoute } from '@tanstack/react-router'

import { ProviderApplicationSettingsPage } from '@/components/provider-application-settings-page'

export const Route = createFileRoute('/dashboard/settings/provider-applications')({
    component: ProviderApplicationSettingsPage,
})
