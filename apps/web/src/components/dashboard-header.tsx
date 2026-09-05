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
import { SidebarTrigger } from '@herald/ui/components/sidebar'
import { Logout2Icon } from '@solar-icons/react/bold/logout-2'

import { ThemeToggle } from '@/components/theme-toggle'
import type { Session } from '@/lib/api'

interface DashboardHeaderProps {
    readonly isPublicationRoute: boolean
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectName: string
    readonly sectionLabel: string
    readonly session: Session
}

export function DashboardHeader({
    isPublicationRoute,
    onSignOut,
    pending,
    projectName,
    sectionLabel,
    session,
}: DashboardHeaderProps) {
    const userInitial = session.user.name.trim().charAt(0).toUpperCase() || 'H'

    return (
        <header
            data-dashboard-header="true"
            className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 bg-background/95 px-4 shadow-surface backdrop-blur-sm sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger
                    aria-label="Toggle workspace navigation"
                    title="Toggle workspace navigation"
                />
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <div className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="truncate text-muted-foreground">
                        {isPublicationRoute ? 'Publication editor' : sectionLabel}
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
    )
}
