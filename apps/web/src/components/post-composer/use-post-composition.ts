import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

import type { DeliveryMode, PublicationTargetDraft } from '@/lib/publication-authoring'
import type { MediaSelection } from '@/lib/target-media'

export const postSharedScopeId = 'shared'

export interface PostCompositionTarget extends PublicationTargetDraft {
    readonly customized: boolean
    readonly locked?: boolean
}

export interface PostCompositionState {
    readonly postTitle: string
    readonly postContent: string
    readonly sourceMedia: MediaSelection[]
    readonly publicationTagIds: string[]
    readonly publicationTargets: PostCompositionTarget[]
    readonly defaultDeliveryMode: DeliveryMode
    readonly defaultScheduledAt: string
    /** Delivery overrides are independent of channel text customization. */
    readonly customizedTargetIds: Set<string>
    readonly activePublicationTabId: string
    readonly activeContentScopeId: string
}

export type PostCompositionInitialState = Partial<
    Omit<PostCompositionState, 'publicationTargets'>
> & {
    readonly publicationTargets?: (PublicationTargetDraft & {
        readonly customized?: boolean
        readonly locked?: boolean
    })[]
}

export function initialPostComposition(initial: PostCompositionInitialState): PostCompositionState {
    const targets = (initial.publicationTargets ?? []).map(target => ({
        ...target,
        customized: target.customized ?? target.content.trim() !== '',
    }))
    const scope = targets.find(target => target.content.trim() !== '')?.id ?? postSharedScopeId
    return {
        postTitle: '',
        postContent: '',
        sourceMedia: [],
        publicationTagIds: [],
        defaultDeliveryMode: targets[0]?.deliveryMode ?? 'manual',
        defaultScheduledAt: targets[0]?.scheduledAt ?? '',
        customizedTargetIds: new Set(),
        activePublicationTabId: scope,
        activeContentScopeId: scope,
        ...initial,
        publicationTargets: targets,
    }
}

export type PostCompositionAction =
    | { readonly type: 'editText'; readonly scopeId: string; readonly content: string }
    | { readonly type: 'resetText'; readonly targetId: string }
    | { readonly type: 'removeTarget'; readonly targetId: string }
    | { readonly type: 'addTarget'; readonly target: PostCompositionTarget }
    | { readonly type: 'selectScope'; readonly scopeId: string }
    | { readonly type: 'changeTargets'; readonly targets: PublicationTargetDraft[] }
    | { readonly type: 'defaultDelivery'; readonly deliveryMode: DeliveryMode }
    | { readonly type: 'defaultSchedule'; readonly scheduledAt: string }
    | {
          readonly type: 'customizeDelivery'
          readonly targetId: string
          readonly customized: boolean
      }

