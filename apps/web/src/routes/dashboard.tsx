import { Button } from '@postdot/ui/components/button'
import { AddIcon } from '@solar-icons/react/linear/add'
import { AltArrowRightIcon } from '@solar-icons/react/linear/alt-arrow-right'
import {
    createFileRoute,
    Link,
    Outlet,
    redirect,
    useLocation,
    useNavigate,
} from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { DashboardShell } from '@/components/dashboard-shell'
import { EmptyState } from '@/components/empty-state'
import { ResourceCreationDialog } from '@/components/resource-creation-dialog'
import { api, formatApiError, type Project } from '@/lib/api'
import {
    DashboardGlobalProvider,
    useDashboardGlobal,
    type DashboardGlobalContextValue,
} from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { ProjectRealtimeProvider } from '@/lib/project-realtime'
import { useActionError } from '@/lib/use-action-error'
import * as m from '@/paraglide/messages.js'

export interface DashboardSearch {
    projectId?: string
    workspaceId?: string
}

export const Route = createFileRoute('/dashboard')({
    validateSearch: (search: Record<string, unknown>): DashboardSearch => {
        const validated: DashboardSearch = {}
        if (typeof search.projectId === 'string' && search.projectId.length > 0) {
            validated.projectId = search.projectId
        }
        if (typeof search.workspaceId === 'string' && search.workspaceId.length > 0) {
            validated.workspaceId = search.workspaceId
        }
        return validated
    },
    loaderDeps: ({ search }) => ({
        projectId: search.projectId,
        workspaceId: search.workspaceId,
    }),
    loader: async ({ location, deps }) => {
        const session = await api.getSession()
        if (session === null) {
            const continuation = createLoginContinuation(location.pathname, location.search)
            throw redirect({
                to: '/login',
                search: { continue: continuation },
            })
        }

        const [{ projects }, { categories }, workspaceResponse, instanceAccess] = await Promise.all(
            [
                api.listProjects(),
                api.listCategories({ includeArchived: true }),
                api.listWorkspaces(),
                api.getInstanceAccess(),
            ]
        )
        const { workspaces, canCreateWorkspace } = workspaceResponse
        if (isInstanceAdminSettingsPath(location.pathname) && !instanceAccess.isAdmin) {
            throw redirect({
                to: '/dashboard',
                search: { workspaceId: deps.workspaceId },
                replace: true,
            })
        }
        if (isWorkspaceSettingsPath(location.pathname)) {
            const requestedWorkspaceId =
                deps.workspaceId ??
                workspaces.find(workspace => workspace.isDefault)?.id ??
                workspaces[0]?.id
            const requestedWorkspace = workspaces.find(
                workspace => workspace.id === requestedWorkspaceId
            )
            if (
                requestedWorkspace === undefined ||
                (requestedWorkspace.role !== 'owner' && requestedWorkspace.role !== 'admin')
            ) {
                throw redirect({
                    to: '/dashboard',
                    search: { workspaceId: deps.workspaceId },
                    replace: true,
                })
            }
        }
        const isDashboardIndex =
            location.pathname === '/dashboard' || location.pathname === '/dashboard/'
        const firstProject =
            deps.workspaceId === undefined
                ? projects[0]
                : projects.find(project => project.workspaceId === deps.workspaceId)
        if (isDashboardIndex && deps.projectId !== 'none' && firstProject !== undefined) {
            throw redirect({
                to: '/dashboard/projects/$projectId/overview',
                params: { projectId: firstProject.id },
                replace: true,
            })
        }

        return {
            canCreateWorkspace,
            categories,
            isInstanceAdmin: instanceAccess.isAdmin,
            session,
            projects,
            workspaces,
        }
    },
    component: DashboardPage,
})

