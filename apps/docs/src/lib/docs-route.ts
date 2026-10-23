import { notFound } from '@tanstack/react-router'

import { getPageMarkdownUrl } from './markdown'
import { preloadOpenAPIPage } from './openapi-preload'
import { getOGImageUrl, seo } from './social-metadata'
import { source } from './source'

/** Resolves a page from the slugs of the URL and preloads everything it renders. */
export async function loadDocsPage(slugs: string[]) {
    const page = source.getPage(slugs)
    if (!page) throw notFound()
    await page.data.preload()
    const hasOperations = Boolean(page.data._openapi?.preload)
    const preloaded = hasOperations ? await preloadOpenAPIPage({ data: slugs }) : undefined
    return { slugs, preloaded }
}

export function docsHead(slugs: string[] | undefined) {
    const page = slugs ? source.getPage(slugs) : undefined
    if (!page) return {}
    const path = page.url
    return {
        ...seo({
            title: page.data.title,
            description: page.data.description ?? '',
            image: getOGImageUrl(page.slugs),
            path,
        }),
        links: [{ rel: 'alternate', type: 'text/markdown', href: getPageMarkdownUrl(page) }],
    }
}