/** Pure transitions shared by create and edit workflows, independent of persistence. */
export function reducePostComposition(
    state: PostCompositionState,
    action: PostCompositionAction
): PostCompositionState {
    const targetId = 'targetId' in action ? action.targetId : undefined
    if (targetId !== undefined && state.publicationTargets.find(t => t.id === targetId)?.locked)
        return state
    switch (action.type) {
        case 'editText': {
            if (action.scopeId === postSharedScopeId)
                return { ...state, postContent: action.content }
            const target = state.publicationTargets.find(t => t.id === action.scopeId)
            if (!target || target.locked) return state
            return {
                ...state,
                publicationTargets: state.publicationTargets.map(t =>
                    t.id === action.scopeId
                        ? { ...t, content: action.content, customized: true }
                        : t
                ),
            }
        }
        case 'resetText':
            return {
                ...state,
                publicationTargets: state.publicationTargets.map(t =>
                    t.id === action.targetId ? { ...t, content: '', customized: false } : t
                ),
            }
        case 'removeTarget':
            return {
                ...state,
                publicationTargets: state.publicationTargets.filter(t => t.id !== action.targetId),
                activeContentScopeId:
                    state.activeContentScopeId === action.targetId
                        ? postSharedScopeId
                        : state.activeContentScopeId,
                activePublicationTabId:
                    state.activePublicationTabId === action.targetId
                        ? postSharedScopeId
                        : state.activePublicationTabId,
            }
        case 'addTarget':
            if (state.publicationTargets.some(t => t.channelId === action.target.channelId))
                return state
            return {
                ...state,
                publicationTargets: [
                    ...state.publicationTargets.filter(t => t.channelId !== ''),
                    action.target,
                ],
            }
        case 'changeTargets':
            return {
                ...state,
                publicationTargets: [
                    ...action.targets.map(target => {
                        const previous = state.publicationTargets.find(t => t.id === target.id)
                        if (previous?.locked) return previous
                        return {
                            ...target,
                            customized: previous?.customized ?? target.content.trim() !== '',
                        }
                    }),
                    ...state.publicationTargets.filter(
                        target =>
                            target.locked && !action.targets.some(next => next.id === target.id)
                    ),
                ],
            }
        case 'selectScope':
            if (
                action.scopeId !== postSharedScopeId &&
                !state.publicationTargets.some(t => t.id === action.scopeId)
            )
                return state
            return {
                ...state,
                activeContentScopeId: action.scopeId,
                activePublicationTabId: action.scopeId,
            }
        case 'defaultDelivery':
            return {
                ...state,
                defaultDeliveryMode: action.deliveryMode,
                publicationTargets: state.publicationTargets.map(t =>
                    t.locked || state.customizedTargetIds.has(t.id)
                        ? t
                        : { ...t, deliveryMode: action.deliveryMode }
                ),
            }
        case 'defaultSchedule':
            return {
                ...state,
                defaultScheduledAt: action.scheduledAt,
                publicationTargets: state.publicationTargets.map(t =>
                    t.locked || state.customizedTargetIds.has(t.id)
                        ? t
                        : { ...t, scheduledAt: action.scheduledAt }
                ),
            }
        case 'customizeDelivery': {
            const customizedTargetIds = new Set(state.customizedTargetIds)
            if (action.customized) customizedTargetIds.add(action.targetId)
            else customizedTargetIds.delete(action.targetId)
            return {
                ...state,
                customizedTargetIds,
                publicationTargets: action.customized
                    ? state.publicationTargets
                    : state.publicationTargets.map(t =>
                          t.id === action.targetId
                              ? {
                                    ...t,
                                    deliveryMode: state.defaultDeliveryMode,
                                    scheduledAt: state.defaultScheduledAt,
                                }
                              : t
                      ),
            }
        }
    }
}

export function postScopeText(state: PostCompositionState, scopeId: string): string {
    const target = state.publicationTargets.find(t => t.id === scopeId)
    return target && (target.customized || target.locked) ? target.content : state.postContent
}

function resolveUpdate<T>(value: SetStateAction<T>, current: T): T {
    return typeof value === 'function' ? (value as (previous: T) => T)(current) : value
}

