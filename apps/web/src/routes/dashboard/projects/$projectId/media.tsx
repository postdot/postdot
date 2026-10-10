import { createFileRoute } from '@tanstack/react-router'

import { MediaLibraryPage } from '@/components/media-library-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/media')({
    validateSearch: (search: Record<string, unknown>): { assetId?: string } => ({
        assetId: typeof search.assetId === 'string' ? search.assetId : undefined,
    }),
    component: MediaLibraryPage,
})
