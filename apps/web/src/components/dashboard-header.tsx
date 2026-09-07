import { Avatar, AvatarFallback } from '@herald/ui/components/avatar'
import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import { SidebarTrigger } from '@herald/ui/components/sidebar'
import { Logout2Icon } from '@solar-icons/react/bold/logout-2'

import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationInbox } from '@/components/notification-inbox'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Session } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface DashboardHeaderProps {
    readonly isPublicationRoute: boolean
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectId: string | null
    readonly projectName: string
    readonly sectionLabel: string
    readonly session: Session
}

export function DashboardHeader({
    isPublicationRoute,
    onSignOut,
    pending,
    projectId,
    projectName,
    sectionLabel,
    session,
}: DashboardHeaderProps) {
    useLanguage()
    const userInitial = session.user.name.trim().charAt(0).toUpperCase() || 'H'

    return (
        <header
            data-dashboard-header="true"
            className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 bg-background/95 px-4 shadow-surface backdrop-blur-sm sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger aria-label={m.nav_toggle()} title={m.nav_toggle()} />
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <div className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="truncate text-muted-foreground">
                        {isPublicationRoute ? m.nav_publication_editor() : sectionLabel}
                    </span>
                    <span className="text-muted-foreground/50" aria-hidden="true">
                        /
                    </span>
                    <span className="max-w-48 truncate font-medium text-foreground">
                        {projectName}
                    </span>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <NotificationInbox projectId={projectId} />
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
                        <Avatar size="sm">
                            <AvatarFallback>{userInitial}</AvatarFallback>
                        </Avatar>
                        <span className="hidden max-w-44 truncate text-left text-sm font-medium sm:block">
                            {session.user.name}
                        </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-56">
                        <div className="max-w-52 truncate px-1.5 py-1 text-xs font-medium text-muted-foreground">
                            {session.user.email}
                        </div>
                        <DropdownMenuSeparator />
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
