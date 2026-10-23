import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Analytics } from '@/components/analytics'
import { CookieConsent } from '@/components/cookie-consent'
import { Providers, PublicThemeScript } from '@/components/providers'
import { PublicError } from '@/components/public-error'
import { siteDescription } from '@/lib/social-metadata'

import appCss from '@/styles/globals.css?url'

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: 'utf-8' },
            { name: 'viewport', content: 'width=device-width, initial-scale=1' },
            { name: 'description', content: siteDescription },
        ],
        links: [
            { rel: 'stylesheet', href: appCss },
            { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
        ],
    }),
    shellComponent: RootDocument,
    notFoundComponent: () => <PublicError notFound />,
    errorComponent: ({ reset }) => <PublicError retry={reset} />,
})

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <HeadContent />
                <PublicThemeScript />
            </head>
            <body>
                <Providers>{children}</Providers>
                <Analytics />
                <CookieConsent />
                <Scripts />
            </body>
        </html>
    )
}
