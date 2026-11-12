import { createFileRoute } from '@tanstack/react-router'

import { EditorialArticle } from '@/components/editorial-page'
import { blogSource } from '@/lib/editorial'

export const Route = createFileRoute('/blog/$slug')({
    loader: async ({ params }) =>
        (await import('@/lib/editorial-route')).loadEditorialPage('blog', params.slug),
    head: ({ loaderData }) => loaderData?.head ?? {},
    component: Page,
})

function Page() {
    const { slug } = Route.useLoaderData()
    const page = blogSource.getPage([slug])
    return page ? <EditorialArticle page={page} section="blog" /> : null
}
