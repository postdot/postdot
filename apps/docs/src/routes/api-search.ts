import { createFileRoute } from '@tanstack/react-router'
import { createFromSource } from 'fumadocs-core/search/server'

import { source } from '@/lib/source'

/**
 * Prerendered to `/api/search`. The index is exported at build time and read
 * by the browser, so the search never calls a server.
 */
export const Route = createFileRoute('/api-search')({
    server: {
        handlers: {
            GET: async () => {
                const index = await createFromSource(source, { language: 'english' }).export()
                return new Response(JSON.stringify(index), {
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                })
            },
        },
    },
})