function DashboardPage() {
    const navigate = useNavigate()
    const { pathname, search } = useLocation()
    useLanguage()
    const initialData = Route.useLoaderData()
    const routeSearch = Route.useSearch()
    const [projects, setProjects] = useState<Project[]>(initialData.projects)
    const [workspaces, setWorkspaces] = useState(initialData.workspaces)
    const categories = initialData.categories
    const [projectName, setProjectName] = useState('')
    const [workspaceName, setWorkspaceName] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useActionError()
    const selectedWorkspaceId =
        routeSearch.workspaceId ??
        workspaces.find(workspace => workspace.isDefault)?.id ??
        workspaces[0]?.id ??
        null

    useEffect(() => {
        setProjects(initialData.projects)
    }, [initialData.projects])

    useEffect(() => {
        setWorkspaces(initialData.workspaces)
    }, [initialData.workspaces])

    async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (projectName.trim() === '') return

        await runAction(async () => {
            const response = await api.createProject(
                projectName,
                undefined,
                selectedWorkspaceId ?? undefined
            )
            setProjects(current => [...current, response.project])
            setProjectName('')
            await navigate({
                to: '/dashboard/projects/$projectId/overview',
                params: { projectId: response.project.id },
            })
        })
    }

    async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!initialData.canCreateWorkspace || workspaceName.trim() === '') return

        await runAction(async () => {
            const response = await api.createWorkspace(workspaceName.trim())
            setWorkspaces(current => [...current, response.workspace])
            setWorkspaceName('')
            await navigate({
                to: '/dashboard',
                search: { workspaceId: response.workspace.id },
            })
        })
    }

    async function handleProjectChange(projectId: string | null) {
        setError(null)
        if (projectId === null) {
            await navigate({
                to: '/dashboard',
                search: {
                    projectId: 'none',
                    workspaceId: selectedWorkspaceId ?? undefined,
                },
            })
            return
        }

        await navigate({
            to: '/dashboard/projects/$projectId/overview',
            params: { projectId },
        })
    }

    async function handleWorkspaceChange(workspaceId: string) {
        setError(null)
        if (isSettingsPath(pathname) || isPreferencesPath(pathname)) {
            await navigate({
                to: '.',
                search: previous => ({ ...previous, workspaceId, projectId: 'none' }),
            })
            return
        }

        const firstProject = projects.find(project => project.workspaceId === workspaceId)
        if (firstProject !== undefined) {
            await navigate({
                to: '/dashboard/projects/$projectId/overview',
                params: { projectId: firstProject.id },
            })
            return
        }

        await navigate({ to: '/dashboard', search: { workspaceId } })
    }

    async function handleProjectCategoryChange(projectId: string, categoryId: string | null) {
        await runAction(async () => {
            const project = await api.setProjectPrimaryCategory(projectId, categoryId)
            setProjects(current =>
                current.map(candidate => (candidate.id === project.id ? project : candidate))
            )
        })
    }

    async function handleSignOut() {
        await runAction(async () => {
            await api.signOut()
            await navigate({ to: '/login', search: { continue: undefined } })
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
        canCreateWorkspace: initialData.canCreateWorkspace,
        categories,
        error,
        isInstanceAdmin: initialData.isInstanceAdmin,
        onCreateProject: event => void handleCreateProject(event),
        onCreateWorkspace: event => void handleCreateWorkspace(event),
        onProjectChange: projectId => void handleProjectChange(projectId),
        onProjectCategoryChange: (projectId, categoryId) =>
            void handleProjectCategoryChange(projectId, categoryId),
        onProjectNameChange: setProjectName,
        onWorkspaceChange: workspaceId => void handleWorkspaceChange(workspaceId),
        onWorkspaceNameChange: setWorkspaceName,
        onSignOut: () => void handleSignOut(),
        pending,
        projectName,
        workspaceName,
        projects,
        selectedWorkspaceId,
        session: initialData.session,
        workspaces,
    }

    const isPreferences = isPreferencesPath(pathname)
    const settingsProjectId =
        isSettingsPath(pathname) || isPreferences ? readProjectContextId(search) : undefined
    const selectedSettingsProject =
        isSettingsPath(pathname) || isPreferences
            ? (projects.find(project => project.id === settingsProjectId) ?? null)
            : null

    return (
        <DashboardGlobalProvider value={value}>
            {isSettingsPath(pathname) ? (
                <GlobalSettingsShell global={value} selectedProject={selectedSettingsProject} />
            ) : isPreferences ? (
                <GlobalSettingsShell global={value} selectedProject={selectedSettingsProject} />
            ) : pathname === '/dashboard' || pathname === '/dashboard/' ? (
                projects.length === 0 ? (
                    <EmptyProjectShell global={value} />
                ) : (
                    <ProjectSelectionShell />
                )
            ) : (
                <Outlet />
            )}
        </DashboardGlobalProvider>
    )
}

function isSettingsPath(pathname: string) {
    return pathname === '/dashboard/settings' || pathname.startsWith('/dashboard/settings/')
}

function isInstanceAdminSettingsPath(pathname: string) {
    return (
        pathname === '/dashboard/settings' ||
        pathname.startsWith('/dashboard/settings/access') ||
        pathname.startsWith('/dashboard/settings/provider-applications')
    )
}

function isWorkspaceSettingsPath(pathname: string) {
    return pathname.startsWith('/dashboard/settings/workspace')
}

function isPreferencesPath(pathname: string) {
    return pathname === '/dashboard/preferences' || pathname.startsWith('/dashboard/preferences/')
}

function readProjectContextId(search: unknown) {
    return readSearchString(search, 'projectId')
}

function createLoginContinuation(pathname: string, search: unknown) {
    if (pathname !== '/dashboard' && !pathname.startsWith('/dashboard/')) return undefined

    const params = new URLSearchParams()
    for (const key of ['invitation', 'organizationInvitation', 'projectId', 'workspaceId']) {
        const value = readSearchString(search, key)
        if (value !== undefined) params.set(key, value)
    }

    const query = params.toString()
    return `${pathname}${query === '' ? '' : `?${query}`}`
}

function readSearchString(search: unknown, key: string) {
    if (typeof search !== 'object' || search === null) return undefined

    const value = Reflect.get(search, key)
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

function GlobalSettingsShell({
    global,
    selectedProject,
}: {
    readonly global: DashboardGlobalContextValue
    readonly selectedProject: Project | null
}) {
    return (
        <ProjectRealtimeProvider projectId={null}>
            <DashboardShell
                channels={[]}
                error={global.error}
                onCreateProject={global.onCreateProject}
                onProjectChange={global.onProjectChange}
                onProjectNameChange={global.onProjectNameChange}
                onSignOut={global.onSignOut}
                pending={global.pending}
                projectName={global.projectName}
                projects={global.projects}
                publisherConnections={[]}
                projectRole={null}
                selectedProject={selectedProject}
                session={global.session}>
                <Outlet />
            </DashboardShell>
        </ProjectRealtimeProvider>
    )
}

function EmptyProjectShell({ global }: { readonly global: DashboardGlobalContextValue }) {
    const [createProjectOpen, setCreateProjectOpen] = useState(false)

    return (
        <ProjectRealtimeProvider projectId={null}>
            <DashboardShell
                channels={[]}
                error={global.error}
                onCreateProject={global.onCreateProject}
                onProjectChange={global.onProjectChange}
                onProjectNameChange={global.onProjectNameChange}
                onSignOut={global.onSignOut}
                pending={global.pending}
                projectName={global.projectName}
                projects={global.projects}
                publisherConnections={[]}
                projectRole={null}
                selectedProject={null}
                session={global.session}>
                <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
                    <div className="w-full">
                        <h1 className="font-heading text-3xl font-semibold leading-[1.02] sm:text-4xl">
                            {m.overview_create_first_project()}
                        </h1>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                            {m.overview_create_first_project_description()}
                        </p>
                        <EmptyState
                            action={
                                <Button onClick={() => setCreateProjectOpen(true)} type="button">
                                    <AddIcon aria-hidden="true" />
                                    {m.nav_create_project()}
                                </Button>
                            }
                            className="mt-8 w-full"
                            illustration="data"
                            layout="compact"
                            title={m.overview_no_projects()}
                        />
                        <ResourceCreationDialog
                            id="empty-state-new-project"
                            label={m.nav_new_project()}
                            maxLength={120}
                            onOpenChange={open => {
                                setCreateProjectOpen(open)
                                if (!open) global.onProjectNameChange('')
                            }}
                            onSubmit={global.onCreateProject}
                            onValueChange={global.onProjectNameChange}
                            open={createProjectOpen}
                            pending={global.pending}
                            placeholder={m.nav_project_name()}
                            submitLabel={m.nav_add_project()}
                            title={m.nav_create_project()}
                            value={global.projectName}
                        />
                    </div>
                </main>
            </DashboardShell>
        </ProjectRealtimeProvider>
    )
}

function ProjectSelectionShell() {
    const global = useDashboardGlobal()
    const [createProjectOpen, setCreateProjectOpen] = useState(false)
    const projects =
        global.selectedWorkspaceId === null
            ? global.projects
            : global.projects.filter(project => project.workspaceId === global.selectedWorkspaceId)
    const hasProjects = projects.length > 0

    return (
        <ProjectRealtimeProvider projectId={null}>
            <DashboardShell
                channels={[]}
                error={global.error}
                onCreateProject={global.onCreateProject}
                onProjectChange={global.onProjectChange}
                onProjectNameChange={global.onProjectNameChange}
                onSignOut={global.onSignOut}
                pending={global.pending}
                projectName={global.projectName}
                projects={global.projects}
                publisherConnections={[]}
                projectRole={null}
                selectedProject={null}
                session={global.session}>
                <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
                    <div className="w-full">
                        <DashboardPageHeader
                            action={
                                <Button onClick={() => setCreateProjectOpen(true)} type="button">
                                    <AddIcon aria-hidden="true" />
                                    {m.nav_create_project()}
                                </Button>
                            }
                            description={m.dashboard_select_project_description()}
                            title={
                                hasProjects
                                    ? m.nav_select_project()
                                    : m.overview_create_first_project()
                            }
                        />
                        {hasProjects ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                                {projects.map(project => (
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
                        ) : (
                            <EmptyState
                                className="mt-4 w-full"
                                description={m.overview_create_first_project_description()}
                                illustration="data"
                                layout="compact"
                                title={m.overview_no_projects()}
                            />
                        )}
                        <ResourceCreationDialog
                            id="project-selection-new-project"
                            label={m.nav_new_project()}
                            maxLength={120}
                            onOpenChange={open => {
                                setCreateProjectOpen(open)
                                if (!open) global.onProjectNameChange('')
                            }}
                            onSubmit={global.onCreateProject}
                            onValueChange={global.onProjectNameChange}
                            open={createProjectOpen}
                            pending={global.pending}
                            placeholder={m.nav_project_name()}
                            submitLabel={m.nav_add_project()}
                            title={m.nav_create_project()}
                            value={global.projectName}
                        />
                    </div>
                </main>
            </DashboardShell>
        </ProjectRealtimeProvider>
    )
}

function errorMessage(error: unknown) {
    return formatApiError(error)
}
