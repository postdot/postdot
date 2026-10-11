import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@fontsource-variable/recursive'

import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
    title: { default: 'Herald', template: '%s | Herald' },
    description: 'One source, publications for every destination. Self-hosted with Herald.',
    robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    )
}
