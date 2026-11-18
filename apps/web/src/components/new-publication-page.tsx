import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { Kbd } from '@postdot/ui/components/kbd'
import { Tooltip, TooltipTrigger, TooltipContent } from '@postdot/ui/components/tooltip'
import { cn } from '@postdot/ui/lib/utils'
import { CalendarAddIcon } from '@solar-icons/react/linear/calendar-add'
import { FileTextIcon } from '@solar-icons/react/linear/file-text'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { ChannelCreationDialog } from '@/components/channel-creation-dialog'
import { ComposerDraftConflict } from '@/components/composer-draft-conflict'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PostComposer } from '@/components/post-composer/post-composer'
import { publicationSharedTabId } from '@/components/publication-target-list'
import { QueryErrorState } from '@/components/query-error-state'
import { ApiError, api, formatApiError, type PublicationComposerDraft } from '@/lib/api'
import { useDashboardGlobal, useProjectDashboard } from '@/lib/dashboard-context'
import { useProjectTagCatalog } from '@/lib/project-tags'
import { calendarDateTimeLocal, createPublicationTarget } from '@/lib/publication-authoring'
import {
    type PublicationCreationMode,
    usePublicationComposer,
} from '@/lib/publication-composer-context'
import {
    clearPublicationRecovery,
    hasRecoverablePublicationContent,
    readPublicationRecovery,
    recoveredComposerContent,
    composerContentsEqual,
    writePublicationRecovery,
    type PublicationComposerDraftContent,
    type PublicationRecoveryState,
} from '@/lib/publication-recovery'
import { getModifierKey } from '@/lib/shortcuts'
import * as m from '@/paraglide/messages.js'

