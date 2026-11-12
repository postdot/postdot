import { createFileRoute } from '@tanstack/react-router'

import { EditorialIndex } from '@/components/editorial-page'
import { editorialImage, getEditorialSection, comparisonSource } from '@/lib/editorial'
import { seo } from '@/lib/social-metadata'

export const Route = createFileRoute('/compare/')({
    head: () =>
        seo({
            title: getEditorialSection('compare').title,
            description: getEditorialSection('compare').description,
            image: editorialImage('/compare'),
            path: '/compare',
        }),
    component: () => <EditorialIndex section="compare" pages={comparisonSource.getPages()} />,
})
