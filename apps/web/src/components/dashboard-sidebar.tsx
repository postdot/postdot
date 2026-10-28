import { PostdotLogo } from '@postdot/ui/components/postdot-logo'
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@postdot/ui/components/sidebar'
import { AddIcon } from '@solar-icons/react/linear/add'
import { ArchiveIcon } from '@solar-icons/react/linear/archive'
import { ChartSquareIcon } from '@solar-icons/react/linear/chart-square'
import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { KeyMinimalisticIcon } from '@solar-icons/react/linear/key-minimalistic'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { ListIcon } from '@solar-icons/react/linear/list'
import { Logout2Icon } from '@solar-icons/react/linear/logout-2'
import { ServerIcon } from '@solar-icons/react/linear/server'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { TagIcon } from '@solar-icons/react/linear/tag'
import { UserCircleIcon } from '@solar-icons/react/linear/user-circle'
import { UserPlusRoundedIcon } from '@solar-icons/react/linear/user-plus-rounded'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'
import { Widget2Icon } from '@solar-icons/react/linear/widget-2'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { DashboardProjectCategory } from '@/components/dashboard-project-context'
import type {
    Channel,
    Project,
    ProjectCategory,
    ProjectMemberRole,
    PublisherConnection,
    WorkspaceListItem,
} from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export type DashboardSection =
    | 'overview'
    | 'performance'
    | 'new-publication'
    | 'queue'
    | 'channels'
    | 'media'
    | 'access'
    | 'invitations'
    | 'tags'
    | 'settings-archives'
    | 'settings-access'
    | 'settings-provider-applications'
    | 'workspace-channels'
    | 'settings-workspace'
    | 'settings'
    | 'preferences'
    | 'preferences-api-keys'
    | 'preferences-account'

interface DashboardSidebarProps {
    readonly activeSection: DashboardSection
    readonly categories: readonly ProjectCategory[]
    readonly channels: readonly Channel[]
    readonly isInstanceAdmin: boolean
    readonly isInstanceSettings: boolean
    readonly isProjectSettings: boolean
    readonly isWorkspaceSettings: boolean
    readonly isUserPreferences: boolean
    readonly isPublicationRoute: boolean
    readonly onProjectCategoryChange: (projectId: string, categoryId: string | null) => void
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projects: readonly Project[]
    readonly publisherConnections: readonly PublisherConnection[]
    readonly projectRole: ProjectMemberRole | null
    readonly selectedProjectId: string | null
    readonly selectedWorkspaceId: string | null
    readonly workspaces: readonly WorkspaceListItem[]
}

