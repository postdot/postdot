import { createFileRoute } from '@tanstack/react-router'

import { DocsPageView } from '@/components/docs-page'
import { source } from '@/lib/source'

export const Route = createFileRoute('/docs/')({
    loader: async () => (await import('@/lib/docs-route')).loadDocsPage([]),
    head: ({ loaderData }) => loaderData?.head ?? {},
    component: DocsIndex,
})

function DocsIndex() {
    const { slugs, preloaded } = Route.useLoaderData()
    const page = source.getPage(slugs)
    return page ? <DocsPageView page={page} preloaded={preloaded} /> : null
}
