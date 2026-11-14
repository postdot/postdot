import { createFileRoute } from '@tanstack/react-router'

import { ProjectSettingsPage } from '@/components/project-settings-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/settings')({
    component: ProjectSettingsPage,
})
