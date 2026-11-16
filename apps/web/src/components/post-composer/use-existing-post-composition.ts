import { useCallback, useEffect, useRef, useState } from 'react'

import type { PublicationEditorSaveState } from '@/components/publication-editor-sidebar'
import {
    api,
    ApiError,
    formatApiError,
    type Post,
    type PublicationEditorState,
    type PublicationSummary,
} from '@/lib/api'
import { loadPostPublications } from '@/lib/post-publications'
import type { ProjectAccessStatus } from '@/lib/project-access-verification'
import * as m from '@/paraglide/messages.js'

import {
    compositionChannelContent,
    compositionFromPost,
    compositionSource,
    isCompositionChannelLocked,
} from './existing-post-composition'
import { usePostComposition, type PostCompositionState } from './use-post-composition'

export interface ExistingPostData {
    readonly post: Post
    readonly editors: readonly PublicationEditorState[]
    readonly publications: readonly PublicationSummary[]
}

export async function loadExistingPost(
    projectId: string,
    postId: string
): Promise<ExistingPostData> {
    const [{ post }, publications] = await Promise.all([
        api.getPost(projectId, postId),
        loadPostPublications(projectId, postId),
    ])
    const editors = await Promise.all(
        publications.map(
            async publication => (await api.getPublicationEditor(projectId, publication.id)).editor
        )
    )
    return { post, publications, editors }
}

export function compositionFingerprint(state: PostCompositionState, data: ExistingPostData) {
    return JSON.stringify({
        source: compositionSource(state, data.post.sourceContent),
        targets: data.editors
            .filter(
                editor =>
                    !state.publicationTargets.find(target => target.id === editor.publication.id)
                        ?.locked
            )
            .map(editor => [editor.publication.id, compositionChannelContent(state, editor)]),
    })
}

function serverFingerprint(data: ExistingPostData, readOnly: boolean, timeZone: string) {
    return compositionFingerprint(
        compositionFromPost(data.post, data.editors, timeZone, { readOnly }),
        data
    )
}

