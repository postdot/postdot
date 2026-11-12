import { createFileRoute } from '@tanstack/react-router'

import { PublicHome } from '@/components/public-home'
import { withMaterial } from '@/lib/material'
import { seo } from '@/lib/social-metadata'

export const Route = createFileRoute('/')({
    head: () =>
        withMaterial(
            seo({
                title: 'Postdot: self-hosted social media scheduler',
                description:
                    'Write, adapt and schedule posts per channel in one open-source, self-hosted app. One Docker image, SQLite or PostgreSQL, and a CLI, API and MCP for agents.',
                image: '/og/home.png',
                path: '/',
            })
        ),
    component: PublicHome,
})
