import { createServerFn } from '@tanstack/react-start'
import { staticFunctionMiddleware } from '@tanstack/start-static-server-functions'

/**
 * Operation fragments of an API reference page. The result is written to a
 * static JSON file while the site is prerendered, and the browser reads that
 * file when it navigates, so no server is involved at runtime.
 */
export const preloadOpenAPIPage = createServerFn({ method: 'GET' })
    .middleware([staticFunctionMiddleware])
    .validator((slugs: string[]) => slugs)
    .handler(async ({ data: slugs }) => {
        const [{ openapi }, { source }] = await Promise.all([
            import('./openapi'),
            import('./source'),
        ])
        const page = source.getPage(slugs)
        return page ? (await openapi.preloadOpenAPIPage(page)).preloaded : undefined
    })
