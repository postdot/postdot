import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceAdministrationPage } from '@/components/workspace-administration-page'

export const Route = createFileRoute('/dashboard/settings/workspace/settings')({
    component: WorkspaceRoute,
})
function WorkspaceRoute() {
    return <WorkspaceAdministrationPage view="settings" />
}
