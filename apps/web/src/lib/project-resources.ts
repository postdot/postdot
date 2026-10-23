import { queryOptions, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api, formatApiError } from '@/lib/api'
import { projectQueryKeys } from '@/lib/project-realtime'
import { useActionError } from '@/lib/use-action-error'

export const projectResourceQueries = {
    channels: (projectId: string) =>
        queryOptions({
            queryKey: projectQueryKeys.channels(projectId),
            queryFn: () => api.listChannels(projectId),
        }),
    connections: (projectId: string) =>
        queryOptions({
            queryKey: projectQueryKeys.connections(projectId),
            queryFn: () => api.listPublisherConnections(projectId),
        }),
    membership: (projectId: string) =>
        queryOptions({
            queryKey: projectQueryKeys.membership(projectId),
            queryFn: () => api.getProjectMembership(projectId),
        }),
    due: (projectId: string) =>
        queryOptions({
            queryKey: projectQueryKeys.duePublications(projectId),
            queryFn: () => api.listDuePublications(projectId),
        }),
    publications: (projectId: string) =>
        queryOptions({
            queryKey: projectQueryKeys.publications(projectId),
            queryFn: () => api.listPublications(projectId),
        }),
}

/** Each feature observes only the resources it renders; the shared shell does not fetch them. */
export function useProjectPublicationData(projectId: string) {
    const queryClient = useQueryClient()
    const hasCommitted = useRef(false)
    useEffect(() => {
        hasCommitted.current = true
    }, [])
    // A newly opened feature must not present an invalidated empty snapshot as current.
    // Already visible pages keep their last known data during background refresh/refusal.
    const dueOptions = projectResourceQueries.due(projectId)
    const publicationOptions = projectResourceQueries.publications(projectId)
    if (
        !hasCommitted.current &&
        (queryClient.getQueryState(dueOptions.queryKey)?.isInvalidated ||
            queryClient.getQueryState(publicationOptions.queryKey)?.isInvalidated)
    ) {
        throw Promise.all([
            queryClient.fetchQuery(dueOptions),
            queryClient.fetchQuery(publicationOptions),
        ])
    }
    const [{ data: due }, { data: page }] = useSuspenseQueries({
        queries: [
            projectResourceQueries.due(projectId),
            projectResourceQueries.publications(projectId),
        ],
    })
    return {
        due: due.publications,
        publications: page.publications,
        publicationsNextCursor: page.nextCursor,
        publicationSummary: page.summary,
    }
}

export function useProjectPublicationPagination(projectId: string) {
    const queryClient = useQueryClient()
    const [loadingMorePublications, setLoadingMorePublications] = useState(false)
    const [error, setError] = useActionError()
    async function onLoadMorePublications() {
        if (loadingMorePublications) return
        const key = projectQueryKeys.publications(projectId)
        const current = queryClient.getQueryData(
            projectResourceQueries.publications(projectId).queryKey
        )
        if (current?.nextCursor == null) return
        setLoadingMorePublications(true)
        try {
            const response = await api.listPublications(projectId, {
                cursor: current.nextCursor,
                limit: 100,
            })
            queryClient.setQueryData(key, (page: typeof current) => {
                if (page === undefined) return page
                const known = new Set(page.publications.map(item => item.id))
                return {
                    ...page,
                    publications: [
                        ...page.publications,
                        ...response.publications.filter(item => !known.has(item.id)),
                    ],
                    nextCursor: response.nextCursor,
                }
            })
        } catch (caughtError) {
            setError(formatApiError(caughtError))
        } finally {
            setLoadingMorePublications(false)
        }
    }
    return { loadingMorePublications, onLoadMorePublications, error }
}

export { refreshPublicationResources, refreshChannelResources } from './project-query-invalidation'