export function DashboardSidebar({
    activeSection,
    categories,
    channels,
    isInstanceAdmin,
    isInstanceSettings,
    isProjectSettings,
    isWorkspaceSettings,
    isUserPreferences,
    isPublicationRoute,
    onProjectCategoryChange,
    onSignOut,
    pending,
    projects,
    projectRole,
    selectedProjectId,
    selectedWorkspaceId,
    workspaces,
}: DashboardSidebarProps) {
    useLanguage()
    const canEditProject = projectRole === 'owner' || projectRole === 'editor'
    const isSettingsShell =
        isInstanceSettings || isProjectSettings || isWorkspaceSettings || isUserPreferences
    const selectedWorkspace = workspaces.find(workspace => workspace.id === selectedWorkspaceId)
    const canManageWorkspace =
        selectedWorkspace?.role === 'owner' || selectedWorkspace?.role === 'admin'

    return (
        <Sidebar
            collapsible="icon"
            className="!border-0 !bg-surface-raised md:!bg-transparent !shadow-surface md:!shadow-none md:p-0! [&_[data-slot=sidebar-inner]]:!bg-surface-canvas [&_[data-slot=sidebar-inner]]:!shadow-none"
            mobileCloseLabel={m.common_close()}
            mobileTitle={m.nav_aria_label()}
            mobileDescription={null}
            variant="inset">
            <SidebarHeader className="gap-4 p-3 group-data-[collapsible=icon]:h-14 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0">
                <div className="flex items-center gap-2 group-data-[collapsible=icon]:h-14 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center">
                    {isProjectSettings && selectedProjectId !== null ? (
                        <Link
                            to="/dashboard/projects/$projectId/overview"
                            params={{ projectId: selectedProjectId }}
                            aria-label={m.nav_aria_label()}
                            className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground hover:text-foreground/75 group-data-[collapsible=icon]:size-full! group-data-[collapsible=icon]:rounded-none">
                            <PostdotLogo className="size-7" />
                        </Link>
                    ) : isSettingsShell || selectedProjectId === null ? (
                        <Link
                            to="/dashboard"
                            aria-label={m.nav_aria_label()}
                            className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground hover:text-foreground/75 group-data-[collapsible=icon]:size-full! group-data-[collapsible=icon]:rounded-none">
                            <PostdotLogo className="size-7" />
                        </Link>
                    ) : (
                        <Link
                            to="/dashboard/projects/$projectId/overview"
                            params={{ projectId: selectedProjectId }}
                            aria-label={m.nav_aria_label()}
                            className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground hover:text-foreground/75 group-data-[collapsible=icon]:size-full! group-data-[collapsible=icon]:rounded-none">
                            <PostdotLogo className="size-7" />
                        </Link>
                    )}
                    <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                        <p className="truncate text-sm font-semibold">Postdot</p>
                    </div>
                </div>

                {!isSettingsShell ? (
                    <div className="group-data-[collapsible=icon]:hidden">
                        <DashboardProjectCategory
                            onProjectCategoryChange={onProjectCategoryChange}
                            pending={pending}
                            categories={categories}
                            selectedProject={
                                projects.find(project => project.id === selectedProjectId) ?? null
                            }
                        />
                    </div>
                ) : null}
            </SidebarHeader>

            {!isSettingsShell &&
            selectedProjectId !== null &&
            (channels.length > 0 || activeSection === 'new-publication') &&
            canEditProject ? (
                <div className="px-3 pb-1 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                className="bg-action text-action-foreground hover:bg-action/90 hover:text-action-foreground"
                                isActive={activeSection === 'new-publication'}
                                render={workspaceLink(
                                    'new-publication',
                                    selectedProjectId,
                                    selectedWorkspaceId,
                                    m.nav_new_publication(),
                                    activeSection === 'new-publication'
                                )}
                                size="lg"
                                title={m.nav_new_publication()}
                                tooltip={m.nav_new_publication()}>
                                <AddIcon aria-hidden="true" />
                                <span className="group-data-[collapsible=icon]:hidden">
                                    {m.nav_new_publication()}
                                </span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </div>
            ) : null}

            <SidebarContent>
                {isProjectSettings ? (
                    <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                        <SidebarGroupLabel className="px-2">
                            {m.nav_project_configuration()}
                        </SidebarGroupLabel>
                        <SidebarGroupContent>
                            <nav aria-label={m.nav_project_configuration()}>
                                <SidebarMenu>
                                    <WorkspaceMenuItem
                                        active={activeSection === 'access'}
                                        destination="access"
                                        icon={<KeyMinimalisticIcon aria-hidden="true" />}
                                        label={m.nav_access()}
                                        projectId={selectedProjectId}
                                        workspaceId={selectedWorkspaceId}
                                    />
                                    <WorkspaceMenuItem
                                        active={activeSection === 'invitations'}
                                        destination="invitations"
                                        icon={<UserPlusRoundedIcon aria-hidden="true" />}
                                        label={m.nav_project_invitations()}
                                        projectId={selectedProjectId}
                                        workspaceId={selectedWorkspaceId}
                                    />
                                    <WorkspaceMenuItem
                                        active={activeSection === 'tags'}
                                        destination="tags"
                                        icon={<TagIcon aria-hidden="true" />}
                                        label={m.taxonomy_tags()}
                                        projectId={selectedProjectId}
                                        workspaceId={selectedWorkspaceId}
                                    />
                                </SidebarMenu>
                            </nav>
                        </SidebarGroupContent>
                    </SidebarGroup>
                ) : isUserPreferences || isInstanceSettings || isWorkspaceSettings ? (
                    <>
                        <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                            <SidebarGroupLabel className="px-2">
                                {m.nav_personal_settings()}
                            </SidebarGroupLabel>
                            <SidebarGroupContent>
                                <nav aria-label={m.nav_personal_settings()}>
                                    <SidebarMenu>
                                        <WorkspaceMenuItem
                                            active={activeSection === 'preferences'}
                                            destination="preferences"
                                            icon={<SettingsIcon aria-hidden="true" />}
                                            label={m.nav_preferences_general()}
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                        />
                                        <WorkspaceMenuItem
                                            active={activeSection === 'preferences-account'}
                                            destination="preferences-account"
                                            icon={<UserCircleIcon aria-hidden="true" />}
                                            label={m.nav_preferences_account()}
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                        />
                                        <WorkspaceMenuItem
                                            active={activeSection === 'preferences-api-keys'}
                                            destination="preferences-api-keys"
                                            icon={<KeyMinimalisticIcon aria-hidden="true" />}
                                            label={m.nav_preferences_api_keys()}
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                        />
                                    </SidebarMenu>
                                </nav>
                            </SidebarGroupContent>
                        </SidebarGroup>
                        <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                            <SidebarGroupLabel className="px-2">
                                {m.nav_resources()}
                            </SidebarGroupLabel>
                            <SidebarGroupContent>
                                <nav aria-label={m.nav_resources()}>
                                    <SidebarMenu>
                                        <WorkspaceMenuItem
                                            active={activeSection === 'settings-archives'}
                                            destination="settings-archives"
                                            icon={<ArchiveIcon aria-hidden="true" />}
                                            label={m.lifecycle_archives()}
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                        />
                                    </SidebarMenu>
                                </nav>
                            </SidebarGroupContent>
                        </SidebarGroup>
                        {isInstanceAdmin ? (
                            <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                                <SidebarGroupLabel className="px-2">
                                    {m.nav_installation()}
                                </SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <nav aria-label={m.nav_instance_navigation()}>
                                        <SidebarMenu>
                                            <WorkspaceMenuItem
                                                active={activeSection === 'settings'}
                                                destination="settings"
                                                icon={<ServerIcon aria-hidden="true" />}
                                                label={m.nav_instance_configuration()}
                                                projectId={selectedProjectId}
                                                workspaceId={selectedWorkspaceId}
                                            />
                                            <WorkspaceMenuItem
                                                active={activeSection === 'settings-access'}
                                                destination="settings-access"
                                                icon={<UserPlusRoundedIcon aria-hidden="true" />}
                                                label={m.nav_instance_access()}
                                                projectId={selectedProjectId}
                                                workspaceId={selectedWorkspaceId}
                                            />
                                            <WorkspaceMenuItem
                                                active={
                                                    activeSection ===
                                                    'settings-provider-applications'
                                                }
                                                destination="settings-provider-applications"
                                                icon={<LinkIcon aria-hidden="true" />}
                                                label={m.nav_instance_provider_apps()}
                                                projectId={selectedProjectId}
                                                workspaceId={selectedWorkspaceId}
                                            />
                                        </SidebarMenu>
                                    </nav>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        ) : null}
                        {canManageWorkspace ? (
                            <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                                <SidebarGroupLabel className="px-2">
                                    {m.nav_workspace()}
                                </SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <nav aria-label={m.nav_workspace_navigation()}>
                                        <SidebarMenu>
                                            <WorkspaceMenuItem
                                                active={activeSection === 'workspace-channels'}
                                                destination="workspace-channels"
                                                icon={<LinkIcon aria-hidden="true" />}
                                                label={m.workspace_channels_title()}
                                                projectId={selectedProjectId}
                                                workspaceId={selectedWorkspaceId}
                                            />
                                            <WorkspaceMenuItem
                                                active={activeSection === 'settings-workspace'}
                                                destination="settings-workspace"
                                                icon={
                                                    <UsersGroupTwoRoundedIcon aria-hidden="true" />
                                                }
                                                label={m.nav_workspace_administration()}
                                                projectId={selectedProjectId}
                                                workspaceId={selectedWorkspaceId}
                                            />
                                        </SidebarMenu>
                                    </nav>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        ) : null}
                    </>
                ) : (
                    <>
                        <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                            <SidebarGroupLabel className="px-2">{m.nav_work()}</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <nav aria-label={m.nav_work_navigation()}>
                                    <SidebarMenu>
                                        <WorkspaceMenuItem
                                            active={activeSection === 'overview'}
                                            destination="overview"
                                            icon={<Widget2Icon aria-hidden="true" />}
                                            label={
                                                selectedProjectId === null
                                                    ? m.nav_projects()
                                                    : m.nav_overview()
                                            }
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                        />
                                        <WorkspaceMenuItem
                                            active={activeSection === 'performance'}
                                            destination="performance"
                                            icon={<ChartSquareIcon aria-hidden="true" />}
                                            label={m.nav_performance()}
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                        />
                                        <WorkspaceMenuItem
                                            active={activeSection === 'queue' || isPublicationRoute}
                                            destination="queue"
                                            icon={<ListIcon aria-hidden="true" />}
                                            label={m.nav_queue()}
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                        />
                                    </SidebarMenu>
                                </nav>
                            </SidebarGroupContent>
                        </SidebarGroup>

                        <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                            <SidebarGroupLabel className="px-2">
                                {m.nav_project()}
                            </SidebarGroupLabel>
                            <SidebarGroupContent>
                                <nav aria-label={m.nav_project_management_navigation()}>
                                    <SidebarMenu>
                                        <WorkspaceMenuItem
                                            destination="channels"
                                            icon={<LinkIcon aria-hidden="true" />}
                                            label={m.nav_channels()}
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                            active={activeSection === 'channels'}
                                        />
                                        <WorkspaceMenuItem
                                            destination="media"
                                            icon={<GalleryIcon aria-hidden="true" />}
                                            label={m.nav_media()}
                                            projectId={selectedProjectId}
                                            workspaceId={selectedWorkspaceId}
                                            active={activeSection === 'media'}
                                        />
                                    </SidebarMenu>
                                </nav>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    </>
                )}
                {selectedWorkspaceId && (!isSettingsShell || !canManageWorkspace) ? (
                    <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                        <SidebarGroupLabel className="px-2">{m.nav_workspace()}</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <nav aria-label={m.workspace_channels_navigation()}>
                                <SidebarMenu>
                                    <WorkspaceMenuItem
                                        active={activeSection === 'workspace-channels'}
                                        destination="workspace-channels"
                                        icon={<LinkIcon aria-hidden="true" />}
                                        label={m.workspace_channels_title()}
                                        projectId={selectedProjectId}
                                        workspaceId={selectedWorkspaceId}
                                    />
                                </SidebarMenu>
                            </nav>
                        </SidebarGroupContent>
                    </SidebarGroup>
                ) : null}
            </SidebarContent>

            <SidebarFooter className="gap-3 p-3 group-data-[collapsible=icon]:p-2">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            disabled={pending}
                            aria-label={m.nav_sign_out()}
                            onClick={onSignOut}
                            tooltip={m.nav_sign_out()}>
                            <Logout2Icon aria-hidden="true" />
                            <span className="group-data-[collapsible=icon]:hidden">
                                {m.nav_sign_out()}
                            </span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    )
}

