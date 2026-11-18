import { useQueries } from '@tanstack/react-query'

import { api, type MediaReference } from '@/lib/api'
import { projectQueryKeys } from '@/lib/project-query-keys'

/**
 * Loads the media items a comparison shows, by asset id. Items that cannot be read (deleted,
 * no access) are left out, and the comparison names them as unavailable.
 */
export function useMediaReferences(
    projectId: string,
    assetIds: readonly string[],
    enabled = true
): MediaReference[] {
    const ids = [...new Set(assetIds)]
    const queries = useQueries({
        queries: ids.map(assetId => ({
            queryKey: [...projectQueryKeys.data(projectId), 'comparison-media', assetId],
            queryFn: ({ signal }: { signal: AbortSignal }) =>
                api.getMedia(projectId, assetId, { signal }),
            enabled,
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
        })),
    })
    return queries.flatMap(query => (query.data ? [query.data] : []))
}
