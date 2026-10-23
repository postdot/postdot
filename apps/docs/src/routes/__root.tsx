import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Providers, PublicThemeScript } from '@/components/providers'
import { PublicError } from '@/components/public-error'
import { siteDescription, siteUrl } from '@/lib/social-metadata'
import { umamiEnabled, umamiId, umamiUrl } from '@/lib/umami'

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
                {umamiEnabled ? (
                    <>
                        <script
                            defer
                            src="/p.js"
                            data-website-id={umamiId}
                            data-host-url={umamiUrl}
                            data-domains={new URL(siteUrl).hostname}
                            data-do-not-track="true"
                            data-performance="true"
                        />
                        <script
                            defer
                            src="/r.js"
                            data-website-id={umamiId}
                            data-host-url={umamiUrl}
                            data-domains={new URL(siteUrl).hostname}
                            data-do-not-track="true"
                            data-sample-rate="0.15"
                            data-mask-level="moderate"
                            data-max-duration="300000"
                        />
                    </>
                ) : null}
                <Scripts />
            </body>
        </html>
    )
}
