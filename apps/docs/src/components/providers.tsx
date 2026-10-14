'use client'

import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

import { PublicScroll } from './public-scroll'

export function Providers({ children }: { children: ReactNode }) {
    return (
        <RootProvider theme={{ defaultTheme: 'light' }} search={{ options: { type: 'static' } }}>
            <PublicScroll>{children}</PublicScroll>
        </RootProvider>
    )
}
