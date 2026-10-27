import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceChannelsPage } from '@/components/workspace-channels-page'
export const Route = createFileRoute('/dashboard/workspace/channels')({
    component: WorkspaceChannelsPage,
})
