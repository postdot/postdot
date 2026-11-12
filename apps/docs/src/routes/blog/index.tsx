import { createFileRoute } from '@tanstack/react-router'

import { EditorialIndex } from '@/components/editorial-page'
import { editorialImage, getEditorialSection, sortedArticles } from '@/lib/editorial'
import { seo } from '@/lib/social-metadata'

export const Route = createFileRoute('/blog/')({
    head: () => {
        const head = seo({
            title: getEditorialSection('blog').title,
            description: getEditorialSection('blog').description,
            image: editorialImage('/blog'),
            path: '/blog',
        })
        return {
            ...head,
            links: [
                ...head.links,
                {
                    rel: 'alternate',
                    type: 'application/rss+xml',
                    title: 'Postdot blog',
                    href: '/blog/rss.xml',
                },
            ],
        }
    },
    component: () => <EditorialIndex section="blog" pages={sortedArticles()} />,
})
