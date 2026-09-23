import { createFileRoute } from '@tanstack/react-router'
import { Outlet } from '@tanstack/react-router'

export interface UserPreferencesSearch {
    projectId?: string
    workspaceId?: string
}

export const Route = createFileRoute('/dashboard/preferences')({
    validateSearch: (search: Record<string, unknown>): UserPreferencesSearch => {
        const validated: UserPreferencesSearch = {}
        if (typeof search.projectId === 'string' && search.projectId.length > 0) {
            validated.projectId = search.projectId
        }
        if (typeof search.workspaceId === 'string' && search.workspaceId.length > 0) {
            validated.workspaceId = search.workspaceId
        }
        return validated
    },
    component: PreferencesLayout,
})

function PreferencesLayout() {
    return <Outlet />
}
