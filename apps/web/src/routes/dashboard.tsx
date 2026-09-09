import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { PenIcon } from '@solar-icons/react/bold/pen'
import {
    createFileRoute,
    Link,
    Outlet,
    redirect,
    useLocation,
    useNavigate,
} from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { DashboardShell } from '@/components/dashboard-shell'
import { api, formatApiError, type Project } from '@/lib/api'
import {
    DashboardGlobalProvider,
    useDashboardGlobal,
    type DashboardGlobalContextValue,
} from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { ProjectRealtimeProvider } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/dashboard')({
    loader: async ({ location }) => {
        const session = await api.getSession()
        if (session === null) {
            throw redirect({ to: '/login' })
        }

        const { projects } = await api.listProjects()
        const isDashboardIndex =
            location.pathname === '/dashboard' || location.pathname === '/dashboard/'
        const firstProject = projects[0]
        if (isDashboardIndex && firstProject !== undefined) {
            throw redirect({
                to: '/dashboard/projects/$projectId/overview',
                params: { projectId: firstProject.id },
                replace: true,
            })
        }

        return { session, projects }
    },
    component: DashboardPage,
})

function DashboardPage() {
    const navigate = useNavigate()
    const { pathname } = useLocation()
    useLanguage()
    const initialData = Route.useLoaderData()
    const [projects, setProjects] = useState<Project[]>(initialData.projects)
    const [projectName, setProjectName] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (projectName.trim() === '') return

        await runAction(async () => {
            const response = await api.createProject(projectName)
            setProjects(current => [...current, response.project])
            setProjectName('')
            await navigate({
                to: '/dashboard/projects/$projectId/overview',
                params: { projectId: response.project.id },
            })
        })
    }

    async function handleProjectChange(projectId: string | null) {
        setError(null)
        if (projectId === null) {
            await navigate({ to: '/dashboard' })
            return
        }

        await navigate({
            to: '/dashboard/projects/$projectId/overview',
            params: { projectId },
        })
    }

    async function handleSignOut() {
        await runAction(async () => {
            await api.signOut()
            await navigate({ to: '/login' })
        })
    }

    async function runAction(action: () => Promise<void>) {
        setError(null)
        setPending(true)
        try {
            await action()
        } catch (caughtError) {
            setError(errorMessage(caughtError))
        } finally {
            setPending(false)
        }
    }

    const value: DashboardGlobalContextValue = {
        error,
        onCreateProject: event => void handleCreateProject(event),
        onProjectChange: projectId => void handleProjectChange(projectId),
        onProjectNameChange: setProjectName,
        onSignOut: () => void handleSignOut(),
        pending,
        projectName,
        projects,
        session: initialData.session,
    }

    return (
        <DashboardGlobalProvider value={value}>
            {pathname.startsWith('/dashboard/settings/') ? (
                <GlobalSettingsShell />
            ) : projects.length === 0 ? (
                <EmptyProjectShell />
            ) : pathname === '/dashboard' || pathname === '/dashboard/' ? (
                <ProjectSelectionShell />
            ) : (
                <Outlet />
            )}
        </DashboardGlobalProvider>
    )
}

function GlobalSettingsShell() {
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
                <Outlet />
            </DashboardShell>
        </ProjectRealtimeProvider>
    )
}

function EmptyProjectShell() {
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
                    <div className="max-w-2xl">
                        <h1 className="font-heading text-3xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-4xl">
                            {m.overview_create_first_workspace()}
                        </h1>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                            {m.overview_create_first_workspace_description()}
                        </p>
                        <Empty className="mt-8 min-h-48 bg-muted">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <PenIcon aria-hidden="true" />
                                </EmptyMedia>
                                <EmptyTitle>{m.nav_no_project_selected()}</EmptyTitle>
                                <EmptyDescription>
                                    {m.overview_open_create_project()}
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    </div>
                </main>
            </DashboardShell>
        </ProjectRealtimeProvider>
    )
}

function ProjectSelectionShell() {
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
                    <div className="max-w-3xl">
                        <h1 className="font-heading text-3xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-4xl">
                            {m.nav_select_project()}
                        </h1>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                            {m.dashboard_select_project_description()}
                        </p>
                        <div className="mt-8 grid gap-2 sm:grid-cols-2">
                            {global.projects.map(project => (
                                <Link
                                    className="group flex items-center justify-between gap-4 rounded-md bg-muted px-4 py-3 shadow-surface transition-[background-color,transform] hover:-translate-y-px hover:bg-muted/75"
                                    key={project.id}
                                    params={{ projectId: project.id }}
                                    to="/dashboard/projects/$projectId/overview">
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium">
                                            {project.name}
                                        </span>
                                        <span className="mt-1 block text-xs text-muted-foreground">
                                            {project.timeZone}
                                        </span>
                                    </span>
                                    <AltArrowRightIcon
                                        aria-hidden="true"
                                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                                    />
                                </Link>
                            ))}
                        </div>
                    </div>
                </main>
            </DashboardShell>
        </ProjectRealtimeProvider>
    )
}

function errorMessage(error: unknown) {
    return formatApiError(error)
}
