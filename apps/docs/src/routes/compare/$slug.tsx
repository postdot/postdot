import { createFileRoute } from '@tanstack/react-router'

import { EditorialArticle } from '@/components/editorial-page'
import { comparisonSource } from '@/lib/editorial'

export const Route = createFileRoute('/compare/$slug')({
    loader: async ({ params }) =>
        (await import('@/lib/editorial-route')).loadEditorialPage('compare', params.slug),
    head: ({ loaderData }) => loaderData?.head ?? {},
    component: Page,
})

function Page() {
    const { slug } = Route.useLoaderData()
    const page = comparisonSource.getPage([slug])
    return page ? <EditorialArticle page={page} section="compare" /> : null
}
