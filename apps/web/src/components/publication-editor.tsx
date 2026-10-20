import { Button, buttonVariants } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@postbot/ui/components/dialog'
import { X_MAX_WEIGHTED_POST_LENGTH } from '@postbot/x/text'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type MediaSelection } from '@/components/media-attachment-picker'
import { PostSourceReview } from '@/components/post-source-review'
import { PublicationActivityTimeline } from '@/components/publication-activity-timeline'
import { PublicationAdoptionHistory } from '@/components/publication-adoption-history'
import { PublicationCancellationDialog } from '@/components/publication-cancellation-dialog'
import { PublicationCommentsPanel } from '@/components/publication-comments-panel'
import { PublicationComposer } from '@/components/publication-composer'
import { PublicationDraftPreview } from '@/components/publication-draft-preview'
import {
    PublicationEditorDeliverySettings,
    PublicationEditorPromotionAction,
} from '@/components/publication-editor-promotion-section'
import {
    type CapabilitySummary,
    PublicationEditorSidebar,
    type PublicationEditorSaveState,
} from '@/components/publication-editor-sidebar'
import { PublicationEditorSourceSection } from '@/components/publication-editor-source-section'
import {
    PublicationEditorSaveIndicator,
    PublicationEditorStatus,
} from '@/components/publication-editor-status'
import { PublicationEditorTargetSection } from '@/components/publication-editor-target-section'
import { PublicationLifecyclePanel } from '@/components/publication-lifecycle-panel'
import {
    PublicationOutcomePanel,
    type PublicationOutcomeResolutionInput,
} from '@/components/publication-outcome-panel'
import { PublicationProfileAdoption } from '@/components/publication-profile-adoption'
import { PublicationRecoveryComparison } from '@/components/publication-recovery-comparison'
import { PublicationTagPicker } from '@/components/publication-tag-picker'
import { PublicationChannelRail } from '@/components/publication-target-list'
import {
    ApiError,
    api,
    formatApiError,
    type Channel,
    type MediaReference,
    type ProjectTag,
    type PublicationEditorState,
    type PublisherConnection,
    type PublicationSummary,
} from '@/lib/api'
import {
    dateTimeLocalErrorMessage,
    parseDateTimeLocal,
    toDateTimeLocal,
    type DateTimeLocalResult,
} from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import {
    decideConfirmedReconcile,
    type ProjectAccessStatus,
} from '@/lib/project-access-verification'
import { projectQueryKeys } from '@/lib/project-realtime'
import { mergeProjectTags } from '@/lib/project-tags'
import type { PublicationCalendarView } from '@/lib/publication-calendar-events'
import { canEditPublication, isManualPublicationDue } from '@/lib/publication-lifecycle'
import {
    getPreviewTarget,
    getTargetPreviewBody,
    getTargetPreviewTitle,
} from '@/lib/publication-preview'
import {
    isActiveChannelProfilePromotionError,
    publicationPromotionIntent,
} from '@/lib/publication-promotion'
import { recoveryProfileMatches } from '@/lib/publication-recovery-profile'
import { getTargetMediaSelections, updateTargetMedia } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

type SourceContent = PublicationEditorState['post']['sourceContent']
type Profile = PublicationEditorState['profile']['profile']

interface PublicationEditorProps {
    readonly configuredEditor?: boolean
    readonly channels?: readonly Channel[]
    readonly publisherConnections?: readonly PublisherConnection[]
    readonly projectId: string
    readonly initialEditor: PublicationEditorState
    readonly initialPublicationTags: readonly ProjectTag[]
    readonly onCreateProjectTag: (name: string) => Promise<ProjectTag>
    readonly onCancel?: () => Promise<boolean>
    readonly onPublish?: () => Promise<boolean>
    readonly onRetry?: () => Promise<boolean>
    readonly readOnly?: boolean
    /**
     * Explicit project-access assessment owning this editor instance. Anything
     * other than `confirmed` freezes new server writes without touching local
     * state or the recovery buffer.
     */
    readonly accessStatus: ProjectAccessStatus
    /** Epoch captured at dispatch; stale continuations must apply nothing. */
    readonly accessEpoch: number
    /**
     * Called when an editor-owned request is refused with 403/404 while the
     * page believed access was confirmed. The refusal is authoritative, unlike
     * a silent transport, so it starts the same one-shot verification.
     */
    readonly onAccessRefused?: () => void
    /**
     * Called with the reconciliation outcome after a successful membership
     * read. The route owns the machine; the editor only reports what its
     * reread established.
     */
    readonly onAccessReconciled?: (succeeded: boolean) => void
    readonly projectTags: readonly ProjectTag[]
    readonly relatedPublications?: readonly PublicationSummary[]
    readonly backToCalendar?: {
        readonly date?: string
        readonly view?: PublicationCalendarView
    }
    readonly timeZone: string
}

interface RecoveryBuffer {
    readonly profileVersionId?: string
    readonly version: 3
    readonly baseRevision: number
    readonly sourceContent: SourceContent
    readonly targetText: string
    readonly scheduleValue: string
    readonly timeZone: string
}

type SaveState = PublicationEditorSaveState

const recoveryVersion = 3 as const

