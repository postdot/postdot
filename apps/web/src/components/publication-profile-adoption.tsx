import { Button } from '@postdot/ui/components/button'
import { useEffect, useRef, useState } from 'react'

import { PublicationTargetEditor } from '@/components/publication-target-editor'
import { api, type PublicationEditorState } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { getTargetEditorFields, readTargetField, updateTargetField } from '@/lib/target-editor'
import * as m from '@/paraglide/messages.js'

interface Props {
    projectId: string
    editor: PublicationEditorState
    localContent: Record<string, unknown> | null
    blocked: boolean
    onCancel: () => void
    onAdopted: (editor: PublicationEditorState) => void
    onError: (error: unknown) => void
}

export function PublicationProfileAdoption({
    projectId,
    editor,
    localContent,
    blocked,
    onCancel,
    onAdopted,
    onError,
}: Props) {
    const { locale } = useLanguage()
    const [baseEditor, setBaseEditor] = useState(editor)
    const requestEpoch = useRef(0)
    useEffect(() => {
        requestEpoch.current += 1
        return () => {
            requestEpoch.current += 1
        }
    }, [blocked])
    const [active, setActive] = useState<PublicationEditorState['profile'] | null>(null)
    const [candidate, setCandidate] = useState('{}')
    const [useLocal, setUseLocal] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [assessment, setAssessment] = useState<{
        valid: boolean
        issues: Record<string, unknown>[]
    } | null>(null)
    useEffect(() => {
        let alive = true
        api.getChannelProfileState(projectId, editor.channel.id)
            .then(state => {
                if (alive) setActive(state.active)
            })
            .catch(() => {
                if (alive) {
                    setError(m.profile_adoption_load_failed())
                }
            })
        return () => {
            alive = false
        }
    }, [projectId, editor.channel.id])
    let content: Record<string, unknown> | null = null
    try {
        const parsed: unknown = JSON.parse(candidate)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
            content = parsed as Record<string, unknown>
    } catch {
        /* Invalid text remains editable. */
    }
    const previous = useLocal && localContent !== null ? localContent : baseEditor.draft.content
    const oldFields = getTargetEditorFields(baseEditor.profile.profile, locale)
    const fields = getTargetEditorFields(active?.profile, locale)
    function update(next: string) {
        setCandidate(next)
        setAssessment(null)
        setError(null)
    }
    async function run(save: boolean) {
        if (active === null || content === null || blocked || pending) return
        const input = {
            expectedRevision: baseEditor.draft.revision,
            expectedSourceRevision: baseEditor.draft.sourceRevision,
            expectedProfileVersionId: baseEditor.draft.profileVersionId,
            activeProfileVersionId: active.id,
            targetContent: content,
            previousLocalContent: localContent ?? undefined,
        }
        const epoch = requestEpoch.current
        setPending(true)
        setError(null)
        try {
            if (save) {
                const result = await api.adoptPublicationDraftProfile(
                    projectId,
                    editor.publication.id,
                    input
                )
                if (epoch === requestEpoch.current) onAdopted(result.editor)
            } else {
                const result = await api.assessPublicationDraftAdoption(
                    projectId,
                    editor.publication.id,
                    input
                )
                if (epoch === requestEpoch.current) setAssessment(result)
            }
        } catch (caught) {
            if (epoch === requestEpoch.current) {
                setError(m.profile_adoption_failed())
                onError(caught)
            }
        } finally {
            setPending(false)
        }
    }
    async function refresh() {
        if (pending || blocked) return
        const epoch = requestEpoch.current
        setPending(true)
        try {
            const [latest, profile] = await Promise.all([
                api.getPublicationEditor(projectId, editor.publication.id),
                api.getChannelProfileState(projectId, editor.channel.id),
            ])
            if (epoch !== requestEpoch.current) return
            setBaseEditor(latest.editor)
            setActive(profile.active)
            setAssessment(null)
            setError(null)
        } catch (caught) {
            if (epoch === requestEpoch.current) {
                setError(m.profile_adoption_load_failed())
                onError(caught)
            }
        } finally {
            setPending(false)
        }
    }

    return (
        <section className="space-y-5" aria-label={m.profile_adoption_title()}>
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{m.profile_adoption_title()}</h2>
                <Button variant="ghost" onClick={onCancel} disabled={pending}>
                    {m.common_cancel()}
                </Button>
            </div>
            <p className="text-sm text-muted-foreground">{m.profile_adoption_description()}</p>
            {error ? (
                <div>
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                    <Button
                        variant="secondary"
                        disabled={pending || blocked}
                        onClick={() => void refresh()}>
                        {m.profile_adoption_refresh()}
                    </Button>
                </div>
            ) : null}
            {active === null ? (
                <p role="status">{m.common_loading()}</p>
            ) : (
                <>
                    <div className="space-y-2">
                        {localContent !== null ? (
                            <Button
                                variant={useLocal ? 'secondary' : 'outline'}
                                disabled={pending || blocked}
                                onClick={() => {
                                    setUseLocal(!useLocal)
                                    setAssessment(null)
                                }}>
                                {useLocal
                                    ? m.profile_adoption_use_saved()
                                    : m.profile_adoption_use_local()}
                            </Button>
                        ) : null}
                        {fields.flatMap(field => {
                            const old = oldFields.find(
                                item =>
                                    item.bindingId === field.bindingId &&
                                    item.semantic === field.semantic
                            )
                            if (
                                old === undefined ||
                                readTargetField(previous, old.path) === undefined
                            )
                                return []
                            return [
                                <div
                                    key={field.path}
                                    className="flex flex-wrap items-center gap-2 text-sm">
                                    <Button
                                        variant="secondary"
                                        disabled={pending || blocked || content === null}
                                        onClick={() =>
                                            update(
                                                JSON.stringify(
                                                    updateTargetField(
                                                        content ?? {},
                                                        field.path,
                                                        readTargetField(previous, old.path)
                                                    ),
                                                    null,
                                                    2
                                                )
                                            )
                                        }>
                                        {m.profile_adoption_reuse({ field: field.label })}
                                    </Button>
                                    {old.path !== field.path ? (
                                        <span className="text-muted-foreground">
                                            {old.path} → {field.path}
                                        </span>
                                    ) : null}
                                </div>,
                            ]
                        })}
                    </div>
                    {oldFields
                        .filter(
                            old =>
                                readTargetField(previous, old.path) !== undefined &&
                                !fields.some(
                                    field =>
                                        field.bindingId === old.bindingId &&
                                        field.semantic === old.semantic
                                )
                        )
                        .map(old => (
                            <div key={old.path} className="space-y-1 text-sm">
                                <p className="text-state-attention">
                                    {m.profile_adoption_unmapped({ field: old.label })}
                                </p>
                                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">
                                    {JSON.stringify(readTargetField(previous, old.path), null, 2)}
                                </pre>
                            </div>
                        ))}
                    <PublicationTargetEditor
                        compact
                        profile={active.profile}
                        target={content}
                        rawText={candidate}
                        validationIssues={assessment?.issues}
                        disabled={pending || blocked}
                        projectId={projectId}
                        mediaScopeId={`adoption-${editor.publication.id}`}
                        onTargetChange={next => update(JSON.stringify(next, null, 2))}
                        onRawTextChange={update}
                    />
                    {assessment?.issues.length ? (
                        <ul role="alert" className="space-y-1 text-sm text-state-attention">
                            {assessment.issues.map((issue, index) => (
                                <li key={index}>
                                    {String(issue.path ?? '')}{' '}
                                    {String(issue.message ?? issue.code ?? '')}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <details>
                        <summary className="cursor-pointer text-sm font-medium">
                            {m.profile_adoption_previous()}
                        </summary>
                        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                            {JSON.stringify(previous, null, 2)}
                        </pre>
                    </details>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="secondary"
                            disabled={pending || blocked || content === null}
                            onClick={() => void run(false)}>
                            {m.profile_adoption_validate()}
                        </Button>
                        <Button
                            disabled={pending || blocked || !assessment?.valid}
                            onClick={() => void run(true)}>
                            {m.profile_adoption_save()}
                        </Button>
                    </div>
                </>
            )}
        </section>
    )
}
