import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import { Card, CardContent } from '@herald/ui/components/card'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Textarea } from '@herald/ui/components/textarea'
import { cn } from '@herald/ui/lib/utils'
import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { MediaAttachmentPicker, type MediaSelection } from '@/components/media-attachment-picker'
import { ApiError, api, type PublicationEditorState } from '@/lib/api'
import { parseDateTimeLocal, toDateTimeLocal } from '@/lib/date-time'
import { updateTargetMedia } from '@/lib/target-media'

type SourceContent = PublicationEditorState['post']['sourceContent']
type Profile = PublicationEditorState['profile']['profile']

interface PublicationEditorProps {
    readonly projectId: string
    readonly initialEditor: PublicationEditorState
}

interface RecoveryBuffer {
    readonly version: 2
    readonly baseRevision: number
    readonly sourceContent: SourceContent
    readonly targetText: string
    readonly scheduleValue: string
}

interface CapabilityField {
    readonly bindingId: string
    readonly maxLength: number | null
    readonly acceptedSourceFormats: readonly string[]
}

interface CapabilitySummary {
    readonly textFields: readonly CapabilityField[]
    readonly mediaFieldCount: number
}

type SaveState = 'saved' | 'saving' | 'rebasing' | 'local_only' | 'conflict' | 'error'

const recoveryVersion = 2 as const

