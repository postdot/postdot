import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import type { ReactNode } from 'react'

import { HeraldLogo } from '@/components/brand'
import { source } from '@/lib/source'

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <DocsLayout
            tree={source.pageTree}
            nav={{
                title: (
                    <span className="brand">
                        <HeraldLogo className="brand-mark" />
                        Herald
                    </span>
                ),
            }}
            links={[{ text: 'Home', url: '/' }]}>
            {children}
        </DocsLayout>
    )
}
