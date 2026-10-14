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
                <Providers>{children}</Providers>
            </body>
        </html>
    )
}
