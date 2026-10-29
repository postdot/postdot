import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, type Context, type FormEvent, type ReactNode } from 'react'

import {
    formatApiError,
    type Project,
    type ProjectCategory,
    type WorkspaceListItem,
} from '@/lib/api'
import { projectResourceQueries } from '@/lib/project-resources'

import type { loadProjectShell } from './project-shell-loader'

export interface DashboardGlobalContextValue {
    readonly canCreateWorkspace: boolean
    readonly categories: readonly ProjectCategory[]
    readonly error: string | null
    readonly isInstanceAdmin: boolean
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onCreateWorkspace: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectCategoryChange: (projectId: string, categoryId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly onWorkspaceChange: (workspaceId: string) => void
    readonly onWorkspaceNameChange: (value: string) => void
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectName: string
    readonly workspaceName: string
    readonly projects: readonly Project[]
    readonly selectedWorkspaceId: string | null
    readonly session: {
        readonly user: {
            readonly id: string
            readonly name: string
            readonly email: string
            readonly image?: string | null
        }
        readonly session: {
            readonly id: string
        }
    }
    readonly workspaces: readonly WorkspaceListItem[]
}

const DashboardGlobalContext =
    (import.meta.hot?.data.dashboardGlobalContext as
        | Context<DashboardGlobalContextValue | null>
        | undefined) ?? createContext<DashboardGlobalContextValue | null>(null)
if (import.meta.hot) import.meta.hot.data.dashboardGlobalContext = DashboardGlobalContext

export function DashboardGlobalProvider({
    children,
    value,
}: {
    readonly children: ReactNode
    readonly value: DashboardGlobalContextValue
}) {
    return (
        <DashboardGlobalContext.Provider value={value}>{children}</DashboardGlobalContext.Provider>
    )
}

/** Standalone previews have no author and must not restore authenticated browser files. */
export function useDashboardUserId() {
    return useContext(DashboardGlobalContext)?.session.user.id
}

export function useDashboardGlobal() {
    const context = useContext(DashboardGlobalContext)
    if (context === null)
        throw new Error('useDashboardGlobal must be used inside the dashboard route')
    return context
}

type ProjectShellData = Awaited<ReturnType<typeof loadProjectShell>>

function useProjectShell(project: Project, initialData: ProjectShellData) {
    const channels = useQuery({
        ...projectResourceQueries.channels(project.id),
        initialData: initialData.channels,
    })
    const connections = useQuery({
        ...projectResourceQueries.connections(project.id),
        initialData: initialData.connections,
    })
    const membership = useQuery({
        ...projectResourceQueries.membership(project.id),
        initialData: initialData.membership,
    })
    const queryError = channels.error ?? connections.error ?? membership.error
    return {
        project,
        channels: channels.data.channels,
        activeChannels: channels.data.channels.filter(channel => channel.state === 'active'),
        connections: connections.data.connections,
        projectRole: membership.data.membership.role,
        error: queryError == null ? null : formatApiError(queryError),
    }
}

type ProjectDashboardContextValue = ReturnType<typeof useProjectShell>
const ProjectDashboardContext =
    (import.meta.hot?.data.projectDashboardContext as
        | Context<ProjectDashboardContextValue | null>
        | undefined) ?? createContext<ProjectDashboardContextValue | null>(null)
if (import.meta.hot) import.meta.hot.data.projectDashboardContext = ProjectDashboardContext

export function ProjectDashboardProvider({
    children,
    initialData,
    project,
}: {
    readonly children: ReactNode
    readonly initialData: ProjectShellData
    readonly project: Project
}) {
    const value = useProjectShell(project, initialData)
    return (
        <ProjectDashboardContext.Provider value={value}>
            {children}
        </ProjectDashboardContext.Provider>
    )
}

export function useProjectDashboard() {
    const context = useContext(ProjectDashboardContext)
    if (context === null)
        throw new Error('useProjectDashboard must be used inside a project dashboard route')
    return context
}
