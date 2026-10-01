import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import { SidebarTrigger } from '@herald/ui/components/sidebar'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { Logout2Icon } from '@solar-icons/react/linear/logout-2'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { Link } from '@tanstack/react-router'
import type { FormEvent } from 'react'

import { DashboardProjectContext } from '@/components/dashboard-project-context'
import { UserAvatar } from '@/components/identity-visuals'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationInbox } from '@/components/notification-inbox'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Project, ProjectCategory, Session, WorkspaceListItem } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface DashboardHeaderProps {
    readonly hasPageBack: boolean
    readonly canCreateWorkspace: boolean
    readonly categories: readonly ProjectCategory[]
    readonly isInstanceSettings: boolean
    readonly isProjectSettings: boolean
    readonly isWorkspaceSettings: boolean
    readonly isUserPreferences: boolean
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onCreateWorkspace: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly onWorkspaceChange: (workspaceId: string) => void
    readonly onWorkspaceNameChange: (value: string) => void
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectId: string | null
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly session: Session
    readonly workspaceId: string | null
    readonly workspaceName: string
    readonly workspaces: readonly WorkspaceListItem[]
}

export function DashboardHeader({
    hasPageBack,
    canCreateWorkspace,
    categories,
    isInstanceSettings,
    isProjectSettings,
    isWorkspaceSettings,
    isUserPreferences,
    onCreateProject,
    onCreateWorkspace,
    onProjectChange,
    onProjectNameChange,
    onWorkspaceChange,
    onWorkspaceNameChange,
    onSignOut,
    pending,
    projectId,
    projectName,
    projects,
    session,
    workspaceId,
    workspaceName,
    workspaces,
}: DashboardHeaderProps) {
    useLanguage()
    const isSettingsShell =
        isInstanceSettings || isProjectSettings || isWorkspaceSettings || isUserPreferences
    const backLabel = isProjectSettings ? m.nav_back_to_project() : m.nav_back_to_workspace()
    const backLink =
        isProjectSettings && projectId !== null ? (
            <Link params={{ projectId }} to="/dashboard/projects/$projectId/overview" />
        ) : (
            <Link search={{ workspaceId: workspaceId ?? undefined }} to="/dashboard" />
        )

    return (
        <header
            data-dashboard-header="true"
            className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 bg-surface-canvas/95 px-4 pl-2 backdrop-blur-sm sm:px-6 sm:pl-2 lg:px-8 lg:pl-2">
            <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger aria-label={m.nav_toggle()} title={m.nav_toggle()} />
                {isSettingsShell && !hasPageBack ? (
                    <Button
                        aria-label={backLabel}
                        className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                        nativeButton={false}
                        render={backLink}
                        size="sm"
                        title={backLabel}
                        variant="ghost">
                        <AltArrowLeftIcon aria-hidden="true" />
                        <span className="hidden sm:inline">{backLabel}</span>
                    </Button>
                ) : null}
                <DashboardProjectContext
                    canCreateWorkspace={canCreateWorkspace}
                    categories={categories}
                    onCreateProject={onCreateProject}
                    onCreateWorkspace={onCreateWorkspace}
                    onProjectChange={onProjectChange}
                    onProjectNameChange={onProjectNameChange}
                    onWorkspaceChange={onWorkspaceChange}
                    onWorkspaceNameChange={onWorkspaceNameChange}
                    pending={pending}
                    projectName={projectName}
                    projects={projects}
                    selectedProjectId={projectId}
                    selectedWorkspaceId={workspaceId}
                    workspaceName={workspaceName}
                    workspaces={workspaces}
                />
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <NotificationInbox
                    projectId={isUserPreferences ? null : projectId}
                    projects={projects}
                />
                <LanguageSwitcher />
                <ThemeToggle />
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                aria-label={m.nav_account_menu()}
                                variant="ghost"
                                className="h-auto gap-2 px-1.5 py-1.5"
                            />
                        }>
                        <UserAvatar
                            imageUrl={session.user.image}
                            name={session.user.name}
                            seed={session.user.id}
                        />
                        <span className="hidden max-w-44 truncate text-left text-sm font-medium sm:block">
                            {session.user.name}
                        </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-56">
                        <div className="max-w-52 truncate px-1.5 py-1 text-xs font-medium text-muted-foreground">
                            {session.user.email}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            render={
                                <Link
                                    search={{
                                        workspaceId: workspaceId ?? undefined,
                                        projectId: projectId ?? 'none',
                                    }}
                                    to="/dashboard/preferences"
                                />
                            }>
                            <SettingsIcon aria-hidden="true" />
                            {m.nav_preferences()}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onSignOut} disabled={pending}>
                            <Logout2Icon aria-hidden="true" />
                            {m.nav_sign_out()}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}