export function NewPublicationPage({
    calendarDate,
    calendarTime,
    configuredEditor = true,
}: {
    readonly calendarDate?: string
    readonly calendarTime?: string
    readonly configuredEditor?: boolean
}) {
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/publications/new' })
    const { activeChannels, channels, connections, project, projectRole, access } =
        useProjectDashboard()
    const userId = useDashboardGlobal().session.user.id
    const {
        error,
        composition,
        onCreatePost,
        onCreateChannel,
        onCreateProjectTag,
        onPublicationTargetsChange,
        pending,
        postContent,
        postTitle,
        publicationTagIds,
        publicationTargets,
        sourceMedia,
    } = usePublicationComposer()
    const tagCatalogQuery = useProjectTagCatalog(project.id)
    const activeProjectTags = tagCatalogQuery.data?.tags.filter(tag => tag.state === 'active') ?? []
    const pickerTags = tagCatalogQuery.data?.tags ?? activeProjectTags
    const hasCurrentComposerContent = hasRecoverablePublicationContent({
        postTitle,
        postContent,
        publicationTargets,
        sourceMedia,
    })
    const formRef = useRef<HTMLFormElement | null>(null)
    const [mediaPreparationPending, setMediaPreparationPending] = useState(false)
    const mediaPreparationPendingRef = useRef(false)
    const currentCreatePost = useRef(onCreatePost)
    currentCreatePost.current = onCreatePost
    const reportMediaPreparation = useCallback((next: boolean) => {
        mediaPreparationPendingRef.current = next
        setMediaPreparationPending(next)
    }, [])
    const canCreateProjectTag = projectRole === 'owner' || projectRole === 'editor'
    const [localRecoveryAtMount] = useState(() => readPublicationRecovery(project.id, userId))
    const appliedCalendarSlot = useRef<string | undefined>(undefined)
    const {
        defaultDeliveryMode,
        defaultScheduledAt,
        customizedTargetIds,
        customizedContentTargetIds,
        activePublicationTabId,
        activeContentScopeId,
        handleDefaultScheduledAtChange,
    } = composition
    const [recovery, setRecovery] = useState<PublicationRecoveryState | null>(() =>
        hasCurrentComposerContent ? null : localRecoveryAtMount
    )
    const [serverDraft, setServerDraft] = useState<PublicationComposerDraft | null>(null)
    const [serverDraftReady, setServerDraftReady] = useState(false)
    const [serverDraftLoadFailed, setServerDraftLoadFailed] = useState(false)
    const [serverDraftLoadAttempt, setServerDraftLoadAttempt] = useState(0)
    const [discardingRecovery, setDiscardingRecovery] = useState(false)
    const [autosaveState, setAutosaveState] = useState<
        'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'account' | 'session'
    >('idle')
    const [autosaveError, setAutosaveError] = useState<string | null>(null)
    const [autosaveRetryPending, setAutosaveRetryPending] = useState(false)
    const autosaveConflict = useRef(false)
    const authoringPaused = useRef(false)
    const [conflictBusy, setConflictBusy] = useState(false)
    const [conflictVersionKnown, setConflictVersionKnown] = useState(false)
    const recoveryPromptOpen = useRef(recovery !== null)
    // ADR-103 §6: work comes back without a question; this is what "Start over" returns to.
    const [restoredNotice, setRestoredNotice] = useState(false)
    const blankComposerContent = useRef<PublicationComposerDraftContent | null>(null)
    const currentComposerHasContent = useRef(hasCurrentComposerContent)
    const serverDraftRef = useRef<PublicationComposerDraft | null>(null)
    const autosaveQueue = useRef(Promise.resolve())
    const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const selectedPublicationCount = publicationTargets.filter(
        target => target.channelId !== ''
    ).length

    currentComposerHasContent.current = hasCurrentComposerContent
    if (blankComposerContent.current === null && recovery === null) {
        blankComposerContent.current = composerDraftContent()
    }
    serverDraftRef.current = serverDraft

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        if (!access.canWrite()) {
            event.preventDefault()
            return
        }
        event.preventDefault()
        const accessEpoch = access.captureEpoch()
        if (
            autosaveConflict.current ||
            authoringPaused.current ||
            mediaPreparationPendingRef.current
        )
            return
        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        await autosaveQueue.current.catch(() => undefined)
        if (!access.isCurrent(accessEpoch) || !access.canWrite()) return

        const submitter = (event.nativeEvent as SubmitEvent).submitter
        const mode: PublicationCreationMode =
            submitter instanceof HTMLButtonElement && submitter.value === 'draft'
                ? 'draft'
                : 'schedule'
        if (
            authoringPaused.current ||
            autosaveConflict.current ||
            mediaPreparationPendingRef.current
        )
            return
        const publications = await currentCreatePost.current(event, mode, pauseForSessionError)
        if (!access.isCurrent(accessEpoch)) return
        if (publications !== null) {
            clearPublicationRecovery(project.id, userId)
            await discardServerDraft()
            recoveryPromptOpen.current = false
            setRecovery(null)
        }
        const publication = publications?.[0]
        if (publication === undefined) return

        await navigate({
            to: '/dashboard/projects/$projectId/posts/$postId',
            params: { projectId: project.id, postId: publication.postId },
        })
    }

    function restoreRecovery() {
        if (recovery === null || !serverDraftReady || discardingRecovery) return

        applyComposerContent(recoveredComposerContent(recovery))
        clearPublicationRecovery(project.id, userId)
        recoveryPromptOpen.current = false
        setRecovery(null)
    }

    function applyComposerContent(recovery: PublicationComposerDraftContent) {
        const restoredScope = resolveRecoveredContentScope(recovery)
        const {
            customizedContentTargetIds: contentIds,
            customizedTargetIds: deliveryIds,
            ...content
        } = recovery
        composition.restoreComposition({
            ...content,
            publicationTargets: recovery.publicationTargets.map(target => ({
                ...target,
                customized: contentIds.includes(target.id),
            })),
            customizedTargetIds: new Set(deliveryIds),
            activePublicationTabId: restoredScope,
            activeContentScopeId: restoredScope,
        })
    }

    /** A refused session cannot keep using the mounted author's composition. */
    function pauseForSessionError(error: unknown): boolean {
        if (!(error instanceof ApiError)) return false
        if (error.status !== 401 && error.code !== 'account_changed') return false
        authoringPaused.current = true
        autosaveConflict.current = true
        // Any open comparison or recovery choice was built from this page's account.
        recoveryPromptOpen.current = false
        setRecovery(null)
        setAutosaveState(error.status === 401 ? 'session' : 'account')
        return true
    }

    async function discardServerDraft() {
        if (!access.canWrite()) return false
        if (serverDraftRef.current === null) return true
        const accessEpoch = access.captureEpoch()

        try {
            await api.deletePublicationComposerDraft(
                project.id,
                serverDraftRef.current.revision,
                serverDraftRef.current.id,
                userId
            )
            if (!access.isCurrent(accessEpoch)) return false
            serverDraftRef.current = null
            setServerDraft(null)
            setAutosaveState('idle')
            setAutosaveError(null)
            return true
        } catch (caughtError) {
            if (!access.isCurrent(accessEpoch)) return false
            access.reportRefusal(caughtError)
            setAutosaveError(formatApiError(caughtError))
            if (pauseForSessionError(caughtError)) return false
            if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                autosaveConflict.current = true
                setAutosaveState('conflict')
            } else setAutosaveState('error')
            return false
        }
    }

    async function startOver() {
        if (!serverDraftReady || discardingRecovery) return
        setDiscardingRecovery(true)
        try {
            if (!(await discardServerDraft())) return
            clearPublicationRecovery(project.id, userId)
            if (blankComposerContent.current !== null) {
                applyComposerContent(blankComposerContent.current)
            }
            setRestoredNotice(false)
        } finally {
            setDiscardingRecovery(false)
        }
    }

    function compositionDraftTargets() {
        return publicationTargets.map(({ id, channelId, content, deliveryMode, scheduledAt }) => ({
            id,
            channelId,
            content,
            deliveryMode,
            scheduledAt,
        }))
    }

    function composerDraftContent(): PublicationComposerDraftContent {
        return {
            activeContentScopeId,
            activePublicationTabId,
            customizedContentTargetIds: [...customizedContentTargetIds],
            customizedTargetIds: [...customizedTargetIds],
            defaultDeliveryMode,
            defaultScheduledAt,
            postContent,
            postTitle,
            publicationTagIds: [...publicationTagIds],
            publicationTargets: compositionDraftTargets(),
            sourceMedia: sourceMedia.map(selection => ({ ...selection })),
        }
    }

    function enqueueAutosave(content: PublicationComposerDraftContent | null) {
        autosaveQueue.current = autosaveQueue.current
            .catch(() => undefined)
            .then(async () => {
                if (
                    !access.canWrite() ||
                    !serverDraftReady ||
                    recoveryPromptOpen.current ||
                    autosaveConflict.current ||
                    authoringPaused.current
                )
                    return
                const accessEpoch = access.captureEpoch()
                setAutosaveState('saving')
                setAutosaveError(null)
                if (content === null) {
                    if (serverDraftRef.current === null) setAutosaveState('idle')
                    else await discardServerDraft()
                    return
                }
                try {
                    const response = await api.savePublicationComposerDraft(
                        project.id,
                        serverDraftRef.current?.revision ?? 0,
                        content,
                        serverDraftRef.current?.id,
                        userId
                    )
                    if (!access.isCurrent(accessEpoch)) return
                    serverDraftRef.current = response.draft
                    setServerDraft(response.draft)
                    setAutosaveState('saved')
                } catch (caughtError) {
                    if (!access.isCurrent(accessEpoch)) return
                    access.reportRefusal(caughtError)
                    setAutosaveError(formatApiError(caughtError))
                    if (pauseForSessionError(caughtError)) return
                    if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                        autosaveConflict.current = true
                        setAutosaveState('conflict')
                    } else setAutosaveState('error')
                }
            })
        return autosaveQueue.current
    }

    function retryAutosave() {
        if (
            autosaveState !== 'error' ||
            autosaveRetryPending ||
            pending ||
            !access.canWrite() ||
            !serverDraftReady ||
            recoveryPromptOpen.current ||
            autosaveConflict.current ||
            authoringPaused.current
        )
            return
        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        autosaveTimer.current = undefined
        setAutosaveRetryPending(true)
        void enqueueAutosave(hasCurrentComposerContent ? composerDraftContent() : null).finally(
            () => setAutosaveRetryPending(false)
        )
        setAutosaveState('saving')
    }

    async function reviewConflict() {
        recoveryPromptOpen.current = true
        if (recovery === null)
            setRecovery({
                ...composerDraftContent(),
                version: 1,
                savedAt: Date.now(),
                conflict: true,
            })
        setConflictBusy(true)
        setConflictVersionKnown(false)
        setAutosaveError(null)
        try {
            const { draft } = await api.getPublicationComposerDraft(project.id, userId)
            serverDraftRef.current = draft
            setServerDraft(draft)
            setConflictVersionKnown(true)
        } catch (caught) {
            pauseForSessionError(caught)
            setAutosaveError(formatApiError(caught))
        } finally {
            setConflictBusy(false)
        }
    }

    async function resolveConflict(useLocal: boolean) {
        if (!access.canWrite() || recovery === null || conflictBusy || !conflictVersionKnown) return
        setConflictBusy(true)
        setAutosaveError(null)
        try {
            let chosen: PublicationComposerDraftContent
            if (useLocal) {
                chosen = recoveredComposerContent(recovery)
                const { draft } = await api.savePublicationComposerDraft(
                    project.id,
                    serverDraftRef.current?.revision ?? 0,
                    chosen,
                    serverDraftRef.current?.id,
                    userId
                )
                serverDraftRef.current = draft
                setServerDraft(draft)
            } else {
                const { draft } = await api.getPublicationComposerDraft(project.id, userId)
                serverDraftRef.current = draft
                setServerDraft(draft)
                chosen = draft?.content ?? {
                    ...recoveredComposerContent(recovery),
                    postTitle: '',
                    postContent: '',
                    sourceMedia: [],
                    publicationTagIds: [],
                    defaultDeliveryMode: 'manual',
                    defaultScheduledAt: '',
                    publicationTargets: [
                        createPublicationTarget(activeChannels[0]?.id ?? '', project.timeZone),
                    ],
                    customizedTargetIds: [],
                    customizedContentTargetIds: [],
                    activeContentScopeId: publicationSharedTabId,
                    activePublicationTabId: publicationSharedTabId,
                }
            }
            applyComposerContent(chosen)
            autosaveConflict.current = false
            recoveryPromptOpen.current = false
            setRecovery(null)
            setAutosaveState('saved')
        } catch (caught) {
            setAutosaveError(formatApiError(caught))
            if (pauseForSessionError(caught)) {
                return
            }
            // A refused replacement must show the latest version before another choice.
            try {
                const { draft } = await api.getPublicationComposerDraft(project.id, userId)
                serverDraftRef.current = draft
                setServerDraft(draft)
                setConflictVersionKnown(true)
            } catch (refreshError) {
                pauseForSessionError(refreshError)
                setConflictVersionKnown(false)
            }
        } finally {
            setConflictBusy(false)
        }
    }

    const autosaveStatus =
        autosaveState === 'saving'
            ? m.publication_new_autosave_saving()
            : autosaveState === 'saved'
              ? m.publication_new_autosave_saved()
              : null

    useEffect(() => {
        let cancelled = false
        setServerDraftReady(false)
        setServerDraftLoadFailed(false)

        void api
            .getPublicationComposerDraft(project.id, userId)
            .then(({ draft }) => {
                if (cancelled) return
                serverDraftRef.current = draft
                setServerDraft(draft)
                setServerDraftReady(true)

                const localRecovery = readPublicationRecovery(project.id, userId)
                if (
                    localRecovery !== null &&
                    !(
                        draft !== null &&
                        composerContentsEqual(
                            recoveredComposerContent(localRecovery),
                            draft.content
                        )
                    ) &&
                    (localRecovery.conflict ||
                        (localRecovery.serverDraftRevision !== undefined &&
                            (localRecovery.serverDraftRevision !== (draft?.revision ?? 0) ||
                                (localRecovery.serverDraftId !== undefined &&
                                    localRecovery.serverDraftId !== draft?.id))))
                ) {
                    autosaveConflict.current = true
                    setConflictVersionKnown(true)
                    setAutosaveState('conflict')
                    recoveryPromptOpen.current = true
                    setRecovery(localRecovery)
                    return
                }
                if (currentComposerHasContent.current || draft === null) return

                const serverRecovery: PublicationRecoveryState = {
                    ...draft.content,
                    savedAt: draft.updatedAt,
                    version: 1,
                }
                if (localRecovery === null || draft.updatedAt >= localRecovery.savedAt) {
                    recoveryPromptOpen.current = true
                    setRecovery(serverRecovery)
                }
            })
            .catch(caught => {
                if (cancelled) return
                if (pauseForSessionError(caught)) {
                    return
                }
                setServerDraftLoadFailed(true)
            })

        return () => {
            cancelled = true
        }
    }, [project.id, serverDraftLoadAttempt, userId])

    useEffect(() => {
        if (
            !access.canWrite() ||
            !serverDraftReady ||
            recoveryPromptOpen.current ||
            autosaveConflict.current
        )
            return

        if (!hasCurrentComposerContent) {
            if (serverDraftRef.current === null) return
            enqueueAutosave(null)
            return
        }

        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        const content = composerDraftContent()
        autosaveTimer.current = setTimeout(() => {
            autosaveTimer.current = undefined
            enqueueAutosave(content)
        }, 900)

        return () => {
            if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
            autosaveTimer.current = undefined
        }
    }, [
        access.status,
        activeContentScopeId,
        activePublicationTabId,
        customizedContentTargetIds,
        customizedTargetIds,
        defaultDeliveryMode,
        defaultScheduledAt,
        hasCurrentComposerContent,
        postContent,
        postTitle,
        project.id,
        publicationTagIds,
        publicationTargets,
        recovery,
        serverDraftReady,
        sourceMedia,
    ])

    useEffect(() => {
        // Closing a refused recovery choice must not replace its snapshot with the empty form.
        if (recoveryPromptOpen.current || authoringPaused.current) return
        writePublicationRecovery(project.id, userId, {
            serverDraftId: serverDraftReady
                ? serverDraftRef.current?.id
                : localRecoveryAtMount?.serverDraftId,
            serverDraftRevision: serverDraftReady
                ? (serverDraftRef.current?.revision ?? 0)
                : localRecoveryAtMount?.serverDraftRevision,
            conflict:
                autosaveConflict.current || (!serverDraftReady && localRecoveryAtMount?.conflict),
            activeContentScopeId,
            activePublicationTabId,
            customizedContentTargetIds,
            customizedTargetIds,
            defaultDeliveryMode,
            defaultScheduledAt,
            postContent,
            postTitle,
            publicationTagIds,
            publicationTargets: compositionDraftTargets(),
            sourceMedia,
        })
    }, [
        activeContentScopeId,
        activePublicationTabId,
        customizedContentTargetIds,
        customizedTargetIds,
        defaultDeliveryMode,
        defaultScheduledAt,
        postContent,
        postTitle,
        project.id,
        publicationTagIds,
        publicationTargets,
        sourceMedia,
        userId,
        serverDraft,
        serverDraftReady,
        localRecoveryAtMount,
        autosaveState,
    ])

    useEffect(() => {
        const firstTarget = publicationTargets[0]
        const firstActiveChannel = activeChannels[0]
        if (
            publicationTargets.length !== 1 ||
            firstTarget === undefined ||
            firstTarget.channelId !== '' ||
            firstActiveChannel === undefined
        ) {
            return
        }

        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                target.id === firstTarget.id
                    ? { ...target, channelId: firstActiveChannel.id }
                    : target
            )
        )
    }, [activeChannels, onPublicationTargetsChange, publicationTargets])

    useEffect(() => {
        if (
            calendarDate === undefined ||
            appliedCalendarSlot.current === `${calendarDate}:${calendarTime ?? ''}` ||
            publicationTargets.length === 0
        ) {
            return
        }

        const scheduledAt = calendarDateTimeLocal(calendarDate, calendarTime)
        if (scheduledAt === undefined) return

        appliedCalendarSlot.current = `${calendarDate}:${calendarTime ?? ''}`
        handleDefaultScheduledAtChange(scheduledAt)
    }, [
        calendarDate,
        calendarTime,
        customizedTargetIds,
        onPublicationTargetsChange,
        publicationTargets.length,
    ])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.isComposing) return
            const hasMod = event.metaKey || event.ctrlKey
            if (hasMod && event.key === 'Enter') {
                const form = formRef.current
                if (!form) return
                const scheduleBtn = form.querySelector<HTMLButtonElement>(
                    'button[name="publication-action"][value="schedule"]'
                )
                const draftBtn = form.querySelector<HTMLButtonElement>(
                    'button[name="publication-action"][value="draft"]'
                )
                const targetBtn =
                    scheduleBtn && !scheduleBtn.disabled
                        ? scheduleBtn
                        : draftBtn && !draftBtn.disabled
                          ? draftBtn
                          : null
                if (targetBtn) {
                    event.preventDefault()
                    targetBtn.click()
                }
            } else if (hasMod && event.shiftKey && event.key.toLowerCase() === 'm') {
                const form = formRef.current
                if (!form) return
                const mediaBtn = form.querySelector<HTMLButtonElement>(
                    'button[data-media-picker-trigger="true"]'
                )
                if (mediaBtn && !mediaBtn.disabled) {
                    event.preventDefault()
                    mediaBtn.click()
                }
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    useEffect(() => {
        if (
            recovery === null ||
            autosaveState === 'conflict' ||
            !serverDraftReady ||
            serverDraftLoadFailed ||
            discardingRecovery
        )
            return
        if (blankComposerContent.current === null) {
            blankComposerContent.current = composerDraftContent()
        }
        restoreRecovery()
        setRestoredNotice(true)
        // restoreRecovery reads the same state this effect depends on.
    }, [recovery, autosaveState, serverDraftReady, serverDraftLoadFailed, discardingRecovery])

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            {/* ADR-103 §2: "New post" is a sidebar destination, so it has no return control. */}
            <div className="mx-auto mb-6 max-w-6xl">
                <DashboardPageHeader title={m.publication_new_title()} />
            </div>

            {recovery !== null && autosaveState === 'conflict' ? (
                <ComposerDraftConflict
                    projectId={project.id}
                    tagCatalog={tagCatalogQuery}
                    local={recoveredComposerContent(recovery)}
                    saved={serverDraft?.content ?? null}
                    channels={channels}
                    timeZone={project.timeZone}
                    busy={conflictBusy}
                    savedKnown={conflictVersionKnown}
                    error={autosaveError}
                    onRefresh={() => void reviewConflict()}
                    onUseSaved={() => void resolveConflict(false)}
                    onSaveLocal={() => void resolveConflict(true)}
                    onClose={() => {
                        applyComposerContent(recoveredComposerContent(recovery))
                        recoveryPromptOpen.current = false
                        setRecovery(null)
                    }}
                />
            ) : null}
            {recovery !== null && autosaveState !== 'conflict' && serverDraftLoadFailed ? (
                <div className="mx-auto mb-4 max-w-6xl" data-new-publication-recovery="true">
                    <QueryErrorState
                        title={m.publication_new_draft_read_failed()}
                        description={m.publication_new_draft_read_retry()}
                        onRetry={() => setServerDraftLoadAttempt(attempt => attempt + 1)}
                    />
                </div>
            ) : null}
            {restoredNotice ? (
                <div
                    className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
                    data-new-publication-restored="true"
                    role="status">
                    <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
                        {m.publication_new_recovery_restored()}
                    </span>
                    <span className="flex items-center gap-1">
                        <Button
                            disabled={discardingRecovery}
                            onClick={() => void startOver()}
                            size="sm"
                            type="button"
                            variant="ghost">
                            {discardingRecovery
                                ? m.common_loading()
                                : m.publication_new_recovery_start_over()}
                        </Button>
                        {/* Text actions only: no lone icon beside a text button (pattern 8). */}
                        <Button
                            onClick={() => setRestoredNotice(false)}
                            size="sm"
                            type="button"
                            variant="ghost">
                            {m.common_dismiss()}
                        </Button>
                    </span>
                    {error || autosaveError ? (
                        <p role="alert" className="w-full break-words text-sm text-state-failed">
                            {error ?? autosaveError}
                        </p>
                    ) : null}
                </div>
            ) : null}
            {autosaveState === 'account' || autosaveState === 'session' ? (
                <Alert className="mb-6" role="alert">
                    <AlertTitle>
                        {autosaveState === 'session'
                            ? m.composer_session_ended_title()
                            : m.composer_account_changed_title()}
                    </AlertTitle>
                    <AlertDescription>
                        {autosaveState === 'session'
                            ? m.composer_session_ended_notice()
                            : m.composer_account_changed_notice()}
                    </AlertDescription>
                    <Button
                        className="mt-3"
                        onClick={() => {
                            if (autosaveState === 'session')
                                void navigate({
                                    to: '/login',
                                    search: {
                                        continue: window.location.pathname + window.location.search,
                                    },
                                })
                            else window.location.reload()
                        }}
                        type="button"
                        variant="outline">
                        {autosaveState === 'session'
                            ? m.composer_session_ended_sign_in()
                            : m.composer_account_changed_reload()}
                    </Button>
                </Alert>
            ) : null}
            {recovery === null && autosaveState === 'conflict' ? (
                <Alert className="mb-6">
                    <AlertTitle>{m.composer_conflict_title()}</AlertTitle>
                    <AlertDescription>{m.composer_conflict_notice()}</AlertDescription>
                    <Button
                        className="mt-3"
                        onClick={() => void reviewConflict()}
                        type="button"
                        variant="outline">
                        {m.composer_conflict_review()}
                    </Button>
                </Alert>
            ) : null}
            {recovery === null &&
            !serverDraftReady &&
            autosaveState !== 'account' &&
            autosaveState !== 'session' ? (
                serverDraftLoadFailed ? (
                    <QueryErrorState
                        className="mb-6"
                        title={m.publication_new_draft_read_failed()}
                        description={m.publication_new_draft_read_retry()}
                        onRetry={() => setServerDraftLoadAttempt(attempt => attempt + 1)}
                    />
                ) : (
                    <p role="status" className="mb-6 text-sm text-muted-foreground">
                        {m.common_loading()}
                    </p>
                )
            ) : null}
            {error &&
            recovery === null &&
            autosaveState !== 'session' &&
            autosaveState !== 'account' ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>{m.publication_new_action_failed()}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <form
                ref={formRef}
                aria-busy={
                    !serverDraftReady && autosaveState !== 'account' && autosaveState !== 'session'
                }
                className={cn(recovery !== null && 'opacity-55')}
                data-new-publication-form="true"
                inert={
                    !serverDraftReady ||
                    recovery !== null ||
                    autosaveState === 'account' ||
                    autosaveState === 'session'
                }
                onSubmit={event => void handleSubmit(event)}>
                <section data-new-publication-workspace="true">
                    <PostComposer
                        composition={composition}
                        project={project}
                        activeChannels={activeChannels}
                        connections={connections}
                        pending={pending}
                        disabled={recovery !== null}
                        configuredEditor={configuredEditor}
                        createChannel={
                            projectRole === 'owner' || projectRole === 'editor' ? (
                                <ChannelCreationDialog
                                    projectId={project.id}
                                    compact={activeChannels.length > 0}
                                    channels={channels}
                                    onCreate={onCreateChannel}
                                    pending={pending}
                                />
                            ) : undefined
                        }
                        pickerTags={pickerTags}
                        onCreateProjectTag={canCreateProjectTag ? onCreateProjectTag : undefined}
                        mediaDisabled={pending || access.status !== 'confirmed'}
                        mediaReadOnly={!access.canWrite()}
                        onMediaPreparationChange={reportMediaPreparation}
                        onError={pauseForSessionError}
                        footer={
                            <div className="flex w-full flex-wrap items-center justify-between gap-3">
                                {(autosaveState === 'error' ||
                                    (autosaveState === 'saving' && autosaveRetryPending)) &&
                                recovery === null ? (
                                    <div
                                        role="alert"
                                        data-composer-autosave-error="true"
                                        className="w-full rounded-md bg-state-failed/10 p-3 text-sm text-state-failed">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <p className="min-w-0 flex-1">
                                                {m.publication_new_autosave_unavailable()}
                                            </p>
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={
                                                                pending || autosaveRetryPending
                                                            }
                                                            focusableWhenDisabled
                                                            aria-describedby={
                                                                autosaveRetryPending
                                                                    ? 'new-publication-autosave-status'
                                                                    : undefined
                                                            }

                                                            onClick={retryAutosave}>
                                                            {m.common_retry()}
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    {autosaveRetryPending
                                                        ? m.publication_new_autosave_saving()
                                                        : pending
                                                          ? m.common_loading()
                                                          : undefined}
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        {autosaveError ? (
                                            <p className="mt-1 break-words text-xs">
                                                {autosaveError}
                                            </p>
                                        ) : null}
                                    </div>
                                ) : null}
                                {mediaPreparationPending ? (
                                    <p
                                        id="new-publication-media-preparation"
                                        role="status"
                                        className="w-full text-sm text-muted-foreground">
                                        {m.publication_new_media_preparation_pending()}
                                    </p>
                                ) : null}
                                <span
                                    id="new-publication-autosave-status"
                                    aria-live="polite"
                                    className="min-h-4 text-xs text-muted-foreground">
                                    {autosaveStatus}
                                </span>
                                {selectedPublicationCount > 0 ? (
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button
                                            name="publication-action"
                                            type="submit"
                                            value="draft"
                                            variant="ghost"
                                            aria-describedby={
                                                mediaPreparationPending
                                                    ? 'new-publication-media-preparation'
                                                    : undefined
                                            }
                                            disabled={
                                                mediaPreparationPending ||
                                                pending ||
                                                autosaveState === 'conflict' ||
                                                autosaveState === 'account' ||
                                                autosaveState === 'session'
                                            }>
                                            <FileTextIcon aria-hidden="true" />
                                            {m.publication_new_create_draft()}
                                        </Button>
                                        <Button
                                            name="publication-action"
                                            type="submit"
                                            value="schedule"
                                            aria-describedby={
                                                mediaPreparationPending
                                                    ? 'new-publication-media-preparation'
                                                    : undefined
                                            }
                                            disabled={
                                                mediaPreparationPending ||
                                                pending ||
                                                autosaveState === 'conflict' ||
                                                autosaveState === 'account' ||
                                                autosaveState === 'session'
                                            }>
                                            <CalendarAddIcon aria-hidden="true" />
                                            <span>
                                                {m.publication_new_schedule_count({
                                                    count: selectedPublicationCount,
                                                })}
                                            </span>
                                            <Kbd className="ml-1 hidden font-mono text-[10px] opacity-75 sm:inline-flex">
                                                {getModifierKey()}↵
                                            </Kbd>
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        }
                    />
                </section>
            </form>
        </main>
    )
}

function resolveRecoveredContentScope(recovery: PublicationComposerDraftContent) {
    if (recovery.activeContentScopeId === publicationSharedTabId) return publicationSharedTabId
    if (
        recovery.activeContentScopeId !== undefined &&
        recovery.publicationTargets.some(target => target.id === recovery.activeContentScopeId)
    ) {
        return recovery.activeContentScopeId
    }

    return recovery.customizedContentTargetIds.includes(recovery.activePublicationTabId)
        ? recovery.activePublicationTabId
        : publicationSharedTabId
}
