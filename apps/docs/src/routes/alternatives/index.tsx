import { createFileRoute } from '@tanstack/react-router'

import { AlternativesIndex } from '@/components/alternatives-index'
import { seo } from '@/lib/social-metadata'

export const Route = createFileRoute('/alternatives/')({
    head: () =>
        seo({
            title: 'Social media publishing alternatives',
            description:
                'Compare Postdot with Postiz, Mixpost and PostFast on projects, shared channels, teams, languages, automation, platforms and ownership.',
            image: '/og/alternatives/image.png',
            path: '/alternatives',
        }),
    component: AlternativesIndex,
})
