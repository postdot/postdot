import { SolarProvider } from '@solar-icons/react'
import { createRootRoute, Outlet } from '@tanstack/react-router'

import { ThemeProvider } from '@/lib/theme'

export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {
    return (
        <ThemeProvider>
            <SolarProvider size={18} strokeWidth={1.5}>
                <div className="min-h-screen bg-background text-foreground">
                    <Outlet />
                </div>
            </SolarProvider>
        </ThemeProvider>
    )
}
