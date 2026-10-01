import { Button } from '@herald/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import * as m from '@/paraglide/messages.js'

export function AccessPageHeader({
    title,
    projectId,
}: {
    readonly title: string
    readonly projectId?: string
}) {
    const global = useDashboardGlobal()
    const label = projectId ? m.nav_back_to_project() : m.nav_back_to_workspace()
    return (
        <DashboardPageHeader
            title={title}
            back={
                <Button
                    nativeButton={false}
                    render={
                        projectId ? (
                            <Link
                                params={{ projectId }}
                                to="/dashboard/projects/$projectId/overview"
                            />
                        ) : (
                            <Link
                                search={{ workspaceId: global.selectedWorkspaceId ?? undefined }}
                                to="/dashboard"
                            />
                        )
                    }
                    size="sm"
                    variant="ghost">
                    <AltArrowLeftIcon aria-hidden="true" />
                    {label}
                </Button>
            }
        />
    )
}
