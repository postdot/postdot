import { Button, buttonVariants } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@herald/ui/components/dialog'
import { X_MAX_WEIGHTED_POST_LENGTH } from '@herald/x/text'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type MediaSelection } from '@/components/media-attachment-picker'
import { PublicationActivityTimeline } from '@/components/publication-activity-timeline'
import { PublicationCancellationDialog } from '@/components/publication-cancellation-dialog'
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
    type PublicationSummary,
} from '@/lib/api'
import {
    dateTimeLocalErrorMessage,
    parseDateTimeLocal,
    toDateTimeLocal,
    type DateTimeLocalResult,
} from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import type { PublicationCalendarView } from '@/lib/publication-calendar-events'
import { canEditPublication, isManualPublicationDue } from '@/lib/publication-lifecycle'
import { getTargetMediaSelections, updateTargetMedia } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

type SourceContent = PublicationEditorState['post']['sourceContent']
type Profile = PublicationEditorState['profile']['profile']

interface PublicationEditorProps {
    readonly channels?: readonly Channel[]
    readonly projectId: string
    readonly initialEditor: PublicationEditorState
    readonly initialPublicationTags: readonly ProjectTag[]
    readonly onCancel?: () => Promise<boolean>
    readonly onPublish?: () => Promise<boolean>
    readonly onRetry?: () => Promise<boolean>
    readonly readOnly?: boolean
    readonly projectTags: readonly ProjectTag[]
    readonly relatedPublications?: readonly PublicationSummary[]
    readonly backToCalendar?: {
        readonly date?: string
        readonly view?: PublicationCalendarView
    }
    readonly timeZone: string
}

interface RecoveryBuffer {
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
    channels = [],
    initialEditor,
    initialPublicationTags,
    onCancel,
    onPublish,
    onRetry,
    readOnly = false,
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
        initialRecovery.baseRevision >= initialEditor.draft.revision
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
    const pendingRecoveryExcerpt = recoveryAvailable
        ? readRecovery(recoveryKey, timeZone)?.sourceContent.body?.text?.trim().slice(0, 180)
        : undefined
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
    const [cancelPending, setCancelPending] = useState(false)
    const [retryPending, setRetryPending] = useState(false)
    const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(initialSourceConflict)
    const [targetCustomizationOpen, setTargetCustomizationOpen] = useState(
        initialEditor.draft.reviewState !== 'compatible'
    )
    const technicalDetailsRef = useRef<HTMLDetailsElement>(null)
    const requestGeneration = useRef(0)

