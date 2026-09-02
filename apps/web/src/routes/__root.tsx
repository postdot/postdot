import { HeraldLogo } from '@herald/ui/components/herald-logo'
import { SolarProvider } from '@solar-icons/react'
import { ClipboardTextIcon } from '@solar-icons/react/bold/clipboard-text'
import { HomeIcon } from '@solar-icons/react/bold/home'
import { LoginIcon } from '@solar-icons/react/bold/login'
import { QuestionMarkIcon } from '@solar-icons/react/bold/question-mark'
import { createRootRoute, Link, Outlet, useLocation } from '@tanstack/react-router'

import { ThemeToggle } from '@/components/theme-toggle'
import { ThemeProvider } from '@/lib/theme'

export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {
    const { pathname } = useLocation()
    const isDashboardRoute = pathname === '/dashboard' || pathname.startsWith('/dashboard/')

    return (
        <ThemeProvider>
            <SolarProvider size={18} strokeWidth={1.5}>
                <div className="min-h-screen bg-background text-foreground">
                    {isDashboardRoute ? (
                        <Outlet />
                    ) : (
                        <>
                            <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-6">
                                <Link
                                    to="/"
                                    className="flex shrink-0 items-center gap-2 text-lg font-semibold tracking-tight">
                                    <HeraldLogo className="size-7 text-primary" />
                                    Herald
                                </Link>
                                <div className="flex items-center gap-1">
                                    <ThemeToggle />
                                    <nav
                                        aria-label="Main navigation"
                                        className="flex items-center gap-0.5 sm:gap-1">
                                        <Link
                                            to="/"
                                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-[background-color,color] hover:bg-muted hover:text-foreground sm:px-3"
                                            activeProps={{ className: 'bg-muted text-foreground' }}>
                                            <HomeIcon aria-hidden="true" />
                                            <span className="sr-only sm:not-sr-only">Home</span>
                                        </Link>
                                        <Link
                                            to="/about"
                                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-[background-color,color] hover:bg-muted hover:text-foreground sm:px-3"
                                            activeProps={{ className: 'bg-muted text-foreground' }}>
                                            <QuestionMarkIcon aria-hidden="true" />
                                            <span className="sr-only sm:not-sr-only">About</span>
                                        </Link>
                                        <Link
                                            to="/dashboard"
                                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-[background-color,color] hover:bg-muted hover:text-foreground sm:px-3"
                                            activeProps={{ className: 'bg-muted text-foreground' }}>
                                            <ClipboardTextIcon aria-hidden="true" />
                                            <span className="sr-only sm:not-sr-only">
                                                Dashboard
                                            </span>
                                        </Link>
                                        <Link
                                            to="/login"
                                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-[background-color,color] hover:bg-muted hover:text-foreground sm:px-3"
                                            activeProps={{ className: 'bg-muted text-foreground' }}>
                                            <LoginIcon aria-hidden="true" />
                                            <span className="sr-only sm:not-sr-only">Sign in</span>
                                        </Link>
                                    </nav>
                                </div>
                            </header>
                            <main className="mx-auto max-w-6xl px-6">
                                <Outlet />
                            </main>
                        </>
                    )}
                </div>
            </SolarProvider>
        </ThemeProvider>
    )
}
