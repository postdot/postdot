import { createFileRoute } from '@tanstack/react-router'

import { ProjectAccessPage } from '@/components/project-access-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/access')({
    component: ProjectAccessPage,
})