export function PublicationEditor({ projectId, initialEditor }: PublicationEditorProps) {
    const recoveryKey = useMemo(
        () => createRecoveryKey(projectId, initialEditor.publication.id),
        [projectId, initialEditor.publication.id]
    )
    const initialRecovery = useMemo(() => readRecovery(recoveryKey), [recoveryKey])
    const shouldRestoreInitialRecovery =
        initialRecovery !== null && initialRecovery.baseRevision >= initialEditor.draft.revision
    const recoveredContentDiffers =
        shouldRestoreInitialRecovery &&
        initialRecovery !== null &&
        recoveryContentDiffers(initialRecovery, initialEditor)
    const recoveredScheduleDiffers =
        shouldRestoreInitialRecovery &&
        initialRecovery !== null &&
        initialRecovery.scheduleValue !== toDateTimeLocal(initialEditor.publication.scheduledAt)
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
            ? 'A locally recovered copy is ready to be saved.'
            : initialSourceConflict
              ? `This draft is based on source revision ${initialEditor.draft.sourceRevision}, while the current source is revision ${initialEditor.post.sourceRevision}. Rebase it before saving or promoting.`
              : initialRecovery === null
                ? null
                : 'A previous local copy was kept because the server has newer work.'
    )
    const [recoveryAvailable, setRecoveryAvailable] = useState(
        initialRecovery !== null && !shouldRestoreInitialRecovery
    )
    const [scheduleValue, setScheduleValue] = useState(
        shouldRestoreInitialRecovery && initialRecovery !== null
            ? initialRecovery.scheduleValue
            : toDateTimeLocal(initialEditor.publication.scheduledAt)
    )
    const [scheduleDirty, setScheduleDirty] = useState(recoveredScheduleDiffers)
    const requestGeneration = useRef(0)

    const targetResult = useMemo(() => parseTargetText(targetText), [targetText])
    const sourceIssue = useMemo(() => sourceContentIssue(sourceContent), [sourceContent])
    const capabilitySummary = useMemo(() => getCapabilitySummary(editor.profile.profile), [editor])
    const sourceConflict = editor.draft.sourceRevision !== editor.post.sourceRevision
    const draftDiffersFromTarget =
        editor.selectedTarget === null ||
        editor.draft.sourceRevision !== editor.selectedTarget.sourceRevision ||
        formatJson(editor.draft.content) !== formatJson(editor.selectedTarget.content)
    const hasLocalChanges = dirty || scheduleDirty
    const isRebasing = saveState === 'rebasing'

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
        })
    }, [
        expectedRevision,
        hasLocalChanges,
        recoveryAvailable,
        recoveryKey,
        scheduleValue,
        sourceContent,
        targetText,
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
                        setMessage(
                            'The server has newer work. Your local copy is preserved; reload it or restore your changes explicitly.'
                        )
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
        const localRecovery = readRecovery(recoveryKey)
        if (hasLocalChanges) {
            writeRecovery(recoveryKey, {
                version: recoveryVersion,
                baseRevision: expectedRevision,
                sourceContent: localSource,
                targetText: localTargetText,
                scheduleValue,
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
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt))
            setDirty(false)
            setScheduleDirty(false)
            const refreshedSourceConflict =
                response.editor.draft.sourceRevision !== response.editor.post.sourceRevision
            setSaveState(refreshedSourceConflict ? 'conflict' : 'saved')
            setMessage(
                refreshedSourceConflict
                    ? `The server version is loaded, but this draft still uses source revision ${response.editor.draft.sourceRevision}. Rebase it before writing again.`
                    : 'The server version is loaded. Your previous local copy remains available.'
            )
        } catch (caughtError) {
            if (generation !== requestGeneration.current) return
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    function restoreRecovery() {
        const recovery = readRecovery(recoveryKey)
        if (recovery === null) return
        requestGeneration.current += 1
        setSourceContent(recovery.sourceContent)
        setTargetText(recovery.targetText)
        setScheduleValue(recovery.scheduleValue)
        setExpectedRevision(editor.draft.revision)
        const contentDiffers = recoveryContentDiffers(recovery, editor)
        const scheduleDiffers =
            recovery.scheduleValue !== toDateTimeLocal(editor.publication.scheduledAt)
        setDirty(contentDiffers)
        setScheduleDirty(scheduleDiffers)
        setSaveState(sourceConflict ? 'conflict' : contentDiffers ? 'local_only' : 'saved')
        setMessage(
            sourceConflict
                ? 'The recovered copy is active for review, but the server draft must be rebased before it can be saved.'
                : contentDiffers || scheduleDiffers
                  ? 'The recovered copy is active and ready for explicit promotion.'
                  : 'The recovered copy does not contain changes to apply.'
        )
        setRecoveryAvailable(false)
    }

    async function restoreRecoveryAgainstLatestServer() {
        const recovery = readRecovery(recoveryKey)
        if (recovery === null) return

        const generation = ++requestGeneration.current
        try {
            const response = await api.getPublicationEditor(projectId, editor.publication.id)
            if (generation !== requestGeneration.current) return
            const contentDiffers = recoveryContentDiffers(recovery, response.editor)
            const scheduleDiffers =
                recovery.scheduleValue !== toDateTimeLocal(response.editor.publication.scheduledAt)
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
                    ? 'Your local copy is loaded for review. Rebase the server draft before saving it.'
                    : contentDiffers || scheduleDiffers
                      ? 'Your local copy is restored against the latest server revision.'
                      : 'The latest server revision already contains the local copy.'
            )
        } catch (caughtError) {
            if (generation !== requestGeneration.current) return
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    async function rebaseToLatestSource() {
        const generation = ++requestGeneration.current
        const localRecovery = readRecovery(recoveryKey)
        const hadLocalCopy = hasLocalChanges || localRecovery !== null
        if (hasLocalChanges) {
            writeRecovery(recoveryKey, {
                version: recoveryVersion,
                baseRevision: expectedRevision,
                sourceContent,
                targetText,
                scheduleValue,
            })
        }
        setRecoveryAvailable(hadLocalCopy)
        setSaveState('rebasing')
        setMessage('Rebasing the server draft onto the current source…')

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
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState(rebasedSourceConflict ? 'conflict' : 'saved')
            setRecoveryAvailable(hadLocalCopy)
            setMessage(
                rebasedSourceConflict
                    ? 'The shared source advanced again while the draft was being rebased. Review the conflict again before continuing.'
                    : hadLocalCopy
                      ? 'The server draft now uses the current source. Your local copy remains available for review.'
                      : 'The server draft now uses the current source. Review the preserved target before promoting it.'
            )
        } catch (caughtError) {
            if (generation !== requestGeneration.current) return
            if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                setSaveState('conflict')
                setMessage(
                    'The draft changed before it could be rebased. Reload the server version and review the conflict again.'
                )
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
            saveState !== 'saved' ||
            targetResult.value === null ||
            sourceIssue !== null
        ) {
            return
        }

        const scheduledAt = parseSchedule(scheduleValue)
        if (scheduledAt === 'invalid') {
            setMessage('Choose a valid schedule or leave it empty for an unscheduled draft.')
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
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState('saved')
            setRecoveryAvailable(false)
            setMessage('The draft is now the selected target revision.')
        } catch (caughtError) {
            if (caughtError instanceof ApiError && caughtError.code === 'write_conflict') {
                setSaveState('conflict')
                setMessage(
                    'The draft changed before promotion. Reload the server version or restore the local copy before trying again.'
                )
                return
            }
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    const body = sourceContent.body

    return (
        <section className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <div className="flex flex-col justify-between gap-5 pb-7 sm:flex-row sm:items-end">
                <div>
                    <Link
                        to="/dashboard/projects/$projectId/queue"
                        params={{ projectId }}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                        <ArrowLeftIcon aria-hidden="true" className="size-4" />
                        Back to queue
                    </Link>
                    <p className="mt-6 text-xs font-medium text-muted-foreground">
                        Publication editor
                    </p>
                    <h1 className="mt-2 font-heading text-4xl font-semibold leading-[1.02] tracking-[-0.05em]">
                        {editor.post.title ?? 'Untitled publication'}
                    </h1>
                    <p className="mt-3 text-sm text-muted-foreground">
                        {editor.channel.name} · {editor.profile.profileId} profile v
                        {editor.profile.version}
                    </p>
                </div>
                <SaveIndicator state={saveState} revision={editor.draft.revision} />
            </div>

            {message ? (
                <Alert
                    variant={
                        saveState === 'error' || saveState === 'conflict'
                            ? 'destructive'
                            : 'default'
                    }
                    className={cn(
                        'mt-6 rounded-md',
                        saveState === 'error' || saveState === 'conflict'
                            ? 'border-destructive/35 bg-destructive/10'
                            : 'border-border/70 bg-muted/35'
                    )}>
                    <AlertTitle>
                        {saveState === 'error'
                            ? 'Save failed'
                            : saveState === 'conflict'
                              ? 'Revision conflict'
                              : 'Editor status'}
                    </AlertTitle>
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            ) : null}

            {recoveryAvailable ? (
                <div className="mt-4 flex flex-col gap-3 rounded-md bg-state-attention/10 px-4 py-3 text-sm ring-1 ring-state-attention/30 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-foreground">
                        A local recovery copy is available from an earlier editor session.
                    </p>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={restoreRecovery}
                            disabled={isRebasing}>
                            Restore local copy
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                requestGeneration.current += 1
                                removeRecovery(recoveryKey)
                                setRecoveryAvailable(false)
                            }}
                            disabled={isRebasing}>
                            Discard local copy
                        </Button>
                    </div>
                </div>
            ) : null}

            <div className="mt-7 grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="min-w-0 space-y-8">
                    <section className="min-w-0">
                        <Card>
                            <CardContent className="p-6 sm:p-7">
                                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground">
                                            Source document
                                        </p>
                                        <h2 className="mt-2 font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                            Shared authoring content
                                        </h2>
                                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                            This source can seed several channel-specific targets.
                                            Editing it does not silently replace the selected
                                            target.
                                        </p>
                                    </div>
                                    <span className="text-xs font-medium text-muted-foreground">
                                        Source revision {editor.post.sourceRevision}
                                    </span>
                                </div>

                                <div className="mt-6 grid min-w-0 gap-4">
                                    <Field className="min-w-0 gap-1.5">
                                        <FieldLabel htmlFor="source-body">Body</FieldLabel>
                                        <Textarea
                                            id="source-body"
                                            value={body?.text ?? ''}
                                            onChange={event => updateSourceText(event.target.value)}
                                            disabled={isRebasing}
                                            rows={9}
                                            className="min-h-44 min-w-0 max-w-full text-sm leading-6"
                                        />
                                    </Field>
                                    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                                        <Field className="min-w-0 gap-1.5">
                                            <FieldLabel htmlFor="source-format">
                                                Source format
                                            </FieldLabel>
                                            <Select
                                                items={{
                                                    plain_text: 'Plain text',
                                                    markdown: 'Markdown',
                                                }}
                                                value={body?.format ?? 'plain_text'}
                                                onValueChange={value =>
                                                    updateSourceFormat(
                                                        value as 'plain_text' | 'markdown'
                                                    )
                                                }>
                                                <SelectTrigger
                                                    id="source-format"
                                                    disabled={isRebasing}>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent align="start">
                                                    <SelectItem value="plain_text">
                                                        Plain text
                                                    </SelectItem>
                                                    <SelectItem value="markdown">
                                                        Markdown
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                        <Field className="min-w-0 gap-1.5">
                                            <FieldLabel htmlFor="source-headline">
                                                Headline
                                            </FieldLabel>
                                            <Input
                                                id="source-headline"
                                                value={sourceContent.headline ?? ''}
                                                onChange={event =>
                                                    updateSourceOptionalField(
                                                        'headline',
                                                        event.target.value
                                                    )
                                                }
                                                placeholder="Optional headline"
                                                disabled={isRebasing}
                                                className="min-w-0"
                                            />
                                        </Field>
                                    </div>
                                    <Field className="min-w-0 gap-1.5">
                                        <FieldLabel htmlFor="source-language">Language</FieldLabel>
                                        <Input
                                            id="source-language"
                                            value={sourceContent.language ?? ''}
                                            onChange={event =>
                                                updateSourceOptionalField(
                                                    'language',
                                                    event.target.value
                                                )
                                            }
                                            placeholder="Optional BCP 47 tag, for example en-US"
                                            disabled={isRebasing}
                                            className="min-w-0"
                                        />
                                    </Field>
                                    <MediaAttachmentPicker
                                        projectId={projectId}
                                        value={sourceContent.media}
                                        onChange={updateSourceMedia}
                                        disabled={
                                            saveState === 'saving' || saveState === 'rebasing'
                                        }
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </section>

                    <section className="min-w-0">
                        <Card>
                            <CardContent className="p-6 sm:p-7">
                                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground">
                                            Channel target
                                        </p>
                                        <h2 className="mt-2 font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                            Editable structured payload
                                        </h2>
                                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                            The channel profile owns this shape. JSON keeps custom
                                            channels expressive without inventing a new table for
                                            every destination.
                                        </p>
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className={
                                            editor.draft.reviewState === 'compatible'
                                                ? 'border-0 bg-transparent px-0 text-state-published'
                                                : 'border-0 bg-transparent px-0 text-state-attention'
                                        }>
                                        <span
                                            className="size-1.5 rounded-full bg-current"
                                            aria-hidden="true"
                                        />
                                        {editor.draft.reviewState === 'compatible'
                                            ? 'Compatible'
                                            : 'Review required'}
                                    </Badge>
                                </div>

                                <Field className="mt-6 min-w-0 gap-1.5">
                                    <FieldLabel htmlFor="target-json">Target JSON</FieldLabel>
                                    <Textarea
                                        id="target-json"
                                        value={targetText}
                                        onChange={event => {
                                            setTargetText(event.target.value)
                                            setDirty(true)
                                        }}
                                        disabled={isRebasing}
                                        spellCheck={false}
                                        rows={15}
                                        className="min-h-64 min-w-0 max-w-full resize-y bg-surface-field px-3 py-2 font-mono text-xs leading-6 text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
                                    />
                                </Field>
                                {targetResult.error ? (
                                    <Alert variant="destructive" className="mt-4 rounded-md">
                                        <AlertTitle>Invalid target JSON</AlertTitle>
                                        <AlertDescription>{targetResult.error}</AlertDescription>
                                    </Alert>
                                ) : null}
                                {editor.draft.validationIssues.length > 0 ? (
                                    <Alert className="mt-4 rounded-md border-state-attention/35 bg-state-attention/10">
                                        <AlertTitle>
                                            The profile reported validation issues
                                        </AlertTitle>
                                        <AlertDescription>
                                            <ul className="mt-1 space-y-1">
                                                {editor.draft.validationIssues.map(
                                                    (issue, index) => (
                                                        <li key={`${issueCode(issue)}-${index}`}>
                                                            {issueMessage(issue)}
                                                        </li>
                                                    )
                                                )}
                                            </ul>
                                        </AlertDescription>
                                    </Alert>
                                ) : null}
                            </CardContent>
                        </Card>
                    </section>

                    <section className="min-w-0">
                        <Card>
                            <CardContent className="p-6 sm:p-7">
                                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground">
                                            Explicit promotion
                                        </p>
                                        <h2 className="mt-2 font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                            Choose what gets delivered
                                        </h2>
                                        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                                            Autosave preserves your work. This action creates the
                                            immutable target revision used by manual delivery or the
                                            worker.
                                        </p>
                                    </div>
                                    <span className="text-sm text-muted-foreground">
                                        {draftDiffersFromTarget
                                            ? 'Draft differs from selected target'
                                            : 'Draft matches selected target'}
                                    </span>
                                </div>
                                <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
                                    <Field className="min-w-0 flex-1 gap-1.5">
                                        <FieldLabel htmlFor="deliver-at">Deliver at</FieldLabel>
                                        <Input
                                            id="deliver-at"
                                            type="datetime-local"
                                            value={scheduleValue}
                                            onChange={event => {
                                                const value = event.target.value
                                                setScheduleValue(value)
                                                setScheduleDirty(
                                                    value !==
                                                        toDateTimeLocal(
                                                            editor.publication.scheduledAt
                                                        )
                                                )
                                            }}
                                            disabled={isRebasing}
                                            className="min-w-0"
                                        />
                                        <FieldDescription className="text-xs">
                                            Clear the value to keep this publication as a draft.
                                        </FieldDescription>
                                    </Field>
                                    <Button
                                        className="sm:mb-5"
                                        onClick={() => void promoteDraft()}
                                        disabled={
                                            dirty ||
                                            sourceConflict ||
                                            saveState !== 'saved' ||
                                            targetResult.value === null ||
                                            sourceIssue !== null
                                        }>
                                        <CheckReadIcon aria-hidden="true" />
                                        Apply draft to target
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </section>
                </div>

                <aside className="min-w-0 space-y-8 xl:sticky xl:top-20 xl:self-start">
                    <section className="min-w-0 rounded-md bg-muted p-5 shadow-surface">
                        <p className="text-xs font-medium text-muted-foreground">Selected target</p>
                        <h2 className="mt-2 font-heading text-xl font-[580] leading-[1.03] tracking-[-0.04em]">
                            Delivery snapshot
                        </h2>
                        {editor.selectedTarget === null ? (
                            <p className="mt-4 text-sm leading-6 text-muted-foreground">
                                No target has been promoted yet. This publication remains a draft.
                            </p>
                        ) : (
                            <div className="mt-4 space-y-3 text-sm">
                                <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                                    <dt className="text-muted-foreground">Revision</dt>
                                    <dd className="font-medium">
                                        {editor.selectedTarget.sequence}
                                    </dd>
                                    <dt className="text-muted-foreground">Profile</dt>
                                    <dd className="truncate font-medium">
                                        {editor.selectedTarget.profileVersionId}
                                    </dd>
                                    <dt className="text-muted-foreground">Scheduled</dt>
                                    <dd className="font-medium">
                                        {formatSchedule(editor.publication.scheduledAt)}
                                    </dd>
                                </dl>
                                <pre className="max-h-72 max-w-full overflow-auto rounded-md bg-surface-field p-3 font-mono text-xs leading-5 shadow-field">
                                    {formatJson(editor.selectedTarget.content)}
                                </pre>
                            </div>
                        )}
                    </section>

                    <section className="min-w-0 pt-2">
                        <p className="text-xs font-medium text-muted-foreground">
                            Channel contract
                        </p>
                        <h2 className="mt-2 font-heading text-xl font-[580] leading-[1.03] tracking-[-0.04em]">
                            Capability feedback
                        </h2>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                            Profile {editor.profile.profileId} v{editor.profile.version} · schema
                            {` ${editor.profile.profile.schemaHash ?? 'unhashed'}`}
                        </p>
                        <div className="mt-5 space-y-3 text-sm">
                            {capabilitySummary.textFields.map(field => (
                                <div
                                    key={field.bindingId}
                                    className="rounded-md bg-muted px-3 py-2 shadow-field">
                                    <p className="font-medium">{field.bindingId}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {field.maxLength === null
                                            ? 'No declared length limit'
                                            : `Maximum ${field.maxLength} characters`}{' '}
                                        ·{' '}
                                        {field.acceptedSourceFormats.join(', ') ||
                                            'No source format'}
                                    </p>
                                </div>
                            ))}
                            <p className="text-xs text-muted-foreground">
                                {capabilitySummary.mediaFieldCount} media field
                                {capabilitySummary.mediaFieldCount === 1 ? '' : 's'} declared.
                            </p>
                        </div>
                    </section>

                    {sourceConflict || saveState === 'conflict' ? (
                        <Alert
                            variant="destructive"
                            className="rounded-md border-destructive/35 bg-destructive/5 px-4 py-5">
                            <AlertTitle>
                                {sourceConflict
                                    ? 'Source revision needs review'
                                    : 'Reconcile before continuing'}
                            </AlertTitle>
                            <AlertDescription>
                                {sourceConflict
                                    ? `This draft was authored from source revision ${editor.draft.sourceRevision}, but the shared post is now at revision ${editor.post.sourceRevision}. The target payload is preserved until you explicitly choose what to keep.`
                                    : 'Another editor committed a newer draft revision. Keep your local copy or load the server version before writing again.'}
                            </AlertDescription>
                            {sourceConflict ? (
                                <div className="mt-4 grid min-w-0 gap-3 text-xs sm:grid-cols-2">
                                    <div className="min-w-0 rounded-md bg-background/60 p-3 shadow-field">
                                        <p className="font-medium text-foreground">
                                            Draft source · revision {editor.draft.sourceRevision}
                                        </p>
                                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono leading-5 text-muted-foreground">
                                            {formatJson(editor.draft.baseSourceContent)}
                                        </pre>
                                    </div>
                                    <div className="min-w-0 rounded-md bg-background/60 p-3 shadow-field">
                                        <p className="font-medium text-foreground">
                                            Current source · revision {editor.post.sourceRevision}
                                        </p>
                                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono leading-5 text-muted-foreground">
                                            {formatJson(editor.post.sourceContent)}
                                        </pre>
                                    </div>
                                </div>
                            ) : null}
                            <div className="mt-4 grid gap-2">
                                {sourceConflict ? (
                                    <Button
                                        size="sm"
                                        onClick={() => void rebaseToLatestSource()}
                                        disabled={isRebasing}>
                                        Rebase draft to current source
                                    </Button>
                                ) : null}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void reloadServerVersion()}
                                    disabled={isRebasing}>
                                    Load server version
                                </Button>
                                {recoveryAvailable || hasLocalChanges ? (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => void restoreRecoveryAgainstLatestServer()}
                                        disabled={isRebasing}>
                                        Load local copy for review
                                    </Button>
                                ) : null}
                            </div>
                        </Alert>
                    ) : null}
                </aside>
            </div>
        </section>
    )
}

