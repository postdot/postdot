import { ThemeProvider } from '@wrksz/themes/next'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'
import { Providers } from '@/components/providers'
import { getSocialMetadata } from '@/lib/social-metadata'

export const metadata: Metadata = {
    metadataBase: new URL(process.env.POSTBOT_SITE_URL ?? 'http://127.0.0.1:5174'),
    ...getSocialMetadata('Postdot', 'Social publishing. For you and your agents.', '/og/home.png'),
    title: { default: 'Postdot', template: '%s | Postdot' },
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
