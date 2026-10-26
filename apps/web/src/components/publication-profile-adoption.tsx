import { Button } from '@postdot/ui/components/button'
import { useEffect, useRef, useState } from 'react'

import {
    PublicationTargetEditor,
    ReadOnlyTargetFields,
} from '@/components/publication-target-editor'
import { api, type PublicationEditorState } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { compareAdoptionFields } from '@/lib/profile-adoption-fields'
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
    const oldFields = getTargetEditorFields(baseEditor.profile.profile, locale, previous)
    const fields = getTargetEditorFields(active?.profile, locale, content)
    const comparison = compareAdoptionFields(previous, oldFields, fields)
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
                    </div>
                    <div className="grid min-w-0 gap-4" data-adoption-fields>
                        {comparison.map(change => (
                            <div key={change.previous.path} className="min-w-0">
                                {change.status === 'removed' ? (
                                    <p className="text-sm text-state-attention">
                                        {m.profile_adoption_unmapped({
                                            field: change.previous.label,
                                        })}
                                    </p>
                                ) : change.status === 'changed' ? (
                                    <p className="text-sm text-state-attention">
                                        {m.profile_adoption_type_changed({
                                            field: change.previous.label,
                                        })}
                                    </p>
                                ) : null}
                                <ReadOnlyTargetFields
                                    fields={[change.previous]}
                                    target={previous}
                                />
                                {change.next && change.next.path !== change.previous.path ? (
                                    <p className="mt-2 break-all text-xs text-muted-foreground">
                                        {m.profile_adoption_path_changed({
                                            previous: change.previous.path,
                                            current: change.next.path,
                                        })}
                                    </p>
                                ) : null}
                                {change.reusable && change.next ? (
                                    <Button
                                        className="mt-2"
                                        variant="secondary"
                                        disabled={pending || blocked || content === null}
                                        onClick={() =>
                                            update(
                                                JSON.stringify(
                                                    updateTargetField(
                                                        content ?? {},
                                                        change.next!.path,
                                                        readTargetField(
                                                            previous,
                                                            change.previous.path
                                                        )
                                                    ),
                                                    null,
                                                    2
                                                )
                                            )
                                        }>
                                        {m.profile_adoption_reuse({ field: change.next.label })}
                                    </Button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                    <h3 className="text-sm font-medium">{m.profile_adoption_candidate()}</h3>
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
                        <PublicationTargetEditor
                            readOnly
                            profile={baseEditor.profile.profile}
                            target={previous}
                            rawText={JSON.stringify(previous, null, 2)}
                            onTargetChange={() => {}}
                            onRawTextChange={() => {}}
                        />
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
