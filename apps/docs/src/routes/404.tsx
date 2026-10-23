import { createFileRoute } from '@tanstack/react-router'

import { PublicError } from '@/components/public-error'
import { materialLinks } from '@/lib/material'

/** Prerendered to `404.html`, which the asset storage serves for unknown paths. */
export const Route = createFileRoute('/404')({
    head: () => ({ links: materialLinks }),
    component: () => <PublicError notFound />,
})
