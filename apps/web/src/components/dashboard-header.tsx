import { Button } from '@postdot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { SidebarTrigger } from '@postdot/ui/components/sidebar'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { Logout2Icon } from '@solar-icons/react/linear/logout-2'
import { PaletteIcon } from '@solar-icons/react/linear/palette'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { TranslationIcon } from '@solar-icons/react/linear/translation'
import { Link } from '@tanstack/react-router'
import type { FormEvent } from 'react'

import { ActionTooltip } from '@/components/action-tooltip'
import { DashboardProjectContext } from '@/components/dashboard-project-context'
import { DashboardSearch } from '@/components/dashboard-search'
import { UserAvatar } from '@/components/identity-visuals'
import { isLocale, languageLabels } from '@/components/language-switcher'
import { NotificationInbox } from '@/components/notification-inbox'
import { selectedThemeOption, themeLabel, themeOptions } from '@/components/theme-toggle'
import type { Project, ProjectCategory, Session, WorkspaceListItem } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import * as m from '@/paraglide/messages.js'
import { locales } from '@/paraglide/runtime.js'

interface DashboardHeaderProps {
    readonly canCreateWorkspace: boolean
    readonly categories: readonly ProjectCategory[]
    readonly isUserPreferences: boolean
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onCreateWorkspace: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly onProjectTimeZoneChange: (timeZone: string) => void
    readonly onWorkspaceChange: (workspaceId: string) => void
    readonly onWorkspaceNameChange: (value: string) => void
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectId: string | null
    readonly projectName: string
    readonly projectTimeZone: string
    readonly projects: readonly Project[]
    readonly session: Session
    readonly workspaceId: string | null
    readonly workspaceName: string
    readonly workspaces: readonly WorkspaceListItem[]
}

export function DashboardHeader({
    canCreateWorkspace,
    categories,
    isUserPreferences,
    onCreateProject,
    onCreateWorkspace,
    onProjectChange,
    onProjectNameChange,
    onProjectTimeZoneChange,
    onWorkspaceChange,
    onWorkspaceNameChange,
    onSignOut,
    pending,
    projectId,
    projectName,
    projectTimeZone,
    projects,
    session,
    workspaceId,
    workspaceName,
    workspaces,
}: DashboardHeaderProps) {
    const { locale, setLocale } = useLanguage()
    const { theme: chosenTheme, setTheme } = useTheme()
    const selectedTheme = selectedThemeOption(chosenTheme)
    return (
        <header
            data-dashboard-header="true"
            className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 bg-surface-canvas/95 px-4 pl-2 backdrop-blur-sm sm:px-6 sm:pl-2 lg:px-8 lg:pl-2">
            <div className="flex min-w-0 items-center gap-2">
                <ActionTooltip label={m.nav_toggle()}>
                    <SidebarTrigger aria-label={m.nav_toggle()} />
                </ActionTooltip>
                <DashboardProjectContext
                    canCreateWorkspace={canCreateWorkspace}
                    categories={categories}
                    onCreateProject={onCreateProject}
                    onCreateWorkspace={onCreateWorkspace}
                    onProjectChange={onProjectChange}
                    onProjectNameChange={onProjectNameChange}
                    onProjectTimeZoneChange={onProjectTimeZoneChange}
                    onWorkspaceChange={onWorkspaceChange}
                    onWorkspaceNameChange={onWorkspaceNameChange}
                    pending={pending}
                    projectName={projectName}
                    projectTimeZone={projectTimeZone}
                    projects={projects}
                    selectedProjectId={projectId}
                    selectedWorkspaceId={workspaceId}
                    workspaceName={workspaceName}
                    workspaces={workspaces}
                />
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <DashboardSearch projectId={projectId} workspaceId={workspaceId} />
                <NotificationInbox
                    projectId={isUserPreferences ? null : projectId}
                    projects={projects}
                />
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                aria-label={m.nav_account_menu()}
                                data-slot="account-menu-trigger"
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
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger data-slot="account-menu-theme">
                                <PaletteIcon aria-hidden="true" />
                                {m.preferences_theme()}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-36">
                                {themeOptions.map(theme => (
                                    <DropdownMenuItem
                                        key={theme}
                                        aria-current={selectedTheme === theme ? 'true' : undefined}
                                        data-theme-option={theme}
                                        onClick={() => setTheme(theme)}>
                                        {themeLabel(theme)}
                                        {selectedTheme === theme ? (
                                            <CheckIcon aria-hidden="true" className="ml-auto" />
                                        ) : null}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger data-slot="account-menu-language">
                                <TranslationIcon aria-hidden="true" />
                                {m.language_menu_label()}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-36">
                                {locales.map(language => (
                                    <DropdownMenuItem
                                        key={language}
                                        aria-current={locale === language ? 'true' : undefined}
                                        lang={language}
                                        onClick={() => {
                                            if (locale !== language && isLocale(language))
                                                void setLocale(language)
                                        }}>
                                        {languageLabels[language]()}
                                        {locale === language ? (
                                            <CheckIcon aria-hidden="true" className="ml-auto" />
                                        ) : null}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            data-slot="account-menu-sign-out"
                            onClick={onSignOut}
                            disabled={pending}>
                            <Logout2Icon aria-hidden="true" />
                            {m.nav_sign_out()}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}
