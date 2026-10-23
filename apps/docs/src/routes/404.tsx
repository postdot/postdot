import { createFileRoute } from '@tanstack/react-router'

import { PublicError } from '@/components/public-error'

/** Prerendered to `404.html`, which the asset storage serves for unknown paths. */
export const Route = createFileRoute('/404')({
    component: () => <PublicError notFound />,
})
