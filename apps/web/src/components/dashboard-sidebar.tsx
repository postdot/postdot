import { HeraldLogo } from '@herald/ui/components/herald-logo'
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@herald/ui/components/sidebar'
import { cn } from '@herald/ui/lib/utils'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CalendarMinimalisticIcon } from '@solar-icons/react/bold/calendar-minimalistic'
import { GalleryIcon } from '@solar-icons/react/bold/gallery'
import { KeyMinimalisticIcon } from '@solar-icons/react/bold/key-minimalistic'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { ListIcon } from '@solar-icons/react/bold/list'
import { Logout2Icon } from '@solar-icons/react/bold/logout-2'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { SettingsIcon } from '@solar-icons/react/bold/settings'
import { Widget2Icon } from '@solar-icons/react/bold/widget-2'
import { Link } from '@tanstack/react-router'
import type { FormEvent, ReactNode } from 'react'

import { DashboardProjectContext } from '@/components/dashboard-project-context'
import type { Channel, Project, PublisherConnection } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export type DashboardSection =
    | 'overview'
    | 'calendar'
    | 'compose'
    | 'queue'
    | 'channels'
    | 'media'
    | 'access'
    | 'settings'

interface DashboardSidebarProps {
    readonly activeSection: DashboardSection
    readonly channels: readonly Channel[]
    readonly dueCount: number
    readonly isInstanceSettings: boolean
    readonly isPublicationRoute: boolean
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly publisherConnections: readonly PublisherConnection[]
    readonly publicationsCount: number
    readonly selectedProjectId: string | null
}

