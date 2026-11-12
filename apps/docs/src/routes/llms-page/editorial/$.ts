import { createFileRoute } from '@tanstack/react-router'

import { editorialSections } from '@/lib/editorial'
import { getEditorialText } from '@/lib/llms'

export const Route = createFileRoute('/llms-page/editorial/$')({
    server: {
        handlers: {
            GET: async ({ params }) => {
                const [section, ...slugs] = params._splat?.split('/').filter(Boolean) ?? []
                const page = editorialSections
                    .find(item => item.key === section)
                    ?.source.getPage(slugs)
                if (!page) return new Response('Not found', { status: 404 })
                return new Response(await getEditorialText(page), {
                    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
                })
            },
        },
    },
})
