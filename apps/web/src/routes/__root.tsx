import { Toaster } from '@herald/ui/components/toast'
import { SolarProvider } from '@solar-icons/react'
import { createRootRoute, Outlet, type ErrorComponentProps } from '@tanstack/react-router'

import { AppErrorState } from '@/components/app-error-state'
import { LanguageProvider, useLanguage } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme'
import * as m from '@/paraglide/messages.js'

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
                <SolarProvider size={24} strokeWidth={2}>
                    <div className="min-h-screen bg-background text-foreground">
                        <Outlet />
                        <AppToaster />
                    </div>
                </SolarProvider>
            </ThemeProvider>
        </LanguageProvider>
    )
}

function AppToaster() {
    useLanguage()
    return <Toaster closeLabel={m.toast_dismiss()} viewportLabel={m.toast_region()} />
}
