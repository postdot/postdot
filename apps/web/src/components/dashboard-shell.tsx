import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { SidebarInset, SidebarProvider } from '@herald/ui/components/sidebar'
import { useLocation } from '@tanstack/react-router'
import { useEffect, useRef, type CSSProperties, type FormEvent, type ReactNode } from 'react'

import { DashboardHeader } from '@/components/dashboard-header'
import {
    DashboardSidebar,
    workspaceSection,
    workspaceSectionLabel,
} from '@/components/dashboard-sidebar'
import type { Channel, Project, ProjectMemberRole, PublisherConnection, Session } from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
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
    readonly projectRole: ProjectMemberRole | null
    readonly selectedProject: Project | null
    readonly scopeLabel?: string
    readonly sectionLabel?: string
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
    projectRole,
    selectedProject,
    scopeLabel,
    sectionLabel,
    session,
    publicationsCount,
    onProjectNameChange,
}: DashboardShellProps) {
    const { pathname } = useLocation()
    useLanguage()
    const scrollRegionRef = useRef<HTMLDivElement>(null)
    const isPublicationRoute =
        pathname.includes('/publications/') && !pathname.endsWith('/publications/new')
    const activeSection = workspaceSection(pathname)
    const isUserPreferences =
        activeSection === 'preferences' || activeSection === 'preferences-api-keys'
    const isProjectSettings = activeSection === 'access' || activeSection === 'invitations'
    const isWorkspaceSettings = activeSection === 'settings-workspace'
    const isInstanceSettings =
        activeSection === 'settings' ||
        activeSection === 'settings-access' ||
        activeSection === 'settings-provider-applications'
    const global = useDashboardGlobal()
    const selectedProjectId = selectedProject?.id ?? null
    const selectedProjectName = selectedProject?.name ?? m.nav_no_project_selected()
    const selectedWorkspaceId = selectedProject?.workspaceId ?? global.selectedWorkspaceId
    const shellProjects =
        selectedProject !== null && !projects.some(project => project.id === selectedProject.id)
            ? [...projects, selectedProject]
            : projects
    const resolvedScopeLabel =
        scopeLabel ?? (isProjectSettings ? m.nav_project_configuration() : undefined)
    const resolvedSectionLabel =
        sectionLabel ??
        (isInstanceSettings && activeSection === 'settings'
            ? m.nav_instance()
            : isWorkspaceSettings && activeSection === 'settings-workspace'
              ? m.nav_workspace()
              : workspaceSectionLabel(activeSection))

    useEffect(() => {
        scrollRegionRef.current?.scrollTo({ behavior: 'auto', left: 0, top: 0 })
    }, [pathname])

    return (
        <SidebarProvider
            className="herald-dashboard h-svh min-h-0 overflow-hidden !bg-surface-canvas"
            style={{ '--sidebar-width-icon': '2rem' } as CSSProperties}>
            <DashboardSidebar
                activeSection={activeSection}
                channels={channels}
                canCreateWorkspace={global.canCreateWorkspace}
                dueCount={dueCount}
                isInstanceAdmin={global.isInstanceAdmin}
                isInstanceSettings={isInstanceSettings}
                isProjectSettings={isProjectSettings}
                isWorkspaceSettings={isWorkspaceSettings}
                isUserPreferences={isUserPreferences}
                isPublicationRoute={isPublicationRoute}
                onCreateProject={onCreateProject}
                onCreateWorkspace={global.onCreateWorkspace}
                onProjectChange={onProjectChange}
                onProjectCategoryChange={global.onProjectCategoryChange}
                onProjectNameChange={onProjectNameChange}
                onWorkspaceChange={global.onWorkspaceChange}
                onWorkspaceNameChange={global.onWorkspaceNameChange}
                onSignOut={onSignOut}
                pending={pending}
                projectName={projectName}
                workspaceName={global.workspaceName}
                projects={shellProjects}
                categories={global.categories}
                publisherConnections={publisherConnections}
                publicationsCount={publicationsCount}
                projectRole={projectRole}
                selectedProjectId={selectedProjectId}
                selectedWorkspaceId={selectedWorkspaceId}
                workspaces={global.workspaces}
            />

            <SidebarInset className="!m-0 !rounded-none !bg-surface-canvas !shadow-none">
                <div className="flex min-h-0 flex-1 flex-col bg-surface-canvas">
                    <DashboardHeader
                        isInstanceSettings={isInstanceSettings}
                        isProjectSettings={isProjectSettings}
                        isWorkspaceSettings={isWorkspaceSettings}
                        isUserPreferences={isUserPreferences}
                        isPublicationRoute={isPublicationRoute}
                        onSignOut={onSignOut}
                        pending={pending}
                        projectId={selectedProjectId}
                        projectName={selectedProjectName}
                        projects={shellProjects}
                        scopeLabel={resolvedScopeLabel}
                        sectionLabel={resolvedSectionLabel}
                        session={session}
                        workspaceId={selectedWorkspaceId}
                    />
                    <div
                        key={pathname}
                        ref={scrollRegionRef}
                        data-dashboard-scroll="true"
                        className="min-h-0 flex-1 overflow-y-auto bg-surface-raised shadow-surface md:mr-2 md:mb-2 md:ml-0 md:rounded-lg">
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
