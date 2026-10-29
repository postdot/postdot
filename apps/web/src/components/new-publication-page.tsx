import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button, buttonVariants } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Input } from '@postdot/ui/components/input'
import { cn } from '@postdot/ui/lib/utils'
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
import { ComposerDraftConflict } from '@/components/composer-draft-conflict'
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
import { QueryErrorState } from '@/components/query-error-state'
import {
    ApiError,
    api,
    formatApiError,
    type MediaReference,
    type PublicationComposerDraft,
} from '@/lib/api'
import { countComposerText, getComposerTextFields } from '@/lib/composer-text-constraints'
import { useDashboardGlobal, useProjectDashboard } from '@/lib/dashboard-context'
import { formatCivilSchedule } from '@/lib/date-time'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { getNativeEditorProfile } from '@/lib/native-presentation'
import { useProjectTagCatalog } from '@/lib/project-tags'
import {
    calendarDateTimeLocal,
    createPublicationTarget,
    type DeliveryMode,
} from '@/lib/publication-authoring'
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
import * as m from '@/paraglide/messages.js'
import { providerRegistry } from '@/providers/registry'

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
    const { activeChannels, channels, connections, project, projectRole } = useProjectDashboard()
    const userId = useDashboardGlobal().session.user.id
    const {
        error,
        onCreatePost,
        onCreateChannel,
        onCreateProjectTag,
        onPostContentChange,
        onPostTitleChange,
        onPublicationTargetsChange,
        onSourceMediaChange,
        pending,
        postContent,
        postTitle,
        publicationTagIds,
        publicationTargets,
        sourceMedia,
        onPublicationTagIdsChange,
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
    const [mediaToolbar, setMediaToolbar] = useState<HTMLDivElement | null>(null)
    const canCreateProjectTag = projectRole === 'owner' || projectRole === 'editor'
    const [localRecoveryAtMount] = useState(() => readPublicationRecovery(project.id, userId))
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
    const [serverDraftLoadFailed, setServerDraftLoadFailed] = useState(false)
    const [serverDraftLoadAttempt, setServerDraftLoadAttempt] = useState(0)
    const [discardingRecovery, setDiscardingRecovery] = useState(false)
    const [autosaveState, setAutosaveState] = useState<
        'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'account'
    >('idle')
    const [autosaveError, setAutosaveError] = useState<string | null>(null)
    const [scheduleDetailsOpen, setScheduleDetailsOpen] = useState(() =>
        publicationTargets.some(
            target =>
                target.deliveryMode === 'automatic' &&
                connections.find(connection => connection.channelId === target.channelId)?.state !==
                    'active'
        )
    )
    const autosaveConflict = useRef(false)
    const accountChanged = useRef(false)
    const [conflictBusy, setConflictBusy] = useState(false)
    const [conflictVersionKnown, setConflictVersionKnown] = useState(false)
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
                ? getComposerTextFields(profileQuery.data.active.profile, { media: sourceMedia })
                : null,
        [profileQuery.data, profileQuery.isError, sourceMedia]
    )
    const showHeadline = textFields?.headline !== undefined && textFields?.headline !== null
    const headlineCount = textFields?.headline
        ? countComposerText(postTitle, textFields.headline)
        : null
    const textRule = providerRegistry.forExecution(activePreviewChannel?.execution)?.text
    const TextCount = textRule?.Count
    const usesWeightedTextRules = textRule !== undefined
    const activeText =
        activeContentTarget !== undefined && !activeContentTargetUsesSharedContent
            ? activeContentTarget.content
            : postContent
    const activeTextValidation = usesWeightedTextRules ? textRule!.parse(activeText) : null
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
        if (autosaveConflict.current || accountChanged.current) {
            event.preventDefault()
            return
        }
        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        await autosaveQueue.current.catch(() => undefined)

        const submitter = (event.nativeEvent as SubmitEvent).submitter
        const mode: PublicationCreationMode =
            submitter instanceof HTMLButtonElement && submitter.value === 'draft'
                ? 'draft'
                : 'schedule'
        const publications = await onCreatePost(event, mode)
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
    }

    async function discardRecovery() {
        if (!serverDraftReady || discardingRecovery) return

        setDiscardingRecovery(true)
        try {
            if (!(await discardServerDraft())) return
            clearPublicationRecovery(project.id, userId)
            recoveryPromptOpen.current = false
            setRecovery(null)
        } finally {
            setDiscardingRecovery(false)
        }
    }

    /** Another tab signed in as someone else: this page's cookie no longer belongs to its author. */
    function pauseForAccountChange() {
        accountChanged.current = true
        autosaveConflict.current = true
        // Any open comparison or recovery choice was built from this page's account.
        recoveryPromptOpen.current = false
        setRecovery(null)
        setAutosaveState('account')
    }

    async function discardServerDraft() {
        if (serverDraftRef.current === null) return true

        try {
            await api.deletePublicationComposerDraft(
                project.id,
                serverDraftRef.current.revision,
                serverDraftRef.current.id,
                userId
            )
            serverDraftRef.current = null
            setServerDraft(null)
            setAutosaveState('idle')
            setAutosaveError(null)
            return true
        } catch (caughtError) {
            if (caughtError instanceof ApiError && caughtError.code === 'account_changed') {
                pauseForAccountChange()
            } else if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                autosaveConflict.current = true
                setAutosaveState('conflict')
            } else setAutosaveState('error')
            setAutosaveError(formatApiError(caughtError))
            return false
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
            if (caught instanceof ApiError && caught.code === 'account_changed')
                pauseForAccountChange()
            setAutosaveError(formatApiError(caught))
        } finally {
            setConflictBusy(false)
        }
    }

    async function resolveConflict(useLocal: boolean) {
        if (recovery === null || conflictBusy || !conflictVersionKnown) return
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
            if (caught instanceof ApiError && caught.code === 'account_changed') {
                pauseForAccountChange()
                return
            }
            // A refused replacement must show the latest version before another choice.
            try {
                const { draft } = await api.getPublicationComposerDraft(project.id, userId)
                serverDraftRef.current = draft
                setServerDraft(draft)
                setConflictVersionKnown(true)
            } catch (refreshError) {
                if (refreshError instanceof ApiError && refreshError.code === 'account_changed')
                    pauseForAccountChange()
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
              : autosaveState === 'error'
                ? m.publication_new_autosave_unavailable()
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
                if (caught instanceof ApiError && caught.code === 'account_changed') {
                    pauseForAccountChange()
                    return
                }
                setServerDraftLoadFailed(true)
            })

        return () => {
            cancelled = true
        }
    }, [project.id, serverDraftLoadAttempt, userId])

    useEffect(() => {
        if (!serverDraftReady || recoveryPromptOpen.current || autosaveConflict.current) return

        if (!hasCurrentComposerContent) {
            if (serverDraftRef.current === null) return
            autosaveQueue.current = autosaveQueue.current
                .catch(() => undefined)
                .then(async () => {
                    if (autosaveConflict.current) return
                    await discardServerDraft()
                })
            return
        }

        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        const content = composerDraftContent()
        autosaveTimer.current = setTimeout(() => {
            autosaveQueue.current = autosaveQueue.current
                .catch(() => undefined)
                .then(async () => {
                    if (autosaveConflict.current) return
                    setAutosaveState('saving')
                    setAutosaveError(null)
                    try {
                        const response = await api.savePublicationComposerDraft(
                            project.id,
                            serverDraftRef.current?.revision ?? 0,
                            content,
                            serverDraftRef.current?.id,
                            userId
                        )
                        serverDraftRef.current = response.draft
                        setServerDraft(response.draft)
                        setAutosaveState('saved')
                    } catch (caughtError) {
                        if (
                            caughtError instanceof ApiError &&
                            caughtError.code === 'account_changed'
                        ) {
                            pauseForAccountChange()
                        } else if (
                            caughtError instanceof ApiError &&
                            caughtError.code === 'write_conflict'
                        ) {
                            autosaveConflict.current = true
                            setAutosaveState('conflict')
                        } else setAutosaveState('error')
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
        // Closing a refused recovery choice must not replace its snapshot with the empty form.
        if (recoveryPromptOpen.current || accountChanged.current) return
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
        userId,
        serverDraft,
        serverDraftReady,
        localRecoveryAtMount,
        autosaveState,
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

            {recovery !== null && autosaveState === 'conflict' ? (
                <ComposerDraftConflict
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
            {recovery !== null && autosaveState !== 'conflict' ? (
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
                        {serverDraftLoadFailed ? (
                            <QueryErrorState
                                onRetry={() => setServerDraftLoadAttempt(attempt => attempt + 1)}
                            />
                        ) : null}
                        {error || autosaveError ? (
                            <p role="alert" className="break-words text-sm text-state-failed">
                                {error ?? autosaveError}
                            </p>
                        ) : null}
                        <DialogFooter>
                            <Button
                                disabled={!serverDraftReady || discardingRecovery}
                                onClick={() => void discardRecovery()}
                                type="button"
                                variant="secondary">
                                {discardingRecovery
                                    ? m.common_loading()
                                    : m.publication_new_recovery_discard()}
                            </Button>
                            <Button
                                disabled={!serverDraftReady || discardingRecovery}
                                onClick={restoreRecovery}
                                type="button">
                                {m.publication_new_recovery_restore()}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
            {autosaveState === 'account' ? (
                <Alert className="mb-6" role="alert">
                    <AlertTitle>{m.composer_account_changed_title()}</AlertTitle>
                    <AlertDescription>{m.composer_account_changed_notice()}</AlertDescription>
                    <Button
                        className="mt-3"
                        onClick={() => window.location.reload()}
                        type="button"
                        variant="outline">
                        {m.composer_account_changed_reload()}
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
            {recovery === null && !serverDraftReady && autosaveState !== 'account' ? (
                serverDraftLoadFailed ? (
                    <QueryErrorState
                        className="mb-6"
                        onRetry={() => setServerDraftLoadAttempt(attempt => attempt + 1)}
                    />
                ) : (
                    <p role="status" className="mb-6 text-sm text-muted-foreground">
                        {m.common_loading()}
                    </p>
                )
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
                inert={!serverDraftReady || recovery !== null || autosaveState === 'account'}
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
                                                                        (usesWeightedTextRules ||
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
                                                    usesWeightedTextRules || bodyCount !== null
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
                                        {activeTextValidation !== null && TextCount ? (
                                            <div className="px-4 pb-3">
                                                <TextCount
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

                                <div className="mt-5">
                                    <PublicationTagPicker
                                        ariaLabel={m.taxonomy_select_tags()}
                                        archivedLabel={m.common_archived()}
                                        disabled={pending}
                                        emptyLabel={m.taxonomy_no_tags()}
                                        label={m.taxonomy_tags()}
                                        onChange={onPublicationTagIdsChange}
                                        onCreateTag={
                                            canCreateProjectTag ? onCreateProjectTag : undefined
                                        }
                                        selectedTagIds={publicationTagIds}
                                        selectedLabel={count => m.taxonomy_selected_tags({ count })}
                                        tags={pickerTags}
                                    />
                                </div>
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
                                            disabled={
                                                pending ||
                                                autosaveState === 'conflict' ||
                                                autosaveState === 'account'
                                            }>
                                            <FileTextIcon aria-hidden="true" />
                                            {m.publication_new_create_draft()}
                                        </Button>
                                        <Button
                                            name="publication-action"
                                            type="submit"
                                            value="schedule"
                                            disabled={
                                                pending ||
                                                autosaveState === 'conflict' ||
                                                autosaveState === 'account'
                                            }>
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
