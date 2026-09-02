import { createFileRoute } from '@tanstack/react-router'

import { ChannelManagementPage } from '@/components/channel-management-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/channels')({
    component: ChannelManagementPage,
})
