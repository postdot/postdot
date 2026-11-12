import { createFileRoute } from '@tanstack/react-router'

import { EditorialArticle } from '@/components/editorial-page'
import { featureSource } from '@/lib/editorial'

export const Route = createFileRoute('/features/$slug')({
    loader: async ({ params }) =>
        (await import('@/lib/editorial-route')).loadEditorialPage('features', params.slug),
    head: ({ loaderData }) => loaderData?.head ?? {},
    component: Page,
})

function Page() {
    const { slug } = Route.useLoaderData()
    const page = featureSource.getPage([slug])
    return page ? <EditorialArticle page={page} section="features" /> : null
}
