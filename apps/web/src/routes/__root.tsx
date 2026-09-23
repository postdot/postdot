import { SolarProvider } from '@solar-icons/react'
import { createRootRoute, Outlet, type ErrorComponentProps } from '@tanstack/react-router'

import { AppErrorState } from '@/components/app-error-state'
import { LanguageProvider } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme'

export const Route = createRootRoute({
    component: RootLayout,
    errorComponent: RootError,
})

function RootError({ reset }: ErrorComponentProps) {
    return <AppErrorState reset={reset} />
}

function RootLayout() {
    return (
        <LanguageProvider>
            <ThemeProvider>
                <SolarProvider size={18} strokeWidth={1.5}>
                    <div className="min-h-screen bg-background text-foreground">
                        <Outlet />
                    </div>
                </SolarProvider>
            </ThemeProvider>
        </LanguageProvider>
    )
}
