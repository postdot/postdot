import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceAdministrationPage } from '@/components/workspace-administration-page'

export interface WorkspaceSettingsSearch {
    projectId?: string
    workspaceId?: string
}

export const Route = createFileRoute('/dashboard/settings/workspace')({
    validateSearch: (search: Record<string, unknown>): WorkspaceSettingsSearch => {
        const validated: WorkspaceSettingsSearch = {}
        if (typeof search.projectId === 'string' && search.projectId.length > 0) {
            validated.projectId = search.projectId
        }
        if (typeof search.workspaceId === 'string' && search.workspaceId.length > 0) {
            validated.workspaceId = search.workspaceId
        }
        return validated
    },
    component: WorkspaceAdministrationRoute,
})

function WorkspaceAdministrationRoute() {
    const search = Route.useSearch()
    return <WorkspaceAdministrationPage preferredWorkspaceId={search.workspaceId} />
}
