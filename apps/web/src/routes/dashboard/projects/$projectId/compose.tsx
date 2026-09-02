import { createFileRoute } from '@tanstack/react-router'

import { PublicationComposer } from '@/components/publication-composer'

export const Route = createFileRoute('/dashboard/projects/$projectId/compose')({
    component: PublicationComposer,
})
