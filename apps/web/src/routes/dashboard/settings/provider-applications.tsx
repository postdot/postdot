import { createFileRoute } from '@tanstack/react-router'

import { ProviderApplicationSettingsPage } from '@/components/provider-application-settings-page'

export const Route = createFileRoute('/dashboard/settings/provider-applications')({
    validateSearch: (search: Record<string, unknown>) => ({
        projectId:
            typeof search.projectId === 'string' && search.projectId.length > 0
                ? search.projectId
                : undefined,
    }),
    component: ProviderApplicationSettingsPage,
})
