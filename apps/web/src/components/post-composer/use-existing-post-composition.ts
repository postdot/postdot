import { toast } from '@postdot/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { PublicationEditorSaveState } from '@/components/publication-editor-sidebar'
import { api, ApiError, formatApiError, type PublicationEditorState } from '@/lib/api'
import { parseDateTimeLocal, toDateTimeLocal, dateTimeLocalErrorMessage } from '@/lib/date-time'
import type { ProjectAccessStatus } from '@/lib/project-access-verification'
import { isActiveChannelProfilePromotionError } from '@/lib/publication-promotion'
import * as m from '@/paraglide/messages.js'

import {
    applyCompositionChannels,
    discardCompositionChanges,
    type ChannelApplyResult,
} from './apply-post-composition'
import {
    compositionChannelContent,
    compositionFromPost,
    compositionSource,
    isCompositionChannelLocked,
} from './existing-post-composition'
import { loadExistingPost, type ExistingPostData } from './load-existing-post'
import {
    postCompositionRecoveryKey,
    readPostRecoveries,
    serializePostRecovery,
    recoveryMatchesProfiles,
    restorePostRecovery,
} from './post-composition-recovery'
import { usePostComposition, type PostCompositionState } from './use-post-composition'

export { loadExistingPost, type ExistingPostData }

/** JSON with sorted keys: the server stores channel content canonically, so key order differs. */
function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    if (value !== null && typeof value === 'object') {
        return `{${Object.keys(value)
            .filter(key => (value as Record<string, unknown>)[key] !== undefined)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`
            )
            .join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
}

