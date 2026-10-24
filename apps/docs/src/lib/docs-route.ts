import { notFound } from '@tanstack/react-router'

import { getPageMarkdownUrl } from './markdown'
import { preloadOpenAPIPage } from './openapi-preload'
import { getOGImageUrl, seo } from './social-metadata'
import { source } from './source'

/**
 * Resolves a page from the slugs of the URL, preloads everything it renders and
 * builds its head. Routes import this module on demand, so the page tree and
 * frontmatter stay out of the bundle that every page loads.
 */
export async function loadDocsPage(slugs: string[]) {
    const page = source.getPage(slugs)
    if (!page) throw notFound()
    await page.data.preload()
    const hasOperations = Boolean(page.data._openapi?.preload)
    const preloaded = hasOperations ? await preloadOpenAPIPage({ data: slugs }) : undefined
    const head = seo({
        title: page.data.title,
        description: page.data.description ?? '',
        image: getOGImageUrl(page.slugs),
        path: page.url,
    })
    return {
        slugs,
        preloaded,
        head: {
            ...head,
            links: [
                ...head.links,
                { rel: 'alternate', type: 'text/markdown', href: getPageMarkdownUrl(page) },
            ],
        },
    }
}