    const availableTags = useMemo(() => {
        const byId = new Map<string, ProjectTag>()
        for (const tag of projectTags) {
            if (tag.state === 'active') byId.set(tag.id, tag)
        }
        for (const tag of initialPublicationTags) byId.set(tag.id, tag)
        return [...byId.values()]
    }, [initialPublicationTags, projectTags])

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
        manualPublishPending ||
        hasLocalChanges ||
        saveState !== 'saved' ||
        sourceConflict ||
        draftRequiresReview ||
        draftDiffersFromTarget
    const promotionBlocked =
        dirty ||
        sourceConflict ||
        draftRequiresReview ||
        saveState !== 'saved' ||
        targetResult.value === null ||
        sourceIssue !== null
    const cancellationBlocked =
        cancelPending || hasLocalChanges || saveState !== 'saved' || isRebasing
    const retryBlocked =
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
    const previewMediaSelections = useMemo(
        () =>
            targetResult.value === null
                ? sourceContent.media
                : getTargetMediaSelections(editor.profile.profile, targetResult.value),
        [editor.profile.profile, sourceContent.media, targetResult.value]
    )
    const readOnlyMediaIds = previewMediaSelections
        .map(selection => selection.assetId)
        .join('\u0000')
    useEffect(() => {
        if (publicationEditable || readOnlyMediaIds === '') return

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
    }, [projectId, publicationEditable, readOnlyMediaIds])
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
        () => getTargetPreviewText(targetResult.value) ?? sourceContent.body?.text ?? '',
        [sourceContent.body?.text, targetResult.value]
    )
    const currentEditorFingerprint = publicationEditorFingerprint(editor)
    const incomingEditorFingerprint = publicationEditorFingerprint(initialEditor)
    const lastIncomingEditorFingerprint = useRef<string | null>(null)

    useEffect(() => {
        if (initialEditor.publication.id !== editor.publication.id) return
        if (incomingEditorFingerprint === lastIncomingEditorFingerprint.current) return
        lastIncomingEditorFingerprint.current = incomingEditorFingerprint
        if (incomingEditorFingerprint === currentEditorFingerprint) return

        requestGeneration.current += 1
        if (hasLocalChanges) {
            setSaveState(current => (current === 'saving' ? current : 'conflict'))
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
        if (!publicationEditable) return
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
            setPublicationTagIds(response.tags.map(tag => tag.id))
            invalidatePublicationQueries()
        } catch (caughtError) {
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
        if (!publicationEditable || !dirty || recoveryAvailable) return

        const generation = ++requestGeneration.current
        if (sourceConflict || sourceIssue !== null || targetResult.value === null) {
            setSaveState(sourceConflict ? 'conflict' : 'local_only')
            return
        }
        const targetContent = targetResult.value

        setSaveState('saving')
        const timer = window.setTimeout(() => {
            void api
                .savePublicationDraft(projectId, editor.publication.id, {
                    expectedRevision,
                    sourceContent,
                    targetContent,
                })
                .then(response => {
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
                    if (generation !== requestGeneration.current) return
                    if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                        setSaveState('conflict')
                        setMessage(m.editor_server_newer_local())
                        return
                    }
                    setSaveState('error')
                    setMessage(errorMessage(caughtError))
                })
        }, 650)

        return () => {
            window.clearTimeout(timer)
        }
    }, [
        dirty,
        editor.publication.id,
        expectedRevision,
        projectId,
        publicationEditable,
        recoveryAvailable,
        recoveryKey,
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
        const generation = ++requestGeneration.current
        const localSource = sourceContent
        const localTargetText = targetText
        const localRecovery = readRecovery(recoveryKey, timeZone)
        if (hasLocalChanges) {
            writeRecovery(recoveryKey, {
                version: recoveryVersion,
                baseRevision: expectedRevision,
                sourceContent: localSource,
                targetText: localTargetText,
                scheduleValue,
                timeZone,
            })
        }

        try {
            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (generation !== requestGeneration.current) return
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
            if (generation !== requestGeneration.current) return
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    function restoreRecovery() {
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
        const recovery = readRecovery(recoveryKey, timeZone)
        if (recovery === null) return

        const generation = ++requestGeneration.current
        try {
            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (generation !== requestGeneration.current) return
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
            if (generation !== requestGeneration.current) return
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    async function rebaseToLatestSource() {
        const generation = ++requestGeneration.current
        const localRecovery = readRecovery(recoveryKey, timeZone)
        const hadLocalCopy = hasLocalChanges || localRecovery !== null
        if (hasLocalChanges) {
            writeRecovery(recoveryKey, {
                version: recoveryVersion,
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

    async function promoteDraft() {
        if (
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

        const scheduledAt = parseSchedule(scheduleValue, timeZone)
        if (typeof scheduledAt === 'string') {
            setMessage(dateTimeLocalErrorMessage(scheduledAt))
            return
        }
        if (scheduledAt !== null && scheduledAt < Date.now()) {
            setMessage(dateTimeLocalErrorMessage('past'))
            return
        }

        setMessage(null)
        try {
            const response = await api.promotePublicationDraft(
                projectId,
                editor.publication.id,
                expectedRevision,
                scheduledAt
            )
            setEditor(response.editor)
            setExpectedRevision(response.editor.draft.revision)
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt, timeZone))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState('saved')
            setRecoveryAvailable(false)
            setMessage(m.editor_promoted())
            invalidatePublicationQueries()
        } catch (caughtError) {
            if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                setSaveState('conflict')
                setMessage(m.editor_conflict_promotion())
                return
            }
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    async function retryDelivery(): Promise<boolean> {
        if (onRetry === undefined || retryBlocked) return false

        requestGeneration.current += 1
        setRetryPending(true)
        setMessage(null)
        try {
            const retried = await onRetry()
            if (!retried) {
                setMessage(m.editor_retry_failed())
                return false
            }

            const response = await api.getPublicationEditor(projectId, editor.publication.id)
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
            setSaveState('error')
            setMessage(errorMessage(caughtError))
            return false
        } finally {
            setRetryPending(false)
        }
    }

    async function recordManualPublication(): Promise<boolean> {
        if (
            onPublish === undefined ||
            !isManualPublicationDue(editor.publication) ||
            manualPublicationBlocked
        ) {
            return false
        }

        requestGeneration.current += 1
        setManualPublishPending(true)
        setMessage(null)
        try {
            const published = await onPublish()
            if (!published) {
                setMessage(m.editor_manual_publish_failed())
                return false
            }

            const response = await api.getPublicationEditor(projectId, editor.publication.id)
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
            setSaveState('error')
            setMessage(errorMessage(caughtError))
            return false
        } finally {
            setManualPublishPending(false)
        }
    }

    async function cancelPublication(): Promise<boolean> {
        if (
            onCancel === undefined ||
            editor.publication.state !== 'scheduled' ||
            cancellationBlocked
        ) {
            return false
        }

        requestGeneration.current += 1
        setCancelPending(true)
        setMessage(null)
        try {
            const cancelled = await onCancel()
            if (!cancelled) {
                setMessage(m.editor_cancel_failed())
                return false
            }

            const response = await api.getPublicationEditor(projectId, editor.publication.id)
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
            setSaveState('error')
            setMessage(errorMessage(caughtError))
            return false
        } finally {
            setCancelPending(false)
        }
    }

    async function reconcilePublication(input: PublicationOutcomeResolutionInput) {
        const response = await api.reconcileAmbiguousPublication(
            projectId,
            editor.publication.id,
            input
        )
        setEditor(current => ({ ...current, publication: response.publication }))
        invalidatePublicationQueries()
    }

    const passiveStatus = passiveMessage && saveState !== 'error' && saveState !== 'conflict'
    const editorStatus = (
        <PublicationEditorStatus
            passive={passiveStatus}
            message={message}
            saveState={saveState}
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
        <PublicationEditorSourceSection
            projectId={projectId}
            sourceContent={sourceContent}
            sourceRevision={editor.post.sourceRevision}
            disabled={!publicationEditable || isRebasing}
            readOnly={!publicationEditable}
            mediaDisabled={
                !publicationEditable || saveState === 'saving' || saveState === 'rebasing'
            }
            onTextChange={updateSourceText}
            onFormatChange={updateSourceFormat}
            onOptionalFieldChange={updateSourceOptionalField}
            onMediaChange={updateSourceMedia}
            onAssetsChange={setAvailableMedia}
        />
    )
    const targetSection = (
        <PublicationEditorTargetSection
            profile={editor.profile.profile}
            reviewState={editor.draft.reviewState}
            validationIssues={editor.draft.validationIssues}
            target={targetResult.value}
            targetText={targetText}
            disabled={!publicationEditable || isRebasing}
            readOnly={!publicationEditable}
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
    )
    const draftPreview = (
        <PublicationDraftPreview
            channel={editor.channel}
            identityMode={publicationEditable ? 'sample' : 'channel'}
            media={previewMedia}
            mediaSelections={previewMediaSelections}
            postContent={previewContent}
            postTitle={editor.post.title ?? ''}
        />
    )

    return (
        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            {recoveryAvailable ? (
                <Dialog open onOpenChange={() => {}}>
                    <DialogContent
                        showCloseButton={false}
                        data-publication-recovery-decision="true"
                        className="sm:max-w-md">
                        <DialogTitle>{m.editor_recovery_choice_title()}</DialogTitle>
                        <DialogDescription>
                            {m.editor_recovery_choice_description()}
                        </DialogDescription>
                        {pendingRecoveryExcerpt ? (
                            <p className="line-clamp-3 break-words rounded-md bg-surface-inset/50 p-3 text-sm text-muted-foreground">
                                {pendingRecoveryExcerpt}
                            </p>
                        ) : null}
                        {saveState === 'error' && message ? (
                            <p role="alert" className="break-words text-sm text-state-failed">
                                {message}
                            </p>
                        ) : null}
                        <DialogFooter>
                            <Button
                                variant="secondary"
                                disabled={isRebasing}
                                onClick={() => {
                                    requestGeneration.current += 1
                                    removeRecovery(recoveryKey)
                                    setRecoveryAvailable(false)
                                }}>
                                {m.editor_discard_recovery()}
                            </Button>
                            <Button disabled={isRebasing} onClick={restoreRecovery}>
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

                {!passiveStatus ? editorStatus : null}

                <PublicationOutcomePanel
                    publication={editor.publication}
                    onResolve={reconcilePublication}
                />

                {availableTags.length > 0 ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <PublicationTagPicker
                            ariaLabel={m.taxonomy_select_tags()}
                            archivedLabel={m.common_archived()}
                            disabled={!publicationEditable || isRebasing || tagSavePending}
                            emptyLabel={m.taxonomy_no_tags()}
                            label={m.taxonomy_tags()}
                            onChange={value => void handlePublicationTagIdsChange(value)}
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
                                disabled={isRebasing}
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
                        publicationEditable ? (
                            <PublicationEditorPromotionAction
                                disabled={promotionBlocked}
                                draftRequiresReview={draftRequiresReview}
                                draftDiffersFromTarget={draftDiffersFromTarget || scheduleDirty}
                                onPromote={() => void promoteDraft()}
                            />
                        ) : undefined
                    }
                    preview={publicationEditable ? draftPreview : undefined}
                />

                {passiveStatus ? editorStatus : null}

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
                                capabilitySummary={capabilitySummary}
                                timeZone={timeZone}
                                sourceConflict={sourceConflict}
                                saveState={saveState}
                                isRebasing={isRebasing}
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
    return `herald:publication-editor:v${recoveryVersion}:${encodeURIComponent(projectId)}:${encodeURIComponent(publicationId)}`
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

function getTargetPreviewText(target: Record<string, unknown> | null): string | null {
    if (target === null) return null

    for (const key of ['commentary', 'text', 'body', 'body_markdown', 'content']) {
        const value = target[key]
        if (typeof value === 'string') return value
    }
    return null
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
