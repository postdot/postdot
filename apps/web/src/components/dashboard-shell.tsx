import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { SidebarInset, SidebarProvider } from '@postdot/ui/components/sidebar'
import { useLocation } from '@tanstack/react-router'
import { useEffect, useRef, type CSSProperties, type FormEvent, type ReactNode } from 'react'

import { DashboardHeader } from '@/components/dashboard-header'
import { DashboardSidebar, workspaceSection } from '@/components/dashboard-sidebar'
import { RecoveryNotice } from '@/components/recovery-settings'
import type { Channel, Project, ProjectMemberRole, PublisherConnection, Session } from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import { CadenceConfirmationDialog } from './cadence-confirmation-dialog'

interface DashboardShellProps {
    readonly children: ReactNode
    readonly channels: readonly Channel[]
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
    readonly session: Session
    readonly onProjectNameChange: (value: string) => void
}

export function DashboardShell({
    children,
    channels,
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
    session,
    onProjectNameChange,
}: DashboardShellProps) {
    const { pathname } = useLocation()
    useLanguage()
    const scrollRegionRef = useRef<HTMLDivElement>(null)
    const isPublicationRoute =
        pathname.includes('/publications/') && !pathname.endsWith('/publications/new')
    const activeSection = workspaceSection(pathname)
    const isUserPreferences =
        activeSection === 'preferences' ||
        activeSection === 'preferences-api-keys' ||
        activeSection === 'preferences-account'
    const isProjectSettings =
        activeSection === 'access' || activeSection === 'invitations' || activeSection === 'tags'
    const isWorkspaceSettings =
        activeSection === 'settings-workspace' || activeSection === 'workspace-channels'
    const isInstanceSettings =
        activeSection === 'settings' ||
        activeSection === 'settings-access' ||
        activeSection === 'settings-provider-applications'
    const global = useDashboardGlobal()
    const selectedProjectId = selectedProject?.id ?? null
    const selectedWorkspaceId = selectedProject?.workspaceId ?? global.selectedWorkspaceId
    const shellProjects =
        selectedProject !== null && !projects.some(project => project.id === selectedProject.id)
            ? [...projects, selectedProject]
            : projects

    useEffect(() => {
        scrollRegionRef.current?.scrollTo({ behavior: 'auto', left: 0, top: 0 })
    }, [pathname])

    return (
        <SidebarProvider
            className="postbot-dashboard h-svh min-h-0 overflow-hidden !bg-surface-canvas"
            style={{ '--sidebar-width-icon': '2rem' } as CSSProperties}>
            <CadenceConfirmationDialog channels={channels} />
            <DashboardSidebar
                activeSection={activeSection}
                channels={channels}
                isInstanceAdmin={global.isInstanceAdmin}
                isInstanceSettings={isInstanceSettings}
                isProjectSettings={isProjectSettings}
                isWorkspaceSettings={isWorkspaceSettings}
                isUserPreferences={isUserPreferences}
                isPublicationRoute={isPublicationRoute}
                onProjectCategoryChange={global.onProjectCategoryChange}
                onSignOut={onSignOut}
                pending={pending}
                projects={shellProjects}
                categories={global.categories}
                publisherConnections={publisherConnections}
                projectRole={projectRole}
                selectedProjectId={selectedProjectId}
                selectedWorkspaceId={selectedWorkspaceId}
                workspaces={global.workspaces}
            />

            <SidebarInset className="!m-0 !rounded-none !bg-surface-canvas !shadow-none">
                <div className="flex min-h-0 flex-1 flex-col bg-surface-canvas">
                    <DashboardHeader
                        hasPageBack={
                            isProjectSettings ||
                            isWorkspaceSettings ||
                            activeSection === 'settings-access' ||
                            activeSection === 'settings-provider-applications'
                        }
                        canCreateWorkspace={global.canCreateWorkspace}
                        categories={global.categories}
                        isInstanceSettings={isInstanceSettings}
                        isProjectSettings={isProjectSettings}
                        isWorkspaceSettings={isWorkspaceSettings}
                        isUserPreferences={isUserPreferences}
                        onCreateProject={onCreateProject}
                        onCreateWorkspace={global.onCreateWorkspace}
                        onProjectChange={onProjectChange}
                        onProjectNameChange={onProjectNameChange}
                        onWorkspaceChange={global.onWorkspaceChange}
                        onWorkspaceNameChange={global.onWorkspaceNameChange}
                        onSignOut={onSignOut}
                        pending={pending}
                        projectId={selectedProjectId}
                        projectName={projectName}
                        projects={shellProjects}
                        session={session}
                        workspaceId={selectedWorkspaceId}
                        workspaceName={global.workspaceName}
                        workspaces={global.workspaces}
                    />
                    <div
                        data-dashboard-frame="true"
                        className="relative flex min-h-0 flex-1 overflow-hidden bg-surface-background md:mr-2 md:mb-2 md:rounded-lg">
                        <div
                            key={pathname}
                            ref={scrollRegionRef}
                            data-dashboard-scroll="true"
                            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
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
                            <RecoveryNotice />
                            {children}
                        </div>
                        <div
                            aria-hidden="true"
                            data-dashboard-frame-edge="true"
                            className="pointer-events-none absolute inset-0 z-30 hidden rounded-[inherit] shadow-shell md:block"
                        />
                    </div>
                </div>
            </SidebarInset>
        </SidebarProvider>
    )
}