function SaveIndicator({
    state,
    revision,
}: {
    readonly state: SaveState
    readonly revision: number
}) {
    const label =
        state === 'saved'
            ? 'Saved'
            : state === 'saving'
              ? 'Saving…'
              : state === 'rebasing'
                ? 'Rebasing…'
                : state === 'local_only'
                  ? 'Local recovery only'
                  : state === 'conflict'
                    ? 'Conflict'
                    : 'Save failed'

    return (
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span
                className={cn(
                    'size-1.5 rounded-full bg-current',
                    state === 'saved' ? 'text-state-published' : 'text-state-attention'
                )}
                aria-hidden="true"
            />
            {label} · draft revision {revision}
        </div>
    )
}

function createRecoveryKey(projectId: string, publicationId: string) {
    return `herald:publication-editor:v${recoveryVersion}:${encodeURIComponent(projectId)}:${encodeURIComponent(publicationId)}`
}

function readRecovery(key: string): RecoveryBuffer | null {
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
        if (!Array.isArray(value.sourceContent.media)) return null
        return {
            version: recoveryVersion,
            baseRevision: value.baseRevision,
            sourceContent: value.sourceContent as SourceContent,
            targetText: value.targetText,
            scheduleValue: value.scheduleValue,
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
            return { value: null, error: 'Target content must be a JSON object.' }
        }
        return { value: parsed, error: null }
    } catch {
        return { value: null, error: 'Target JSON is incomplete or invalid.' }
    }
}

function sourceContentIssue(source: SourceContent): string | null {
    if (source.body === undefined && source.media.length === 0) {
        return 'Add source text or at least one media reference before saving.'
    }
    if (source.body !== undefined && source.body.text.trim() === '') {
        return 'Source body text must not be blank.'
    }
    if (source.headline !== undefined && source.headline.trim() === '') {
        return 'Headline must not be blank when provided.'
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
    return typeof issue.code === 'string' ? issue.code : 'validation-issue'
}

function issueMessage(issue: Record<string, unknown>) {
    const message = typeof issue.message === 'string' ? issue.message : 'The value is invalid.'
    const path = typeof issue.path === 'string' && issue.path !== '' ? `${issue.path}: ` : ''
    return `${path}${message}`
}

function formatJson(value: unknown) {
    return JSON.stringify(value, null, 2)
}

function parseSchedule(value: string): number | null | 'invalid' {
    return parseDateTimeLocal(value)
}

function formatSchedule(timestamp: number | null) {
    return timestamp === null ? 'Unscheduled' : new Date(timestamp).toLocaleString()
}

function errorMessage(error: unknown) {
    return error instanceof ApiError ? error.message : 'The action could not be completed.'
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
