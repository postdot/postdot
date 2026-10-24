import { createFileRoute } from '@tanstack/react-router'

import { DocsPageView } from '@/components/docs-page'
import { source } from '@/lib/source'

export const Route = createFileRoute('/docs/$')({
    loader: async ({ params }) =>
        (await import('@/lib/docs-route')).loadDocsPage(
            params._splat?.split('/').filter(Boolean) ?? []
        ),
    head: ({ loaderData }) => loaderData?.head ?? {},
    component: DocsSplat,
})

function DocsSplat() {
    const { slugs, preloaded } = Route.useLoaderData()
    const page = source.getPage(slugs)
    return page ? <DocsPageView page={page} preloaded={preloaded} /> : null
}
