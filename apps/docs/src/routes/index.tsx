import { createFileRoute } from '@tanstack/react-router'

import { PublicHome } from '@/components/public-home'
import { seo } from '@/lib/social-metadata'

export const Route = createFileRoute('/')({
    head: () =>
        seo({
            title: 'Postdot',
            description: 'Social publishing. For you and your agents.',
            image: '/og/home.png',
            path: '/',
        }),
    component: PublicHome,
})
