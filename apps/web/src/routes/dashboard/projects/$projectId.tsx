import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { DashboardShell } from '@/components/dashboard-shell'
import { api } from '@/lib/api'
import {
    ProjectDashboardProvider,
    loadProjectData,
    useDashboardGlobal,
    useProjectDashboard,
} from '@/lib/dashboard-context'

export const Route = createFileRoute('/dashboard/projects/$projectId')({
    loader: async ({ location, params }) => {
        const { projects } = await api.listProjects()
        const project = projects.find(candidate => candidate.id === params.projectId)
        if (project === undefined) {
            throw redirect({ to: '/dashboard', replace: true })
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
    const { project, ...initialData } = Route.useLoaderData()

    return (
        <ProjectDashboardProvider initialData={initialData} project={project}>
            <ProjectDashboardFrame />
        </ProjectDashboardProvider>
    )
}

function ProjectDashboardFrame() {
    const global = useDashboardGlobal()
    const projectDashboard = useProjectDashboard()

    return (
        <DashboardShell
            channels={projectDashboard.channels}
            dueCount={projectDashboard.due.length}
            error={global.error}
            onCreateProject={global.onCreateProject}
            onProjectChange={global.onProjectChange}
            onProjectNameChange={global.onProjectNameChange}
            onSignOut={global.onSignOut}
            pending={global.pending || projectDashboard.pending}
            projectName={global.projectName}
            projects={global.projects}
            publisherConnections={projectDashboard.connections}
            selectedProjectId={projectDashboard.project.id}
            session={global.session}
            publicationsCount={projectDashboard.publications.length}>
            <Outlet />
        </DashboardShell>
    )
}
