import type { QueryClient } from '@tanstack/react-query'

import { projectQueryKeys } from './project-query-keys'

export function projectEventRefreshScope(
    type: string
): 'channels' | 'publications' | 'tags' | 'project' {
    if (type.startsWith('channel.') || type.startsWith('publisher.')) return 'channels'
    if (type.startsWith('project_tag.')) return 'tags'
    if (type.startsWith('post.') || type.startsWith('publication')) return 'publications'
    return 'project'
}

export function projectRefreshKeys(projectId: string, scope: string) {
    const publications = [
        projectQueryKeys.publications(projectId),
        projectQueryKeys.duePublications(projectId),
        projectQueryKeys.publicationQueues(projectId),
        projectQueryKeys.calendarPublications(projectId),
        projectQueryKeys.publicationApprovals(projectId),
        projectQueryKeys.publicationDestinations(projectId),
        [...projectQueryKeys.data(projectId), 'post'],
    ]
    if (scope === 'publications') return publications
    if (scope === 'channels')
        return [
            projectQueryKeys.channels(projectId),
            projectQueryKeys.connections(projectId),
            ...publications,
        ]
    if (scope === 'tags') return [projectQueryKeys.projectTagsCatalog(projectId), ...publications]
    return [
        projectQueryKeys.data(projectId),
        projectQueryKeys.publicationQueues(projectId),
        projectQueryKeys.calendarPublications(projectId),
        projectQueryKeys.publicationApprovals(projectId),
        projectQueryKeys.publicationDestinations(projectId),
    ]
}

/** Keep inactive features stale until visited; never refetch another project's resources. */
async function refreshResources(queryClient: QueryClient, projectId: string, scope: string) {
    await Promise.all(
        projectRefreshKeys(projectId, scope).map(queryKey =>
            queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
        )
    )
}
export function refreshPublicationResources(queryClient: QueryClient, projectId: string) {
    return refreshResources(queryClient, projectId, 'publications')
}
export function refreshChannelResources(queryClient: QueryClient, projectId: string) {
    return refreshResources(queryClient, projectId, 'channels')
}
