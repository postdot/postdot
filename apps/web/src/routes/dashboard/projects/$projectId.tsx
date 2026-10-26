import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Suspense } from 'react'

import { DashboardShell } from '@/components/dashboard-shell'
import {
    ProjectLifecycleBoundary,
    useProjectLifecycle,
} from '@/components/resource-lifecycle-section'
import { api } from '@/lib/api'
import { ChannelIdentityProvider } from '@/lib/channel-identity-context'
import {
    ProjectDashboardProvider,
    useDashboardGlobal,
    useProjectDashboard,
} from '@/lib/dashboard-context'
import { ProjectRealtimeProvider } from '@/lib/project-realtime'
import { loadProjectShell } from '@/lib/project-shell-loader'
import { PublicationComposerProvider } from '@/lib/publication-composer-context'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/dashboard/projects/$projectId')({
    loader: async ({ location, params }) => {
        const { projects } = await api.listProjects(true)
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

        return { project, ...(await loadProjectShell(project.id)) }
    },
    component: ProjectDashboardRoute,
})

function ProjectDashboardRoute() {
    const routeData = Route.useLoaderData()
    const { project, ...initialData } = routeData

    return (
        <ProjectRealtimeProvider key={project.id} projectId={project.id}>
            <ProjectDashboardProvider initialData={initialData} project={project}>
                <PublicationComposerProvider>
                    <ProjectDashboardFrame />
                </PublicationComposerProvider>
            </ProjectDashboardProvider>
        </ProjectRealtimeProvider>
    )
}

function ProjectDashboardFrame() {
    const global = useDashboardGlobal()
    const projectDashboard = useProjectDashboard()
    const lifecycle = useProjectLifecycle(projectDashboard.project.id)

    return (
        <ChannelIdentityProvider channels={projectDashboard.channels}>
            <DashboardShell
                channels={projectDashboard.channels}
                error={global.error}
                onCreateProject={global.onCreateProject}
                onProjectChange={global.onProjectChange}
                onProjectNameChange={global.onProjectNameChange}
                onSignOut={global.onSignOut}
                pending={global.pending}
                projectName={global.projectName}
                projects={global.projects}
                publisherConnections={projectDashboard.connections}
                projectRole={
                    lifecycle.data?.state === 'active' ? projectDashboard.projectRole : 'viewer'
                }
                selectedProject={projectDashboard.project}
                session={global.session}>
                <Suspense
                    fallback={
                        <main
                            aria-busy="true"
                            className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
                            <h1 className="sr-only">{m.common_loading()}</h1>
                            <p role="status" className="text-sm text-muted-foreground">
                                {m.common_loading()}
                            </p>
                        </main>
                    }>
                    <ProjectLifecycleBoundary projectId={projectDashboard.project.id}>
                        <Outlet />
                    </ProjectLifecycleBoundary>
                </Suspense>
            </DashboardShell>
        </ChannelIdentityProvider>
    )
}
