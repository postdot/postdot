import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Textarea } from '@herald/ui/components/textarea'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CodeFileIcon } from '@solar-icons/react/linear/code-file'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
import { useEffect, useRef, useState } from 'react'

import { ChannelProfileImpactPreview } from '@/components/channel-profile-impact-preview'
import {
    api,
    ApiError,
    formatApiError,
    type ProfileDefinitionIssue,
    type Channel,
    type ChannelProfileAssessment,
} from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { profileIssueMessage } from '@/lib/profile-validation-feedback'
import * as m from '@/paraglide/messages.js'

export function ChannelProfileEditorDialog({
    channel,
    onOpenChange,
    onRefreshProject,
    open,
    pending,
}: {
    readonly channel: Channel | null
    readonly onOpenChange: (open: boolean) => void
    readonly onRefreshProject: () => Promise<void>
    readonly open: boolean
    readonly pending: boolean
}) {
    useLanguage()
    const [profileText, setProfileText] = useState('')
    const [savedProfileText, setSavedProfileText] = useState('')
    const [metadata, setMetadata] = useState<Record<string, unknown> | null>(null)
    const session = useRef(0)
    const titleRef = useRef<HTMLHeadingElement>(null)
    const [draftId, setDraftId] = useState<string | null>(null)
    const [draftRevision, setDraftRevision] = useState<number | undefined>(undefined)
    const [assessment, setAssessment] = useState<ChannelProfileAssessment | null>(null)
    const [editing, setEditing] = useState(true)
    const [stage, setStage] = useState<'edit' | 'confirm' | 'activated'>('edit')
    const [reloadRequired, setReloadRequired] = useState(false)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setErrorText] = useState<string | null>(null)
    const [definitionIssues, setDefinitionIssues] = useState<readonly ProfileDefinitionIssue[]>([])
    const [definitionIssueCount, setDefinitionIssueCount] = useState(0)
    function setError(value: string | null) {
        setErrorText(value)
        setDefinitionIssues([])
        setDefinitionIssueCount(0)
    }

    useEffect(() => {
        if (stage !== 'edit') titleRef.current?.focus()
    }, [stage])

    useEffect(() => {
        if (!open || channel === null) return

        const epoch = ++session.current
        let cancelled = false
        setLoading(true)
        setProfileText('')
        setSavedProfileText('')
        setMetadata(null)
        setDraftId(null)
        setDraftRevision(undefined)
        setSaving(false)
        setError(null)
        setAssessment(null)
        setEditing(true)
        setStage('edit')
        setReloadRequired(false)
        void api
            .getChannelProfileState(channel.projectId, channel.id)
            .then(state => {
                if (cancelled) return
                const version = state.draft ?? state.active
                const presentation = profilePresentation(version.profile)
                setProfileText(presentation.text)
                setSavedProfileText(presentation.text)
                setMetadata(presentation.metadata)
                setDraftId(state.draft?.id ?? null)
                setDraftRevision(state.draft?.revision)
            })
            .catch(caughtError => {
                if (!cancelled) setError(formatApiError(caughtError))
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
            if (session.current === epoch) session.current++
        }
    }, [channel, open])

    if (channel === null) return null
    const currentChannel = channel

    async function saveDraft() {
        let profile: Record<string, unknown>
        try {
            const parsed: unknown = JSON.parse(profileText)
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setError(m.profile_must_be_object())
                return
            }
            if (profileMetadataKeys.some(key => Object.hasOwn(parsed, key))) {
                setError(m.profile_metadata_managed())
                return
            }
            profile = parsed as Record<string, unknown>
        } catch {
            setError(m.profile_invalid_json())
            return
        }

        const epoch = session.current
        setSaving(true)
        setError(null)
        setAssessment(null)
        try {
            const response = await api.saveChannelProfileDraft(
                currentChannel.projectId,
                currentChannel.id,
                profile,
                draftRevision
            )
            if (epoch !== session.current) return
            setDraftId(response.profile.id)
            setDraftRevision(response.profile.revision)
            const presentation = profilePresentation(response.profile.profile)
            setProfileText(presentation.text)
            setSavedProfileText(presentation.text)
            setMetadata(presentation.metadata)
        } catch (caughtError) {
            if (epoch === session.current) {
                if (
                    caughtError instanceof ApiError &&
                    caughtError.status === 400 &&
                    caughtError.code === 'invalid_content' &&
                    caughtError.profileIssues.length > 0
                ) {
                    setError(m.profile_definition_invalid())
                    setDefinitionIssues(caughtError.profileIssues)
                    setDefinitionIssueCount(caughtError.profileIssueCount)
                } else setError(formatApiError(caughtError))
            }
        } finally {
            if (epoch === session.current) setSaving(false)
        }
    }

    async function previewDraft(confirm = false) {
        if (draftId === null || profileText !== savedProfileText) {
            setError(m.profile_save_before_preview())
            return
        }
        const epoch = session.current
        setSaving(true)
        setError(null)
        try {
            const response = await api.previewChannelProfileActivation(
                currentChannel.projectId,
                currentChannel.id,
                draftId
            )
            if (epoch !== session.current) return
            setAssessment(response.assessment)
            setEditing(false)
            setStage(confirm ? 'confirm' : 'edit')
        } catch (caughtError) {
            if (epoch === session.current) setError(formatApiError(caughtError))
        } finally {
            if (epoch === session.current) setSaving(false)
        }
    }

    async function activateDraft() {
        if (
            draftId === null ||
            assessment === null ||
            stage !== 'confirm' ||
            profileText !== savedProfileText
        ) {
            setError(m.profile_preview_before_activate())
            return
        }
        const epoch = session.current
        setSaving(true)
        setError(null)
        try {
            const result = await api.activateChannelProfile(
                currentChannel.projectId,
                currentChannel.id,
                draftId,
                draftRevision
            )
            if (epoch !== session.current) return
            setAssessment(result.assessment)
            setStage('activated')
            try {
                await onRefreshProject()
            } catch (caughtError) {
                if (epoch === session.current) setError(formatApiError(caughtError))
            }
        } catch (caughtError) {
            if (epoch === session.current) {
                setError(formatApiError(caughtError))
                setStage('edit')
                setAssessment(null)
                setReloadRequired(true)
            }
        } finally {
            if (epoch === session.current) setSaving(false)
        }
    }

    async function reloadSavedProfile() {
        const epoch = session.current
        setLoading(true)
        try {
            const state = await api.getChannelProfileState(
                currentChannel.projectId,
                currentChannel.id
            )
            if (epoch !== session.current) return
            const version = state.draft ?? state.active
            const presentation = profilePresentation(version.profile)
            setProfileText(presentation.text)
            setSavedProfileText(presentation.text)
            setMetadata(presentation.metadata)
            setDraftId(state.draft?.id ?? null)
            setDraftRevision(state.draft?.revision)
            setAssessment(null)
            setEditing(true)
            setStage('edit')
            setError(null)
            setReloadRequired(false)
        } catch (caughtError) {
            if (epoch === session.current) setError(formatApiError(caughtError))
        } finally {
            if (epoch === session.current) setLoading(false)
        }
    }

    const busy = pending || loading || saving
    const unsaved = profileText !== savedProfileText

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[min(46rem,calc(100dvh-2rem))] max-w-[calc(100vw_-_2rem)] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
                        {stage === 'confirm'
                            ? m.profile_activation_confirm_title({ channel: currentChannel.name })
                            : stage === 'activated'
                              ? m.profile_activated_title({ channel: currentChannel.name })
                              : m.profile_editor_title({ channel: currentChannel.name })}
                    </DialogTitle>
                    <DialogDescription>
                        {stage === 'confirm'
                            ? m.profile_activation_consequence()
                            : m.profile_editor_description()}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                    {stage === 'edit' ? (
                        <details
                            open={editing}
                            onToggle={event => setEditing(event.currentTarget.open)}>
                            <summary className="cursor-pointer font-medium">
                                {m.profile_json()}
                            </summary>
                            <Field className="mt-3 gap-1.5">
                                <FieldLabel htmlFor="channel-profile-json">
                                    {m.profile_json()}
                                </FieldLabel>
                                <Textarea
                                    id="channel-profile-json"
                                    value={profileText}
                                    onChange={event => {
                                        setProfileText(event.target.value)
                                        setError(null)
                                        setAssessment(null)
                                    }}
                                    spellCheck={false}
                                    rows={10}
                                    readOnly={reloadRequired}
                                    disabled={busy}
                                    className="field-sizing-fixed max-h-64 overflow-y-auto font-mono text-xs leading-5"
                                />
                                <FieldDescription>
                                    {unsaved
                                        ? m.profile_save_before_preview()
                                        : m.profile_json_description()}
                                </FieldDescription>
                            </Field>
                        </details>
                    ) : null}

                    {stage === 'edit' && metadata ? (
                        <details data-profile-metadata>
                            <summary className="cursor-pointer text-sm font-medium">
                                {m.profile_metadata_title()}
                            </summary>
                            <p className="mt-2 text-xs text-muted-foreground">
                                {m.profile_metadata_description()}
                            </p>
                            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                                {profileMetadataKeys.map(key => (
                                    <div key={key} className="contents">
                                        <dt className="text-muted-foreground">
                                            <code>{key}</code>
                                        </dt>
                                        <dd className="min-w-0 break-all font-mono">
                                            {String(metadata[key])}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </details>
                    ) : null}

                    {error ? (
                        <Alert variant="destructive">
                            <AlertTitle>
                                {stage === 'activated'
                                    ? m.profile_activation_refresh_failed()
                                    : definitionIssues.length > 0
                                      ? m.profile_definition_invalid()
                                      : m.profile_action_failed()}
                            </AlertTitle>
                            <AlertDescription>
                                {definitionIssues.length > 0 ? (
                                    <>
                                        <ul className="space-y-2">
                                            {definitionIssues.map((issue, index) => (
                                                <li key={`${issue.path}:${issue.code}:${index}`}>
                                                    <code className="block break-all text-xs">
                                                        {issue.path || m.profile_definition_root()}
                                                    </code>
                                                    <span>{profileIssueMessage(issue.code)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        {definitionIssueCount > definitionIssues.length ? (
                                            <p className="mt-2">
                                                {m.profile_issue_more({
                                                    count:
                                                        definitionIssueCount -
                                                        definitionIssues.length,
                                                })}
                                            </p>
                                        ) : null}
                                    </>
                                ) : (
                                    error
                                )}
                                {reloadRequired ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={busy}
                                        onClick={() => void reloadSavedProfile()}>
                                        {m.profile_activation_reload()}
                                    </Button>
                                ) : null}
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    {assessment ? (
                        <ChannelProfileImpactPreview
                            assessment={assessment}
                            activated={stage === 'activated'}
                            projectId={currentChannel.projectId}
                            onInspect={() => onOpenChange(false)}
                        />
                    ) : null}
                </div>

                {stage !== 'activated' ? (
                    <DialogFooter className="flex-wrap sm:justify-between">
                        {stage === 'confirm' ? (
                            <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() => setStage('edit')}>
                                {m.profile_activation_back()}
                            </Button>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void saveDraft()}
                                    disabled={busy || reloadRequired}>
                                    <CodeFileIcon aria-hidden="true" />
                                    {m.profile_save_draft()}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void previewDraft()}
                                    disabled={
                                        busy || draftId === null || unsaved || reloadRequired
                                    }>
                                    <RefreshIcon aria-hidden="true" />
                                    {m.profile_preview_impact()}
                                </Button>
                            </div>
                        )}
                        <Button
                            type="button"
                            onClick={() =>
                                stage === 'confirm' ? void activateDraft() : void previewDraft(true)
                            }
                            disabled={busy || assessment === null || unsaved || reloadRequired}>
                            <CheckIcon aria-hidden="true" />
                            {stage === 'confirm'
                                ? m.profile_activation_confirm()
                                : m.profile_activation_review()}
                        </Button>
                    </DialogFooter>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}

const profileMetadataKeys = ['id', 'origin', 'version', 'schemaHash', 'profileHash'] as const

function profilePresentation(profile: object) {
    const fields = Object.fromEntries(Object.entries(profile))
    const metadata = Object.fromEntries(profileMetadataKeys.map(key => [key, fields[key]]))
    const editable = Object.fromEntries(
        Object.entries(profile).filter(([key]) => !profileMetadataKeys.some(field => field === key))
    )
    return { text: JSON.stringify(editable, null, 2), metadata }
}
