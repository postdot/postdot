import { createFileRoute } from '@tanstack/react-router'

import { EditorialIndex } from '@/components/editorial-page'
import { editorialImage, getEditorialSection, featureSource } from '@/lib/editorial'
import { seo } from '@/lib/social-metadata'

export const Route = createFileRoute('/features/')({
    head: () =>
        seo({
            title: getEditorialSection('features').title,
            description: getEditorialSection('features').description,
            image: editorialImage('/features'),
            path: '/features',
        }),
    component: () => <EditorialIndex section="features" pages={featureSource.getPages()} />,
})