/** Initial state can be a blank composition or an existing post. No API or recovery effects. */
export function usePostComposition(
    initial: PostCompositionInitialState | (() => PostCompositionInitialState)
) {
    const [state, setState] = useState(() =>
        initialPostComposition(typeof initial === 'function' ? initial() : initial)
    )
    const dispatch = useCallback(
        (action: PostCompositionAction) =>
            setState(current => reducePostComposition(current, action)),
        []
    )
    const onPostTitleChange = useCallback(
        (value: SetStateAction<string>) =>
            setState(current => ({
                ...current,
                postTitle: resolveUpdate(value, current.postTitle),
            })),
        []
    )
    const onPostContentChange = useCallback(
        (value: SetStateAction<string>) =>
            setState(current => ({
                ...current,
                postContent: resolveUpdate(value, current.postContent),
            })),
        []
    )
    const onSourceMediaChange = useCallback(
        (value: SetStateAction<MediaSelection[]>) =>
            setState(current => ({
                ...current,
                sourceMedia: resolveUpdate(value, current.sourceMedia),
            })),
        []
    )
    const onPublicationTagIdsChange = useCallback(
        (value: SetStateAction<string[]>) =>
            setState(current => ({
                ...current,
                publicationTagIds: resolveUpdate(value, current.publicationTagIds),
            })),
        []
    )
    const onPublicationTargetsChange = useCallback(
        (value: SetStateAction<PublicationTargetDraft[]>) =>
            setState(current =>
                reducePostComposition(current, {
                    type: 'changeTargets',
                    targets: resolveUpdate(value, current.publicationTargets),
                })
            ),
        []
    )
    const restoreComposition = useCallback(
        (next: PostCompositionInitialState) => setState(initialPostComposition(next)),
        []
    )
    const customizedContentTargetIds = useMemo(
        () => new Set(state.publicationTargets.filter(t => t.customized).map(t => t.id)),
        [state.publicationTargets]
    )
    const activeContentTarget = state.publicationTargets.find(
        t => t.id === state.activeContentScopeId
    )
    const activeTarget = state.publicationTargets.find(t => t.id === state.activePublicationTabId)
    const resolvedActiveContentScopeId = activeContentTarget?.id ?? postSharedScopeId
    const activeContentTargetUsesSharedContent =
        activeContentTarget === undefined ||
        (!activeContentTarget.customized && !activeContentTarget.locked)
    const activeText = postScopeText(state, resolvedActiveContentScopeId)
    const previousTargetIds = useRef(new Set(state.publicationTargets.map(t => t.id)))
    useEffect(() => {
        const nextTargetIds = new Set(state.publicationTargets.map(t => t.id))
        const preserved = [...previousTargetIds.current].some(id => nextTargetIds.has(id))
        const first = state.publicationTargets[0]
        if (!preserved && first)
            setState(current => ({
                ...current,
                defaultDeliveryMode: first.deliveryMode,
                defaultScheduledAt: first.scheduledAt,
                customizedTargetIds: new Set(),
            }))
        previousTargetIds.current = nextTargetIds
    }, [state.publicationTargets])
    useEffect(() => {
        setState(current => {
            const valid = (id: string) =>
                id === postSharedScopeId ||
                current.publicationTargets.some(t => t.id === id && t.channelId !== '')
            if (valid(current.activeContentScopeId) && valid(current.activePublicationTabId))
                return current
            return {
                ...current,
                activeContentScopeId: valid(current.activeContentScopeId)
                    ? current.activeContentScopeId
                    : postSharedScopeId,
                activePublicationTabId: valid(current.activePublicationTabId)
                    ? current.activePublicationTabId
                    : postSharedScopeId,
            }
        })
    }, [state.publicationTargets])
    return {
        ...state,
        customizedContentTargetIds,
        activeContentTarget,
        activeTarget,
        resolvedActiveContentScopeId,
        activeContentTargetUsesSharedContent,
        activeText,
        onPostTitleChange,
        onPostContentChange,
        onSourceMediaChange,
        onPublicationTagIdsChange,
        onPublicationTargetsChange,
        restoreComposition,
        selectContentScope: (scopeId: string) => dispatch({ type: 'selectScope', scopeId }),
        editScopeText: (scopeId: string, content: string) =>
            dispatch({ type: 'editText', scopeId, content }),
        editActiveText: (content: string) =>
            dispatch({ type: 'editText', scopeId: resolvedActiveContentScopeId, content }),
        useSharedTargetContent: (targetId: string) => dispatch({ type: 'resetText', targetId }),
        removeTarget: (targetId: string) => dispatch({ type: 'removeTarget', targetId }),
        addTarget: (target: PostCompositionTarget) => dispatch({ type: 'addTarget', target }),
        handleDefaultDeliveryModeChange: (deliveryMode: DeliveryMode) =>
            dispatch({ type: 'defaultDelivery', deliveryMode }),
        handleDefaultScheduledAtChange: (scheduledAt: string) =>
            dispatch({ type: 'defaultSchedule', scheduledAt }),
        handleTargetCustomizationChange: (targetId: string, customized: boolean) =>
            dispatch({ type: 'customizeDelivery', targetId, customized }),
    }
}

export type PostComposition = ReturnType<typeof usePostComposition>
