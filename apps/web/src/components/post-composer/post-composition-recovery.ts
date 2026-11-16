import type { Post, PublicationEditorState } from '@/lib/api'
import { channelVersionFollowsSource } from '@/lib/channel-version-follow'
import { getTargetPreviewBody } from '@/lib/publication-preview'
import { recoveryProfileMatches } from '@/lib/publication-recovery-profile'

import { compositionFromPost } from './existing-post-composition'
import { initialPostComposition, type PostCompositionState } from './use-post-composition'

export interface PostRecovery {
    readonly key: string
    readonly state: PostCompositionState
    readonly publicationId?: string
    readonly profileVersionIds: Readonly<Record<string, string>>
}

type RecoveryStorage = Pick<Storage, 'getItem'>

export function postCompositionRecoveryKey(projectId: string, postId: string, userId: string) {
    return `postdot:post-composition:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(postId)}`
}

export function serializePostRecovery(
    state: PostCompositionState,
    editors: readonly PublicationEditorState[],
    timeZone: string
) {
    return JSON.stringify({
        version: 1,
        timeZone,
        profileVersionIds: Object.fromEntries(
            editors.map(editor => [editor.publication.id, editor.draft.profileVersionId])
        ),
        state: { ...state, customizedTargetIds: [...state.customizedTargetIds] },
    })
}

/** Read both shipped legacy spellings. Never remove a copy merely because it is old. */
export function readPostRecoveries(
    storage: RecoveryStorage,
    key: string,
    post: Post,
    editors: readonly PublicationEditorState[],
    timeZone: string
): PostRecovery[] {
    const results: PostRecovery[] = []
    const current = readJson(storage, key)
    if (
        record(current) &&
        current.version === 1 &&
        current.timeZone === timeZone &&
        record(current.state) &&
        validState(current.state) &&
        record(current.profileVersionIds)
    ) {
        results.push({
            key,
            state: initialPostComposition({
                ...current.state,
                customizedTargetIds: new Set(
                    Array.isArray(current.state.customizedTargetIds)
                        ? current.state.customizedTargetIds.filter(
                              (id): id is string => typeof id === 'string'
                          )
                        : []
                ),
            }),
            profileVersionIds: Object.fromEntries(
                Object.entries(current.profileVersionIds).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string'
                )
            ),
        })
    }
    for (const editor of editors) {
        for (const prefix of [
            'postdot:publication-editor:v3:',
            'postdot:publication-editor-recovery:v3:',
        ]) {
            const legacyKey = `${prefix}${encodeURIComponent(editor.publication.projectId)}:${encodeURIComponent(editor.publication.id)}`
            const legacy = readJson(storage, legacyKey)
            if (
                !record(legacy) ||
                legacy.version !== 3 ||
                legacy.timeZone !== timeZone ||
                !Number.isSafeInteger(legacy.baseRevision) ||
                typeof legacy.targetText !== 'string' ||
                typeof legacy.scheduleValue !== 'string' ||
                !validSource(legacy.sourceContent)
            )
                continue
            let document: unknown
            try {
                document = JSON.parse(legacy.targetText)
            } catch {
                continue
            }
            if (!record(document)) continue
            const source = legacy.sourceContent
            const initial = compositionFromPost(post, editors, timeZone)
            results.push({
                key: legacyKey,
                publicationId: editor.publication.id,
                profileVersionIds: {
                    [editor.publication.id]:
                        typeof legacy.profileVersionId === 'string'
                            ? legacy.profileVersionId
                            : recoveryProfileMatches({}, editor)
                              ? editor.draft.profileVersionId
                              : '',
                },
                state: {
                    ...initial,
                    postTitle: source.headline ?? '',
                    postContent: source.body?.text ?? '',
                    sourceMedia: [...source.media],
                    sourceFormat: source.body?.format ?? 'plain_text',
                    sourceLanguage: source.language ?? '',
                    publicationTargets: initial.publicationTargets.map(target =>
                        target.id === editor.publication.id
                            ? {
                                  ...target,
                                  contentDocument: document,
                                  content: getTargetPreviewBody(editor.profile.profile, document),
                                  customized: !channelVersionFollowsSource(
                                      editor.profile.profile,
                                      source,
                                      document
                                  ),
                                  scheduledAt: legacy.scheduleValue as string,
                              }
                            : target
                    ),
                },
            })
        }
    }
    return results
}

export function recoveryMatchesProfiles(
    recovery: PostRecovery,
    editors: readonly PublicationEditorState[]
) {
    return Object.entries(recovery.profileVersionIds).every(
        ([id, version]) =>
            editors.find(editor => editor.publication.id === id)?.draft.profileVersionId === version
    )
}

/** Preserve newly locked tabs and other publications when choosing one legacy copy. */
export function restorePostRecovery(
    current: PostCompositionState,
    recovery: PostRecovery
): PostCompositionState {
    return {
        ...current,
        postTitle: recovery.state.postTitle,
        postContent: recovery.state.postContent,
        sourceMedia: recovery.state.sourceMedia,
        sourceFormat: recovery.state.sourceFormat,
        sourceLanguage: recovery.state.sourceLanguage,
        publicationTargets: current.publicationTargets.map(target =>
            target.locked || (recovery.publicationId && recovery.publicationId !== target.id)
                ? target
                : {
                      ...target,
                      ...recovery.state.publicationTargets.find(local => local.id === target.id),
                      locked: target.locked,
                  }
        ),
        activeContentScopeId: current.activeContentScopeId,
        activePublicationTabId: current.activePublicationTabId,
    }
}

function readJson(storage: RecoveryStorage, key: string): unknown {
    try {
        return JSON.parse(storage.getItem(key) ?? 'null')
    } catch {
        return null
    }
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function validSource(value: unknown): value is Post['sourceContent'] {
    return (
        record(value) &&
        Array.isArray(value.media) &&
        value.media.every(item => record(item) && typeof item.assetId === 'string') &&
        (value.body === undefined ||
            (record(value.body) &&
                typeof value.body.text === 'string' &&
                ['markdown', 'plain_text'].includes(String(value.body.format)))) &&
        (value.headline === undefined || typeof value.headline === 'string') &&
        (value.language === undefined || typeof value.language === 'string')
    )
}
function validState(
    value: Record<string, unknown>
): value is Record<string, unknown> & PostCompositionState {
    return (
        typeof value.postTitle === 'string' &&
        typeof value.postContent === 'string' &&
        Array.isArray(value.sourceMedia) &&
        value.sourceMedia.every(item => record(item) && typeof item.assetId === 'string') &&
        Array.isArray(value.publicationTargets) &&
        value.publicationTargets.every(
            target =>
                record(target) &&
                typeof target.id === 'string' &&
                typeof target.channelId === 'string' &&
                typeof target.content === 'string' &&
                typeof target.scheduledAt === 'string' &&
                ['manual', 'automatic'].includes(String(target.deliveryMode)) &&
                (target.contentDocument === undefined || record(target.contentDocument))
        )
    )
}
