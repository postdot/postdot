import { createFileRoute } from '@tanstack/react-router'

import { UsageStudy } from '@/components/usage-study'
import { seo, siteDescription } from '@/lib/social-metadata'

export const Route = createFileRoute('/usage-study')({
    head: () => {
        const head = seo({
            title: 'Usage study',
            description: siteDescription,
            image: '/og/home.png',
            path: '/usage-study',
        })
        // A design prototype, not public content.
        return { ...head, meta: [...head.meta, { name: 'robots', content: 'noindex' }] }
    },
    component: UsageStudy,
})
