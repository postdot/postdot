import { CheckCircleIcon } from '@solar-icons/react/linear/check-circle'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ApiError, api, type PublicationEditorState } from '@/lib/api'

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

type SaveState = 'saved' | 'saving' | 'local_only' | 'conflict' | 'error'

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
        recoveredContentDiffers ? 'local_only' : 'saved'
    )
    const [message, setMessage] = useState<string | null>(
        recoveredContentDiffers || recoveredScheduleDiffers
            ? 'A locally recovered copy is ready to be saved.'
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
    const draftDiffersFromTarget =
        editor.selectedTarget === null ||
        editor.draft.sourceRevision !== editor.selectedTarget.sourceRevision ||
        formatJson(editor.draft.content) !== formatJson(editor.selectedTarget.content)
    const hasLocalChanges = dirty || scheduleDirty

    useEffect(() => {
        if (!hasLocalChanges) {
            removeRecovery(recoveryKey)
            return
        }

        writeRecovery(recoveryKey, {
            version: recoveryVersion,
            baseRevision: expectedRevision,
            sourceContent,
            targetText,
            scheduleValue,
        })
    }, [expectedRevision, hasLocalChanges, recoveryKey, scheduleValue, sourceContent, targetText])

    useEffect(() => {
        if (!dirty) return

        const generation = ++requestGeneration.current
        if (sourceIssue !== null || targetResult.value === null) {
            setSaveState('local_only')
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
        sourceContent,
        sourceIssue,
        targetResult.value,
    ])

    function updateSourceText(text: string) {
        setSourceContent(current => ({
            ...current,
            body: {
                format: current.body?.format ?? 'plain_text',
                text,
            },
        }))
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

    async function reloadServerVersion() {
        requestGeneration.current += 1
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
            setEditor(response.editor)
            setSourceContent(response.editor.post.sourceContent)
            setTargetText(formatJson(response.editor.draft.content))
            setExpectedRevision(response.editor.draft.revision)
            setScheduleValue(toDateTimeLocal(response.editor.publication.scheduledAt))
            setDirty(false)
            setScheduleDirty(false)
            setSaveState('saved')
            setMessage('The server version is loaded. Your previous local copy remains available.')
        } catch (caughtError) {
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    function restoreRecovery() {
        const recovery = readRecovery(recoveryKey)
        if (recovery === null) return
        setSourceContent(recovery.sourceContent)
        setTargetText(recovery.targetText)
        setScheduleValue(recovery.scheduleValue)
        setExpectedRevision(editor.draft.revision)
        const contentDiffers = recoveryContentDiffers(recovery, editor)
        const scheduleDiffers =
            recovery.scheduleValue !== toDateTimeLocal(editor.publication.scheduledAt)
        setDirty(contentDiffers)
        setScheduleDirty(scheduleDiffers)
        setSaveState(contentDiffers ? 'local_only' : 'saved')
        setMessage(
            contentDiffers || scheduleDiffers
                ? 'The recovered copy is active and ready for explicit promotion.'
                : 'The recovered copy does not contain changes to apply.'
        )
        setRecoveryAvailable(false)
    }

    async function restoreRecoveryAgainstLatestServer() {
        const recovery = readRecovery(recoveryKey)
        if (recovery === null) return

        requestGeneration.current += 1
        try {
            const response = await api.getPublicationEditor(projectId, editor.publication.id)
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
            setSaveState(contentDiffers ? 'local_only' : 'saved')
            setRecoveryAvailable(false)
            setMessage(
                contentDiffers || scheduleDiffers
                    ? 'Your local copy is restored against the latest server revision.'
                    : 'The latest server revision already contains the local copy.'
            )
        } catch (caughtError) {
            setSaveState('error')
            setMessage(errorMessage(caughtError))
        }
    }

    async function promoteDraft() {
        if (dirty || saveState !== 'saved' || targetResult.value === null || sourceIssue !== null) {
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
        <section className="py-10 pb-20 sm:py-14">
            <div className="flex flex-col justify-between gap-5 border-b pb-8 sm:flex-row sm:items-end">
                <div>
                    <Link
                        to="/dashboard"
                        className="text-sm font-medium text-muted-foreground hover:text-foreground">
                        ← Back to dashboard
                    </Link>
                    <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                        Publication editor
                    </p>
                    <h1 className="mt-2 text-4xl font-semibold tracking-tight">
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
                <div
                    role={saveState === 'error' ? 'alert' : 'status'}
                    className={`mt-6 rounded-xl px-4 py-3 text-sm ${
                        saveState === 'error' || saveState === 'conflict'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-muted text-muted-foreground'
                    }`}>
                    {message}
                </div>
            ) : null}

            {recoveryAvailable ? (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-amber-950 dark:text-amber-100">
                        A local recovery copy is available from an earlier editor session.
                    </p>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={restoreRecovery}>
                            Restore local copy
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                removeRecovery(recoveryKey)
                                setRecoveryAvailable(false)
                            }}>
                            Discard local copy
                        </Button>
                    </div>
                </div>
            ) : null}

            <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="space-y-6">
                    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                                    Source document
                                </p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                                    Shared authoring content
                                </h2>
                                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                    This source can seed several channel-specific targets. Editing
                                    it does not silently replace the selected target.
                                </p>
                            </div>
                            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
                                Source revision {editor.post.sourceRevision}
                            </span>
                        </div>

                        <div className="mt-6 grid gap-4">
                            <label className="grid gap-2 text-sm font-medium">
                                Body
                                <textarea
                                    value={body?.text ?? ''}
                                    onChange={event => updateSourceText(event.target.value)}
                                    rows={9}
                                    className="resize-y rounded-lg border bg-background px-3 py-2 text-sm font-normal leading-6 outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                />
                            </label>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="grid gap-2 text-sm font-medium">
                                    Source format
                                    <select
                                        value={body?.format ?? 'plain_text'}
                                        onChange={event =>
                                            updateSourceFormat(
                                                event.target.value as 'plain_text' | 'markdown'
                                            )
                                        }
                                        className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20">
                                        <option value="plain_text">Plain text</option>
                                        <option value="markdown">Markdown</option>
                                    </select>
                                </label>
                                <label className="grid gap-2 text-sm font-medium">
                                    Headline
                                    <input
                                        value={sourceContent.headline ?? ''}
                                        onChange={event =>
                                            updateSourceOptionalField(
                                                'headline',
                                                event.target.value
                                            )
                                        }
                                        placeholder="Optional headline"
                                        className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                    />
                                </label>
                            </div>
                            <label className="grid gap-2 text-sm font-medium">
                                Language
                                <input
                                    value={sourceContent.language ?? ''}
                                    onChange={event =>
                                        updateSourceOptionalField('language', event.target.value)
                                    }
                                    placeholder="Optional BCP 47 tag, for example en-US"
                                    className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                />
                            </label>
                            {sourceContent.media.length > 0 ? (
                                <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
                                    <p className="font-medium">Attached media is preserved</p>
                                    <ul className="mt-2 space-y-1 text-muted-foreground">
                                        {sourceContent.media.map(media => (
                                            <li key={media.assetId}>
                                                {media.assetId}
                                                {media.accessibilityText
                                                    ? ` · ${media.accessibilityText}`
                                                    : ''}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                        </div>
                    </section>

                    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                                    Channel target
                                </p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                                    Editable structured payload
                                </h2>
                                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                    The channel profile owns this shape. JSON keeps custom channels
                                    expressive without inventing a new table for every destination.
                                </p>
                            </div>
                            <span
                                className={`rounded-full px-3 py-1 text-xs font-medium ${
                                    editor.draft.reviewState === 'compatible'
                                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                        : 'bg-amber-500/10 text-amber-800 dark:text-amber-200'
                                }`}>
                                {editor.draft.reviewState === 'compatible'
                                    ? 'Compatible'
                                    : 'Review required'}
                            </span>
                        </div>

                        <label className="mt-6 grid gap-2 text-sm font-medium">
                            Target JSON
                            <textarea
                                value={targetText}
                                onChange={event => {
                                    setTargetText(event.target.value)
                                    setDirty(true)
                                }}
                                spellCheck={false}
                                rows={15}
                                className="resize-y rounded-lg border bg-zinc-950 px-3 py-2 font-mono text-xs leading-6 text-zinc-100 outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                            />
                        </label>
                        {targetResult.error ? (
                            <p className="mt-3 text-sm text-destructive">{targetResult.error}</p>
                        ) : null}
                        {editor.draft.validationIssues.length > 0 ? (
                            <div className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm">
                                <p className="font-medium">The profile reported these issues:</p>
                                <ul className="mt-2 space-y-1 text-muted-foreground">
                                    {editor.draft.validationIssues.map((issue, index) => (
                                        <li key={`${issueCode(issue)}-${index}`}>
                                            {issueMessage(issue)}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </section>

                    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
                        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                                    Explicit promotion
                                </p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                                    Choose what gets delivered
                                </h2>
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                                    Autosave preserves your work. This action creates the immutable
                                    target revision used by manual delivery or the worker.
                                </p>
                            </div>
                            <span className="text-sm text-muted-foreground">
                                {draftDiffersFromTarget
                                    ? 'Draft differs from selected target'
                                    : 'Draft matches selected target'}
                            </span>
                        </div>
                        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
                            <label className="grid flex-1 gap-2 text-sm font-medium">
                                Deliver at
                                <input
                                    type="datetime-local"
                                    value={scheduleValue}
                                    onChange={event => {
                                        const value = event.target.value
                                        setScheduleValue(value)
                                        setScheduleDirty(
                                            value !==
                                                toDateTimeLocal(editor.publication.scheduledAt)
                                        )
                                    }}
                                    className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                />
                                <span className="text-xs font-normal text-muted-foreground">
                                    Clear the value to keep this publication as a draft.
                                </span>
                            </label>
                            <Button
                                className="sm:mb-5"
                                onClick={() => void promoteDraft()}
                                disabled={
                                    dirty ||
                                    saveState !== 'saved' ||
                                    targetResult.value === null ||
                                    sourceIssue !== null
                                }>
                                <CheckCircleIcon aria-hidden="true" />
                                Apply draft to target
                            </Button>
                        </div>
                    </section>
                </div>

                <aside className="space-y-6">
                    <section className="rounded-2xl border bg-card p-5 shadow-sm">
                        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                            Selected target
                        </p>
                        <h2 className="mt-2 text-xl font-semibold tracking-tight">
                            Delivery snapshot
                        </h2>
                        {editor.selectedTarget === null ? (
                            <p className="mt-4 text-sm leading-6 text-muted-foreground">
                                No target has been promoted yet. This publication remains a draft.
                            </p>
                        ) : (
                            <div className="mt-4 space-y-3 text-sm">
                                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
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
                                <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5">
                                    {formatJson(editor.selectedTarget.content)}
                                </pre>
                            </div>
                        )}
                    </section>

                    <section className="rounded-2xl border bg-card p-5 shadow-sm">
                        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                            Channel contract
                        </p>
                        <h2 className="mt-2 text-xl font-semibold tracking-tight">
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
                                    className="rounded-lg bg-muted/60 px-3 py-2">
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

                    {saveState === 'conflict' ? (
                        <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
                            <h2 className="font-semibold">Reconcile before continuing</h2>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                Another editor committed a newer revision. Keep your local copy or
                                load the server version before writing again.
                            </p>
                            <div className="mt-4 grid gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void reloadServerVersion()}>
                                    Load server version
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => void restoreRecoveryAgainstLatestServer()}>
                                    Restore local copy on latest version
                                </Button>
                            </div>
                        </section>
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
              : state === 'local_only'
                ? 'Local recovery only'
                : state === 'conflict'
                  ? 'Conflict'
                  : 'Save failed'

    return (
        <div className="rounded-full border bg-card px-3 py-2 text-xs font-medium shadow-sm">
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
    if (value === '') return null
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : 'invalid'
}

function toDateTimeLocal(timestamp: number | null) {
    if (timestamp === null) return ''
    const date = new Date(timestamp)
    const offset = date.getTimezoneOffset() * 60_000
    return new Date(timestamp - offset).toISOString().slice(0, 16)
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
