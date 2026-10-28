import { createFileRoute } from '@tanstack/react-router'

import { ConfigurationSettingsPage } from '@/components/configuration-settings-page'

export interface ConfigurationSettingsSearch {
    projectId?: string
    workspaceId?: string
}

export const Route = createFileRoute('/dashboard/settings/')({
    validateSearch: (search: Record<string, unknown>): ConfigurationSettingsSearch => {
        const validated: ConfigurationSettingsSearch = {}
        if (typeof search.projectId === 'string' && search.projectId.length > 0) {
            validated.projectId = search.projectId
        }
        if (typeof search.workspaceId === 'string' && search.workspaceId.length > 0) {
            validated.workspaceId = search.workspaceId
        }
        return validated
    },
    component: ConfigurationSettingsRoute,
})

function ConfigurationSettingsRoute() {
    return <ConfigurationSettingsPage />
}
