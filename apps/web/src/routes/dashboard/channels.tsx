import { createFileRoute, redirect } from '@tanstack/react-router'

import { WorkspaceChannelsPage } from '@/components/workspace-channels-page'

/** Channels without a selected project, including workspaces with no projects. */
export const Route = createFileRoute('/dashboard/channels')({
    validateSearch: () => ({ scope: 'workspace' as const }),
    beforeLoad: ({ search }) => {
        if (search.projectId && search.projectId !== 'none')
            throw redirect({
                to: '/dashboard/projects/$projectId/channels',
                params: { projectId: search.projectId },
                search: { scope: 'workspace', workspaceId: search.workspaceId },
                replace: true,
            })
    },
    component: WorkspaceChannelsPage,
})