export function PublicationEditor({
    configuredEditor = true,
    channels = [],
    publisherConnections,
    initialEditor,
    initialPublicationTags,
    onCreateProjectTag,
    onCancel,
    onPublish,
    onRetry,
    readOnly = false,
    accessStatus,
    accessEpoch,
    onAccessRefused,
    onAccessReconciled,
    projectId,
    projectTags,
    relatedPublications = [],
    backToCalendar,
    timeZone,
}: PublicationEditorProps) {
    useLanguage()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const recoveryKey = useMemo(
        () => createRecoveryKey(projectId, initialEditor.publication.id),
        [projectId, initialEditor.publication.id]
    )
    const initialRecovery = useMemo(
        () => readRecovery(recoveryKey, timeZone),
        [recoveryKey, timeZone]
    )
    const initialPublicationEditable =
        !readOnly && canEditPublication(initialEditor.publication.state)
    const shouldRestoreInitialRecovery =
        initialPublicationEditable &&
        initialRecovery !== null &&
        initialRecovery.baseRevision >= initialEditor.draft.revision &&
        recoveryProfileMatches(initialRecovery, initialEditor)
    const recoveredContentDiffers =
        shouldRestoreInitialRecovery &&
        initialRecovery !== null &&
        recoveryContentDiffers(initialRecovery, initialEditor)
    const recoveredScheduleDiffers =
        shouldRestoreInitialRecovery &&
        initialRecovery !== null &&
        initialRecovery.scheduleValue !==
            toDateTimeLocal(initialEditor.publication.scheduledAt, timeZone)
    const initialSourceConflict =
        initialEditor.draft.sourceRevision !== initialEditor.post.sourceRevision
    const [editor, setEditor] = useState(initialEditor)
    const [sourceContent, setSourceContent] = useState<SourceContent>(() =>
        shouldRestoreInitialRecovery
            ? initialRecovery.sourceContent
            : initialEditor.post.sourceContent
    )
    const [targetText, setTargetText] = useState(() =>
        shouldRestoreInitialRecovery
            ? initialRecovery.targetText
            : formatJson(initialEditor.draft.content)
    )
    const [expectedRevision, setExpectedRevision] = useState(initialEditor.draft.revision)
    const [dirty, setDirty] = useState(recoveredContentDiffers)
    const [saveState, setSaveState] = useState<SaveState>(
        !initialPublicationEditable
            ? 'saved'
            : recoveredContentDiffers
              ? 'local_only'
              : initialSourceConflict
                ? 'conflict'
                : 'saved'
    )
    const [message, setMessageValue] = useState<string | null>(
        !initialPublicationEditable
            ? null
            : recoveredContentDiffers || recoveredScheduleDiffers
              ? m.editor_recovered_ready()
              : initialSourceConflict
                ? m.editor_initial_source_conflict({
                      draftRevision: initialEditor.draft.sourceRevision,
                      currentRevision: initialEditor.post.sourceRevision,
                  })
                : initialRecovery === null
                  ? null
                  : m.editor_previous_local_newer()
    )
    const [passiveMessage, setPassiveMessage] = useState(false)
    const setMessage = useCallback((value: string | null, passive = false) => {
        setMessageValue(value)
        setPassiveMessage(passive)
    }, [])
    const [recoveryAvailable, setRecoveryAvailable] = useState(
        initialPublicationEditable && initialRecovery !== null && !shouldRestoreInitialRecovery
    )
    const pendingRecovery = recoveryAvailable ? readRecovery(recoveryKey, timeZone) : null
    const pendingRecoveryTarget = pendingRecovery
        ? parseTargetText(pendingRecovery.targetText).value
        : null
    const [scheduleValue, setScheduleValue] = useState(
        shouldRestoreInitialRecovery && initialRecovery !== null
            ? initialRecovery.scheduleValue
            : toDateTimeLocal(initialEditor.publication.scheduledAt, timeZone)
    )
    const [scheduleDirty, setScheduleDirty] = useState(recoveredScheduleDiffers)
    const [publicationTagIds, setPublicationTagIds] = useState<string[]>(() =>
        initialPublicationTags.map(tag => tag.id)
    )
    const [tagSavePending, setTagSavePending] = useState(false)
    const [tagError, setTagError] = useState<string | null>(null)
    const [availableMedia, setAvailableMedia] = useState<MediaReference[]>([])
    const [readOnlyMedia, setReadOnlyMedia] = useState<MediaReference[]>([])
    const [manualPublishPending, setManualPublishPending] = useState(false)
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
    const [promotionPending, setPromotionPending] = useState(false)
    const [adoptionOpen, setAdoptionOpen] = useState(false)
    const promotionInFlight = useRef(false)
    const [promotionRecoveryRequired, setPromotionRecoveryRequired] = useState(false)
    const [serverReadPending, setServerReadPending] = useState(false)
    const serverReadInFlight = useRef(false)
    const editorMutationPending = promotionPending || serverReadPending || adoptionOpen
    const [cancelPending, setCancelPending] = useState(false)
    const [retryPending, setRetryPending] = useState(false)
    const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(initialSourceConflict)
    const [targetCustomizationOpen, setTargetCustomizationOpen] = useState(
        initialEditor.draft.reviewState !== 'compatible'
    )
    const technicalDetailsRef = useRef<HTMLDetailsElement>(null)
    const requestGeneration = useRef(0)
    const [pendingSaveGeneration, setPendingSaveGeneration] = useState<number | null>(null)
    const accessWritesBlocked = accessStatus !== 'confirmed'
    const accessEpochRef = useRef(accessEpoch)

    useEffect(() => {
        accessEpochRef.current = accessEpoch
    }, [accessEpoch])

    function reportAccessRefusal(error: unknown) {
        if (onAccessRefused === undefined) return
        if (error instanceof ApiError && (error.status === 403 || error.status === 404))
            onAccessRefused()
    }

    const availableTags = useMemo(
        () => mergeProjectTags(projectTags, initialPublicationTags),
        [initialPublicationTags, projectTags]
    )

    const targetResult = useMemo(() => parseTargetText(targetText), [targetText])
    const sourceIssue = useMemo(() => sourceContentIssue(sourceContent), [sourceContent])
    const capabilitySummary = useMemo(() => getCapabilitySummary(editor.profile.profile), [editor])
    const sourceConflict = editor.draft.sourceRevision !== editor.post.sourceRevision
    const draftRequiresReview = editor.draft.reviewState !== 'compatible'
    const draftDiffersFromTarget =
        editor.selectedTarget === null ||
        editor.draft.sourceRevision !== editor.selectedTarget.sourceRevision ||
        formatJson(editor.draft.content) !== formatJson(editor.selectedTarget.content)
    const hasLocalChanges = dirty || scheduleDirty
    const isRebasing = saveState === 'rebasing'
    const publicationEditable = !readOnly && canEditPublication(editor.publication.state)
    const manualPublicationBlocked =
        accessWritesBlocked ||
        editorMutationPending ||
        promotionRecoveryRequired ||
        manualPublishPending ||
        hasLocalChanges ||
        saveState !== 'saved' ||
        sourceConflict ||
        draftRequiresReview ||
        draftDiffersFromTarget
    const promotionBlocked =
        accessWritesBlocked ||
        editorMutationPending ||
        promotionRecoveryRequired ||
        dirty ||
        sourceConflict ||
        draftRequiresReview ||
        saveState !== 'saved' ||
        targetResult.value === null ||
        sourceIssue !== null
    const cancellationBlocked =
        accessWritesBlocked ||
        editorMutationPending ||
        promotionRecoveryRequired ||
        cancelPending ||
        hasLocalChanges ||
        saveState !== 'saved' ||
        isRebasing
    const retryBlocked =
        accessWritesBlocked ||
        editorMutationPending ||
        promotionRecoveryRequired ||
        retryPending ||
        onRetry === undefined ||
        !publicationEditable ||
        editor.publication.state !== 'failed' ||
        editor.publication.deliveryMode !== 'automatic' ||
        hasLocalChanges ||
        sourceConflict ||
        draftRequiresReview ||
        saveState !== 'saved' ||
        draftDiffersFromTarget

    useEffect(() => {
        if (sourceConflict || saveState === 'conflict') setTechnicalDetailsOpen(true)
    }, [saveState, sourceConflict])
    useEffect(() => {
        if (targetResult.error !== null || editor.draft.validationIssues.length > 0) {
            setTargetCustomizationOpen(true)
        }
    }, [editor.draft.validationIssues.length, targetResult.error])
    const editorChannels = useMemo(() => {
        const channelsById = new Map(channels.map(channel => [channel.id, channel]))
        const orderedChannelIds = [
            ...relatedPublications.map(publication => publication.channelId),
            editor.channel.id,
        ]
        const uniqueChannelIds = [...new Set(orderedChannelIds)]

        return uniqueChannelIds.flatMap(channelId => {
            const channel = channelsById.get(channelId)
            return channel === undefined
                ? channelId === editor.channel.id
                    ? [editor.channel]
                    : []
                : [channel]
        })
    }, [channels, editor.channel, relatedPublications])
    const editorChannelIds = useMemo(
        () => new Set(editorChannels.map(channel => channel.id)),
        [editorChannels]
    )
    // Headline, body and media all read this one document, so a locked publication
    // cannot describe a later unapplied draft in one of the three and not another.
    const previewTarget = getPreviewTarget({
        editable: publicationEditable,
        workingTarget: targetResult.value,
        selectedTarget: editor.selectedTarget?.content,
    })
    const previewProfile =
        !publicationEditable && editor.selectedTarget !== null
            ? (editor.selectedTargetProfile ?? editor.profile).profile
            : editor.profile.profile
    const previewMediaSelections = useMemo(
        () =>
            previewTarget === null
                ? sourceContent.media
                : getTargetMediaSelections(previewProfile, previewTarget),
        [previewProfile, previewTarget, sourceContent.media]
    )
    const readOnlyMediaIds = [
        ...new Set(
            [
                ...previewMediaSelections,
                ...editor.draft.baseSourceContent.media,
                ...editor.post.sourceContent.media,
                ...(pendingRecovery?.sourceContent.media ?? []),
                ...(pendingRecoveryTarget
                    ? getTargetMediaSelections(editor.profile.profile, pendingRecoveryTarget)
                    : []),
                ...getTargetMediaSelections(editor.profile.profile, editor.draft.content),
            ]
                .filter(
                    selection => !availableMedia.some(asset => asset.asset.id === selection.assetId)
                )
                .map(selection => selection.assetId)
        ),
    ].join('\u0000')
    useEffect(() => {
        if (readOnlyMediaIds === '') return

        let active = true
        void Promise.allSettled(
            readOnlyMediaIds.split('\u0000').map(assetId => api.getMedia(projectId, assetId))
        ).then(results => {
            if (!active) return
            setReadOnlyMedia(
                results.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
            )
        })
        return () => {
            active = false
        }
    }, [projectId, readOnlyMediaIds])
    const previewMedia = useMemo(
        () =>
            previewMediaSelections
                .map(
                    selection =>
                        availableMedia.find(asset => asset.asset.id === selection.assetId) ??
                        readOnlyMedia.find(asset => asset.asset.id === selection.assetId)
                )
                .filter((asset): asset is MediaReference => asset !== undefined),
        [availableMedia, readOnlyMedia, previewMediaSelections]
    )
    const previewContent = useMemo(
        () =>
            previewTarget === null
                ? (sourceContent.body?.text ?? '')
                : getTargetPreviewBody(previewProfile, previewTarget),
        [previewProfile, previewTarget, sourceContent.body?.text]
    )
    const currentEditorFingerprint = publicationEditorFingerprint(editor)
    const incomingEditorFingerprint = publicationEditorFingerprint(initialEditor)
    const lastIncomingEditorFingerprint = useRef<string | null>(null)

    useEffect(() => {
        if (initialEditor.publication.id !== editor.publication.id) return
        if (incomingEditorFingerprint === lastIncomingEditorFingerprint.current) return
        if (pendingSaveGeneration !== null || editorMutationPending) return
        lastIncomingEditorFingerprint.current = incomingEditorFingerprint
        if (incomingEditorFingerprint === currentEditorFingerprint) return

        requestGeneration.current += 1
        if (hasLocalChanges) {
            setSaveState('conflict')
            setMessage(m.editor_server_newer_local())
            return
        }

        setEditor(initialEditor)
        setSourceContent(initialEditor.post.sourceContent)
        setTargetText(formatJson(initialEditor.draft.content))
        setExpectedRevision(initialEditor.draft.revision)
        setScheduleValue(toDateTimeLocal(initialEditor.publication.scheduledAt, timeZone))
        setDirty(false)
        setScheduleDirty(false)
        const incomingSourceConflict =
            initialEditor.draft.sourceRevision !== initialEditor.post.sourceRevision
        setSaveState(incomingSourceConflict ? 'conflict' : 'saved')
        setMessage(
            incomingSourceConflict
                ? m.editor_initial_source_conflict({
                      draftRevision: initialEditor.draft.sourceRevision,
                      currentRevision: initialEditor.post.sourceRevision,
                  })
                : m.editor_background_update(),
            !incomingSourceConflict
        )
    }, [
        currentEditorFingerprint,
        editor.publication.id,
        hasLocalChanges,
        incomingEditorFingerprint,
        pendingSaveGeneration,
        editorMutationPending,
        initialEditor,
        timeZone,
    ])

    function invalidatePublicationQueries() {
        void Promise.all([
            queryClient.invalidateQueries({ queryKey: projectQueryKeys.data(projectId) }),
            queryClient.invalidateQueries({
                queryKey: projectQueryKeys.calendarPublications(projectId),
            }),
            queryClient.invalidateQueries({
                queryKey: projectQueryKeys.publicationEditors(projectId),
            }),
        ]).catch(() => undefined)
    }

    async function handlePublicationTagIdsChange(nextTagIds: string[]) {
        if (!publicationEditable || accessWritesBlocked) return
        const accessEpochAtStart = accessEpochRef.current
        const previousTagIds = publicationTagIds
        setPublicationTagIds(nextTagIds)
        setTagError(null)
        setTagSavePending(true)
        try {
            const response = await api.replacePublicationTags(
                projectId,
                editor.publication.id,
                nextTagIds
            )
            if (accessEpochAtStart !== accessEpochRef.current) return
            setPublicationTagIds(response.tags.map(tag => tag.id))
            invalidatePublicationQueries()
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return
            reportAccessRefusal(caughtError)
            setPublicationTagIds(previousTagIds)
            setTagError(formatApiError(caughtError))
        } finally {
            setTagSavePending(false)
        }
    }

    function handleChannelChange(channelId: string) {
        const publication = relatedPublications.find(item => item.channelId === channelId)
        if (publication === undefined || publication.id === editor.publication.id) return

        void navigate({
            to: '/dashboard/projects/$projectId/publications/$publicationId',
            params: { projectId, publicationId: publication.id },
            search:
                backToCalendar === undefined
                    ? undefined
                    : { ...backToCalendar, from: 'calendar' as const },
        })
    }

    useEffect(() => {
        if (recoveryAvailable) return
        if (!hasLocalChanges) {
            if (!recoveryAvailable) removeRecovery(recoveryKey)
            return
        }

        writeRecovery(recoveryKey, {
            version: recoveryVersion,
            profileVersionId: editor.draft.profileVersionId,
            baseRevision: expectedRevision,
            sourceContent,
            targetText,
            scheduleValue,
            timeZone,
        })
    }, [
        expectedRevision,
        hasLocalChanges,
        recoveryAvailable,
        recoveryKey,
        scheduleValue,
        sourceContent,
        targetText,
        timeZone,
    ])

    useEffect(() => {
        if (
            !publicationEditable ||
            accessWritesBlocked ||
            !dirty ||
            recoveryAvailable ||
            serverReadPending
        )
            return

        const generation = ++requestGeneration.current
        const accessEpochAtStart = accessEpoch
        if (sourceConflict || sourceIssue !== null || targetResult.value === null) {
            setSaveState(sourceConflict ? 'conflict' : 'local_only')
            return
        }
        const targetContent = targetResult.value

        setSaveState('saving')
        const timer = window.setTimeout(() => {
            setPendingSaveGeneration(generation)
            void api
                .savePublicationDraft(projectId, editor.publication.id, {
                    expectedRevision,
                    sourceContent,
                    targetContent,
                })
                .then(response => {
                    if (accessEpochAtStart !== accessEpochRef.current) return
                    if (generation !== requestGeneration.current) return
                    setEditor(response.editor)
                    setExpectedRevision(response.editor.draft.revision)
                    setDirty(false)
                    setSaveState('saved')
                    setMessage(null)
                    setRecoveryAvailable(false)
                    invalidatePublicationQueries()
                })
                .catch(caughtError => {
                    if (accessEpochAtStart !== accessEpochRef.current) return
                    reportAccessRefusal(caughtError)
                    if (generation !== requestGeneration.current) return
                    if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                        setSaveState('conflict')
                        setMessage(m.editor_server_newer_local())
                        return
                    }
                    setSaveState('error')
                    setMessage(errorMessage(caughtError))
                })
                .finally(() => {
                    setPendingSaveGeneration(current => (current === generation ? null : current))
                })
        }, 650)

        return () => {
            window.clearTimeout(timer)
        }
    }, [
        accessEpoch,
        accessWritesBlocked,
        dirty,
        editor.publication.id,
        expectedRevision,
        projectId,
        publicationEditable,
        recoveryAvailable,
        recoveryKey,
        serverReadPending,
        sourceConflict,
        sourceContent,
        sourceIssue,
        targetResult.value,
    ])

    function updateSourceText(text: string) {
        setSourceContent(current => {
            const next = { ...current }
            if (text.trim() === '') {
                delete next.body
            } else {
                next.body = {
                    format: current.body?.format ?? 'plain_text',
                    text,
                }
            }
            return next
        })
        setDirty(true)
    }

    function updateSourceFormat(format: 'plain_text' | 'markdown') {
        setSourceContent(current => ({
            ...current,
            body: {
                format,
                text: current.body?.text ?? '',
            },
        }))
        setDirty(true)
    }

    function updateSourceOptionalField(field: 'headline' | 'language', value: string) {
        setSourceContent(current => {
            const next = { ...current }
            if (value.trim() === '') {
                delete next[field]
            } else {
                next[field] = value
            }
            return next
        })
        setDirty(true)
    }

    function updateSourceMedia(media: MediaSelection[]) {
        setSourceContent(current => ({ ...current, media }))
        if (targetResult.value !== null) {
            setTargetText(
                formatJson(updateTargetMedia(editor.profile.profile, targetResult.value, media))
            )
        }
        setDirty(true)
    }

    async function reloadServerVersion() {
        if (
            accessWritesBlocked ||
            serverReadInFlight.current ||
            promotionInFlight.current ||
            pendingSaveGeneration !== null ||
            saveState === 'saving' ||
            isRebasing
        )
            return
        serverReadInFlight.current = true
        setServerReadPending(true)
        const generation = ++requestGeneration.current
        const accessEpochAtStart = accessEpochRef.current
        const localSource = sourceContent
        const localTargetText = targetText
        const localRecovery = readRecovery(recoveryKey, timeZone)
        if (hasLocalChanges) {
            writeRecovery(recoveryKey, {
                version: recoveryVersion,
                profileVersionId: editor.draft.profileVersionId,
                baseRevision: expectedRevision,
                sourceContent: localSource,
                targetText: localTargetText,
                scheduleValue,
                timeZone,
            })
        }

        try {
            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (accessEpochAtStart !== accessEpochRef.current) return
            if (generation !== requestGeneration.current) return
            setPromotionRecoveryRequired(false)
            setRecoveryAvailable(hasLocalChanges || localRecovery !== null)
            setEditor(response.editor)
            setSourceContent(response.editor.post.sourceContent)
            setTargetText(formatJson(response.editor.draft.content))
            setExpectedRevision(response.editor.draft.revision)
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt, timeZone))
            setDirty(false)
            setScheduleDirty(false)
            const refreshedSourceConflict =
                response.editor.draft.sourceRevision !== response.editor.post.sourceRevision
            setSaveState(refreshedSourceConflict ? 'conflict' : 'saved')
            setMessage(
                refreshedSourceConflict
                    ? m.editor_server_loaded_conflict({
                          revision: response.editor.draft.sourceRevision,
                      })
                    : m.editor_server_loaded()
            )
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return
            reportAccessRefusal(caughtError)
            if (generation !== requestGeneration.current) return
            if (!promotionRecoveryRequired) setSaveState('error')
            setMessage(errorMessage(caughtError))
        } finally {
            serverReadInFlight.current = false
            setServerReadPending(false)
        }
    }

    function restoreRecovery() {
        const buffered = readRecovery(recoveryKey, timeZone)
        if (buffered !== null && !recoveryProfileMatches(buffered, editor)) {
            setMessage(m.profile_adoption_recovery_mismatch())
            return
        }
        if (accessWritesBlocked) return
        const recovery = readRecovery(recoveryKey, timeZone)
        if (recovery === null) return
        requestGeneration.current += 1
        setSourceContent(recovery.sourceContent)
        setTargetText(recovery.targetText)
        setScheduleValue(recovery.scheduleValue)
        setExpectedRevision(editor.draft.revision)
        const contentDiffers = recoveryContentDiffers(recovery, editor)
        const scheduleDiffers =
            recovery.scheduleValue !== toDateTimeLocal(editor.publication.scheduledAt, timeZone)
        setDirty(contentDiffers)
        setScheduleDirty(scheduleDiffers)
        setSaveState(sourceConflict ? 'conflict' : contentDiffers ? 'local_only' : 'saved')
        setMessage(
            sourceConflict
                ? m.editor_recovered_review()
                : contentDiffers || scheduleDiffers
                  ? m.editor_recovered_promotion()
                  : m.editor_recovered_no_changes()
        )
        setRecoveryAvailable(false)
    }

    async function restoreRecoveryAgainstLatestServer() {
        const buffered = readRecovery(recoveryKey, timeZone)
        if (buffered !== null && !recoveryProfileMatches(buffered, editor)) {
            setMessage(m.profile_adoption_recovery_mismatch())
            return
        }
        if (accessWritesBlocked) return
        const recovery = readRecovery(recoveryKey, timeZone)
        if (recovery === null) return

        const generation = ++requestGeneration.current
        const accessEpochAtStart = accessEpochRef.current
        try {
            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (accessEpochAtStart !== accessEpochRef.current) return
            if (generation !== requestGeneration.current) return
            if (!recoveryProfileMatches(recovery, response.editor)) {
                setEditor(response.editor)
                setRecoveryAvailable(true)
                setSaveState('conflict')
                setMessage(m.profile_adoption_recovery_mismatch())
                return
            }
            const contentDiffers = recoveryContentDiffers(recovery, response.editor)
            const scheduleDiffers =
                recovery.scheduleValue !==
                toDateTimeLocal(response.editor.publication.scheduledAt, timeZone)
            setEditor(response.editor)
            setSourceContent(recovery.sourceContent)
            setTargetText(recovery.targetText)
            setScheduleValue(recovery.scheduleValue)
            setExpectedRevision(response.editor.draft.revision)
            setDirty(contentDiffers)
            setScheduleDirty(scheduleDiffers)
            const refreshedSourceConflict =
                response.editor.draft.sourceRevision !== response.editor.post.sourceRevision
            setSaveState(
                refreshedSourceConflict ? 'conflict' : contentDiffers ? 'local_only' : 'saved'
            )
            setRecoveryAvailable(false)
            setMessage(
                refreshedSourceConflict
                    ? m.editor_recovered_review()
                    : contentDiffers || scheduleDiffers
                      ? m.editor_server_loaded()
                      : m.editor_recovered_no_changes()
            )
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return
            reportAccessRefusal(caughtError)
            if (generation !== requestGeneration.current) return
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    async function rebaseToLatestSource() {
        if (accessWritesBlocked) return
        const generation = ++requestGeneration.current
        const accessEpochAtStart = accessEpochRef.current
        const localRecovery = readRecovery(recoveryKey, timeZone)
        const hadLocalCopy = hasLocalChanges || localRecovery !== null
        if (hasLocalChanges) {
            writeRecovery(recoveryKey, {
                version: recoveryVersion,
                profileVersionId: editor.draft.profileVersionId,
                baseRevision: expectedRevision,
                sourceContent,
                targetText,
                scheduleValue,
                timeZone,
            })
        }
        setRecoveryAvailable(hadLocalCopy)
        setSaveState('rebasing')
        setMessage(m.editor_rebase_started())

        try {
            const response = await api.rebasePublicationDraft(
                projectId,
                editor.publication.id,
                expectedRevision
            )
            if (accessEpochAtStart !== accessEpochRef.current) return
            if (generation !== requestGeneration.current) return
            const rebasedSourceConflict =
                response.editor.draft.sourceRevision !== response.editor.post.sourceRevision
            setEditor(response.editor)
            setSourceContent(response.editor.post.sourceContent)
            setTargetText(formatJson(response.editor.draft.content))
            setExpectedRevision(response.editor.draft.revision)
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt, timeZone))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState(rebasedSourceConflict ? 'conflict' : 'saved')
            setRecoveryAvailable(hadLocalCopy)
            setMessage(
                rebasedSourceConflict
                    ? m.editor_rebase_conflict()
                    : hadLocalCopy
                      ? m.editor_shared_source_rebased_local()
                      : m.editor_shared_source_rebased()
            )
            invalidatePublicationQueries()
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return
            reportAccessRefusal(caughtError)
            if (generation !== requestGeneration.current) return
            if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                setSaveState('conflict')
                setMessage(m.editor_conflict_rebase())
                return
            }
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }
    const lastAccessReconciledEpoch = useRef<number | null>(null)

    useEffect(() => {
        if (accessStatus !== 'reconciling') return
        if (lastAccessReconciledEpoch.current === accessEpoch) return
        lastAccessReconciledEpoch.current = accessEpoch

        void (async () => {
            try {
                const response = await api.getPublicationEditor(projectId, editor.publication.id)
                if (accessEpoch !== accessEpochRef.current) return
                const recovery = readRecovery(recoveryKey, timeZone)
                const workingDiffers =
                    hasLocalChanges ||
                    (recovery !== null && recoveryContentDiffers(recovery, response.editor))
                const decision = decideConfirmedReconcile({
                    hasLocalChanges: workingDiffers,
                    serverRevision: response.editor.draft.revision,
                    expectedRevision,
                    serverSourceConflict:
                        response.editor.draft.sourceRevision !==
                        response.editor.post.sourceRevision,
                })
                if (decision.kind === 'adopt-server') {
                    setPromotionRecoveryRequired(false)
                    setRecoveryAvailable(recovery !== null)
                    setEditor(response.editor)
                    setSourceContent(response.editor.post.sourceContent)
                    setTargetText(formatJson(response.editor.draft.content))
                    setExpectedRevision(response.editor.draft.revision)
                    setScheduleValue(
                        toDateTimeLocal(response.editor.publication.scheduledAt, timeZone)
                    )
                    setDirty(false)
                    setScheduleDirty(false)
                    const refreshedSourceConflict =
                        response.editor.draft.sourceRevision !== response.editor.post.sourceRevision
                    setSaveState(refreshedSourceConflict ? 'conflict' : 'saved')
                    setMessage(
                        refreshedSourceConflict
                            ? m.editor_server_loaded_conflict({
                                  revision: response.editor.draft.sourceRevision,
                              })
                            : m.editor_server_loaded()
                    )
                } else if (decision.conflict) {
                    setSaveState('conflict')
                    setMessage(m.editor_server_newer_local())
                }
                onAccessReconciled?.(true)
            } catch {
                if (accessEpoch !== accessEpochRef.current) return
                onAccessReconciled?.(false)
            }
        })()
    }, [
        accessEpoch,
        accessStatus,
        editor.publication.id,
        expectedRevision,
        hasLocalChanges,
        onAccessReconciled,
        projectId,
        publicationEditable,
        recoveryKey,
        timeZone,
    ])

    async function promoteDraft() {
        if (
            accessWritesBlocked ||
            promotionInFlight.current ||
            promotionRecoveryRequired ||
            serverReadInFlight.current ||
            !publicationEditable ||
            dirty ||
            sourceConflict ||
            draftRequiresReview ||
            saveState !== 'saved' ||
            targetResult.value === null ||
            sourceIssue !== null
        ) {
            return
        }

        const scheduledAt = scheduleDirty
            ? parseSchedule(scheduleValue, timeZone)
            : editor.publication.scheduledAt
        const intent = publicationPromotionIntent(editor.publication.state, scheduledAt !== null)
        if (typeof scheduledAt === 'string') {
            setMessage(dateTimeLocalErrorMessage(scheduledAt))
            return
        }
        if (scheduledAt !== null && scheduledAt < Date.now()) {
            setMessage(dateTimeLocalErrorMessage('past'))
            return
        }

        promotionInFlight.current = true
        setPromotionPending(true)
        setMessage(null)
        const accessEpochAtStart = accessEpochRef.current
        try {
            const response = await api.promotePublicationDraft(
                projectId,
                editor.publication.id,
                expectedRevision,
                scheduledAt
            )
            if (accessEpochAtStart !== accessEpochRef.current) return
            setEditor(response.editor)
            setExpectedRevision(response.editor.draft.revision)
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt, timeZone))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState('saved')
            setRecoveryAvailable(false)
            setMessage(
                intent === 'schedule'
                    ? m.editor_scheduled()
                    : intent === 'update_schedule'
                      ? m.editor_schedule_updated()
                      : intent === 'return_draft'
                        ? m.editor_returned_draft()
                        : m.editor_version_selected()
            )
            invalidatePublicationQueries()
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return
            reportAccessRefusal(caughtError)
            if (isActiveChannelProfilePromotionError(caughtError)) {
                setSaveState('error')
                setMessage(m.editor_promotion_active_profile_mismatch())
                invalidatePublicationQueries()
                return
            }
            if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                setSaveState('conflict')
                setMessage(m.editor_conflict_promotion())
                return
            }
            setPromotionRecoveryRequired(true)
            setMessage(errorMessage(caughtError))
        } finally {
            promotionInFlight.current = false
            setPromotionPending(false)
        }
    }

    async function retryDelivery(): Promise<boolean> {
        if (accessWritesBlocked || onRetry === undefined || retryBlocked) return false

        const accessEpochAtStart = accessEpochRef.current
        requestGeneration.current += 1
        setRetryPending(true)
        setMessage(null)
        try {
            const retried = await onRetry()
            if (accessEpochAtStart !== accessEpochRef.current) return false
            if (!retried) {
                setMessage(m.editor_retry_failed())
                return false
            }

            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (accessEpochAtStart !== accessEpochRef.current) return false
            setEditor(response.editor)
            setSourceContent(response.editor.post.sourceContent)
            setTargetText(formatJson(response.editor.draft.content))
            setExpectedRevision(response.editor.draft.revision)
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt, timeZone))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState('saved')
            setRecoveryAvailable(false)
            removeRecovery(recoveryKey)
            setMessage(m.publication_retry_scheduled())
            invalidatePublicationQueries()
            return true
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return false
            reportAccessRefusal(caughtError)
            setSaveState('error')
            setMessage(errorMessage(caughtError))
            return false
        } finally {
            setRetryPending(false)
        }
    }

    async function recordManualPublication(): Promise<boolean> {
        if (
            accessWritesBlocked ||
            onPublish === undefined ||
            !isManualPublicationDue(editor.publication) ||
            manualPublicationBlocked
        ) {
            return false
        }

        const accessEpochAtStart = accessEpochRef.current
        requestGeneration.current += 1
        setManualPublishPending(true)
        setMessage(null)
        try {
            const published = await onPublish()
            if (accessEpochAtStart !== accessEpochRef.current) return false
            if (!published) {
                setMessage(m.editor_manual_publish_failed())
                return false
            }

            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (accessEpochAtStart !== accessEpochRef.current) return false
            setEditor(response.editor)
            setSourceContent(response.editor.post.sourceContent)
            setTargetText(formatJson(response.editor.draft.content))
            setExpectedRevision(response.editor.draft.revision)
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt, timeZone))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState('saved')
            setRecoveryAvailable(false)
            removeRecovery(recoveryKey)
            setMessage(m.editor_manual_published())
            invalidatePublicationQueries()
            return true
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return false
            reportAccessRefusal(caughtError)
            setSaveState('error')
            setMessage(errorMessage(caughtError))
            return false
        } finally {
            setManualPublishPending(false)
        }
    }

    async function cancelPublication(): Promise<boolean> {
        if (
            accessWritesBlocked ||
            onCancel === undefined ||
            editor.publication.state !== 'scheduled' ||
            cancellationBlocked
        ) {
            return false
        }

        const accessEpochAtStart = accessEpochRef.current
        requestGeneration.current += 1
        setCancelPending(true)
        setMessage(null)
        try {
            const cancelled = await onCancel()
            if (accessEpochAtStart !== accessEpochRef.current) return false
            if (!cancelled) {
                setMessage(m.editor_cancel_failed())
                return false
            }

            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (accessEpochAtStart !== accessEpochRef.current) return false
            setEditor(response.editor)
            setSourceContent(response.editor.post.sourceContent)
            setTargetText(formatJson(response.editor.draft.content))
            setExpectedRevision(response.editor.draft.revision)
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt, timeZone))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState('saved')
            setRecoveryAvailable(false)
            removeRecovery(recoveryKey)
            setMessage(m.editor_cancelled())
            invalidatePublicationQueries()
            return true
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return false
            reportAccessRefusal(caughtError)
            setSaveState('error')
            setMessage(errorMessage(caughtError))
            return false
        } finally {
            setCancelPending(false)
        }
    }

    async function reconcilePublication(input: PublicationOutcomeResolutionInput) {
        if (accessWritesBlocked) return
        const accessEpochAtStart = accessEpochRef.current
        try {
            const response = await api.reconcileAmbiguousPublication(
                projectId,
                editor.publication.id,
                input
            )
            if (accessEpochAtStart !== accessEpochRef.current) return
            setEditor(current => ({ ...current, publication: response.publication }))
            invalidatePublicationQueries()
        } catch (caughtError) {
            if (accessEpochAtStart !== accessEpochRef.current) return
            reportAccessRefusal(caughtError)
            throw caughtError
        }
    }

    const passiveStatus = passiveMessage && saveState !== 'error' && saveState !== 'conflict'
    const editorStatus = (
        <PublicationEditorStatus
            passive={passiveStatus}
            message={promotionRecoveryRequired ? m.editor_application_unconfirmed() : message}
            saveState={promotionRecoveryRequired ? 'error' : saveState}
            onCheckServer={promotionRecoveryRequired ? () => void reloadServerVersion() : undefined}
            checkingServer={serverReadPending}
            checkServerDisabled={
                editorMutationPending ||
                pendingSaveGeneration !== null ||
                saveState === 'saving' ||
                isRebasing
            }
            onReviewConflict={() => {
                setTechnicalDetailsOpen(true)
                const details = technicalDetailsRef.current
                if (details === null) return
                details.open = true
                details.querySelector('summary')?.focus()
                details.scrollIntoView({ block: 'start' })
            }}
        />
    )

    const sourceSection = (
        <div className="space-y-4">
            <PostSourceReview
                projectId={projectId}
                postId={editor.post.id}
                accessEpoch={accessEpoch}
                disabled={
                    readOnly ||
                    accessWritesBlocked ||
                    hasLocalChanges ||
                    !['saved', 'conflict'].includes(saveState) ||
                    editorMutationPending
                }
                onApplied={next => {
                    if (next.publication.id !== editor.publication.id || accessWritesBlocked) return
                    setEditor(next)
                    setSourceContent(next.post.sourceContent)
                    setTargetText(formatJson(next.draft.content))
                    setExpectedRevision(next.draft.revision)
                    setDirty(false)
                    setSaveState('saved')
                }}
            />
            <PublicationEditorSourceSection
                configuredEditor={configuredEditor}
                projectId={projectId}
                sourceContent={sourceContent}
                sourceRevision={editor.post.sourceRevision}
                disabled={
                    !publicationEditable ||
                    accessWritesBlocked ||
                    isRebasing ||
                    editorMutationPending
                }
                readOnly={!publicationEditable || accessWritesBlocked}
                mediaDisabled={
                    !publicationEditable ||
                    accessWritesBlocked ||
                    editorMutationPending ||
                    saveState === 'saving' ||
                    saveState === 'rebasing'
                }
                onTextChange={updateSourceText}
                onFormatChange={updateSourceFormat}
                onOptionalFieldChange={updateSourceOptionalField}
                onMediaChange={updateSourceMedia}
                onAssetsChange={setAvailableMedia}
            />
        </div>
    )
    const targetSection = (
        <div className="space-y-3">
            {publicationEditable &&
            editor.channel.profileVersionId !== editor.draft.profileVersionId ? (
                <Button
                    variant="secondary"
                    disabled={
                        accessWritesBlocked ||
                        pendingSaveGeneration !== null ||
                        sourceConflict ||
                        recoveryAvailable ||
                        serverReadPending ||
                        promotionPending ||
                        JSON.stringify(sourceContent) !== JSON.stringify(editor.post.sourceContent)
                    }
                    onClick={() => {
                        requestGeneration.current += 1
                        setAdoptionOpen(true)
                    }}>
                    {m.profile_adoption_title()}
                </Button>
            ) : null}
            {(editor.adoptionCount ?? 0) > 0 ? (
                <PublicationAdoptionHistory
                    projectId={projectId}
                    publicationId={editor.publication.id}
                    revision={editor.draft.revision}
                />
            ) : null}
            <PublicationEditorTargetSection
                projectId={projectId}
                publicationId={editor.publication.id}
                configuredEditor={configuredEditor}
                profile={editor.profile.profile}
                reviewState={editor.draft.reviewState}
                validationIssues={editor.draft.validationIssues}
                target={targetResult.value}
                targetText={targetText}
                disabled={
                    !publicationEditable ||
                    accessWritesBlocked ||
                    isRebasing ||
                    editorMutationPending
                }
                readOnly={!publicationEditable || accessWritesBlocked}
                open={targetCustomizationOpen}
                onOpenChange={setTargetCustomizationOpen}
                onTargetChange={next => {
                    setTargetText(formatJson(next))
                    setDirty(true)
                }}
                onRawTextChange={value => {
                    setTargetText(value)
                    setDirty(true)
                }}
                targetError={targetResult.error}
                issueCode={issueCode}
                issueMessage={issueMessage}
            />
        </div>
    )
    const draftPreview = (
        <PublicationDraftPreview
            channel={editor.channel}
            execution={previewProfile.execution}
            identityMode={publicationEditable ? 'sample' : 'channel'}
            media={previewMedia}
            mediaSelections={previewMediaSelections}
            postContent={previewContent}
            postTitle={getTargetPreviewTitle(previewProfile, previewTarget)}
        />
    )

    if (adoptionOpen) {
        const epochAtOpen = accessEpoch
        return (
            <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
                <PublicationProfileAdoption
                    projectId={projectId}
                    editor={editor}
                    localContent={dirty ? targetResult.value : null}
                    blocked={accessWritesBlocked || !publicationEditable}
                    onCancel={() => setAdoptionOpen(false)}
                    onError={reportAccessRefusal}
                    onAdopted={next => {
                        if (epochAtOpen !== accessEpochRef.current) return
                        requestGeneration.current += 1
                        setEditor(next)
                        setSourceContent(next.post.sourceContent)
                        setExpectedRevision(next.draft.revision)
                        setTargetText(formatJson(next.draft.content))
                        setDirty(false)
                        setSaveState('saved')
                        setMessage(null)
                        setAdoptionOpen(false)
                        if (!scheduleDirty) removeRecovery(recoveryKey)
                        invalidatePublicationQueries()
                    }}
                />
            </main>
        )
    }

    return (
        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            {recoveryAvailable ? (
                <Dialog open onOpenChange={() => {}}>
                    <DialogContent
                        showCloseButton={false}
                        data-publication-recovery-decision="true"
                        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
                        <DialogTitle>{m.editor_recovery_choice_title()}</DialogTitle>
                        <DialogDescription>
                            {m.editor_recovery_choice_description()}
                        </DialogDescription>
                        {pendingRecovery !== null &&
                        !recoveryProfileMatches(pendingRecovery, editor) ? (
                            <>
                                <p role="alert">{m.profile_adoption_recovery_mismatch()}</p>
                                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                                    {JSON.stringify(
                                        {
                                            sourceContent: pendingRecovery.sourceContent,
                                            targetText: pendingRecovery.targetText,
                                            scheduleValue: pendingRecovery.scheduleValue,
                                        },
                                        null,
                                        2
                                    )}
                                </pre>
                            </>
                        ) : pendingRecovery ? (
                            <PublicationRecoveryComparison
                                editor={editor}
                                localSource={pendingRecovery.sourceContent}
                                localTarget={pendingRecoveryTarget}
                                localSchedule={pendingRecovery.scheduleValue}
                                savedSchedule={toDateTimeLocal(
                                    editor.publication.scheduledAt,
                                    timeZone
                                )}
                                projectId={projectId}
                                media={[...availableMedia, ...readOnlyMedia]}
                            />
                        ) : null}
                        {saveState === 'error' && message ? (
                            <p role="alert" className="break-words text-sm text-state-failed">
                                {message}
                            </p>
                        ) : null}
                        <DialogFooter>
                            <Button
                                variant="secondary"
                                disabled={
                                    accessWritesBlocked || isRebasing || editorMutationPending
                                }
                                onClick={() => {
                                    if (accessWritesBlocked) return
                                    requestGeneration.current += 1
                                    removeRecovery(recoveryKey)
                                    setRecoveryAvailable(false)
                                }}>
                                {m.editor_discard_recovery()}
                            </Button>
                            <Button
                                disabled={
                                    accessWritesBlocked ||
                                    isRebasing ||
                                    editorMutationPending ||
                                    (pendingRecovery !== null &&
                                        !recoveryProfileMatches(pendingRecovery, editor))
                                }
                                onClick={restoreRecovery}>
                                {m.editor_restore_recovery()}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
            <div className="mx-auto min-w-0 max-w-6xl" inert={recoveryAvailable}>
                <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-5 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
                    <Link
                        aria-label={
                            backToCalendar === undefined
                                ? m.editor_back_to_queue()
                                : m.editor_back_to_calendar()
                        }
                        className={buttonVariants({
                            variant: 'ghost',
                            size: 'icon',
                            className:
                                'justify-self-start text-muted-foreground hover:text-foreground sm:w-auto sm:gap-1.5 sm:px-2.5',
                        })}
                        params={{ projectId }}
                        search={
                            backToCalendar === undefined
                                ? { filter: undefined, sort: undefined, tagIds: undefined }
                                : backToCalendar
                        }
                        to={
                            backToCalendar === undefined
                                ? '/dashboard/projects/$projectId/queue'
                                : '/dashboard/projects/$projectId/overview'
                        }>
                        <AltArrowLeftIcon aria-hidden="true" />
                        <span className="hidden sm:inline">
                            {backToCalendar === undefined
                                ? m.editor_back_to_queue()
                                : m.editor_back_to_calendar()}
                        </span>
                    </Link>
                    <h1
                        className="col-span-full row-start-2 min-w-0 line-clamp-2 break-words text-center font-heading text-xl font-semibold leading-tight sm:text-2xl lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:line-clamp-1 lg:truncate xl:text-3xl"
                        title={publicationEditorHeading(editor, sourceContent)}>
                        {publicationEditorHeading(editor, sourceContent)}
                    </h1>
                    {publicationEditable ? (
                        <div className="col-start-2 row-start-1 min-w-0 justify-self-end lg:col-start-3">
                            <PublicationEditorSaveIndicator
                                compactOnMobile
                                state={saveState}
                                revision={editor.draft.revision}
                                showRevision={false}
                            />
                        </div>
                    ) : null}
                </header>

                <PublicationLifecyclePanel
                    connection={
                        publisherConnections === undefined
                            ? undefined
                            : (publisherConnections.find(
                                  connection => connection.channelId === editor.channel.id
                              ) ?? null)
                    }
                    readOnly={readOnly || accessWritesBlocked}
                    cancelDisabled={cancellationBlocked}
                    onCancel={onCancel === undefined ? undefined : () => setCancelDialogOpen(true)}
                    onPublish={onPublish === undefined ? undefined : recordManualPublication}
                    onRetry={
                        editor.publication.state === 'failed'
                            ? () => void retryDelivery()
                            : undefined
                    }
                    pending={manualPublicationBlocked || cancelPending || retryPending}
                    publication={editor.publication}
                    retryDisabled={retryBlocked}
                    timeZone={timeZone}
                />

                {onCancel !== undefined ? (
                    <PublicationCancellationDialog
                        open={cancelDialogOpen}
                        onCancel={cancelPublication}
                        onOpenChange={setCancelDialogOpen}
                        pending={cancelPending}
                    />
                ) : null}

                {!promotionRecoveryRequired && !passiveStatus ? editorStatus : null}

                <PublicationOutcomePanel
                    publication={editor.publication}
                    onResolve={reconcilePublication}
                />

                {editor.publication.state === 'published' &&
                editor.publication.externalId &&
                editor.profile.profile.execution.kind === 'built_in' &&
                ((editor.profile.profile.execution.contractId === 'bluesky' &&
                    editor.publication.externalId.startsWith('at://')) ||
                    (editor.profile.profile.execution.contractId === 'mastodon' &&
                        editor.publication.externalUrl)) ? (
                    <PublicationCommentsPanel
                        provider={
                            editor.profile.profile.execution.contractId === 'mastodon'
                                ? 'mastodon'
                                : 'bluesky'
                        }
                        projectId={projectId}
                        publicationId={editor.publication.id}
                        canRefresh={!readOnly && !accessWritesBlocked}
                        timeZone={timeZone}
                        onAccessRefused={onAccessRefused}
                    />
                ) : null}

                {availableTags.length > 0 || publicationEditable ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <PublicationTagPicker
                            ariaLabel={m.taxonomy_select_tags()}
                            archivedLabel={m.common_archived()}
                            disabled={
                                !publicationEditable ||
                                accessWritesBlocked ||
                                isRebasing ||
                                editorMutationPending ||
                                tagSavePending
                            }
                            emptyLabel={m.taxonomy_no_tags()}
                            label={m.taxonomy_tags()}
                            onChange={value => void handlePublicationTagIdsChange(value)}
                            onCreateTag={publicationEditable ? onCreateProjectTag : undefined}
                            selectedTagIds={publicationTagIds}
                            selectedLabel={count => m.taxonomy_selected_tags({ count })}
                            tags={availableTags}
                        />
                        {tagError ? (
                            <p className="text-xs text-state-failed" role="alert">
                                {tagError}
                            </p>
                        ) : null}
                    </div>
                ) : null}

                <PublicationComposer
                    className="mt-6"
                    channelNavigation={
                        editorChannels.length > 1 ? (
                            <PublicationChannelRail
                                activeChannelId={editor.channel.id}
                                channels={editorChannels}
                                disabled={isRebasing || editorMutationPending}
                                onActiveChannelChange={handleChannelChange}
                                selectedChannelIds={editorChannelIds}
                            />
                        ) : undefined
                    }
                    editor={
                        publicationEditable ? (
                            <div className="min-w-0 space-y-5">
                                {sourceSection}
                                {targetSection}
                            </div>
                        ) : (
                            <div className="mx-auto max-w-2xl">{draftPreview}</div>
                        )
                    }
                    settings={
                        publicationEditable ? (
                            <PublicationEditorDeliverySettings
                                timeZone={timeZone}
                                scheduleValue={scheduleValue}
                                disabled={promotionBlocked}
                                onScheduleChange={value => {
                                    setScheduleValue(value)
                                    setScheduleDirty(
                                        value !==
                                            toDateTimeLocal(
                                                editor.publication.scheduledAt,
                                                timeZone
                                            )
                                    )
                                }}
                            />
                        ) : undefined
                    }
                    footer={
                        publicationEditable || promotionRecoveryRequired ? (
                            <div className="grid w-full min-w-0 gap-3">
                                {promotionRecoveryRequired ? editorStatus : null}
                                {publicationEditable ? (
                                    <PublicationEditorPromotionAction
                                        pending={promotionPending}
                                        intent={publicationPromotionIntent(
                                            editor.publication.state,
                                            scheduleValue !== ''
                                        )}
                                        disabled={promotionBlocked}
                                        draftRequiresReview={draftRequiresReview}
                                        draftDiffersFromTarget={
                                            draftDiffersFromTarget || scheduleDirty
                                        }
                                        onPromote={() => void promoteDraft()}
                                    />
                                ) : null}
                            </div>
                        ) : undefined
                    }
                    preview={publicationEditable ? draftPreview : undefined}
                />

                {!promotionRecoveryRequired && passiveStatus ? editorStatus : null}

                <div
                    className={`mt-5 grid min-w-0 gap-3 ${publicationEditable ? '' : 'mx-auto max-w-2xl'}`}>
                    <details
                        className="group rounded-xl bg-surface-inset/35 p-1 shadow-surface"
                        ref={technicalDetailsRef}
                        open={technicalDetailsOpen}
                        onToggle={event => setTechnicalDetailsOpen(event.currentTarget.open)}>
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                            <span className="min-w-0">
                                <span className="font-medium">{m.editor_technical_details()}</span>
                            </span>
                            <AltArrowDownIcon
                                aria-hidden="true"
                                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                            />
                        </summary>
                        <div className="space-y-3 px-2 pb-2 pt-2 sm:px-3">
                            {!publicationEditable ? sourceSection : null}
                            {!publicationEditable ? targetSection : null}
                            <PublicationEditorSidebar
                                editor={editor}
                                projectId={projectId}
                                media={[...availableMedia, ...readOnlyMedia]}
                                capabilitySummary={capabilitySummary}
                                timeZone={timeZone}
                                sourceConflict={sourceConflict}
                                saveState={saveState}
                                isRebasing={isRebasing || editorMutationPending}
                                recoveryAvailable={recoveryAvailable}
                                hasLocalChanges={hasLocalChanges}
                                onRebase={() => void rebaseToLatestSource()}
                                onReload={() => void reloadServerVersion()}
                                onRestore={() => void restoreRecoveryAgainstLatestServer()}
                            />
                        </div>
                    </details>

                    <details className="group rounded-xl bg-surface-inset/35 p-1 shadow-surface">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                            <span className="min-w-0">
                                <span className="font-medium">{m.editor_activity_details()}</span>
                            </span>
                            <AltArrowDownIcon
                                aria-hidden="true"
                                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                            />
                        </summary>
                        <div className="px-2 pb-2 pt-2 sm:px-3">
                            <PublicationActivityTimeline
                                className="mt-0 bg-transparent px-0 shadow-none"
                                projectId={projectId}
                                publicationId={editor.publication.id}
                                refreshKey={editor.publication.updatedAt}
                                timeZone={timeZone}
                            />
                        </div>
                    </details>
                </div>
            </div>
        </main>
    )
}

