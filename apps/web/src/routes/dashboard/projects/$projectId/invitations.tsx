import { createFileRoute } from '@tanstack/react-router'

import { ProjectInvitationsPage } from '@/components/project-invitations-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/invitations')({
    component: ProjectInvitationsPage,
})
