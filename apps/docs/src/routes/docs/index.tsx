import { createFileRoute } from '@tanstack/react-router'

import { DocsPageView } from '@/components/docs-page'
import { docsHead, loadDocsPage } from '@/lib/docs-route'
import { source } from '@/lib/source'

export const Route = createFileRoute('/docs/')({
    loader: () => loadDocsPage([]),
    head: ({ loaderData }) => docsHead(loaderData?.slugs),
    component: DocsIndex,
})

function DocsIndex() {
    const { slugs, preloaded } = Route.useLoaderData()
    const page = source.getPage(slugs)
    return page ? <DocsPageView page={page} preloaded={preloaded} /> : null
}