function publicationEditorHeading(editor: PublicationEditorState, sourceContent: SourceContent) {
    const title = editor.post.title?.trim()
    if (title) return title

    const candidate = sourceContent.body?.text.trim() || sourceContent.headline?.trim() || ''
    if (candidate === '') {
        return sourceContent.media.length > 0
            ? m.publication_media_count({ count: sourceContent.media.length })
            : m.publication_untitled()
    }

    const normalized = candidate.replace(/\s+/g, ' ')
    return normalized.length > 96 ? `${normalized.slice(0, 93)}…` : normalized
}

function createRecoveryKey(projectId: string, publicationId: string) {
    return `postbot:publication-editor:v${recoveryVersion}:${encodeURIComponent(projectId)}:${encodeURIComponent(publicationId)}`
}

function readRecovery(key: string, timeZone: string): RecoveryBuffer | null {
    try {
        const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')
        if (!isRecord(value) || value.version !== recoveryVersion) return null
        if (
            typeof value.baseRevision !== 'number' ||
            !Number.isSafeInteger(value.baseRevision) ||
            value.baseRevision < 1
        ) {
            return null
        }
        if (typeof value.targetText !== 'string' || !isRecord(value.sourceContent)) return null
        if (typeof value.scheduleValue !== 'string') return null
        if (value.timeZone !== timeZone) return null
        if (!Array.isArray(value.sourceContent.media)) return null
        return {
            version: recoveryVersion,
            profileVersionId:
                typeof value.profileVersionId === 'string' ? value.profileVersionId : undefined,
            baseRevision: value.baseRevision,
            sourceContent: value.sourceContent as SourceContent,
            targetText: value.targetText,
            scheduleValue: value.scheduleValue,
            timeZone,
        }
    } catch {
        return null
    }
}

