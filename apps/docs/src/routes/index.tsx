import { createFileRoute } from '@tanstack/react-router'

import { PublicHome } from '@/components/public-home'
import { withMaterial } from '@/lib/material'
import { seo } from '@/lib/social-metadata'

export const Route = createFileRoute('/')({
    head: () =>
        withMaterial(
            seo({
                title: 'Postdot',
                description: 'Social publishing. For you and your agents.',
                image: '/og/home.png',
                path: '/',
            })
        ),
    component: PublicHome,
})
