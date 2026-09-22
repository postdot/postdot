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

import { UserAvatar } from '@/components/identity-visuals'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationInbox } from '@/components/notification-inbox'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Project, Session } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface DashboardHeaderProps {
    readonly isInstanceSettings: boolean
    readonly isProjectSettings: boolean
    readonly isWorkspaceSettings: boolean
    readonly isUserPreferences: boolean
    readonly isPublicationRoute: boolean
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectId: string | null
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly scopeLabel?: string
    readonly sectionLabel: string
    readonly session: Session
    readonly workspaceId: string | null
}

export function DashboardHeader({
    isInstanceSettings,
    isProjectSettings,
    isWorkspaceSettings,
    isUserPreferences,
    isPublicationRoute,
    onSignOut,
    pending,
    projectId,
    projectName,
    projects,
    scopeLabel,
    sectionLabel,
    session,
    workspaceId,
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
                {isSettingsShell ? (
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
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <div className="flex min-w-0 items-center gap-2 text-sm">
                    {scopeLabel ? (
                        <>
                            <span className="truncate text-muted-foreground">{scopeLabel}</span>
                            <span className="text-muted-foreground/50" aria-hidden="true">
                                /
                            </span>
                        </>
                    ) : null}
                    <span className="truncate text-muted-foreground">
                        {isPublicationRoute ? m.nav_publication_editor() : sectionLabel}
                    </span>
                    {projectId !== null && (!isSettingsShell || isProjectSettings) ? (
                        <>
                            <span className="text-muted-foreground/50" aria-hidden="true">
                                /
                            </span>
                            <span className="hidden max-w-48 truncate font-medium text-foreground sm:inline">
                                {projectName}
                            </span>
                        </>
                    ) : null}
                </div>
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
                                    search={{ workspaceId: workspaceId ?? undefined }}
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
