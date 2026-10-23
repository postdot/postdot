import { createFileRoute } from '@tanstack/react-router'

import { DocsPageView } from '@/components/docs-page'
import { docsHead, loadDocsPage } from '@/lib/docs-route'
import { source } from '@/lib/source'

export const Route = createFileRoute('/docs/$')({
    loader: ({ params }) => loadDocsPage(params._splat?.split('/').filter(Boolean) ?? []),
    head: ({ loaderData }) => docsHead(loaderData?.slugs),
    component: DocsSplat,
})

function DocsSplat() {
    const { slugs, preloaded } = Route.useLoaderData()
    const page = source.getPage(slugs)
    return page ? <DocsPageView page={page} preloaded={preloaded} /> : null
}
