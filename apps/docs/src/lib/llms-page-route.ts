import { notFound } from '@tanstack/react-router'

import { docsLlms } from './llms'
import { source } from './source'

/** Markdown of one page. Prerendered by `vite.config.ts` to `/llms.mdx/docs/<slug>/content.md`. */
export async function respondWithPageMarkdown(slugs: string[]) {
    const page = source.getPage(slugs)
    if (!page) throw notFound()
    return new Response(await docsLlms.page(page), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
}
