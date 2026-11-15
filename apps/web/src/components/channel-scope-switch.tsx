import { Tabs, TabsList, TabsTrigger } from '@postdot/ui/components/tabs'
import { useNavigate } from '@tanstack/react-router'

import { useDashboardGlobal } from '@/lib/dashboard-context'
import * as m from '@/paraglide/messages.js'

/** Workspace membership exposes this view; channel visibility remains server-filtered. */
export function ChannelScopeSwitch({
    scope,
    projectId,
}: {
    readonly scope: 'project' | 'workspace'
    readonly projectId?: string
}) {
    const { selectedWorkspaceId } = useDashboardGlobal()
    const navigate = useNavigate()
    if (!selectedWorkspaceId) return null
    return (
        <Tabs
            className="mt-4 w-fit max-w-full"
            value={scope}
            onValueChange={value => {
                if (value !== 'project' && value !== 'workspace') return
                if (projectId)
                    void navigate({
                        to: '/dashboard/projects/$projectId/channels',
                        params: { projectId },
                        search: previous => ({
                            ...previous,
                            scope: value === 'workspace' ? 'workspace' : undefined,
                        }),
                    })
            }}>
            <TabsList
                aria-label={m.channels_scope()}
                variant="default"
                className="!h-auto min-h-8 w-fit max-w-full flex-wrap justify-start gap-0.5 !overflow-visible bg-surface-inset/70 p-1 shadow-surface [&>[data-slot=tabs-trigger]]:flex-none [&>[data-slot=tabs-trigger]]:shrink-0">
                <TabsTrigger value="project" disabled={!projectId}>
                    {m.channels_scope_project()}
                </TabsTrigger>
                <TabsTrigger value="workspace">{m.channels_scope_workspace()}</TabsTrigger>
            </TabsList>
        </Tabs>
    )
}
