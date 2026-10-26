import { createFileRoute } from '@tanstack/react-router'

import { ResourceArchives } from '@/components/resource-lifecycle-section'
export const Route = createFileRoute('/dashboard/settings/archives')({
    component: ResourceArchives,
})
