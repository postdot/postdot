import { ClientThemeProvider } from '@wrksz/themes/client'
import { ThemeScript } from '@wrksz/themes/script'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import type { ReactNode } from 'react'

import { PublicScroll } from './public-scroll'

const themeOptions = {
    attribute: 'class',
    defaultTheme: 'light',
    storage: 'localStorage',
    storageKey: 'theme',
    enableSystem: true,
    disableTransitionOnChange: 'background-color 0s, color 0s',
} as const

/** Sets the theme before the first paint; the prerendered HTML cannot know it. */
export function PublicThemeScript() {
    return <ThemeScript {...themeOptions} />
}

export function Providers({ children }: { children: ReactNode }) {
    return (
        <ClientThemeProvider {...themeOptions}>
            <RootProvider
                theme={{ enabled: false }}
                search={{ options: { type: 'static', api: '/api/search' } }}>
                <PublicScroll>{children}</PublicScroll>
            </RootProvider>
        </ClientThemeProvider>
    )
}