export function useExistingPostComposition({
    initialData,
    projectId,
    timeZone,
    activePublicationId,
    readOnly,
    accessStatus,
    accessEpoch,
    onAccessRefused,
    onAccessReconciled,
}: {
    readonly initialData: ExistingPostData
    readonly projectId: string
    readonly timeZone: string
    readonly activePublicationId?: string
    readonly readOnly: boolean
    readonly accessStatus: ProjectAccessStatus
    readonly accessEpoch: number
    readonly onAccessRefused: () => void
    readonly onAccessReconciled: (succeeded: boolean) => void
}) {
    const [data, setData] = useState(initialData)
    const composition = usePostComposition(() =>
        compositionFromPost(initialData.post, initialData.editors, timeZone, {
            activePublicationId,
            readOnly,
        })
    )
    const [saveState, setSaveState] = useState<PublicationEditorSaveState>('saved')
    const [message, setMessage] = useState<string | null>(null)
    const [passive, setPassive] = useState(false)
    const [saving, setSaving] = useState(false)
    const [recoveryChoice, setRecoveryChoice] = useState<PostCompositionState | null>(null)
    const recoveryKey = `postdot:post-composition:v1:${encodeURIComponent(projectId)}:${encodeURIComponent(initialData.post.id)}`
    const current = useRef({
        data,
        composition,
        readOnly,
        accessStatus,
        accessEpoch,
        saveState,
        recoveryChoice,
    })
    current.current = {
        data,
        composition,
        readOnly,
        accessStatus,
        accessEpoch,
        saveState,
        recoveryChoice,
    }
    const request = useRef<Promise<boolean> | null>(null)
    const dirty =
        compositionFingerprint(composition, data) !== serverFingerprint(data, readOnly, timeZone)
    const sourceConflict = data.editors.some(
        editor =>
            !composition.publicationTargets.find(target => target.id === editor.publication.id)
                ?.locked && editor.draft.sourceRevision !== data.post.sourceRevision
    )
    const dirtyRef = useRef(dirty)
    dirtyRef.current = dirty
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    const validEpoch = (epoch: number) => mounted.current && current.current.accessEpoch === epoch
    function reportError(error: unknown) {
        if (error instanceof ApiError && (error.status === 403 || error.status === 404))
            onAccessRefused()
    }
    function persistRecovery(state: PostCompositionState) {
        try {
            localStorage.setItem(
                recoveryKey,
                JSON.stringify({ ...state, customizedTargetIds: [...state.customizedTargetIds] })
            )
        } catch {
            /* Storage can be unavailable. */
        }
    }
    function adopt(next: ExistingPostData) {
        setData(next)
        composition.restoreComposition(
            compositionFromPost(next.post, next.editors, timeZone, {
                activePublicationId: current.current.composition.activeContentScopeId,
                readOnly: current.current.readOnly,
            })
        )
        setSaveState('saved')
    }
    const flush = useCallback(async (): Promise<boolean> => {
        if (request.current) {
            if (!(await request.current)) return false
            if (!dirtyRef.current) return true
        }
        const before = current.current
        if (
            before.readOnly ||
            before.accessStatus !== 'confirmed' ||
            before.saveState === 'conflict' ||
            before.recoveryChoice
        )
            return false
        if (
            compositionFingerprint(before.composition, before.data) ===
            serverFingerprint(before.data, before.readOnly, timeZone)
        )
            return true
        if (
            before.data.editors.some(
                editor =>
                    !before.composition.publicationTargets.find(
                        target => target.id === editor.publication.id
                    )?.locked && editor.draft.sourceRevision !== before.data.post.sourceRevision
            )
        )
            return false
        const epoch = before.accessEpoch
        setSaving(true)
        setSaveState('saving')
        const operation = (async () => {
            try {
                const sourceContent = compositionSource(
                    before.composition,
                    before.data.post.sourceContent
                )
                const response = await api.savePostComposition(projectId, before.data.post.id, {
                    expectedSourceRevision: before.data.post.sourceRevision,
                    ...(JSON.stringify(sourceContent) ===
                    JSON.stringify(before.data.post.sourceContent)
                        ? {}
                        : { sourceContent }),
                    publications: before.data.editors
                        .filter(
                            editor =>
                                !before.composition.publicationTargets.find(
                                    target => target.id === editor.publication.id
                                )?.locked
                        )
                        .map(editor => ({
                            publicationId: editor.publication.id,
                            expectedRevision: editor.draft.revision,
                            targetContent: compositionChannelContent(before.composition, editor),
                        })),
                })
                if (!validEpoch(epoch)) return false
                const next = {
                    ...before.data,
                    post: response.post,
                    publications: before.data.publications.map(publication => {
                        const editor = response.publications.find(
                            editor => editor.publication.id === publication.id
                        )
                        return editor
                            ? {
                                  ...publication,
                                  ...editor.publication,
                                  draftRevision: editor.draft.revision,
                                  draftSourceRevision: editor.draft.sourceRevision,
                                  draftReviewState: editor.draft.reviewState,
                              }
                            : publication
                    }),
                    editors: before.data.editors.map(
                        editor =>
                            response.publications.find(
                                next => next.publication.id === editor.publication.id
                            ) ?? { ...editor, post: response.post }
                    ),
                }
                // Keep edits typed after dispatch. Only the acknowledged base advances.
                current.current = { ...current.current, data: next }
                setData(next)
                setSaveState('saved')
                setMessage(null)
                setPassive(false)
                return true
            } catch (error) {
                if (!validEpoch(epoch)) return false
                reportError(error)
                setSaveState(
                    error instanceof ApiError && error.code === 'write_conflict'
                        ? 'conflict'
                        : 'error'
                )
                setMessage(formatApiError(error))
                setPassive(false)
                return false
            } finally {
                request.current = null
                if (mounted.current) setSaving(false)
            }
        })()
        request.current = operation
        return operation
    }, [projectId, timeZone, onAccessRefused])
    useEffect(() => {
        if (
            !dirty ||
            readOnly ||
            accessStatus !== 'confirmed' ||
            sourceConflict ||
            recoveryChoice ||
            saveState === 'conflict' ||
            saveState === 'error' ||
            saving
        )
            return
        const timer = window.setTimeout(() => void flush(), 650)
        return () => window.clearTimeout(timer)
    }, [
        dirty,
        readOnly,
        accessStatus,
        sourceConflict,
        recoveryChoice,
        saveState,
        saving,
        flush,
        composition.sourceFormat,
        composition.sourceLanguage,
        composition.postContent,
        composition.postTitle,
        composition.sourceMedia,
        composition.publicationTargets,
    ])
    useEffect(() => {
        if (dirty) persistRecovery(composition)
        // A confirmed epoch is required even for recovery cleanup.
    }, [
        dirty,
        composition.sourceFormat,
        composition.sourceLanguage,
        composition.postContent,
        composition.postTitle,
        composition.sourceMedia,
        composition.publicationTargets,
    ])
    useEffect(() => {
        const state = current.current.composition
        const targets = state.publicationTargets.map(target => {
            const editor = current.current.data.editors.find(
                editor => editor.publication.id === target.id
            )
            return editor
                ? { ...target, locked: isCompositionChannelLocked(editor, readOnly) }
                : target
        })
        if (
            targets.some(
                (target, index) => target.locked !== state.publicationTargets[index]?.locked
            )
        )
            composition.restoreComposition({ ...state, publicationTargets: targets })
    }, [readOnly, data.editors])
    const incomingStamp = JSON.stringify(initialData)
    const lastIncoming = useRef(incomingStamp)
    useEffect(() => {
        if (incomingStamp === lastIncoming.current || saving || accessStatus !== 'confirmed') return
        const base = current.current.data
        if (
            initialData.post.sourceRevision < base.post.sourceRevision ||
            initialData.editors.some(
                incoming =>
                    incoming.draft.revision <
                    (base.editors.find(editor => editor.publication.id === incoming.publication.id)
                        ?.draft.revision ?? 0)
            )
        )
            return
        lastIncoming.current = incomingStamp
        if (JSON.stringify(base) === incomingStamp) return
        if (dirtyRef.current) {
            setSaveState('conflict')
            setMessage(m.editor_server_newer_local())
        } else {
            adopt(initialData)
            setMessage(m.editor_background_update())
            setPassive(true)
        }
    }, [incomingStamp, saving, accessStatus, initialData])
    const reconciledEpoch = useRef<number | null>(null)
    useEffect(() => {
        if (accessStatus !== 'reconciling' || reconciledEpoch.current === accessEpoch) return
        reconciledEpoch.current = accessEpoch
        void (async () => {
            try {
                const fresh = await loadExistingPost(projectId, initialData.post.id)
                if (!validEpoch(accessEpoch)) return
                const before = current.current.data
                if (!dirtyRef.current) adopt(fresh)
                else if (
                    fresh.post.sourceRevision !== before.post.sourceRevision ||
                    fresh.editors.some(
                        editor =>
                            editor.draft.revision !==
                            before.editors.find(
                                previous => previous.publication.id === editor.publication.id
                            )?.draft.revision
                    )
                ) {
                    setSaveState('conflict')
                    setMessage(m.editor_server_newer_local())
                }
                onAccessReconciled(true)
            } catch {
                if (validEpoch(accessEpoch)) onAccessReconciled(false)
            }
        })()
    }, [accessStatus, accessEpoch, projectId, initialData.post.id, onAccessReconciled])
    async function reload(keepLocal = false) {
        if (current.current.accessStatus !== 'confirmed' || request.current) return
        const epoch = current.current.accessEpoch
        const local = current.current.composition
        if (dirtyRef.current) persistRecovery(local)
        setSaving(true)
        try {
            const fresh = await loadExistingPost(projectId, data.post.id)
            if (!validEpoch(epoch)) return
            adopt(fresh)
            if (keepLocal) {
                composition.restoreComposition(local)
                setMessage(m.editor_recovered_promotion())
            } else if (dirtyRef.current) setRecoveryChoice(local)
        } catch (error) {
            if (validEpoch(epoch)) {
                reportError(error)
                setSaveState('error')
                setMessage(formatApiError(error))
            }
        } finally {
            if (mounted.current) setSaving(false)
        }
    }
    return {
        data,
        composition,
        dirty,
        sourceConflict,
        saveState,
        message,
        passive,
        saving,
        flush,
        reload,
        recoveryChoice,
        setRecoveryChoice,
        setMessage,
        setData,
    }
}
