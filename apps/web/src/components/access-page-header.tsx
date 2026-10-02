import { Button } from '@herald/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { Link, useSearch } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import * as m from '@/paraglide/messages.js'

export function AccessPageHeader({
    title,
    projectId,
    action,
}: {
    readonly title: string
    readonly action?: ReactNode
    readonly projectId?: string
}) {
    const global = useDashboardGlobal()
    const search = useSearch({ from: '/dashboard' })
    const returnProjectId =
        projectId ??
        global.projects.find(
            project =>
                project.id === search.projectId &&
                project.workspaceId === global.selectedWorkspaceId
        )?.id
    const label = returnProjectId ? m.nav_back_to_project() : m.nav_back_to_workspace()
    return (
        <DashboardPageHeader
            action={action}
            title={title}
            back={
                <Button
                    nativeButton={false}
                    render={
                        returnProjectId ? (
                            <Link
                                params={{ projectId: returnProjectId }}
                                to="/dashboard/projects/$projectId/overview"
                            />
                        ) : (
                            <Link
                                search={{
                                    workspaceId: global.selectedWorkspaceId ?? undefined,
                                    projectId: 'none',
                                }}
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
