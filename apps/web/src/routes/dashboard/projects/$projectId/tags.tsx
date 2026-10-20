import { createFileRoute } from '@tanstack/react-router'

import { ProjectTagsPage } from '@/components/project-tags-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/tags')({
    component: ProjectTagsPage,
})