export function DashboardSidebar({
    activeSection,
    channels,
    dueCount,
    isInstanceSettings,
    isPublicationRoute,
    onCreateProject,
    onProjectChange,
    onProjectNameChange,
    onSignOut,
    pending,
    projectName,
    projects,
    publisherConnections,
    publicationsCount,
    selectedProjectId,
}: DashboardSidebarProps) {
    useLanguage()
    const connectionsByChannel = new Map(
        publisherConnections.map(connection => [connection.channelId, connection])
    )

    return (
        <Sidebar
            collapsible="icon"
            className="!border-0"
            mobileCloseLabel={m.common_close()}
            variant="inset">
            <SidebarHeader className="gap-4 p-3 group-data-[collapsible=icon]:p-2">
                <div className="flex items-center gap-2">
                    {selectedProjectId === null ? (
                        <Link
                            to="/dashboard"
                            aria-label={m.nav_aria_label()}
                            className="flex size-8 shrink-0 items-center justify-center rounded-md text-primary transition-[color,transform] hover:-translate-y-px hover:text-primary/75">
                            <HeraldLogo className="size-7" />
                        </Link>
                    ) : (
                        <Link
                            to="/dashboard/projects/$projectId/overview"
                            params={{ projectId: selectedProjectId }}
                            aria-label={m.nav_aria_label()}
                            className="flex size-8 shrink-0 items-center justify-center rounded-md text-primary transition-[color,transform] hover:-translate-y-px hover:text-primary/75">
                            <HeraldLogo className="size-7" />
                        </Link>
                    )}
                    <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                        <p className="truncate text-sm font-semibold tracking-tight">Herald</p>
                        <p className="truncate text-xs text-muted-foreground">
                            {m.nav_publication_manager()}
                        </p>
                    </div>
                </div>

                <div className="group-data-[collapsible=icon]:hidden">
                    <DashboardProjectContext
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
                {isInstanceSettings ? (
                    <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                        <SidebarGroupLabel className="px-2">{m.nav_instance()}</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <nav aria-label={m.nav_instance_navigation()}>
                                <SidebarMenu>
                                    <WorkspaceMenuItem
                                        active
                                        destination="settings"
                                        icon={<SettingsIcon aria-hidden="true" />}
                                        label={m.nav_settings()}
                                        projectId={null}
                                    />
                                </SidebarMenu>
                            </nav>
                        </SidebarGroupContent>
                    </SidebarGroup>
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
                                            label={m.nav_overview()}
                                            projectId={selectedProjectId}
                                        />
                                        <WorkspaceMenuItem
                                            active={activeSection === 'calendar'}
                                            destination="calendar"
                                            icon={<CalendarMinimalisticIcon aria-hidden="true" />}
                                            label={m.nav_calendar()}
                                            projectId={selectedProjectId}
                                        />
                                        <WorkspaceMenuItem
                                            destination="compose"
                                            icon={<PenIcon aria-hidden="true" />}
                                            label={m.nav_compose()}
                                            projectId={selectedProjectId}
                                            active={activeSection === 'compose'}
                                        />
                                        <WorkspaceMenuItem
                                            active={activeSection === 'queue' || isPublicationRoute}
                                            destination="queue"
                                            icon={<ListIcon aria-hidden="true" />}
                                            label={m.nav_queue()}
                                            projectId={selectedProjectId}
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
                                            active={activeSection === 'channels'}
                                        />
                                        <WorkspaceMenuItem
                                            destination="media"
                                            icon={<GalleryIcon aria-hidden="true" />}
                                            label={m.nav_media()}
                                            projectId={selectedProjectId}
                                            active={activeSection === 'media'}
                                        />
                                        <WorkspaceMenuItem
                                            destination="access"
                                            icon={<KeyMinimalisticIcon aria-hidden="true" />}
                                            label={m.nav_access()}
                                            projectId={selectedProjectId}
                                            active={activeSection === 'access'}
                                        />
                                    </SidebarMenu>
                                </nav>
                            </SidebarGroupContent>
                        </SidebarGroup>

                        <SidebarGroup className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                            <SidebarGroupLabel className="px-2">
                                {m.nav_channels()}
                            </SidebarGroupLabel>
                            <SidebarGroupAction
                                render={workspaceLink(
                                    'channels',
                                    selectedProjectId,
                                    m.nav_manage_channels()
                                )}
                                title={m.nav_manage_channels()}>
                                <AddIcon aria-hidden="true" />
                            </SidebarGroupAction>
                            <SidebarGroupContent>
                                {channels.length === 0 ? (
                                    <p className="px-2 py-2 text-xs leading-5 text-muted-foreground group-data-[collapsible=icon]:hidden">
                                        {m.nav_no_channels()}
                                    </p>
                                ) : (
                                    <SidebarMenu>
                                        {channels.map(channel => {
                                            const connection = connectionsByChannel.get(channel.id)
                                            const channelState =
                                                channel.state === 'archived'
                                                    ? m.channel_archived()
                                                    : channel.profileId === 'linkedin'
                                                      ? connection?.state === 'active'
                                                          ? m.channel_connected()
                                                          : m.channel_needs_connection()
                                                      : connection?.state === 'active'
                                                        ? m.channel_connected()
                                                        : channel.profileId === 'manual-message'
                                                          ? m.channel_manual()
                                                          : m.channel_needs_connection()

                                            return (
                                                <SidebarMenuItem key={channel.id}>
                                                    <SidebarMenuButton
                                                        render={workspaceLink(
                                                            'channels',
                                                            selectedProjectId,
                                                            channel.name
                                                        )}
                                                        tooltip={m.nav_channel_tooltip({
                                                            channel: channel.name,
                                                            provider: channelProviderLabel(
                                                                channel.profileId
                                                            ),
                                                            state: channelState,
                                                        })}>
                                                        <span
                                                            className={cn(
                                                                'size-1.5 shrink-0 rounded-full bg-current',
                                                                channelMarkerClass(
                                                                    channel.profileId
                                                                )
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
                    </>
                )}
            </SidebarContent>

            <SidebarFooter className="gap-3 p-3 group-data-[collapsible=icon]:p-2">
                {!isInstanceSettings ? (
                    <div className="rounded-md bg-sidebar-accent px-3 py-3 text-xs text-muted-foreground shadow-surface group-data-[collapsible=icon]:hidden">
                        <div className="flex items-center justify-between gap-3">
                            <span>{m.nav_publications()}</span>
                            <span className="font-medium tabular-nums text-foreground">
                                {publicationsCount}
                            </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <span>{m.nav_needs_attention()}</span>
                            <span
                                className={cn(
                                    'font-medium tabular-nums',
                                    dueCount > 0 ? 'text-state-attention' : 'text-foreground'
                                )}>
                                {dueCount}
                            </span>
                        </div>
                    </div>
                ) : null}

                <SidebarMenu>
                    {!isInstanceSettings ? (
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                render={workspaceLink(
                                    'settings',
                                    null,
                                    m.nav_settings(),
                                    activeSection === 'settings'
                                )}
                                isActive={activeSection === 'settings'}
                                tooltip={m.nav_settings()}>
                                <SettingsIcon aria-hidden="true" />
                                <span className="group-data-[collapsible=icon]:hidden">
                                    {m.nav_settings()}
                                </span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ) : null}
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
    if (pathname.includes('/settings')) return 'settings'
    if (pathname.includes('/calendar')) return 'calendar'
    if (pathname.includes('/compose')) return 'compose'
    if (pathname.includes('/queue')) return 'queue'
    if (pathname.includes('/channels')) return 'channels'
    if (pathname.includes('/media')) return 'media'
    if (pathname.includes('/access')) return 'access'
    return 'overview'
}

export function workspaceSectionLabel(section: DashboardSection) {
    if (section === 'calendar') return m.nav_calendar()
    if (section === 'compose') return m.nav_compose()
    if (section === 'queue') return m.nav_queue()
    if (section === 'channels') return m.nav_channels()
    if (section === 'media') return m.nav_media()
    if (section === 'access') return m.nav_access()
    if (section === 'settings') return m.nav_settings()
    return m.nav_overview()
}

function WorkspaceMenuItem({
    active = false,
    destination,
    icon,
    label,
    projectId,
}: {
    readonly active?: boolean
    readonly destination: DashboardSection
    readonly icon: ReactNode
    readonly label: string
    readonly projectId: string | null
}) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                render={workspaceLink(destination, projectId, label, active)}
                isActive={active}
                tooltip={label}>
                {icon}
                <span className="group-data-[collapsible=icon]:hidden">{label}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    )
}

function workspaceLink(
    destination: DashboardSection,
    projectId: string | null,
    ariaLabel?: string,
    active = false
) {
    if (destination === 'settings') {
        return (
            <Link
                to="/dashboard/settings/provider-applications"
                aria-label={ariaLabel}
                aria-current={active ? 'page' : undefined}
            />
        )
    }

    if (projectId === null) {
        return (
            <Link
                to="/dashboard"
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

function channelMarkerClass(profileId: string) {
    if (profileId === 'linkedin') return 'text-primary'
    if (profileId === 'manual-message') return 'text-state-queued'
    return 'text-primary'
}

function channelProviderLabel(profileId: string) {
    if (profileId === 'bluesky') return 'Bluesky'
    if (profileId === 'discord') return 'Discord'
    if (profileId === 'devto') return 'DEV.to'
    if (profileId === 'linkedin') return 'LinkedIn'
    if (profileId === 'mastodon') return 'Mastodon'
    if (profileId === 'manual-message') return m.channel_manual()
    return m.channel_custom_profile()
}
