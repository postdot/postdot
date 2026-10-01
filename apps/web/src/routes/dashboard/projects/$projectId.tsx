import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { DashboardShell } from '@/components/dashboard-shell'
import { api } from '@/lib/api'
import { ChannelIdentityProvider } from '@/lib/channel-identity-context'
import {
    ProjectDashboardProvider,
    loadProjectData,
    useDashboardGlobal,
    useProjectDashboard,
} from '@/lib/dashboard-context'
import { ProjectRealtimeProvider } from '@/lib/project-realtime'

export const Route = createFileRoute('/dashboard/projects/$projectId')({
    loader: async ({ location, params }) => {
        const { projects } = await api.listProjects()
        const project = projects.find(candidate => candidate.id === params.projectId)
        if (project === undefined) {
            throw redirect({
                to: '/dashboard',
                search: { projectId: 'none' },
                replace: true,
            })
        }

        if (location.pathname === `/dashboard/projects/${params.projectId}`) {
            throw redirect({
                to: '/dashboard/projects/$projectId/overview',
                params,
                replace: true,
            })
        }

        return { project, ...(await loadProjectData(project.id)) }
    },
    component: ProjectDashboardRoute,
})

function ProjectDashboardRoute() {
    const routeData = Route.useLoaderData()
    const { project, ...initialData } = routeData

    return (
        <ProjectRealtimeProvider key={project.id} projectId={project.id}>
            <ProjectDashboardProvider initialData={initialData} project={project}>
                <ProjectDashboardFrame />
            </ProjectDashboardProvider>
        </ProjectRealtimeProvider>
    )
}

function ProjectDashboardFrame() {
    const global = useDashboardGlobal()
    const projectDashboard = useProjectDashboard()

    return (
        <ChannelIdentityProvider channels={projectDashboard.channels}>
            <DashboardShell
                channels={projectDashboard.channels}
                error={global.error}
                onCreateProject={global.onCreateProject}
                onProjectChange={global.onProjectChange}
                onProjectNameChange={global.onProjectNameChange}
                onSignOut={global.onSignOut}
                pending={global.pending || projectDashboard.pending}
                projectName={global.projectName}
                projects={global.projects}
                publisherConnections={projectDashboard.connections}
                projectRole={projectDashboard.projectRole}
                selectedProject={projectDashboard.project}
                session={global.session}>
                <Outlet />
            </DashboardShell>
        </ChannelIdentityProvider>
    )
}
