import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { type MediaSelection } from '@/components/media-attachment-picker'
import { PublicationComposer } from '@/components/publication-composer'
import { PublicationDraftPreview } from '@/components/publication-draft-preview'
import { PublicationEditorPromotionSection } from '@/components/publication-editor-promotion-section'
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
import { dateTimeLocalErrorMessage, parseDateTimeLocal, toDateTimeLocal } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import type { PublicationCalendarView } from '@/lib/publication-calendar-events'
import { canEditPublication, isManualPublicationDue } from '@/lib/publication-lifecycle'
import { updateTargetMedia } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

type SourceContent = PublicationEditorState['post']['sourceContent']
type Profile = PublicationEditorState['profile']['profile']

interface PublicationEditorProps {
    readonly channels?: readonly Channel[]
    readonly projectId: string
    readonly initialEditor: PublicationEditorState
    readonly initialPublicationTags: readonly ProjectTag[]
    readonly onPublish?: () => Promise<boolean>
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
    onPublish,
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
    const initialPublicationEditable = canEditPublication(initialEditor.publication.state)
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
    const [message, setMessage] = useState<string | null>(
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
    const [recoveryAvailable, setRecoveryAvailable] = useState(
        initialPublicationEditable && initialRecovery !== null && !shouldRestoreInitialRecovery
    )
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
    const [manualPublishPending, setManualPublishPending] = useState(false)
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
    const publicationEditable = canEditPublication(editor.publication.state)
    const manualPublicationBlocked =
        manualPublishPending ||
        hasLocalChanges ||
        saveState !== 'saved' ||
        sourceConflict ||
        draftRequiresReview ||
        draftDiffersFromTarget
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
    const previewMedia = useMemo(
        () =>
            sourceContent.media
                .map(selection =>
                    availableMedia.find(asset => asset.asset.id === selection.assetId)
                )
                .filter((asset): asset is MediaReference => asset !== undefined),
        [availableMedia, sourceContent.media]
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
        setSaveState(
            initialEditor.draft.sourceRevision !== initialEditor.post.sourceRevision
                ? 'conflict'
                : 'saved'
        )
        setMessage(m.editor_background_update())
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
        if (!publicationEditable || !dirty) return

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
        setRecoveryAvailable(hasLocalChanges || localRecovery !== null)

        try {
            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (generation !== requestGeneration.current) return
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

    async function reconcilePublication(input: PublicationOutcomeResolutionInput) {
        const response = await api.reconcileAmbiguousPublication(
            projectId,
            editor.publication.id,
            input
        )
        setEditor(current => ({ ...current, publication: response.publication }))
        invalidatePublicationQueries()
    }

    return (
        <section className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <div className="flex flex-col justify-between gap-5 pb-7 sm:flex-row sm:items-end">
                <div>
                    {backToCalendar === undefined ? (
                        <Link
                            to="/dashboard/projects/$projectId/queue"
                            params={{ projectId }}
                            search={{ filter: undefined, tagIds: undefined }}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                            <ArrowLeftIcon aria-hidden="true" className="size-4" />
                            {m.editor_back_to_queue()}
                        </Link>
                    ) : (
                        <Link
                            to="/dashboard/projects/$projectId/overview"
                            params={{ projectId }}
                            search={backToCalendar}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                            <ArrowLeftIcon aria-hidden="true" className="size-4" />
                            {m.editor_back_to_calendar()}
                        </Link>
                    )}
                    <p className="mt-6 text-xs font-medium text-muted-foreground">
                        {m.editor_title()}
                    </p>
                    <h1 className="mt-2 font-heading text-4xl font-semibold leading-[1.02] tracking-[-0.05em]">
                        {editor.post.title ?? m.publication_untitled()}
                    </h1>
                    <p className="mt-3 text-sm text-muted-foreground">
                        {editor.channel.name} ·{' '}
                        {m.common_profile_version({
                            profile: editor.profile.profileId,
                            version: editor.profile.version,
                        })}
                    </p>
                </div>
                <PublicationEditorSaveIndicator
                    state={saveState}
                    revision={editor.draft.revision}
                />
            </div>

            <PublicationLifecyclePanel
                onPublish={onPublish === undefined ? undefined : recordManualPublication}
                pending={manualPublicationBlocked}
                publication={editor.publication}
                timeZone={timeZone}
            />

            <PublicationEditorStatus
                isRebasing={isRebasing}
                message={message}
                recoveryAvailable={recoveryAvailable}
                saveState={saveState}
                onRestoreRecovery={restoreRecovery}
                onDiscardRecovery={() => {
                    requestGeneration.current += 1
                    removeRecovery(recoveryKey)
                    setRecoveryAvailable(false)
                }}
            />

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
                className="mt-7"
                channelNavigation={
                    <PublicationChannelRail
                        activeChannelId={editor.channel.id}
                        channels={editorChannels}
                        disabled={isRebasing}
                        onActiveChannelChange={handleChannelChange}
                        selectedChannelIds={editorChannelIds}
                    />
                }
                editor={
                    <div className="min-w-0 space-y-8">
                        <PublicationEditorSourceSection
                            projectId={projectId}
                            sourceContent={sourceContent}
                            sourceRevision={editor.post.sourceRevision}
                            disabled={!publicationEditable || isRebasing}
                            mediaDisabled={
                                !publicationEditable ||
                                saveState === 'saving' ||
                                saveState === 'rebasing'
                            }
                            onTextChange={updateSourceText}
                            onFormatChange={updateSourceFormat}
                            onOptionalFieldChange={updateSourceOptionalField}
                            onMediaChange={updateSourceMedia}
                            onAssetsChange={setAvailableMedia}
                        />

                        <PublicationEditorTargetSection
                            profile={editor.profile.profile}
                            reviewState={editor.draft.reviewState}
                            validationIssues={editor.draft.validationIssues}
                            target={targetResult.value}
                            targetText={targetText}
                            disabled={!publicationEditable || isRebasing}
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

                        {publicationEditable ? (
                            <PublicationEditorPromotionSection
                                timeZone={timeZone}
                                scheduleValue={scheduleValue}
                                disabled={
                                    dirty ||
                                    sourceConflict ||
                                    draftRequiresReview ||
                                    saveState !== 'saved' ||
                                    targetResult.value === null ||
                                    sourceIssue !== null
                                }
                                draftRequiresReview={draftRequiresReview}
                                draftDiffersFromTarget={draftDiffersFromTarget}
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
                                onPromote={() => void promoteDraft()}
                            />
                        ) : null}
                    </div>
                }
                preview={
                    <div className="min-w-0 space-y-8">
                        <PublicationDraftPreview
                            channel={editor.channel}
                            media={previewMedia}
                            postContent={previewContent}
                            postTitle={editor.post.title ?? ''}
                        />
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
                }
            />
        </section>
    )
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
    const textFields = Array.isArray(profile.capabilities.textFields)
        ? profile.capabilities.textFields.flatMap(value => {
              if (!isRecord(value) || typeof value.bindingId !== 'string') return []
              return [
                  {
                      bindingId: value.bindingId,
                      maxLength: typeof value.maxLength === 'number' ? value.maxLength : null,
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

function parseSchedule(
    value: string,
    timeZone: string
): number | null | 'invalid' | 'nonexistent' | 'ambiguous' {
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
