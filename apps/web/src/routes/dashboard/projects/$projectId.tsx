import { buttonVariants } from '@herald/ui/components/button'
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
} from '@herald/ui/components/empty'
import { InfoCircleIcon } from '@solar-icons/react/bold/info-circle'
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'

import { DashboardShell } from '@/components/dashboard-shell'
import { api } from '@/lib/api'
import {
    ProjectDashboardProvider,
    loadProjectData,
    useDashboardGlobal,
    useProjectDashboard,
} from '@/lib/dashboard-context'
import { ProjectRealtimeProvider } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/dashboard/projects/$projectId')({
    loader: async ({ location, params }) => {
        const { projects } = await api.listProjects()
        const project = projects.find(candidate => candidate.id === params.projectId)
        if (project === undefined) {
            return { project: null }
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
    if (routeData.project === null) return <MissingProjectRoute />

    const { project, ...initialData } = routeData

    return (
        <ProjectRealtimeProvider key={project.id} projectId={project.id}>
            <ProjectDashboardProvider initialData={initialData} project={project}>
                <ProjectDashboardFrame />
            </ProjectDashboardProvider>
        </ProjectRealtimeProvider>
    )
}

function MissingProjectRoute() {
    const global = useDashboardGlobal()

    return (
        <ProjectRealtimeProvider projectId={null}>
            <DashboardShell
                channels={[]}
                dueCount={0}
                error={global.error}
                onCreateProject={global.onCreateProject}
                onProjectChange={global.onProjectChange}
                onProjectNameChange={global.onProjectNameChange}
                onSignOut={global.onSignOut}
                pending={global.pending}
                projectName={global.projectName}
                projects={global.projects}
                publisherConnections={[]}
                selectedProject={null}
                session={global.session}
                publicationsCount={0}>
                <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
                    <Empty className="min-h-72 bg-muted shadow-surface">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <InfoCircleIcon aria-hidden="true" />
                            </EmptyMedia>
                            <h1 className="font-heading text-sm font-medium tracking-tight">
                                {m.project_not_found_title()}
                            </h1>
                            <EmptyDescription>{m.project_not_found_description()}</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Link
                                className={buttonVariants({ variant: 'secondary' })}
                                to="/dashboard">
                                {m.project_return_to_dashboard()}
                            </Link>
                        </EmptyContent>
                    </Empty>
                </main>
            </DashboardShell>
        </ProjectRealtimeProvider>
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
            selectedProject={projectDashboard.project}
            session={global.session}
            publicationsCount={projectDashboard.publications.length}>
            <Outlet />
        </DashboardShell>
    )
}
