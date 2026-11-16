import type { Post, PublicationEditorState } from '@/lib/api'
import {
    applyPostToChannel,
    channelVersionFollowsSource,
    postFromChannelVersion,
} from '@/lib/channel-version-follow'
import { toDateTimeLocal } from '@/lib/date-time'
import { canEditPublication } from '@/lib/publication-lifecycle'
import { getTargetPreviewBody } from '@/lib/publication-preview'

import {
    initialPostComposition,
    postSharedScopeId,
    type PostCompositionState,
} from './use-post-composition'

export function isCompositionChannelLocked(editor: PublicationEditorState, readOnly = false) {
    return (
        readOnly ||
        editor.channel.state !== 'active' ||
        !canEditPublication(editor.publication.state) ||
        (editor.threadMessages?.some(message =>
            ['confirmed', 'sending', 'ambiguous'].includes(message.state)
        ) ??
            false)
    )
}

/** Publication IDs identify tabs, including repeated destinations on the same channel. */
export function compositionFromPost(
    post: Post,
    editors: readonly PublicationEditorState[],
    timeZone: string,
    options: { readonly activePublicationId?: string; readonly readOnly?: boolean } = {}
): PostCompositionState {
    const activeId = editors.some(editor => editor.publication.id === options.activePublicationId)
        ? options.activePublicationId!
        : postSharedScopeId
    return initialPostComposition({
        postTitle: post.sourceContent.headline ?? '',
        sourceFormat: post.sourceContent.body?.format ?? 'plain_text',
        sourceLanguage: post.sourceContent.language ?? '',
        postContent: post.sourceContent.body?.text ?? '',
        sourceMedia: [...post.sourceContent.media],
        activeContentScopeId: activeId,
        activePublicationTabId: activeId,
        customizedTargetIds: new Set(editors.map(editor => editor.publication.id)),
        publicationTargets: editors.map(editor => {
            const locked = isCompositionChannelLocked(editor, options.readOnly)
            const content = locked
                ? (editor.selectedTarget?.content ?? editor.draft.content)
                : editor.draft.content
            const profile = locked
                ? (editor.selectedTargetProfile ?? editor.profile).profile
                : editor.profile.profile
            return {
                id: editor.publication.id,
                channelId: editor.channel.id,
                content: getTargetPreviewBody(profile, content),
                contentDocument: content,
                customized: !channelVersionFollowsSource(profile, post.sourceContent, content),
                locked,
                deliveryMode: editor.publication.deliveryMode,
                scheduledAt: toDateTimeLocal(editor.publication.scheduledAt, timeZone),
            }
        }),
    })
}

export function compositionSource(
    state: PostCompositionState,
    base: Post['sourceContent']
): Post['sourceContent'] {
    const { body: _body, headline: _headline, language: _language, ...rest } = base
    return {
        ...rest,
        ...(state.postContent === ''
            ? {}
            : {
                  body: {
                      format: state.sourceFormat ?? base.body?.format ?? 'plain_text',
                      text: state.postContent,
                  },
              }),
        ...(state.postTitle === '' ? {} : { headline: state.postTitle }),
        ...((state.sourceLanguage ?? base.language)
            ? { language: state.sourceLanguage ?? base.language }
            : {}),
        media: state.sourceMedia,
    }
}

/** Project following channels together, preserving channel-only fields and custom media. */
export function compositionChannelContent(
    state: PostCompositionState,
    editor: PublicationEditorState
) {
    const target = state.publicationTargets.find(target => target.id === editor.publication.id)
    if (!target) return editor.draft.content
    const document = target.contentDocument ?? editor.draft.content
    if (target.locked) return document
    const source = compositionSource(state, editor.post.sourceContent)
    if (!target.customized)
        return applyPostToChannel(editor.profile.profile, source, document) ?? document
    const ownSource = postFromChannelVersion(editor.profile.profile, document, source)
    const { body: _body, ...rest } = ownSource
    return (
        applyPostToChannel(
            editor.profile.profile,
            {
                ...rest,
                ...(target.content === ''
                    ? {}
                    : {
                          body: {
                              format: ownSource.body?.format ?? 'plain_text',
                              text: target.content,
                          },
                      }),
            },
            document
        ) ?? document
    )
}

export function channelHasPendingChanges(editor: PublicationEditorState) {
    return (
        editor.selectedTarget === null ||
        editor.draft.profileVersionId !== editor.selectedTarget.profileVersionId ||
        JSON.stringify(editor.draft.content) !== JSON.stringify(editor.selectedTarget.content)
    )
}
