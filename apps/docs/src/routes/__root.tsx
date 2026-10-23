import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

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
            // The site is not published yet; see the AGENT.md of this workspace.
            { name: 'robots', content: 'noindex, nofollow' },
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
                <Scripts />
            </body>
        </html>
    )
}
