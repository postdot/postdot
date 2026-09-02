import { createFileRoute } from '@tanstack/react-router'

import { MediaLibraryPage } from '@/components/media-library-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/media')({
    component: MediaLibraryPage,
})
