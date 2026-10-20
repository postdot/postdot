import type { ProjectTag } from '@postbot/client'
import { useQuery, type QueryClient } from '@tanstack/react-query'

import { api, ApiError, formatApiError } from '@/lib/api'
import { projectQueryKeys } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'

export interface ProjectTagCatalog {
    readonly tags: ProjectTag[]
}

/**
 * Shared include-archived catalog. It stays under the project data key so the
 * existing project_tag realtime refresh also refreshes tag names and states.
 */
export function useProjectTagCatalog(projectId: string, initialTags?: readonly ProjectTag[]) {
    return useQuery({
        queryKey: projectQueryKeys.projectTagsCatalog(projectId),
        queryFn: () => api.listProjectTags(projectId, { includeArchived: true }),
        refetchOnMount: 'always',
        ...(initialTags === undefined ? {} : { initialData: { tags: [...initialTags] } }),
    })
}

export function updateProjectTagCatalog(
    queryClient: QueryClient,
    projectId: string,
    tag: ProjectTag
): void {
    queryClient.setQueryData<ProjectTagCatalog>(
        projectQueryKeys.projectTagsCatalog(projectId),
        current => (current === undefined ? current : { tags: upsertProjectTag(current.tags, tag) })
    )
}

export function sortProjectTags(tags: readonly ProjectTag[]): ProjectTag[] {
    return [...tags].sort((first, second) => {
        if (first.normalizedName < second.normalizedName) return -1
        if (first.normalizedName > second.normalizedName) return 1
        if (first.id < second.id) return -1
        if (first.id > second.id) return 1
        return 0
    })
}

export function upsertProjectTag(tags: readonly ProjectTag[], tag: ProjectTag): ProjectTag[] {
    const nextTags = tags.filter(candidate => candidate.id !== tag.id)
    nextTags.push(tag)
    return sortProjectTags(nextTags)
}

export function removeProjectTag(tags: readonly ProjectTag[], tagId: string): ProjectTag[] {
    return tags.filter(tag => tag.id !== tagId)
}

export function synchronizeProjectTag(tags: readonly ProjectTag[], tag: ProjectTag): ProjectTag[] {
    return tag.state === 'active' ? upsertProjectTag(tags, tag) : removeProjectTag(tags, tag.id)
}

export function mergeProjectTags(
    catalog: readonly ProjectTag[],
    retained: readonly ProjectTag[]
): ProjectTag[] {
    const byId = new Map(catalog.map(tag => [tag.id, tag]))
    for (const tag of retained) {
        if (!byId.has(tag.id)) byId.set(tag.id, tag)
    }
    return sortProjectTags([...byId.values()])
}

export function formatProjectTagMutationError(error: unknown): string {
    if (!(error instanceof ApiError)) return m.project_tags_error_network()
    if (error.code === 'write_conflict') return m.project_tags_error_duplicate()
    if (error.code === 'forbidden') return m.api_forbidden()
    return formatApiError(error)
}
