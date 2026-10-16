import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Button, buttonVariants } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Input } from '@postbot/ui/components/input'
import { cn } from '@postbot/ui/lib/utils'
import { parseXPostText } from '@postbot/x/text'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { CalendarAddIcon } from '@solar-icons/react/linear/calendar-add'
import { CalendarMinimalisticIcon } from '@solar-icons/react/linear/calendar-minimalistic'
import { FileTextIcon } from '@solar-icons/react/linear/file-text'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { ChannelCreationDialog } from '@/components/channel-creation-dialog'
import { DashboardFormField } from '@/components/dashboard-form-field'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { PublicationComposer } from '@/components/publication-composer'
import { PublicationDraftPreview } from '@/components/publication-draft-preview'
import { PublicationTagPicker } from '@/components/publication-tag-picker'
import {
    PublicationChannelSettings,
    PublicationChannelTabs,
    publicationSharedTabId,
} from '@/components/publication-target-list'
import { PublicationTextCount } from '@/components/publication-text-count'
import { PublicationTextEditor } from '@/components/publication-text-editor'
import { XWeightedTextCount } from '@/components/x-weighted-text-count'
import { api, formatApiError, type MediaReference, type PublicationComposerDraft } from '@/lib/api'
import { countComposerText, getComposerTextFields } from '@/lib/composer-text-constraints'
import { type PublicationCreationMode, useProjectDashboard } from '@/lib/dashboard-context'
import { formatCivilSchedule } from '@/lib/date-time'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { getNativeEditorProfile, getNativePlatform } from '@/lib/native-presentation'
import { calendarDateTimeLocal, type DeliveryMode } from '@/lib/publication-authoring'
import {
    clearPublicationRecovery,
    hasRecoverablePublicationContent,
    readPublicationRecovery,
    writePublicationRecovery,
    type PublicationComposerDraftContent,
    type PublicationRecoveryState,
} from '@/lib/publication-recovery'
import * as m from '@/paraglide/messages.js'

import { ActionTooltip } from './action-tooltip'

const ConfiguredPublicationEditor = lazy(() =>
    import('./configured-publication-editor').then(module => ({
        default: module.ConfiguredPublicationEditor,
    }))
)