export function workspaceSection(pathname: string): DashboardSection {
    if (pathname === '/dashboard/workspace/channels') return 'workspace-channels'
    if (pathname === '/dashboard/preferences/account') return 'preferences-account'
    if (pathname === '/dashboard/preferences/api-keys') return 'preferences-api-keys'
    if (pathname === '/dashboard/preferences') return 'preferences'
    if (pathname === '/dashboard/settings/archives') return 'settings-archives'
    if (pathname.includes('/settings/access')) return 'settings-access'
    if (pathname.includes('/settings/workspace')) return 'settings-workspace'
    if (pathname.includes('/settings/provider-applications')) {
        return 'settings-provider-applications'
    }
    if (pathname.includes('/settings')) return 'settings'
    if (pathname.includes('/publications/new')) return 'new-publication'
    if (pathname.includes('/publications/') || pathname.includes('/posts/')) return 'queue'
    if (pathname.includes('/performance')) return 'performance'
    if (pathname.includes('/queue')) return 'queue'
    if (pathname.includes('/channels')) return 'channels'
    if (pathname.includes('/media')) return 'media'
    if (pathname.includes('/invitations')) return 'invitations'
    if (pathname.includes('/tags')) return 'tags'
    if (pathname.includes('/access')) return 'access'
    return 'overview'
}