export function compositionFingerprint(state: PostCompositionState, data: ExistingPostData) {
    return stableJson({
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
    userId,
    projectId,
    timeZone,
    activePublicationId,
    readOnly,
    accessStatus,
    accessEpoch,
    onAccessRefused,
    onAccessReconciled,
    getAccessEpoch,
}: {
    readonly userId?: string
    readonly initialData: ExistingPostData
    readonly projectId: string
    readonly timeZone: string
    readonly activePublicationId?: string
    readonly readOnly: boolean
    readonly accessStatus: ProjectAccessStatus
    readonly accessEpoch: number
    readonly onAccessRefused: () => void
    readonly getAccessEpoch: () => number
    readonly onAccessReconciled: (succeeded: boolean) => void
}) {
    const [data, setData] = useState(initialData)
    const composition = usePostComposition(() =>
        compositionFromPost(initialData.post, initialData.editors, timeZone, {
            activePublicationId,
            readOnly,
        })
    )
    // The route names the channel to show. After a move or a duplicate the new publication
    // arrives with the next data load, so its tab is selected once it exists.
    const selectedRoutePublication = useRef<string | null>(null)
    const routeTargetLoaded = composition.publicationTargets.some(
        target => target.id === activePublicationId
    )
    useEffect(() => {
        if (!activePublicationId || !routeTargetLoaded) return
        if (selectedRoutePublication.current === activePublicationId) return
        selectedRoutePublication.current = activePublicationId
        composition.selectContentScope(activePublicationId)
    }, [activePublicationId, routeTargetLoaded])
    const [saveState, setSaveState] = useState<PublicationEditorSaveState>('saved')
    const [message, setMessage] = useState<string | null>(null)
    const [passive, setPassive] = useState(false)
    const [saving, setSaving] = useState(false)
    // A write that failed for a passing reason (network, server unavailable) is tried again;
    // each failure bumps the tick so the retry timer restarts.
    const [retryTick, setRetryTick] = useState(0)
    const retryable = useRef(false)
    const [applying, setApplying] = useState(false)
    const applyingRef = useRef(false)
    const [applyResults, setApplyResults] = useState<Record<string, ChannelApplyResult>>({})
    const uncertain = useRef(new Set<string>())
    const recoveryKey = postCompositionRecoveryKey(projectId, initialData.post.id, userId ?? '')
    const [recoveries, setRecoveries] = useState(() =>
        userId
            ? readPostRecoveries(
                  localStorage,
                  recoveryKey,
                  initialData.post,
                  initialData.editors,
                  timeZone
              ).filter(
                  recovery =>
                      compositionFingerprint(recovery.state, initialData) !==
                          serverFingerprint(initialData, readOnly, timeZone) ||
                      recovery.state.publicationTargets.some(
                          target =>
                              target.scheduledAt !==
                              toDateTimeLocal(
                                  initialData.editors.find(
                                      editor => editor.publication.id === target.id
                                  )?.publication.scheduledAt ?? null,
                                  timeZone
                              )
                      )
              )
            : []
    )
    const [recoveryChoice, setRecoveryChoice] = useState<PostCompositionState | null>(
        () => recoveries[0]?.state ?? null
    )
    const acceptedRecoveryKeys = useRef(new Set<string>())
    const acknowledgedEpoch = useRef<number | null>(null)
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
    const scheduleDirty = composition.publicationTargets.some(
        target =>
            !target.locked &&
            target.scheduledAt !==
                toDateTimeLocal(
                    data.editors.find(editor => editor.publication.id === target.id)?.publication
                        .scheduledAt ?? null,
                    timeZone
                )
    )
    const localChanges = dirty || scheduleDirty
    const dirtyRef = useRef(localChanges)
    dirtyRef.current = localChanges
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    const validEpoch = (epoch: number) =>
        mounted.current && current.current.accessEpoch === epoch && getAccessEpoch() === epoch
    function reportError(error: unknown) {
        if (error instanceof ApiError && (error.status === 403 || error.status === 404))
            onAccessRefused()
    }
    function persistRecovery(state: PostCompositionState) {
        if (!userId || current.current.recoveryChoice) return
        try {
            localStorage.setItem(
                recoveryKey,
                serializePostRecovery(state, current.current.data.editors, timeZone)
            )
        } catch {
            /* Storage can be unavailable. */
        }
    }
    function adopt(next: ExistingPostData) {
        current.current = { ...current.current, data: next }
        setData(next)
        composition.restoreComposition(
            compositionFromPost(next.post, next.editors, timeZone, {
                activePublicationId: current.current.composition.activeContentScopeId,
                readOnly: current.current.readOnly,
            })
        )
        setSaveState('saved')
    }
    const flush = useCallback(
        async (includeSchedules = false): Promise<boolean> => {
            if (request.current) {
                if (!(await request.current)) return false
                if (!includeSchedules && !dirtyRef.current) return true
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
                    serverFingerprint(before.data, before.readOnly, timeZone) &&
                !includeSchedules
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
                                targetContent: compositionChannelContent(
                                    before.composition,
                                    editor
                                ),
                                ...(includeSchedules &&
                                editor.publication.state === 'scheduled' &&
                                before.composition.publicationTargets.find(
                                    target => target.id === editor.publication.id
                                )?.scheduledAt &&
                                before.composition.publicationTargets.find(
                                    target => target.id === editor.publication.id
                                )?.scheduledAt !==
                                    toDateTimeLocal(editor.publication.scheduledAt, timeZone)
                                    ? {
                                          scheduledAt: scheduleTime(
                                              before.composition.publicationTargets.find(
                                                  target => target.id === editor.publication.id
                                              )!.scheduledAt,
                                              timeZone
                                          ),
                                      }
                                    : {}),
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
                    acknowledgedEpoch.current = epoch
                    setSaveState('saved')
                    setMessage(null)
                    setPassive(false)
                    return true
                } catch (error) {
                    if (!validEpoch(epoch)) return false
                    reportError(error)
                    retryable.current =
                        !(error instanceof ApiError) || error.status >= 500 || error.status === 429
                    if (retryable.current) setRetryTick(tick => tick + 1)
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
        },
        [projectId, timeZone, onAccessRefused]
    )
    useEffect(() => {
        if (
            !dirty ||
            readOnly ||
            accessStatus !== 'confirmed' ||
            sourceConflict ||
            recoveryChoice ||
            saveState === 'conflict' ||
            (saveState === 'error' && !retryable.current) ||
            saving ||
            applying
        )
            return
        const timer = window.setTimeout(() => void flush(), saveState === 'error' ? 5000 : 650)
        return () => window.clearTimeout(timer)
    }, [
        retryTick,
        dirty,
        readOnly,
        accessStatus,
        sourceConflict,
        recoveryChoice,
        saveState,
        saving,
        applying,
        flush,
        composition.sourceFormat,
        composition.sourceLanguage,
        composition.postContent,
        composition.postTitle,
        composition.sourceMedia,
        composition.publicationTargets,
    ])
    useEffect(() => {
        if (dirty || scheduleDirty) persistRecovery(composition)
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
    const contentStamp = compositionFingerprint(composition, data)
    const previousContent = useRef(contentStamp)
    useEffect(() => {
        if (previousContent.current !== contentStamp && saveState === 'error')
            setSaveState('local_only')
        previousContent.current = contentStamp
    }, [contentStamp, saveState])
    useEffect(() => {
        if (
            localChanges ||
            recoveryChoice ||
            accessStatus !== 'confirmed' ||
            acknowledgedEpoch.current !== accessEpoch ||
            getAccessEpoch() !== accessEpoch
        )
            return
        try {
            localStorage.removeItem(recoveryKey)
            for (const key of acceptedRecoveryKeys.current) localStorage.removeItem(key)
            acceptedRecoveryKeys.current.clear()
        } catch {
            /* Storage can be unavailable. */
        }
    }, [localChanges, recoveryChoice, accessStatus, accessEpoch, data, recoveryKey, getAccessEpoch])
    const incomingStamp = JSON.stringify(initialData)
    const lastIncoming = useRef(incomingStamp)
    useEffect(() => {
        if (
            incomingStamp === lastIncoming.current ||
            saving ||
            applying ||
            uncertain.current.size > 0 ||
            accessStatus !== 'confirmed'
        )
            return
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
        // Only a newer server revision conflicts with local work. A refetch of the revisions
        // already acknowledged (other summary fields, another shape) must not.
        const newer =
            initialData.post.sourceRevision > base.post.sourceRevision ||
            initialData.editors.some(
                incoming =>
                    incoming.draft.revision >
                    (base.editors.find(editor => editor.publication.id === incoming.publication.id)
                        ?.draft.revision ?? 0)
            )
        if (dirtyRef.current && !newer) return
        if (dirtyRef.current) {
            setSaveState('conflict')
            setMessage(m.editor_server_newer_local())
        } else {
            adopt(initialData)
            setMessage(m.editor_background_update())
            setPassive(true)
        }
    }, [incomingStamp, saving, applying, applyResults, accessStatus, initialData])
    const reconciledEpoch = useRef<number | null>(null)
    useEffect(() => {
        if (accessStatus !== 'reconciling' || reconciledEpoch.current === accessEpoch) return
        reconciledEpoch.current = accessEpoch
        void (async () => {
            try {
                const fresh = await loadExistingPost(projectId, initialData.post.id)
                if (!validEpoch(accessEpoch)) return
                const before = current.current.data
                if (!dirtyRef.current) {
                    adopt(fresh)
                    // The server state is confirmed for this epoch: nothing local is left.
                    acknowledgedEpoch.current = accessEpoch
                    setSaveState('saved')
                } else if (
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
                } else {
                    // A write refused during the suspension left an error; the server did not
                    // move, so the local work resumes and autosave writes it.
                    setSaveState('local_only')
                    setMessage(null)
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

    function acknowledgeEditor(next: PublicationEditorState) {
        const before = current.current.data
        const updated = {
            ...before,
            editors: before.editors.map(editor =>
                editor.publication.id === next.publication.id ? next : editor
            ),
            publications: before.publications.map(publication =>
                publication.id === next.publication.id
                    ? {
                          ...publication,
                          ...next.publication,
                          draftRevision: next.draft.revision,
                          draftSourceRevision: next.draft.sourceRevision,
                          draftReviewState: next.draft.reviewState,
                      }
                    : publication
            ),
        }
        current.current = { ...current.current, data: updated }
        setData(updated)
    }
    async function save(publicationId?: string) {
        if (
            applyingRef.current ||
            current.current.accessStatus !== 'confirmed' ||
            current.current.readOnly
        )
            return
        applyingRef.current = true
        setApplying(true)
        const epoch = current.current.accessEpoch
        try {
            // Wait for the active save, then flush the latest keystrokes before applying.
            if (!(await flush(true)) || !validEpoch(epoch)) return
            const before = current.current
            await applyCompositionChannels({
                editors: before.data.editors.filter(
                    editor =>
                        (!publicationId || editor.publication.id === publicationId) &&
                        !uncertain.current.has(editor.publication.id)
                ),
                state: before.composition,
                timeZone,
                canContinue: () =>
                    validEpoch(epoch) && current.current.accessStatus === 'confirmed',
                apply: async (editor, schedule) =>
                    (
                        await api.promotePublicationDraft(
                            projectId,
                            editor.publication.id,
                            editor.draft.revision,
                            schedule === toDateTimeLocal(editor.publication.scheduledAt, timeZone)
                                ? undefined
                                : scheduleTime(schedule, timeZone)
                        )
                    ).editor,
                onApplied: next => {
                    acknowledgeEditor(next)
                    setApplyResults(previous => ({
                        ...previous,
                        [next.publication.id]: { state: 'applied' },
                    }))
                },
                onFailure: (editor, error) => {
                    reportError(error)
                    const unknown = !(error instanceof ApiError) || error.status >= 500
                    if (unknown) uncertain.current.add(editor.publication.id)
                    setApplyResults(previous => ({
                        ...previous,
                        [editor.publication.id]: {
                            state: unknown ? 'unconfirmed' : 'failed',
                            message: unknown
                                ? m.editor_application_unconfirmed()
                                : isActiveChannelProfilePromotionError(error)
                                  ? m.editor_promotion_active_profile_mismatch()
                                  : formatApiError(error),
                        },
                    }))
                },
            })
        } finally {
            applyingRef.current = false
            if (mounted.current) setApplying(false)
        }
    }
    async function checkApplication(publicationId: string) {
        const epoch = current.current.accessEpoch
        if (current.current.accessStatus !== 'confirmed') return
        try {
            const { editor } = await api.getPublicationEditor(projectId, publicationId)
            if (!validEpoch(epoch)) return
            acknowledgeEditor(editor)
            uncertain.current.delete(publicationId)
            setApplyResults(previous => {
                const next = { ...previous }
                delete next[publicationId]
                return next
            })
        } catch (error) {
            if (validEpoch(epoch)) {
                reportError(error)
                setMessage(formatApiError(error))
            }
        }
    }
    function discard() {
        if (
            current.current.accessStatus !== 'confirmed' ||
            current.current.readOnly ||
            request.current ||
            applyingRef.current
        )
            return
        const before = current.current.composition
        const epoch = current.current.accessEpoch
        composition.restoreComposition(
            discardCompositionChanges(before, current.current.data.editors, timeZone)
        )
        // An application whose result is unknown stays to be checked; discarding text does
        // not settle it.
        setApplyResults(previous =>
            Object.fromEntries(
                Object.entries(previous).filter(([, result]) => result?.state === 'unconfirmed')
            )
        )
        setSaveState('saved')
        toast.add({
            title: m.editor_changes_discarded(),
            type: 'info',
            timeout: 10_000,
            actionProps: {
                children: m.editor_restore_changes(),
                onClick: () => {
                    if (validEpoch(epoch) && current.current.accessStatus === 'confirmed')
                        composition.restoreComposition(before)
                },
            },
        })
    }
    function chooseRecovery(useLocal: boolean) {
        if (current.current.accessStatus !== 'confirmed' || current.current.readOnly) return
        const recovery = recoveries[0]
        if (
            useLocal &&
            recovery &&
            !recoveryMatchesProfiles(recovery, current.current.data.editors)
        )
            return
        if (useLocal && recoveryChoice) {
            composition.restoreComposition(
                recovery
                    ? restorePostRecovery(current.current.composition, recovery)
                    : recoveryChoice
            )
            acceptedRecoveryKeys.current.add(recovery?.key ?? recoveryKey)
            setSaveState('local_only')
            setMessage(m.editor_recovered_promotion())
        } else if (recovery) {
            try {
                localStorage.removeItem(recovery.key)
            } catch {
                /* Storage can be unavailable. */
            }
        }
        const remaining = recoveries.slice(1)
        setRecoveries(remaining)
        setRecoveryChoice(remaining[0]?.state ?? null)
    }
    async function rebase() {
        if (current.current.accessStatus !== 'confirmed' || request.current || applyingRef.current)
            return
        const before = current.current
        const epoch = before.accessEpoch
        persistRecovery(before.composition)
        setSaving(true)
        setSaveState('rebasing')
        try {
            for (const editor of before.data.editors) {
                if (!validEpoch(epoch)) return
                if (
                    before.composition.publicationTargets.find(
                        target => target.id === editor.publication.id
                    )?.locked ||
                    editor.draft.sourceRevision === before.data.post.sourceRevision
                )
                    continue
                await api.rebasePublicationDraft(
                    projectId,
                    editor.publication.id,
                    editor.draft.revision
                )
            }
            if (!validEpoch(epoch)) return
            const fresh = await loadExistingPost(projectId, before.data.post.id)
            if (!validEpoch(epoch)) return
            adopt(fresh)
            if (dirtyRef.current) setRecoveryChoice(before.composition)
            setMessage(m.editor_shared_source_rebased())
        } catch (error) {
            if (!validEpoch(epoch)) return
            reportError(error)
            setSaveState('conflict')
            setMessage(formatApiError(error))
        } finally {
            if (mounted.current) setSaving(false)
        }
    }
    return {
        data,
        composition,
        dirty,
        scheduleDirty,
        applyResults,
        applying,
        save,
        discard,
        checkApplication,
        sourceConflict,
        saveState,
        message,
        passive,
        saving,
        flush,
        reload,
        rebase,
        recoveryChoice,
        recoveryCandidate: recoveries[0],
        chooseRecovery,
        setRecoveryChoice,
        setMessage,
        setData,
    }
}

function scheduleTime(value: string, timeZone: string): number | null {
    const parsed = parseDateTimeLocal(value, timeZone)
    if (typeof parsed === 'string') throw new Error(dateTimeLocalErrorMessage(parsed))
    if (parsed !== null && parsed < Date.now()) throw new Error(dateTimeLocalErrorMessage('past'))
    return parsed
}
