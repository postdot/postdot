import { Outlet, createFileRoute } from '@tanstack/react-router'
import { DocsLayout } from 'fumadocs-ui/layouts/notebook'

import { PostbotLogo } from '@/components/brand'
import { PublicThemeToggle } from '@/components/public-theme-toggle'
import { source } from '@/lib/source'

export const Route = createFileRoute('/docs')({ component: DocsRoot })

function DocsRoot() {
    return (
        <DocsLayout
            tree={source.pageTree}
            tabMode="navbar"
            slots={{ themeSwitch: PublicThemeToggle }}
            nav={{
                mode: 'top',
                title: (
                    <span className="brand">
                        <PostbotLogo className="brand-mark" />
                        Postdot
                    </span>
                ),
            }}
            links={[{ text: 'Home', url: '/' }]}>
            <Outlet />
        </DocsLayout>
    )
}
