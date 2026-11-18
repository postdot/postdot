import type { PublicationEditorState } from '@/lib/api'
import { channelVersionFollowsSource, postFromChannelVersion } from '@/lib/channel-version-follow'
import { toDateTimeLocal } from '@/lib/date-time'
import { getTargetPreviewBody } from '@/lib/publication-preview'

import { channelHasPendingChanges, compositionSource } from './existing-post-composition'
import { type PostCompositionState } from './use-post-composition'

export interface ChannelApplyResult {
    readonly state: 'applied' | 'failed' | 'unconfirmed'
    readonly message?: string
}

/** Never repeat a successful application when another channel needs a retry. */
export async function applyCompositionChannels(input: {
    readonly editors: readonly PublicationEditorState[]
    readonly state: PostCompositionState
    readonly timeZone: string
    readonly canContinue: () => boolean
    readonly apply: (
        editor: PublicationEditorState,
        scheduledAt: string
    ) => Promise<PublicationEditorState>
    readonly onApplied: (editor: PublicationEditorState) => void
    readonly onFailure: (editor: PublicationEditorState, error: unknown) => void
}) {
    for (const editor of input.editors) {
        if (!input.canContinue()) return
        const target = input.state.publicationTargets.find(
            target => target.id === editor.publication.id
        )
        if (
            !target ||
            target.locked ||
            (!channelHasPendingChanges(editor) &&
                target.scheduledAt ===
                    toDateTimeLocal(editor.publication.scheduledAt, input.timeZone))
        )
            continue
        try {
            const next = await input.apply(editor, target.scheduledAt)
            if (!input.canContinue()) return
            input.onApplied(next)
        } catch (error) {
            if (!input.canContinue()) return
            input.onFailure(editor, error)
        }
    }
}

export function discardCompositionChanges(
    state: PostCompositionState,
    editors: readonly PublicationEditorState[],
    timeZone: string
): PostCompositionState {
    let source = compositionSource(state, editors[0]?.post.sourceContent ?? { media: [] })
    const following = editors.find(editor => {
        const target = state.publicationTargets.find(target => target.id === editor.publication.id)
        return (
            target &&
            !target.locked &&
            !target.customized &&
            editor.selectedTarget?.profileVersionId === editor.draft.profileVersionId
        )
    })
    if (following?.selectedTarget)
        source = postFromChannelVersion(
            following.profile.profile,
            following.selectedTarget.content,
            source
        )
    return {
        ...state,
        postContent: source.body?.text ?? '',
        postTitle: source.headline ?? '',
        sourceMedia: [...source.media],
        sourceLanguage: source.language ?? '',
        sourceFormat: source.body?.format ?? 'plain_text',
        publicationTargets: state.publicationTargets.map(target => {
            const editor = editors.find(editor => editor.publication.id === target.id)
            if (
                target.locked ||
                !editor?.selectedTarget ||
                editor.selectedTarget.profileVersionId !== editor.draft.profileVersionId
            )
                return target
            const content = editor.selectedTarget.content
            return {
                ...target,
                contentDocument: content,
                content: getTargetPreviewBody(editor.profile.profile, content),
                customized: !channelVersionFollowsSource(editor.profile.profile, source, content),
                scheduledAt: toDateTimeLocal(editor.publication.scheduledAt, timeZone),
            }
        }),
    }
}
