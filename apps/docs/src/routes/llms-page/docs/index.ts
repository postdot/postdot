import { createFileRoute } from '@tanstack/react-router'

import { respondWithPageMarkdown } from '@/lib/llms-page-route'

export const Route = createFileRoute('/llms-page/docs/')({
    server: { handlers: { GET: () => respondWithPageMarkdown([]) } },
})
