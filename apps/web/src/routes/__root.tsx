import { SolarProvider } from '@solar-icons/react'
import { ClipboardTextIcon } from '@solar-icons/react/linear/clipboard-text'
import { HomeIcon } from '@solar-icons/react/linear/home'
import { InfoCircleIcon } from '@solar-icons/react/linear/info-circle'
import { LoginIcon } from '@solar-icons/react/linear/login'
import { createRootRoute, Link, Outlet, useLocation } from '@tanstack/react-router'

export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {
    const { pathname } = useLocation()
    const isDashboardRoute = pathname === '/dashboard' || pathname.startsWith('/dashboard/')

    return (
        <SolarProvider size={18} strokeWidth={1.5}>
            <div className="min-h-screen bg-background text-foreground">
                <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-6">
                    <Link to="/" className="shrink-0 text-lg font-semibold tracking-tight">
                        Herald
                    </Link>
                    <nav
                        aria-label="Main navigation"
                        className="flex items-center gap-0.5 sm:gap-1">
                        <Link
                            to="/"
                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3"
                            activeProps={{ className: 'bg-muted text-foreground' }}>
                            <HomeIcon aria-hidden="true" />
                            <span className="sr-only sm:not-sr-only">Home</span>
                        </Link>
                        <Link
                            to="/about"
                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3"
                            activeProps={{ className: 'bg-muted text-foreground' }}>
                            <InfoCircleIcon aria-hidden="true" />
                            <span className="sr-only sm:not-sr-only">About</span>
                        </Link>
                        <Link
                            to="/dashboard"
                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3"
                            activeProps={{ className: 'bg-muted text-foreground' }}>
                            <ClipboardTextIcon aria-hidden="true" />
                            <span className="sr-only sm:not-sr-only">Dashboard</span>
                        </Link>
                        {isDashboardRoute ? null : (
                            <Link
                                to="/login"
                                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3"
                                activeProps={{ className: 'bg-muted text-foreground' }}>
                                <LoginIcon aria-hidden="true" />
                                <span className="sr-only sm:not-sr-only">Sign in</span>
                            </Link>
                        )}
                    </nav>
                </header>
                <main className="mx-auto max-w-6xl px-6">
                    <Outlet />
                </main>
            </div>
        </SolarProvider>
    )
}