export function workspaceSectionLabel(section: DashboardSection) {
    if (section === 'new-publication') return m.nav_new_publication()
    if (section === 'performance') return m.nav_performance()
    if (section === 'queue') return m.nav_queue()
    if (section === 'workspace-channels') return m.workspace_channels_title()
    if (section === 'channels') return m.nav_channels()
    if (section === 'media') return m.nav_media()
    if (section === 'access') return m.nav_access()
    if (section === 'invitations') return m.nav_project_invitations()
    if (section === 'tags') return m.taxonomy_tags()
    if (section === 'settings-archives') return m.lifecycle_archives()
    if (section === 'settings-access') return m.nav_instance_access()
    if (section === 'settings-provider-applications') return m.nav_instance_provider_apps()
    if (section === 'settings-workspace') return m.nav_workspace_administration()
    if (section === 'settings') return m.nav_instance_configuration()
    if (section === 'preferences') return m.nav_preferences_general()
    if (section === 'preferences-account') return m.nav_preferences_account()
    if (section === 'preferences-api-keys') return m.nav_preferences_api_keys()
    return m.nav_overview()
}

function WorkspaceMenuItem({
    active = false,
    destination,
    icon,
    label,
    projectId,
    workspaceId,
}: {
    readonly active?: boolean
    readonly destination: DashboardSection
    readonly icon: ReactNode
    readonly label: string
    readonly projectId: string | null
    readonly workspaceId: string | null
}) {
    const requiresProject =
        projectId === null &&
        (destination === 'new-publication' ||
            destination === 'performance' ||
            destination === 'queue' ||
            destination === 'channels' ||
            destination === 'media' ||
            destination === 'access' ||
            destination === 'invitations' ||
            destination === 'tags')

    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                data-navigation-destination={
                    requiresProject
                        ? undefined
                        : destination === 'overview' && projectId === null
                          ? 'projects'
                          : destination
                }
                data-navigation-scope={
                    requiresProject
                        ? undefined
                        : destination.startsWith('preferences')
                          ? 'personal'
                          : destination === 'workspace-channels' ||
                              destination === 'settings-workspace' ||
                              (destination === 'overview' && projectId === null)
                            ? 'workspace'
                            : destination.startsWith('settings')
                              ? 'installation'
                              : 'project'
                }
                aria-disabled={requiresProject}
                disabled={requiresProject}
                render={
                    requiresProject
                        ? undefined
                        : workspaceLink(destination, projectId, workspaceId, label, active)
                }
                isActive={active}
                tabIndex={requiresProject ? -1 : undefined}
                className={
                    requiresProject
                        ? 'cursor-not-allowed text-muted-foreground/45 opacity-100 hover:bg-transparent hover:text-muted-foreground/45'
                        : undefined
                }
                tooltip={requiresProject ? m.nav_project_required() : label}>
                {icon}
                <span className="group-data-[collapsible=icon]:hidden">{label}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    )
}

