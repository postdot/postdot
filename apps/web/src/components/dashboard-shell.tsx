import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { SidebarInset, SidebarProvider } from '@herald/ui/components/sidebar'
import { useLocation } from '@tanstack/react-router'
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'

import { DashboardHeader } from '@/components/dashboard-header'
import {
    DashboardSidebar,
    workspaceSection,
    workspaceSectionLabel,
} from '@/components/dashboard-sidebar'
import type { Channel, Project, PublisherConnection, Session } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface DashboardShellProps {
    readonly children: ReactNode
    readonly channels: readonly Channel[]
    readonly dueCount: number
    readonly error: string | null
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly publisherConnections: readonly PublisherConnection[]
    readonly selectedProject: Project | null
    readonly session: Session
    readonly publicationsCount: number
    readonly onProjectNameChange: (value: string) => void
}

export function DashboardShell({
    children,
    channels,
    dueCount,
    error,
    onCreateProject,
    onProjectChange,
    onSignOut,
    pending,
    projectName,
    projects,
    publisherConnections,
    selectedProject,
    session,
    publicationsCount,
    onProjectNameChange,
}: DashboardShellProps) {
    const { pathname } = useLocation()
    useLanguage()
    const scrollRegionRef = useRef<HTMLDivElement>(null)
    const isPublicationRoute = pathname.includes('/publications/')
    const activeSection = workspaceSection(pathname)
    const selectedProjectId = selectedProject?.id ?? null
    const selectedProjectName = selectedProject?.name ?? m.nav_no_project_selected()

    useEffect(() => {
        scrollRegionRef.current?.scrollTo({ behavior: 'auto', left: 0, top: 0 })
    }, [pathname])

    return (
        <SidebarProvider className="herald-dashboard h-svh min-h-0 overflow-hidden !bg-surface-canvas">
            <DashboardSidebar
                activeSection={activeSection}
                channels={channels}
                dueCount={dueCount}
                isInstanceSettings={activeSection === 'settings'}
                isPublicationRoute={isPublicationRoute}
                onCreateProject={onCreateProject}
                onProjectChange={onProjectChange}
                onProjectNameChange={onProjectNameChange}
                onSignOut={onSignOut}
                pending={pending}
                projectName={projectName}
                projects={projects}
                publisherConnections={publisherConnections}
                publicationsCount={publicationsCount}
                selectedProjectId={selectedProjectId}
            />

            <SidebarInset className="!m-0 !rounded-none !bg-surface-canvas !shadow-none">
                <div className="flex min-h-0 flex-1 flex-col bg-surface-canvas">
                    <DashboardHeader
                        isInstanceSettings={activeSection === 'settings'}
                        isPublicationRoute={isPublicationRoute}
                        onSignOut={onSignOut}
                        pending={pending}
                        projectId={selectedProjectId}
                        projectName={selectedProjectName}
                        sectionLabel={workspaceSectionLabel(activeSection)}
                        session={session}
                    />
                    <div
                        key={pathname}
                        ref={scrollRegionRef}
                        data-dashboard-scroll="true"
                        className="min-h-0 flex-1 overflow-y-auto bg-surface-raised shadow-surface md:m-2 md:mt-0 md:rounded-lg">
                        {error ? (
                            <div className="px-4 pt-4 sm:px-6 lg:px-8">
                                <Alert
                                    variant="destructive"
                                    className="rounded-md border-state-failed/35 bg-state-failed/10">
                                    <AlertTitle>{m.workspace_action_failed()}</AlertTitle>
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            </div>
                        ) : null}
                        {children}
                    </div>
                </div>
            </SidebarInset>
        </SidebarProvider>
    )
}