function writeRecovery(key: string, value: RecoveryBuffer) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // Recovery is best effort when storage is disabled or full.
    }
}

function removeRecovery(key: string) {
    try {
        window.localStorage.removeItem(key)
    } catch {
        // Ignore unavailable browser storage.
    }
}

function parseTargetText(value: string): {
    readonly value: Record<string, unknown> | null
    readonly error: string | null
} {
    try {
        const parsed: unknown = JSON.parse(value)
        if (!isRecord(parsed)) {
            return { value: null, error: m.editor_target_object_required() }
        }
        return { value: parsed, error: null }
    } catch {
        return { value: null, error: m.editor_target_invalid_json() }
    }
}

function sourceContentIssue(source: SourceContent): string | null {
    if (source.body === undefined && source.media.length === 0) {
        return m.editor_source_required()
    }
    if (source.body !== undefined && source.body.text.trim() === '') {
        return m.editor_source_body_blank()
    }
    if (source.headline !== undefined && source.headline.trim() === '') {
        return m.editor_headline_blank()
    }
    return null
}

function getCapabilitySummary(profile: Profile): CapabilitySummary {
    if (!isRecord(profile.capabilities)) return { textFields: [], mediaFieldCount: 0 }
    const execution = isRecord(profile.execution) ? profile.execution : null
    const legacyXProfile = execution?.kind === 'built_in' && execution.contractId === 'x'
    const textFields = Array.isArray(profile.capabilities.textFields)
        ? profile.capabilities.textFields.flatMap(value => {
              if (!isRecord(value) || typeof value.bindingId !== 'string') return []
              return [
                  {
                      bindingId: value.bindingId,
                      maxLength:
                          typeof value.maxWeightedLength === 'number' ||
                          (legacyXProfile && value.bindingId === 'text')
                              ? null
                              : typeof value.maxLength === 'number'
                                ? value.maxLength
                                : null,
                      maxWeightedLength:
                          typeof value.maxWeightedLength === 'number'
                              ? value.maxWeightedLength
                              : legacyXProfile && value.bindingId === 'text'
                                ? X_MAX_WEIGHTED_POST_LENGTH
                                : null,
                      acceptedSourceFormats: Array.isArray(value.acceptedSourceFormats)
                          ? value.acceptedSourceFormats.filter(
                                (format): format is string => typeof format === 'string'
                            )
                          : [],
                  },
              ]
          })
        : []
    const mediaFieldCount = Array.isArray(profile.capabilities.mediaFields)
        ? profile.capabilities.mediaFields.length
        : 0
    return { textFields, mediaFieldCount }
}

