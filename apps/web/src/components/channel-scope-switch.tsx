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
            className="mt-4 max-w-full"
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
            <TabsList aria-label={m.channels_scope()} variant="line">
                <TabsTrigger value="project" disabled={!projectId}>
                    {m.channels_scope_project()}
                </TabsTrigger>
                <TabsTrigger value="workspace">{m.channels_scope_workspace()}</TabsTrigger>
            </TabsList>
        </Tabs>
    )
}
