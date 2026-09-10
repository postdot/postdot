import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { type MediaSelection } from '@/components/media-attachment-picker'
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
import {
    PublicationOutcomePanel,
    type PublicationOutcomeResolutionInput,
} from '@/components/publication-outcome-panel'
import { PublicationTagPicker } from '@/components/publication-tag-picker'
import {
    ApiError,
    api,
    formatApiError,
    type ProjectTag,
    type PublicationEditorState,
} from '@/lib/api'
import { dateTimeLocalErrorMessage, parseDateTimeLocal, toDateTimeLocal } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { updateTargetMedia } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

type SourceContent = PublicationEditorState['post']['sourceContent']
type Profile = PublicationEditorState['profile']['profile']

interface PublicationEditorProps {
    readonly projectId: string
    readonly initialEditor: PublicationEditorState
    readonly initialPublicationTags: readonly ProjectTag[]
    readonly projectTags: readonly ProjectTag[]
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
    initialEditor,
    initialPublicationTags,
    projectId,
    projectTags,
    timeZone,
}: PublicationEditorProps) {
    useLanguage()
    const recoveryKey = useMemo(
        () => createRecoveryKey(projectId, initialEditor.publication.id),
        [projectId, initialEditor.publication.id]
    )
    const initialRecovery = useMemo(
        () => readRecovery(recoveryKey, timeZone),
        [recoveryKey, timeZone]
    )
    const shouldRestoreInitialRecovery =
        initialRecovery !== null && initialRecovery.baseRevision >= initialEditor.draft.revision
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
        recoveredContentDiffers ? 'local_only' : initialSourceConflict ? 'conflict' : 'saved'
    )
    const [message, setMessage] = useState<string | null>(
        recoveredContentDiffers || recoveredScheduleDiffers
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
        initialRecovery !== null && !shouldRestoreInitialRecovery
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

    async function handlePublicationTagIdsChange(nextTagIds: string[]) {
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
        } catch (caughtError) {
            setPublicationTagIds(previousTagIds)
            setTagError(formatApiError(caughtError))
        } finally {
            setTagSavePending(false)
        }
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
        if (!dirty) return

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

    async function reconcilePublication(input: PublicationOutcomeResolutionInput) {
        const response = await api.reconcileAmbiguousPublication(
            projectId,
            editor.publication.id,
            input
        )
        setEditor(current => ({ ...current, publication: response.publication }))
    }

    return (
        <section className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <div className="flex flex-col justify-between gap-5 pb-7 sm:flex-row sm:items-end">
                <div>
                    <Link
                        to="/dashboard/projects/$projectId/queue"
                        params={{ projectId }}
                        search={{ tagIds: undefined }}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                        <ArrowLeftIcon aria-hidden="true" className="size-4" />
                        {m.editor_back_to_queue()}
                    </Link>
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
                        disabled={isRebasing || tagSavePending}
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

            <div className="mt-7 grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="min-w-0 space-y-8">
                    <PublicationEditorSourceSection
                        projectId={projectId}
                        sourceContent={sourceContent}
                        sourceRevision={editor.post.sourceRevision}
                        disabled={isRebasing}
                        mediaDisabled={saveState === 'saving' || saveState === 'rebasing'}
                        onTextChange={updateSourceText}
                        onFormatChange={updateSourceFormat}
                        onOptionalFieldChange={updateSourceOptionalField}
                        onMediaChange={updateSourceMedia}
                    />

                    <PublicationEditorTargetSection
                        profile={editor.profile.profile}
                        reviewState={editor.draft.reviewState}
                        validationIssues={editor.draft.validationIssues}
                        target={targetResult.value}
                        targetText={targetText}
                        disabled={isRebasing}
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
                                value !== toDateTimeLocal(editor.publication.scheduledAt, timeZone)
                            )
                        }}
                        onPromote={() => void promoteDraft()}
                    />
                </div>

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