export function NewPublicationPage({
    calendarDate,
    calendarTime,
    configuredEditor = true,
}: {
    readonly calendarDate?: string
    readonly calendarTime?: string
    readonly configuredEditor?: boolean
}) {
    const { locale } = useLanguage()
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/publications/new' })
    const {
        activeChannels,
        channels,
        connections,
        error,
        onCreatePost,
        onCreateChannel,
        onPostContentChange,
        onPostTitleChange,
        onPublicationTargetsChange,
        onSourceMediaChange,
        pending,
        postContent,
        postTitle,
        project,
        projectRole,
        projectTags,
        publicationTagIds,
        publicationTargets,
        sourceMedia,
        onPublicationTagIdsChange,
    } = useProjectDashboard()
    const hasCurrentComposerContent = hasRecoverablePublicationContent({
        postTitle,
        postContent,
        publicationTargets,
        sourceMedia,
    })
    const [mediaToolbar, setMediaToolbar] = useState<HTMLDivElement | null>(null)
    const [localRecoveryAtMount] = useState(() => readPublicationRecovery(project.id))
    const currentRecovery = hasCurrentComposerContent ? localRecoveryAtMount : null
    const appliedCalendarSlot = useRef<string | undefined>(undefined)
    const currentTargetIds = new Set(publicationTargets.map(target => target.id))
    const initialCustomizedContentTargetIds = new Set(
        currentRecovery === null
            ? publicationTargets
                  .filter(target => target.content.trim() !== '')
                  .map(target => target.id)
            : currentRecovery.customizedContentTargetIds.filter(id => currentTargetIds.has(id))
    )
    const initialContentTargetId = publicationTargets.find(
        target => target.content.trim() !== ''
    )?.id
    const recoveredContentScopeId =
        currentRecovery === null ? undefined : resolveRecoveredContentScope(currentRecovery)
    const recoveredContentTargetExists =
        recoveredContentScopeId === publicationSharedTabId ||
        (recoveredContentScopeId !== undefined && currentTargetIds.has(recoveredContentScopeId))
    const initialActiveContentScopeId =
        recoveredContentTargetExists && recoveredContentScopeId !== undefined
            ? recoveredContentScopeId
            : (initialContentTargetId ?? publicationSharedTabId)
    const [defaultDeliveryMode, setDefaultDeliveryMode] = useState<DeliveryMode>(
        () => publicationTargets[0]?.deliveryMode ?? 'manual'
    )
    const [defaultScheduledAt, setDefaultScheduledAt] = useState(
        () => publicationTargets[0]?.scheduledAt ?? ''
    )
    const [customizedTargetIds, setCustomizedTargetIds] = useState<Set<string>>(() => new Set())
    const [customizedContentTargetIds, setCustomizedContentTargetIds] = useState<Set<string>>(
        () => initialCustomizedContentTargetIds
    )
    const [activePublicationTabId, setActivePublicationTabId] = useState(
        () => initialActiveContentScopeId
    )
    const [activeContentScopeId, setActiveContentScopeId] = useState(
        () => initialActiveContentScopeId
    )
    const [availableMedia, setAvailableMedia] = useState<MediaReference[]>([])
    const [recovery, setRecovery] = useState<PublicationRecoveryState | null>(() =>
        hasCurrentComposerContent ? null : localRecoveryAtMount
    )
    const [serverDraft, setServerDraft] = useState<PublicationComposerDraft | null>(null)
    const [serverDraftReady, setServerDraftReady] = useState(false)
    const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
        'idle'
    )
    const [autosaveError, setAutosaveError] = useState<string | null>(null)
    const [scheduleDetailsOpen, setScheduleDetailsOpen] = useState(() =>
        publicationTargets.some(
            target =>
                target.deliveryMode === 'automatic' &&
                connections.find(connection => connection.channelId === target.channelId)?.state !==
                    'active'
        )
    )
    const recoveryPromptOpen = useRef(recovery !== null)
    const currentComposerHasContent = useRef(hasCurrentComposerContent)
    const serverDraftRef = useRef<PublicationComposerDraft | null>(null)
    const autosaveQueue = useRef(Promise.resolve())
    const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const previousTargetIds = useRef(new Set(publicationTargets.map(target => target.id)))
    const activeTarget =
        activePublicationTabId === publicationSharedTabId
            ? undefined
            : publicationTargets.find(target => target.id === activePublicationTabId)
    const activeContentTarget =
        activeContentScopeId === publicationSharedTabId
            ? undefined
            : publicationTargets.find(target => target.id === activeContentScopeId)
    const selectedPublicationCount = publicationTargets.filter(
        target => target.channelId !== ''
    ).length
    const resolvedActiveContentScopeId = activeContentTarget?.id ?? publicationSharedTabId
    const [visitedEditorScopes, setVisitedEditorScopes] = useState<Set<string>>(
        () => new Set([publicationSharedTabId])
    )
    useEffect(() => {
        if (!configuredEditor) return
        setVisitedEditorScopes(current =>
            current.has(resolvedActiveContentScopeId)
                ? current
                : new Set(current).add(resolvedActiveContentScopeId)
        )
    }, [configuredEditor, resolvedActiveContentScopeId])
    const renderedEditorScopes = new Set([...visitedEditorScopes, resolvedActiveContentScopeId])
    const activePreviewTarget = activeContentTarget ?? activeTarget ?? publicationTargets[0]
    const activePreviewChannel = activeChannels.find(
        channel => channel.id === activePreviewTarget?.channelId
    )
    const activeContentTargetUsesSharedContent =
        activeContentTarget === undefined || !customizedContentTargetIds.has(activeContentTarget.id)
    const profileQuery = useQuery({
        queryKey: [
            'project',
            project.id,
            'composer-channel-profile',
            activePreviewChannel?.id,
            activePreviewChannel?.profileVersionId,
        ],
        queryFn: () => api.getChannelProfileState(project.id, activePreviewChannel!.id),
        enabled: activePreviewChannel !== undefined,
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const textFields = useMemo(
        () =>
            !profileQuery.isError && profileQuery.data
                ? getComposerTextFields(profileQuery.data.active.profile)
                : null,
        [profileQuery.data, profileQuery.isError]
    )
    const showHeadline = textFields?.headline !== undefined && textFields?.headline !== null
    const headlineCount = textFields?.headline
        ? countComposerText(postTitle, textFields.headline)
        : null
    const usesXTextRules = getNativePlatform(activePreviewChannel?.execution) === 'x'
    const activeText =
        activeContentTarget !== undefined && !activeContentTargetUsesSharedContent
            ? activeContentTarget.content
            : postContent
    const activeTextValidation = usesXTextRules ? parseXPostText(activeText) : null
    const bodyCount = textFields?.body ? countComposerText(activeText, textFields.body) : null
    const activeTextInvalid =
        bodyCount?.invalid === true ||
        (activeTextValidation !== null &&
            activeText.trim().length > 0 &&
            !activeTextValidation.valid)
    const previewMedia = sourceMedia
        .map(selection => availableMedia.find(asset => asset.asset.id === selection.assetId))
        .filter((asset): asset is MediaReference => asset !== undefined)
    const recoveryExcerpt = recovery
        ? (
              recovery.postTitle.trim() ||
              recovery.postContent.trim() ||
              recovery.publicationTargets
                  .find(target => target.content.trim() !== '')
                  ?.content.trim() ||
              ''
          ).replace(/\s+/g, ' ')
        : ''

    currentComposerHasContent.current = hasCurrentComposerContent
    serverDraftRef.current = serverDraft

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        await autosaveQueue.current.catch(() => undefined)

        const submitter = (event.nativeEvent as SubmitEvent).submitter
        const mode: PublicationCreationMode =
            submitter instanceof HTMLButtonElement && submitter.value === 'draft'
                ? 'draft'
                : 'schedule'
        const publications = await onCreatePost(event, mode)
        if (publications !== null) {
            clearPublicationRecovery(project.id)
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
        if (recovery === null) return

        onPostTitleChange(recovery.postTitle)
        onPostContentChange(recovery.postContent)
        onSourceMediaChange(recovery.sourceMedia)
        onPublicationTargetsChange(recovery.publicationTargets)
        onPublicationTagIdsChange(recovery.publicationTagIds)
        setDefaultDeliveryMode(recovery.defaultDeliveryMode)
        setDefaultScheduledAt(recovery.defaultScheduledAt)
        setCustomizedTargetIds(new Set(recovery.customizedTargetIds))
        setCustomizedContentTargetIds(new Set(recovery.customizedContentTargetIds))
        const restoredScope = resolveRecoveredContentScope(recovery)
        setActivePublicationTabId(restoredScope)
        setActiveContentScopeId(restoredScope)
        clearPublicationRecovery(project.id)
        recoveryPromptOpen.current = false
        setRecovery(null)
    }

    async function discardRecovery() {
        clearPublicationRecovery(project.id)
        await discardServerDraft()
        recoveryPromptOpen.current = false
        setRecovery(null)
    }

    async function discardServerDraft() {
        if (serverDraftRef.current === null) return

        try {
            await api.deletePublicationComposerDraft(project.id)
            serverDraftRef.current = null
            setServerDraft(null)
            setAutosaveState('idle')
            setAutosaveError(null)
        } catch (caughtError) {
            setAutosaveState('error')
            setAutosaveError(formatApiError(caughtError))
        }
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
            publicationTargets: publicationTargets.map(target => ({ ...target })),
            sourceMedia: sourceMedia.map(selection => ({ ...selection })),
        }
    }

    const autosaveStatus =
        autosaveState === 'saving'
            ? m.publication_new_autosave_saving()
            : autosaveState === 'saved'
              ? m.publication_new_autosave_saved()
              : autosaveState === 'error'
                ? m.publication_new_autosave_unavailable()
                : null

    useEffect(() => {
        let cancelled = false

        void api
            .getPublicationComposerDraft(project.id)
            .then(({ draft }) => {
                if (cancelled) return
                serverDraftRef.current = draft
                setServerDraft(draft)
                setServerDraftReady(true)

                if (currentComposerHasContent.current || draft === null) return

                const localRecovery = readPublicationRecovery(project.id)
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
            .catch(caughtError => {
                if (cancelled) return
                setServerDraftReady(true)
                setAutosaveState('error')
                setAutosaveError(formatApiError(caughtError))
            })

        return () => {
            cancelled = true
        }
    }, [project.id])

    useEffect(() => {
        if (!serverDraftReady || recoveryPromptOpen.current) return

        if (!hasCurrentComposerContent) {
            if (serverDraftRef.current === null) return
            autosaveQueue.current = autosaveQueue.current
                .catch(() => undefined)
                .then(() => discardServerDraft())
            return
        }

        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        const content = composerDraftContent()
        autosaveTimer.current = setTimeout(() => {
            autosaveQueue.current = autosaveQueue.current
                .catch(() => undefined)
                .then(async () => {
                    setAutosaveState('saving')
                    setAutosaveError(null)
                    try {
                        const response = await api.savePublicationComposerDraft(
                            project.id,
                            serverDraftRef.current?.revision ?? 0,
                            content
                        )
                        serverDraftRef.current = response.draft
                        setServerDraft(response.draft)
                        setAutosaveState('saved')
                    } catch (caughtError) {
                        setAutosaveState('error')
                        setAutosaveError(formatApiError(caughtError))
                    }
                })
        }, 900)

        return () => {
            if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
            autosaveTimer.current = undefined
        }
    }, [
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
        if (recoveryPromptOpen.current) return
        writePublicationRecovery(project.id, {
            activeContentScopeId,
            activePublicationTabId,
            customizedContentTargetIds,
            customizedTargetIds,
            defaultDeliveryMode,
            defaultScheduledAt,
            postContent,
            postTitle,
            publicationTagIds,
            publicationTargets,
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
    ])

    useEffect(() => {
        const nextTargetIds = new Set(publicationTargets.map(target => target.id))
        const preservedTarget = [...previousTargetIds.current].some(id => nextTargetIds.has(id))
        const firstTarget = publicationTargets[0]

        if (!preservedTarget && firstTarget !== undefined) {
            setDefaultDeliveryMode(firstTarget.deliveryMode)
            setDefaultScheduledAt(firstTarget.scheduledAt)
            setCustomizedTargetIds(new Set())
        }
        previousTargetIds.current = nextTargetIds
    }, [publicationTargets])

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
        if (activePublicationTabId === publicationSharedTabId) return
        if (
            publicationTargets.some(
                target => target.id === activePublicationTabId && target.channelId !== ''
            )
        ) {
            return
        }
        setActivePublicationTabId(publicationSharedTabId)
    }, [activePublicationTabId, publicationTargets])

    useEffect(() => {
        if (activeContentScopeId === publicationSharedTabId) return
        if (
            publicationTargets.some(
                target => target.id === activeContentScopeId && target.channelId !== ''
            )
        ) {
            return
        }
        setActiveContentScopeId(publicationSharedTabId)
    }, [activeContentScopeId, publicationTargets])

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
        setDefaultScheduledAt(scheduledAt)
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                customizedTargetIds.has(target.id) ? target : { ...target, scheduledAt }
            )
        )
    }, [
        calendarDate,
        calendarTime,
        customizedTargetIds,
        onPublicationTargetsChange,
        publicationTargets.length,
    ])

    function handleDefaultDeliveryModeChange(deliveryMode: DeliveryMode) {
        setDefaultDeliveryMode(deliveryMode)
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                customizedTargetIds.has(target.id) ? target : { ...target, deliveryMode }
            )
        )
    }

    function handleDefaultScheduledAtChange(scheduledAt: string) {
        setDefaultScheduledAt(scheduledAt)
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                customizedTargetIds.has(target.id) ? target : { ...target, scheduledAt }
            )
        )
    }

    function handleTargetCustomizationChange(targetId: string, customized: boolean) {
        setCustomizedTargetIds(current => {
            const next = new Set(current)
            if (customized) next.add(targetId)
            else next.delete(targetId)
            return next
        })

        if (!customized) {
            onPublicationTargetsChange(currentTargets =>
                currentTargets.map(target =>
                    target.id === targetId
                        ? {
                              ...target,
                              deliveryMode: defaultDeliveryMode,
                              scheduledAt: defaultScheduledAt,
                          }
                        : target
                )
            )
        }
    }

    function updateTargetContent(targetId: string, content: string) {
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target => (target.id === targetId ? { ...target, content } : target))
        )
    }

    function useSharedTargetContent(targetId: string) {
        setCustomizedContentTargetIds(current => {
            const next = new Set(current)
            next.delete(targetId)
            return next
        })
        updateTargetContent(targetId, '')
    }

    const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)

    function requestTargetRemoval(targetId: string) {
        const target = publicationTargets.find(item => item.id === targetId)
        if (target === undefined) return
        if (
            target.content !== '' ||
            customizedContentTargetIds.has(targetId) ||
            customizedTargetIds.has(targetId)
        ) {
            setPendingRemovalId(targetId)
            return
        }
        removeTarget(targetId)
    }

    function removeTarget(targetId: string) {
        setCustomizedContentTargetIds(current => {
            const next = new Set(current)
            next.delete(targetId)
            return next
        })
        onPublicationTargetsChange(currentTargets =>
            currentTargets.filter(target => target.id !== targetId)
        )
        if (activeContentScopeId === targetId) {
            setActiveContentScopeId(publicationSharedTabId)
        }
        if (activePublicationTabId === targetId) {
            setActivePublicationTabId(publicationSharedTabId)
        }
    }

    function selectContentScope(scopeId: string) {
        if (scopeId === publicationSharedTabId) {
            setActiveContentScopeId(publicationSharedTabId)
            setActivePublicationTabId(publicationSharedTabId)
            return
        }

        const target = publicationTargets.find(item => item.id === scopeId)
        if (target === undefined) return
        setActiveContentScopeId(target.id)
        setActivePublicationTabId(target.id)
    }

    function editScopeText(scopeId: string, content: string) {
        if (scopeId === publicationSharedTabId) {
            onPostContentChange(content)
            return
        }
        setCustomizedContentTargetIds(current => new Set(current).add(scopeId))
        updateTargetContent(scopeId, content)
    }

    function editActiveText(content: string) {
        editScopeText(resolvedActiveContentScopeId, content)
    }

    return (
        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <header className="mx-auto mb-6 grid max-w-6xl min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
                <Link
                    aria-label={m.publication_new_back_overview()}
                    className={buttonVariants({
                        variant: 'ghost',
                        size: 'icon',
                        className:
                            'justify-self-start text-muted-foreground hover:text-foreground sm:w-auto sm:gap-1.5 sm:px-2.5',
                    })}
                    params={{ projectId: project.id }}
                    to="/dashboard/projects/$projectId/overview">
                    <AltArrowLeftIcon aria-hidden="true" />
                    <span className="hidden sm:inline">{m.publication_new_back_overview()}</span>
                </Link>
                <h1 className="min-w-0 truncate text-center font-heading text-xl font-semibold leading-tight sm:text-2xl xl:text-3xl">
                    {m.publication_new_title()}
                </h1>
            </header>

            {recovery !== null ? (
                <Dialog open onOpenChange={() => {}}>
                    <DialogContent
                        showCloseButton={false}
                        data-new-publication-recovery="true"
                        className="sm:max-w-md">
                        <div className="flex items-start gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                <FileTextIcon aria-hidden="true" className="size-5" />
                            </span>
                            <div className="min-w-0 space-y-1.5">
                                <DialogTitle>{m.publication_new_recovery_title()}</DialogTitle>
                                <DialogDescription>
                                    {m.publication_new_recovery_choice()}
                                </DialogDescription>
                            </div>
                        </div>
                        {recoveryExcerpt ? (
                            <p className="line-clamp-3 break-words rounded-md bg-surface-inset/50 p-3 text-sm text-muted-foreground">
                                {recoveryExcerpt}
                            </p>
                        ) : null}
                        {error ? (
                            <p role="alert" className="break-words text-sm text-state-failed">
                                {error}
                            </p>
                        ) : null}
                        <DialogFooter>
                            <Button
                                disabled={!serverDraftReady}
                                onClick={() => void discardRecovery()}
                                type="button"
                                variant="secondary">
                                {m.publication_new_recovery_discard()}
                            </Button>
                            <Button
                                disabled={!serverDraftReady}
                                onClick={restoreRecovery}
                                type="button">
                                {m.publication_new_recovery_restore()}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
            {error && recovery === null ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>{m.publication_new_action_failed()}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <form
                aria-busy={!serverDraftReady}
                className={cn(recovery !== null && 'opacity-55')}
                data-new-publication-form="true"
                inert={!serverDraftReady || recovery !== null}
                onSubmit={event => void handleSubmit(event)}>
                <section data-new-publication-workspace="true">
                    <PublicationComposer
                        channelNavigation={
                            <PublicationChannelTabs
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
                                activeTabId={resolvedActiveContentScopeId}
                                channels={activeChannels}
                                defaultDeliveryMode={defaultDeliveryMode}
                                defaultScheduledAt={defaultScheduledAt}
                                disabled={pending}
                                onChange={onPublicationTargetsChange}
                                onActiveTabChange={selectContentScope}
                                onRemoveTarget={requestTargetRemoval}
                                projectId={project.id}
                                targets={publicationTargets}
                                timeZone={project.timeZone}
                            />
                        }
                        editor={
                            <div className="min-w-0">
                                {showHeadline ? (
                                    <DashboardFormField
                                        htmlFor="new-post-title"
                                        label={
                                            textFields?.headline?.field.required
                                                ? m.builder_title_required()
                                                : m.builder_title_optional()
                                        }>
                                        <Input
                                            id="new-post-title"
                                            aria-invalid={headlineCount?.invalid || undefined}
                                            aria-describedby={
                                                headlineCount ? 'new-post-title-count' : undefined
                                            }
                                            value={postTitle}
                                            onChange={event =>
                                                onPostTitleChange(event.target.value)
                                            }
                                            placeholder={m.publication_article_title()}
                                        />
                                        {textFields?.headline &&
                                        textFields.headline.field.maxLength !== null &&
                                        headlineCount ? (
                                            <p
                                                id="new-post-title-count"
                                                className={cn(
                                                    'text-xs',
                                                    headlineCount.invalid
                                                        ? 'text-destructive'
                                                        : 'text-muted-foreground'
                                                )}>
                                                {m.composer_character_count({
                                                    count: formatNumber(
                                                        headlineCount.characters,
                                                        locale
                                                    ),
                                                    limit: formatNumber(
                                                        textFields.headline.field.maxLength,
                                                        locale
                                                    ),
                                                })}
                                            </p>
                                        ) : null}
                                    </DashboardFormField>
                                ) : null}
                                {activePreviewChannel && profileQuery.isPending ? (
                                    <p role="status" className="mb-2 text-xs text-muted-foreground">
                                        {m.composer_constraints_loading()}
                                    </p>
                                ) : profileQuery.isError ? (
                                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                        <span role="status">
                                            {m.composer_constraints_unavailable()}
                                        </span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={profileQuery.isFetching}
                                            onClick={() => void profileQuery.refetch()}>
                                            {m.common_retry()}
                                        </Button>
                                    </div>
                                ) : null}

                                <div
                                    data-new-publication-editor="true"
                                    className="overflow-hidden rounded-xl bg-surface-field shadow-surface focus-within:shadow-control">
                                    {activeContentTarget !== undefined &&
                                    !activeContentTargetUsesSharedContent ? (
                                        <div className="flex justify-end px-3 pt-2">
                                            <ActionTooltip
                                                label={m.publication_new_reset_channel_content({
                                                    channel: activePreviewChannel?.name ?? '',
                                                })}>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    disabled={pending}
                                                    aria-label={m.publication_new_reset_channel_content(
                                                        {
                                                            channel:
                                                                activePreviewChannel?.name ?? '',
                                                        }
                                                    )}
                                                    onClick={() =>
                                                        useSharedTargetContent(
                                                            activeContentTarget.id
                                                        )
                                                    }>
                                                    <RestartIcon aria-hidden="true" />
                                                </Button>
                                            </ActionTooltip>
                                        </div>
                                    ) : null}
                                    <div>
                                        {configuredEditor ? (
                                            <Suspense
                                                fallback={
                                                    <div className="min-h-56 p-4 text-muted-foreground">
                                                        {m.common_loading()}
                                                    </div>
                                                }>
                                                {[
                                                    {
                                                        id: publicationSharedTabId,
                                                        channelId: '',
                                                        content: postContent,
                                                    },
                                                    ...publicationTargets,
                                                ]
                                                    .filter(scope =>
                                                        renderedEditorScopes.has(scope.id)
                                                    )
                                                    .map(scope => {
                                                        const channel = activeChannels.find(
                                                            item => item.id === scope.channelId
                                                        )
                                                        const profile =
                                                            scope.id === publicationSharedTabId
                                                                ? 'plain'
                                                                : getNativeEditorProfile(
                                                                      channel?.execution
                                                                  )
                                                        const shared =
                                                            scope.id === publicationSharedTabId ||
                                                            !customizedContentTargetIds.has(
                                                                scope.id
                                                            )
                                                        const visible =
                                                            scope.id ===
                                                            resolvedActiveContentScopeId
                                                        return (
                                                            <div
                                                                key={`${project.id}:${scope.id}:${profile}`}
                                                                hidden={!visible}
                                                                data-editor-scope={scope.id}>
                                                                <ConfiguredPublicationEditor
                                                                    onToolbarMount={
                                                                        visible
                                                                            ? setMediaToolbar
                                                                            : undefined
                                                                    }
                                                                    id={
                                                                        visible
                                                                            ? 'new-post-content'
                                                                            : undefined
                                                                    }
                                                                    profile={profile}
                                                                    value={
                                                                        shared
                                                                            ? postContent
                                                                            : scope.content
                                                                    }
                                                                    label={
                                                                        scope.id ===
                                                                        publicationSharedTabId
                                                                            ? m.publication_new_source_content()
                                                                            : m.publication_new_channel_copy()
                                                                    }
                                                                    disabled={
                                                                        pending || recovery !== null
                                                                    }
                                                                    describedBy={
                                                                        visible &&
                                                                        (usesXTextRules ||
                                                                            bodyCount !== null)
                                                                            ? 'new-post-content-weighted-count'
                                                                            : undefined
                                                                    }
                                                                    invalid={
                                                                        visible && activeTextInvalid
                                                                    }
                                                                    onValueChange={text =>
                                                                        editScopeText(
                                                                            scope.id,
                                                                            text
                                                                        )
                                                                    }
                                                                />
                                                            </div>
                                                        )
                                                    })}
                                            </Suspense>
                                        ) : (
                                            <PublicationTextEditor
                                                appearance="composer"
                                                onToolbarMount={setMediaToolbar}
                                                id="new-post-content"
                                                aria-label={
                                                    activeContentTarget === undefined
                                                        ? m.publication_new_source_content()
                                                        : m.publication_new_channel_copy()
                                                }
                                                aria-describedby={
                                                    usesXTextRules || bodyCount !== null
                                                        ? 'new-post-content-weighted-count'
                                                        : undefined
                                                }
                                                aria-invalid={activeTextInvalid || undefined}
                                                value={activeText}
                                                disabled={pending}
                                                onValueChange={editActiveText}
                                                placeholder={m.publication_new_source_placeholder()}
                                                rows={9}
                                            />
                                        )}
                                        {activeTextValidation !== null ? (
                                            <div className="px-4 pb-3">
                                                <XWeightedTextCount
                                                    id="new-post-content-weighted-count"
                                                    invalid={activeTextInvalid}
                                                    result={activeTextValidation}
                                                />
                                            </div>
                                        ) : bodyCount && textFields?.body ? (
                                            <PublicationTextCount
                                                id="new-post-content-weighted-count"
                                                result={bodyCount}
                                                constraint={textFields.body}
                                            />
                                        ) : null}
                                    </div>

                                    <MediaAttachmentPicker
                                        variant="publication-new-inline"
                                        triggerContainer={mediaToolbar}
                                        projectId={project.id}
                                        value={sourceMedia}
                                        onChange={onSourceMediaChange}
                                        onAssetsChange={setAvailableMedia}
                                        disabled={pending}
                                    />
                                </div>

                                {projectTags.length > 0 ? (
                                    <div className="mt-5">
                                        <PublicationTagPicker
                                            ariaLabel={m.taxonomy_select_tags()}
                                            disabled={pending}
                                            emptyLabel={m.taxonomy_no_tags()}
                                            label={m.taxonomy_tags()}
                                            onChange={onPublicationTagIdsChange}
                                            selectedTagIds={publicationTagIds}
                                            selectedLabel={count =>
                                                m.taxonomy_selected_tags({ count })
                                            }
                                            tags={projectTags}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        }
                        footer={
                            <div className="flex w-full flex-wrap items-center justify-between gap-3">
                                <span
                                    aria-live="polite"
                                    className="min-h-4 text-xs text-muted-foreground"
                                    title={autosaveError ?? undefined}>
                                    {autosaveStatus}
                                </span>
                                {selectedPublicationCount > 0 ? (
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button
                                            name="publication-action"
                                            type="submit"
                                            value="draft"
                                            variant="ghost"
                                            disabled={pending}>
                                            <FileTextIcon aria-hidden="true" />
                                            {m.publication_new_create_draft()}
                                        </Button>
                                        <Button
                                            name="publication-action"
                                            type="submit"
                                            value="schedule"
                                            disabled={pending}>
                                            <CalendarAddIcon aria-hidden="true" />
                                            {m.publication_new_schedule_count({
                                                count: selectedPublicationCount,
                                            })}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        }
                        preview={
                            activePreviewChannel !== undefined ? (
                                <PublicationDraftPreview
                                    channel={activePreviewChannel}
                                    execution={activePreviewChannel.execution}
                                    media={previewMedia}
                                    mediaSelections={sourceMedia}
                                    postContent={postContent}
                                    postTitle={postTitle}
                                    targetContent={
                                        activeContentTargetUsesSharedContent
                                            ? undefined
                                            : activePreviewTarget?.content
                                    }
                                />
                            ) : undefined
                        }
                        settings={
                            selectedPublicationCount > 0 ? (
                                <details
                                    data-publication-schedule-disclosure="true"
                                    className="group min-w-0 rounded-md bg-surface-inset/35 px-3 shadow-surface"
                                    open={scheduleDetailsOpen}
                                    onToggle={event =>
                                        setScheduleDetailsOpen(event.currentTarget.open)
                                    }>
                                    <summary
                                        aria-label={m.publication_new_schedule_settings()}
                                        className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
                                        <CalendarMinimalisticIcon
                                            aria-hidden="true"
                                            className="size-4 shrink-0 text-muted-foreground"
                                        />
                                        <span className="min-w-0 flex-1 truncate font-medium">
                                            {formatCivilSchedule(defaultScheduledAt, locale) ||
                                                m.date_time_picker_placeholder()}
                                        </span>
                                        <span className="hidden shrink-0 text-muted-foreground sm:inline">
                                            {defaultDeliveryMode === 'automatic'
                                                ? m.publication_new_automatic_publication()
                                                : m.publication_new_manual_publication()}
                                        </span>
                                        <AltArrowDownIcon
                                            aria-hidden="true"
                                            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                                        />
                                    </summary>
                                    <div className="pb-4 pt-1">
                                        <PublicationChannelSettings
                                            activeTargetId={activePublicationTabId}
                                            channels={activeChannels}
                                            connections={connections}
                                            customizedTargetIds={customizedTargetIds}
                                            defaultDeliveryMode={defaultDeliveryMode}
                                            defaultScheduledAt={defaultScheduledAt}
                                            disabled={pending}
                                            onDefaultDeliveryModeChange={
                                                handleDefaultDeliveryModeChange
                                            }
                                            onDefaultScheduledAtChange={
                                                handleDefaultScheduledAtChange
                                            }
                                            onChange={onPublicationTargetsChange}
                                            onTargetCustomizationChange={
                                                handleTargetCustomizationChange
                                            }
                                            projectId={project.id}
                                            targets={publicationTargets}
                                            timeZone={project.timeZone}
                                        />
                                    </div>
                                </details>
                            ) : undefined
                        }
                    />
                </section>
            </form>
            <Dialog
                open={pendingRemovalId !== null}
                onOpenChange={open => {
                    if (!open) setPendingRemovalId(null)
                }}>
                <DialogContent>
                    <DialogTitle>{m.publication_remove_customized_title()}</DialogTitle>
                    <DialogDescription>
                        {m.publication_remove_customized_description()}
                    </DialogDescription>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setPendingRemovalId(null)}>
                            {m.publication_remove_customized_cancel()}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                                if (pendingRemovalId !== null) removeTarget(pendingRemovalId)
                                setPendingRemovalId(null)
                            }}>
                            {m.publication_remove_customized_confirm()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    )
}

function resolveRecoveredContentScope(recovery: PublicationRecoveryState) {
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
