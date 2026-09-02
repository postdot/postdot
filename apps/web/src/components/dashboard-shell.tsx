import { Avatar, AvatarFallback } from '@herald/ui/components/avatar'
import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { HeraldLogo } from '@herald/ui/components/herald-logo'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
} from '@herald/ui/components/sidebar'
import { cn } from '@herald/ui/lib/utils'
import { AddIcon } from '@solar-icons/react/bold/add'
import { GalleryIcon } from '@solar-icons/react/bold/gallery'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { ListIcon } from '@solar-icons/react/bold/list'
import { Logout2Icon } from '@solar-icons/react/bold/logout-2'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Widget2Icon } from '@solar-icons/react/bold/widget-2'
import { Link, useLocation } from '@tanstack/react-router'
import type { FormEvent, ReactNode } from 'react'

import { ThemeToggle } from '@/components/theme-toggle'
import type { Channel, Project, PublisherConnection, Session } from '@/lib/api'

interface DashboardShellProps {
    readonly children: ReactNode
    readonly channels: readonly Channel[]
    readonly dueCount: number
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly publisherConnections: readonly PublisherConnection[]
    readonly selectedProjectId: string | null
    readonly session: Session
    readonly publicationsCount: number
    readonly onProjectNameChange: (value: string) => void
}

