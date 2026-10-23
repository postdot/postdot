import { createFileRoute } from '@tanstack/react-router'

import { getLLMIndex } from '@/lib/llms'

/** Prerendered to `/llms.txt`. */
export const Route = createFileRoute('/llms-txt')({
    server: {
        handlers: {
            GET: () =>
                new Response(getLLMIndex(), {
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                }),
        },
    },
})
