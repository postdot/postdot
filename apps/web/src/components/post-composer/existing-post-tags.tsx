import { useState } from 'react'

import { PublicationTagPicker } from '@/components/publication-tag-picker'
import { api, formatApiError } from '@/lib/api'
import { useProjectTagActions, useProjectTagCatalog } from '@/lib/project-tags'
import * as m from '@/paraglide/messages.js'

import { changeSharedPublicationTags, sharedPublicationTags } from './composition-tags'
import type { useExistingPostComposition } from './use-existing-post-composition'

export function ExistingPostTags({
    session,
    blocked,
    projectId,
    getAccessEpoch,
}: {
    readonly session: ReturnType<typeof useExistingPostComposition>
    readonly blocked: boolean
    readonly projectId: string
    readonly getAccessEpoch: () => number
}) {
    const catalog = useProjectTagCatalog(projectId)
    const { onCreateProjectTag } = useProjectTagActions(projectId)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { data, composition } = session
    const editableIds = new Set(
        composition.publicationTargets.filter(target => !target.locked).map(target => target.id)
    )
    const publications = data.publications.filter(publication => editableIds.has(publication.id))
    const shared = sharedPublicationTags(publications.map(publication => publication.tagIds))
    const differs = publications.some(publication => publication.tagIds.length !== shared.length)
    const active = data.publications.find(
        publication => publication.id === composition.activeContentScopeId
    )
    const selected = active?.tagIds ?? shared
    async function change(next: string[]) {
        if (blocked || pending || (active && !editableIds.has(active.id))) return
        const epoch = getAccessEpoch()
        setPending(true)
        setError(null)
        try {
            for (const publication of active ? [active] : publications) {
                if (epoch !== getAccessEpoch()) return
                try {
                    const ids = active
                        ? next
                        : changeSharedPublicationTags(publication.tagIds, shared, next)
                    const { tags } = await api.replacePublicationTags(
                        projectId,
                        publication.id,
                        ids
                    )
                    if (epoch !== getAccessEpoch()) return
                    session.setData(current => ({
                        ...current,
                        publications: current.publications.map(item =>
                            item.id === publication.id
                                ? { ...item, tagIds: tags.map(tag => tag.id) }
                                : item
                        ),
                    }))
                } catch (caught) {
                    if (epoch !== getAccessEpoch()) return
                    setError(`${publication.channelName}: ${formatApiError(caught)}`)
                }
            }
        } finally {
            setPending(false)
        }
    }
    return (
        <div data-publication-tags>
            <PublicationTagPicker
                tags={catalog.data?.tags ?? []}
                selectedTagIds={[...selected]}
                onChange={next => void change(next)}
                onCreateTag={blocked ? undefined : onCreateProjectTag}
                disabled={
                    blocked || pending || (active !== undefined && !editableIds.has(active.id))
                }
                label={m.taxonomy_internal_tags()}
                ariaLabel={m.taxonomy_select_tags()}
                emptyLabel={m.taxonomy_no_tags()}
                archivedLabel={m.common_archived()}
                selectedLabel={count => m.taxonomy_selected_tags({ count })}
                showSelectedTags
                manageTagsProjectId={projectId}
            />
            {!active && differs ? (
                <p className="mt-2 text-xs text-muted-foreground">
                    {m.post_composer_different_tags()}
                </p>
            ) : null}
            {error ? (
                <p role="alert" className="mt-2 text-sm text-state-failed">
                    {error}
                </p>
            ) : null}
        </div>
    )
}