export function DashboardShell({
    children,
    channels,
    dueCount,
    onCreateProject,
    onProjectChange,
    onSignOut,
    pending,
    projectName,
    projects,
    publisherConnections,
    selectedProjectId,
    session,
    publicationsCount,
    onProjectNameChange,
}: DashboardShellProps) {
    const { pathname } = useLocation()
    const isPublicationRoute = pathname.includes('/publications/')
    const connectionsByChannel = new Map(
        publisherConnections.map(connection => [connection.channelId, connection])
    )
    const selectedProjectName =
        projects.find(project => project.id === selectedProjectId)?.name ?? 'No project selected'
    const userInitial = session.user.name.trim().charAt(0).toUpperCase() || 'H'

    return (
        <SidebarProvider className="herald-dashboard h-svh min-h-0 overflow-hidden bg-background">
            <Sidebar collapsible="icon" className="!border-0">
                <SidebarHeader className="gap-4 p-3 group-data-[collapsible=icon]:p-2">
                    <div className="flex items-center gap-2">
                        <Link
                            to="/dashboard"
                            aria-label="Herald workspace"
                            className="flex size-8 shrink-0 items-center justify-center rounded-md text-primary transition-[color,transform] hover:-translate-y-px hover:text-primary/75">
                            <HeraldLogo className="size-7" />
                        </Link>
                        <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                            <p className="truncate text-sm font-semibold tracking-tight">Herald</p>
                            <p className="truncate text-xs text-muted-foreground">
                                Publication manager
                            </p>
                        </div>
                    </div>

                    <div className="group-data-[collapsible=icon]:hidden">
                        <ProjectContext
                            onCreateProject={onCreateProject}
                            onProjectChange={onProjectChange}
                            onProjectNameChange={onProjectNameChange}
                            pending={pending}
                            projectName={projectName}
                            projects={projects}
                            selectedProjectId={selectedProjectId}
                        />
                    </div>
                </SidebarHeader>

                <SidebarContent>
                    <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                        <SidebarGroupLabel className="px-2">Workspace</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <nav aria-label="Workspace navigation">
                                <SidebarMenu>
                                    <WorkspaceMenuItem
                                        active={!isPublicationRoute}
                                        href="#overview"
                                        icon={<Widget2Icon aria-hidden="true" />}
                                        label="Overview"
                                    />
                                    <WorkspaceMenuItem
                                        href="#compose"
                                        icon={<PenIcon aria-hidden="true" />}
                                        label="Compose"
                                    />
                                    <WorkspaceMenuItem
                                        active={isPublicationRoute}
                                        href="#publications"
                                        icon={<ListIcon aria-hidden="true" />}
                                        label="Queue"
                                    />
                                    <WorkspaceMenuItem
                                        href="#channels"
                                        icon={<LinkIcon aria-hidden="true" />}
                                        label="Channels"
                                    />
                                    <WorkspaceMenuItem
                                        href="#media"
                                        icon={<GalleryIcon aria-hidden="true" />}
                                        label="Media"
                                    />
                                </SidebarMenu>
                            </nav>
                        </SidebarGroupContent>
                    </SidebarGroup>

                    <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                        <SidebarGroupLabel className="px-2">Channels</SidebarGroupLabel>
                        <SidebarGroupAction
                            render={<a href="#channels" aria-label="Manage channels" />}
                            title="Manage channels">
                            <AddIcon aria-hidden="true" />
                        </SidebarGroupAction>
                        <SidebarGroupContent>
                            {channels.length === 0 ? (
                                <p className="px-2 py-2 text-xs leading-5 text-muted-foreground group-data-[collapsible=icon]:hidden">
                                    No channels yet.
                                </p>
                            ) : (
                                <SidebarMenu>
                                    {channels.map(channel => {
                                        const connection = connectionsByChannel.get(channel.id)
                                        const channelState =
                                            channel.profileId === 'linkedin'
                                                ? connection?.state === 'active'
                                                    ? 'Connected'
                                                    : 'Needs connection'
                                                : 'Manual'

                                        return (
                                            <SidebarMenuItem key={channel.id}>
                                                <SidebarMenuButton
                                                    render={<a href="#channels" />}
                                                    tooltip={channel.name}>
                                                    <span
                                                        className={cn(
                                                            'size-1.5 shrink-0 rounded-full bg-current',
                                                            channelMarkerClass(channel.profileId)
                                                        )}
                                                        aria-hidden="true"
                                                    />
                                                    <span className="truncate group-data-[collapsible=icon]:hidden">
                                                        {channel.name}
                                                    </span>
                                                    <SidebarMenuBadge>
                                                        {channelState}
                                                    </SidebarMenuBadge>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        )
                                    })}
                                </SidebarMenu>
                            )}
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>

                <SidebarFooter className="gap-3 p-3 group-data-[collapsible=icon]:p-2">
                    <div className="rounded-md bg-sidebar-accent px-3 py-3 text-xs text-muted-foreground shadow-surface group-data-[collapsible=icon]:hidden">
                        <div className="flex items-center justify-between gap-3">
                            <span>Publications</span>
                            <span className="font-medium tabular-nums text-foreground">
                                {publicationsCount}
                            </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <span>Needs attention</span>
                            <span
                                className={cn(
                                    'font-medium tabular-nums',
                                    dueCount > 0 ? 'text-state-attention' : 'text-foreground'
                                )}>
                                {dueCount}
                            </span>
                        </div>
                    </div>

                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                disabled={pending}
                                onClick={onSignOut}
                                tooltip="Sign out">
                                <Logout2Icon aria-hidden="true" />
                                <span className="group-data-[collapsible=icon]:hidden">
                                    Sign out
                                </span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
            </Sidebar>

            <SidebarInset>
                <div data-dashboard-scroll="true" className="min-h-0 flex-1 overflow-y-auto">
                    <header
                        data-dashboard-header="true"
                        className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 bg-background/95 px-4 shadow-surface backdrop-blur-sm sm:px-6 lg:px-8">
                        <div className="flex min-w-0 items-center gap-2">
                            <SidebarTrigger
                                aria-label="Toggle workspace navigation"
                                title="Toggle workspace navigation"
                            />
                            <span
                                className="size-1.5 shrink-0 rounded-full bg-primary"
                                aria-hidden="true"
                            />
                            <div className="flex min-w-0 items-center gap-2 text-sm">
                                <span className="truncate text-muted-foreground">
                                    {isPublicationRoute ? 'Publication editor' : 'Herald workspace'}
                                </span>
                                <span className="text-muted-foreground/50" aria-hidden="true">
                                    /
                                </span>
                                <span className="max-w-48 truncate font-medium text-foreground">
                                    {selectedProjectName}
                                </span>
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                            <ThemeToggle />
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    render={
                                        <Button
                                            aria-label="Open account menu"
                                            variant="ghost"
                                            className="h-auto gap-2 px-1.5 py-1.5"
                                        />
                                    }>
                                    <Avatar size="sm">
                                        <AvatarFallback>{userInitial}</AvatarFallback>
                                    </Avatar>
                                    <span className="hidden max-w-44 truncate text-left text-sm font-medium sm:block">
                                        {session.user.name}
                                    </span>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-56">
                                    <DropdownMenuGroup>
                                        <DropdownMenuLabel className="max-w-52 truncate">
                                            {session.user.email}
                                        </DropdownMenuLabel>
                                    </DropdownMenuGroup>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={onSignOut} disabled={pending}>
                                        <Logout2Icon aria-hidden="true" />
                                        Sign out
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </header>
                    {children}
                </div>
            </SidebarInset>
        </SidebarProvider>
    )
}

