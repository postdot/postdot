import { SolarProvider } from '@solar-icons/react'
import { ClipboardTextIcon } from '@solar-icons/react/linear/clipboard-text'
import { HomeIcon } from '@solar-icons/react/linear/home'
import { InfoCircleIcon } from '@solar-icons/react/linear/info-circle'
import { LoginIcon } from '@solar-icons/react/linear/login'
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {
    return (
        <SolarProvider size={18} strokeWidth={1.5}>
            <div className="min-h-screen bg-background text-foreground">
                <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
                    <Link to="/" className="text-lg font-semibold tracking-tight">
                        Herald
                    </Link>
                    <nav aria-label="Main navigation" className="flex items-center gap-1">
                        <Link
                            to="/"
                            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            activeProps={{ className: 'bg-muted text-foreground' }}>
                            <HomeIcon aria-hidden="true" />
                            Home
                        </Link>
                        <Link
                            to="/about"
                            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            activeProps={{ className: 'bg-muted text-foreground' }}>
                            <InfoCircleIcon aria-hidden="true" />
                            About
                        </Link>
                        <Link
                            to="/dashboard"
                            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            activeProps={{ className: 'bg-muted text-foreground' }}>
                            <ClipboardTextIcon aria-hidden="true" />
                            Dashboard
                        </Link>
                        <Link
                            to="/login"
                            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            activeProps={{ className: 'bg-muted text-foreground' }}>
                            <LoginIcon aria-hidden="true" />
                            Sign in
                        </Link>
                    </nav>
                </header>
                <main className="mx-auto max-w-6xl px-6">
                    <Outlet />
                </main>
            </div>
        </SolarProvider>
    )
}
