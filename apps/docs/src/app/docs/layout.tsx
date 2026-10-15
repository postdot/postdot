import { DocsLayout } from 'fumadocs-ui/layouts/notebook'
import type { ReactNode } from 'react'

import { PostbotLogo } from '@/components/brand'
import { PublicThemeToggle } from '@/components/public-theme-toggle'
import { source } from '@/lib/source'

export default function Layout({ children }: { children: ReactNode }) {
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
                        Postbot
                    </span>
                ),
            }}
            links={[{ text: 'Home', url: '/' }]}>
            {children}
        </DocsLayout>
    )
}