function workspaceLink(
    destination: DashboardSection,
    projectId: string | null,
    workspaceId: string | null,
    ariaLabel?: string,
    active = false
) {
    if (destination === 'settings') {
        return (
            <Link
                to="/dashboard/settings"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'settings-archives') {
        return (
            <Link
                to="/dashboard/settings/archives"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'settings-access') {
        return (
            <Link
                to="/dashboard/settings/access"
                search={{
                    workspaceId: workspaceId ?? undefined,
                    projectId: projectId ?? 'none',
                    invitation: undefined,
                    organizationInvitation: undefined,
                }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'settings-provider-applications') {
        return (
            <Link
                to="/dashboard/settings/provider-applications"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'workspace-channels')
        return (
            <Link
                to="/dashboard/workspace/channels"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    if (destination === 'settings-workspace') {
        return (
            <Link
                to="/dashboard/settings/workspace"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'preferences') {
        return (
            <Link
                to="/dashboard/preferences"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'preferences-account') {
        return (
            <Link
                to="/dashboard/preferences/account"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'preferences-api-keys') {
        return (
            <Link
                to="/dashboard/preferences/api-keys"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (projectId === null) {
        return (
            <Link
                to="/dashboard"
                search={{ workspaceId: workspaceId ?? undefined, projectId: projectId ?? 'none' }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'overview') {
        return (
            <Link
                to="/dashboard/projects/$projectId/overview"
                params={{ projectId }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (destination === 'new-publication') {
        return (
            <Link
                to="/dashboard/projects/$projectId/publications/new"
                params={{ projectId }}
                activeOptions={{ exact: true }}
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    return (
        <Link
            to={`/dashboard/projects/$projectId/${destination}`}
            params={{ projectId }}
            aria-label={ariaLabel}
            aria-current={active ? 'page' : undefined}
        />
    )
}