function WorkspaceMenuItem({
    active = false,
    href,
    icon,
    label,
}: {
    readonly active?: boolean
    readonly href: string
    readonly icon: ReactNode
    readonly label: string
}) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                render={<a href={href} aria-current={active ? 'page' : undefined} />}
                isActive={active}
                tooltip={label}>
                {icon}
                <span className="group-data-[collapsible=icon]:hidden">{label}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    )
}

function ProjectContext({
    onCreateProject,
    onProjectChange,
    onProjectNameChange,
    pending,
    projectName,
    projects,
    selectedProjectId,
}: {
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly pending: boolean
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly selectedProjectId: string | null
}) {
    return (
        <div className="space-y-4">
            <Field className="min-w-0 gap-1.5">
                <FieldLabel className="text-xs font-medium text-muted-foreground">
                    Workspace
                </FieldLabel>
                <Select
                    items={Object.fromEntries([
                        ['__none__', 'No project selected'],
                        ...projects.map(project => [project.id, project.name]),
                    ])}
                    value={selectedProjectId}
                    onValueChange={value => onProjectChange(value === '__none__' ? null : value)}>
                    <SelectTrigger
                        aria-label="Select project"
                        className="h-9 w-full border-0 bg-sidebar-accent/45 px-2.5 shadow-none hover:bg-sidebar-accent focus-visible:ring-2">
                        <SelectValue placeholder="No project selected" />
                    </SelectTrigger>
                    <SelectContent align="start">
                        <SelectItem value="__none__">No project selected</SelectItem>
                        {projects.map(project => (
                            <SelectItem key={project.id} value={project.id}>
                                {project.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>

            <details className="group rounded-md bg-sidebar-accent/50 p-3 open:bg-sidebar-accent">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground transition-[color] hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <AddIcon aria-hidden="true" className="size-3.5" />
                    <span>Create project</span>
                </summary>
                <form className="mt-3 grid gap-2" onSubmit={onCreateProject}>
                    <Field>
                        <FieldLabel className="sr-only" htmlFor="new-project">
                            New project
                        </FieldLabel>
                        <Input
                            id="new-project"
                            required
                            value={projectName}
                            onChange={event => onProjectNameChange(event.target.value)}
                            placeholder="Project name"
                            className="h-9"
                        />
                    </Field>
                    <Button size="sm" type="submit" disabled={pending}>
                        <AddIcon aria-hidden="true" />
                        Add project
                    </Button>
                </form>
            </details>
        </div>
    )
}

function channelMarkerClass(profileId: string) {
    if (profileId === 'linkedin') return 'text-primary'
    if (profileId === 'manual-message') return 'text-state-queued'
    return 'text-primary'
}
