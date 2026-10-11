'use client'

import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

export function Providers({ children }: { children: ReactNode }) {
    return (
        <RootProvider theme={{ defaultTheme: 'dark' }} search={{ options: { type: 'static' } }}>
            {children}
        </RootProvider>
    )
}
