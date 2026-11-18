import type { Channel, PublicationEditorState, PublicationSummary } from './api'
import { canEditPublication } from './publication-lifecycle'
import { getTargetPreviewBody, getTargetPreviewTitle } from './publication-preview'
import { getTargetMediaSelections, mediaSelectionsEqual } from './target-media'

type SourceContent = PublicationEditorState['post']['sourceContent']

export function countStaleChannelVersions(
    publications: readonly Pick<
        PublicationSummary,
        'id' | 'channelId' | 'state' | 'draftSourceRevision'
    >[],
    channels: readonly Pick<Channel, 'id' | 'state'>[],
    sourceRevision: number,
    activeEditor?: {
        readonly publication: Pick<PublicationEditorState['publication'], 'id' | 'state'>
        readonly draft: Pick<PublicationEditorState['draft'], 'sourceRevision'>
    }
): number {
    return publications.filter(publication => {
        const active = activeEditor?.publication.id === publication.id ? activeEditor : undefined
        const channel = channels.find(item => item.id === publication.channelId)
        return (
            canEditPublication(publication.state) &&
            (active === undefined || canEditPublication(active.publication.state)) &&
            channel?.state === 'active' &&
            Math.max(active?.draft.sourceRevision ?? 0, publication.draftSourceRevision) <
                sourceRevision
        )
    }).length
}

export function channelVersionContent(editor: PublicationEditorState): SourceContent {
    return {
        body: {
            text: getTargetPreviewBody(editor.profile.profile, editor.draft.content),
            format: 'plain_text',
        },
        headline: getTargetPreviewTitle(editor.profile.profile, editor.draft.content),
        media: getTargetMediaSelections(editor.profile.profile, editor.draft.content),
    }
}

export function sourceContentDifferences(current: SourceContent, post: SourceContent) {
    return {
        text: (current.body?.text ?? '') !== (post.body?.text ?? ''),
        title: (current.headline ?? '') !== (post.headline ?? ''),
        media: !mediaSelectionsEqual(current.media, post.media),
    }
}
