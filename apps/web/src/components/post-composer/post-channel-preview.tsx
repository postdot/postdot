import { useQuery } from '@tanstack/react-query'

import { PublicationDraftPreview } from '@/components/publication-draft-preview'
import { api, type PublicationEditorState } from '@/lib/api'
import { getTargetPreviewBody, getTargetPreviewTitle } from '@/lib/publication-preview'
import { getTargetMediaSelections } from '@/lib/target-media'

export function PostChannelPreview({
    editor,
    content,
    locked,
}: {
    readonly editor: PublicationEditorState
    readonly content: Readonly<Record<string, unknown>>
    readonly locked: boolean
}) {
    const profile = locked
        ? (editor.selectedTargetProfile ?? editor.profile).profile
        : editor.profile.profile
    const selections = getTargetMediaSelections(profile, content)
    const ids = [...new Set(selections.map(selection => selection.assetId))]
    const query = useQuery({
        queryKey: ['post-composer-preview-media', editor.publication.projectId, ids],
        queryFn: async () =>
            (
                await Promise.allSettled(
                    ids.map(id => api.getMedia(editor.publication.projectId, id))
                )
            ).flatMap(result => (result.status === 'fulfilled' ? [result.value] : [])),
        enabled: ids.length > 0,
    })
    return (
        <PublicationDraftPreview
            channel={editor.channel}
            execution={profile.execution}
            target={content}
            poll={content.poll}
            media={query.data ?? []}
            mediaSelections={selections}
            postContent={getTargetPreviewBody(profile, content)}
            postTitle={getTargetPreviewTitle(profile, content)}
        />
    )
}
