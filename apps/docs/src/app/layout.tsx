import { ThemeProvider } from '@wrksz/themes/next'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
    title: { default: 'Postbot', template: '%s | Postbot' },
    description:
        'Prepare, adapt and schedule social posts in your own workspace. Self-hosted publishing for people, agents and scripts.',
    robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="light"
                    storage="localStorage"
                    storageKey="theme"
                    enableSystem
                    disableTransitionOnChange="background-color 0s, color 0s">
                    <Providers>{children}</Providers>
                </ThemeProvider>
            </body>
        </html>
    )
}
