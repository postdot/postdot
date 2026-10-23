import { createFileRoute } from '@tanstack/react-router'

import { docsLlms } from '@/lib/llms'

/** Prerendered to `/llms-full.txt`. */
export const Route = createFileRoute('/llms-full-txt')({
    server: {
        handlers: {
            GET: async () =>
                new Response(await docsLlms.full(), {
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                }),
        },
    },
})