function issueCode(issue: Record<string, unknown>) {
    return typeof issue.code === 'string' ? issue.code : 'validation_issue'
}

function issueMessage(issue: Record<string, unknown>) {
    const code = issueCode(issue)
    const path = typeof issue.path === 'string' && issue.path !== '' ? issue.path : null
    return path === null
        ? m.editor_target_validation_issue_without_path({ code })
        : m.editor_target_validation_issue({ path, code })
}

function formatJson(value: unknown) {
    return JSON.stringify(value, null, 2)
}

function parseSchedule(value: string, timeZone: string): DateTimeLocalResult {
    return parseDateTimeLocal(value, timeZone)
}

function errorMessage(error: unknown) {
    return formatApiError(error)
}

function recoveryContentDiffers(
    recovery: RecoveryBuffer,
    current: PublicationEditorState
): boolean {
    return (
        formatJson(recovery.sourceContent) !== formatJson(current.post.sourceContent) ||
        recovery.targetText !== formatJson(current.draft.content)
    )
}

function publicationEditorFingerprint(editor: PublicationEditorState): string {
    const publication = editor.publication
    const draft = editor.draft
    const target = editor.selectedTarget

    return [
        publication.id,
        publication.state,
        publication.updatedAt,
        publication.scheduledAt ?? '',
        publication.publishedAt ?? '',
        publication.externalId ?? '',
        publication.externalUrl ?? '',
        publication.errorMessage ?? '',
        publication.reviewState,
        publication.targetRevisionId ?? '',
        draft.id,
        draft.revision,
        draft.updatedAt,
        draft.sourceRevision,
        editor.post.sourceRevision,
        draft.profileVersionId,
        draft.reviewState,
        target?.id ?? '',
        target?.sequence ?? '',
        target?.sourceRevision ?? '',
    ].join('|')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
