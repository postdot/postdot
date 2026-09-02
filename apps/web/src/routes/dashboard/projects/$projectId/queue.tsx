import { createFileRoute } from '@tanstack/react-router'

import { PublicationQueuePage } from '@/components/publication-queue-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/queue')({
    component: PublicationQueuePage,
})
