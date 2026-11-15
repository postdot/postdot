import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { toast } from '@postdot/ui/components/toast'
import { useEffect, useRef, useState } from 'react'

import { ChannelContentBuilder } from '@/components/channel-content-builder'
import { ChannelContentChanges } from '@/components/channel-content-changes'
import { ChannelProfileImpactPreview } from '@/components/channel-profile-impact-preview'
import {
    api,
    ApiError,
    formatApiError,
    type ProfileDefinitionIssue,
    type Channel,
    type ChannelProfileAssessment,
} from '@/lib/api'
import { templatesFromPresets } from '@/lib/channel-profile-presets'
import { useLanguage } from '@/lib/i18n'
import { profileIssueMessage } from '@/lib/profile-validation-feedback'
import * as m from '@/paraglide/messages.js'
import { providerForProfile } from '@/providers/registry'

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
    const [latestTemplateAvailable, setLatestTemplateAvailable] = useState(false)
    const [shippedTemplateText, setShippedTemplateText] = useState<string | null>(null)
    const [savedProfileText, setSavedProfileText] = useState('')
    const [activeDefinition, setActiveDefinition] = useState<unknown>(null)
    const session = useRef(0)
    const titleRef = useRef<HTMLHeadingElement>(null)
    const [draftId, setDraftId] = useState<string | null>(null)
    const [draftRevision, setDraftRevision] = useState<number | undefined>(undefined)
    const [assessment, setAssessment] = useState<ChannelProfileAssessment | null>(null)
    const [builderValid, setBuilderValid] = useState(true)
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
        setActiveDefinition(null)
        setLatestTemplateAvailable(false)
        setShippedTemplateText(null)
        setDraftId(null)
        setDraftRevision(undefined)
        setSaving(false)
        setError(null)
        setAssessment(null)
        setBuilderValid(true)
        setStage('edit')
        setReloadRequired(false)
        void api
            .getChannelProfileState(channel.projectId, channel.id)
            .then(state => {
                if (cancelled) return
                setActiveDefinition(state.active.profile)
                const version = state.draft ?? state.active
                const presentation = profilePresentation(version.profile)
                setProfileText(presentation.text)
                setSavedProfileText(presentation.text)
                const execution = Object.fromEntries(Object.entries(version.profile)).execution
                setLatestTemplateAvailable(
                    state.draft === null &&
                        typeof execution === 'object' &&
                        execution !== null &&
                        'kind' in execution &&
                        execution.kind === 'built_in' &&
                        'contractId' in execution &&
                        providerForProfile(version.profile)?.templateUpgrade !== undefined &&
                        'revision' in execution &&
                        execution.revision ===
                            providerForProfile(version.profile)?.templateUpgrade?.revision
                )
                setDraftId(state.draft?.id ?? null)
                setDraftRevision(state.draft?.revision)
                if (state.draft === null && state.active.profile.origin === 'built_in') {
                    void api
                        .listChannelProfilePresets()
                        .then(({ presets }) => {
                            if (cancelled) return
                            const preset = presets.find(item => item.id === state.active.profile.id)
                            if (preset === undefined) return
                            const text = profilePresentation(preset.profile).text
                            if (
                                canonicalProfileValue(JSON.parse(text)) !==
                                canonicalProfileValue(JSON.parse(presentation.text))
                            ) {
                                setShippedTemplateText(text)
                            }
                        })
                        .catch(caughtError => {
                            if (!cancelled) setError(formatApiError(caughtError))
                        })
                }
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

    async function saveDraft(): Promise<{
        id: string
        revision: number | undefined
    } | null> {
        if (!builderValid) return null
        let profile: Record<string, unknown>
        try {
            const parsed: unknown = JSON.parse(profileText)
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setError(m.profile_must_be_object())
                return null
            }
            if (profileMetadataKeys.some(key => Object.hasOwn(parsed, key))) {
                setError(m.profile_metadata_managed())
                return null
            }
            profile = parsed as Record<string, unknown>
        } catch {
            setError(m.profile_invalid_json())
            return null
        }

        const epoch = session.current
        setError(null)
        setAssessment(null)
        try {
            const response = await api.saveChannelProfileDraft(
                currentChannel.projectId,
                currentChannel.id,
                profile,
                draftRevision
            )
            if (epoch !== session.current) return null
            setDraftId(response.profile.id)
            setDraftRevision(response.profile.revision)
            setShippedTemplateText(null)
            setLatestTemplateAvailable(false)
            const presentation = profilePresentation(response.profile.profile)
            setProfileText(presentation.text)
            setSavedProfileText(presentation.text)
            return { id: response.profile.id, revision: response.profile.revision }
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
            return null
        }
    }

    /**
     * One save (ADR-103 §5): store the rules, check what they change, and apply
     * them at once unless a publication would need review.
     */
    async function save() {
        const epoch = session.current
        setSaving(true)
        setError(null)
        try {
            const saved =
                draftId !== null && !unsaved
                    ? { id: draftId, revision: draftRevision }
                    : await saveDraft()
            if (saved === null || epoch !== session.current) return
            const response = await api.previewChannelProfileActivation(
                currentChannel.projectId,
                currentChannel.id,
                saved.id
            )
            if (epoch !== session.current) return
            if (response.assessment.hasReviewRequired) {
                setAssessment(response.assessment)
                setStage('confirm')
                return
            }
            await activate(saved.id, saved.revision, false)
        } catch (caughtError) {
            if (epoch === session.current) setError(formatApiError(caughtError))
        } finally {
            if (epoch === session.current) setSaving(false)
        }
    }

    async function activate(id: string, revision: number | undefined, showResult: boolean) {
        const epoch = session.current
        try {
            const result = await api.activateChannelProfile(
                currentChannel.projectId,
                currentChannel.id,
                id,
                revision
            )
            if (epoch !== session.current) return
            if (showResult) {
                setAssessment(result.assessment)
                setStage('activated')
            } else {
                toast.add({
                    title: m.profile_saved({ channel: currentChannel.name }),
                    type: 'success',
                })
                onOpenChange(false)
            }
            try {
                await onRefreshProject()
            } catch (caughtError) {
                if (epoch === session.current && showResult) setError(formatApiError(caughtError))
            }
        } catch (caughtError) {
            if (epoch === session.current) {
                setError(formatApiError(caughtError))
                setStage('edit')
                setAssessment(null)
                setReloadRequired(true)
            }
        }
    }

    async function confirmActivation() {
        if (draftId === null || stage !== 'confirm' || unsaved) {
            setError(m.profile_preview_before_activate())
            return
        }
        setSaving(true)
        setError(null)
        try {
            await activate(draftId, draftRevision, true)
        } finally {
            setSaving(false)
        }
    }

    async function loadLatestTemplate() {
        if (draftId !== null) return
        if (shippedTemplateText !== null) {
            setProfileText(shippedTemplateText)
            setAssessment(null)
            setBuilderValid(true)
            setShippedTemplateText(null)
            setLatestTemplateAvailable(false)
            setError(null)
            return
        }
        const epoch = session.current
        setLoading(true)
        setError(null)
        try {
            const { presets } = await api.listChannelProfilePresets()
            if (epoch !== session.current) return
            const presetId = providerForProfile(activeDefinition)?.templateUpgrade?.presetId
            const preset = presets.find(item => item.id === presetId)
            if (preset === undefined) throw new Error('Provider template unavailable')
            setProfileText(profilePresentation(templatesFromPresets([preset])[0]!.profile).text)
            setAssessment(null)
            setBuilderValid(true)
            setLatestTemplateAvailable(false)
        } catch (caughtError) {
            if (epoch === session.current) setError(formatApiError(caughtError))
        } finally {
            if (epoch === session.current) setLoading(false)
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
            setDraftId(state.draft?.id ?? null)
            setDraftRevision(state.draft?.revision)
            setAssessment(null)
            setBuilderValid(true)
            setStage('edit')
            setError(null)
            setReloadRequired(false)
        } catch (caughtError) {
            if (epoch === session.current) setError(formatApiError(caughtError))
        } finally {
            if (epoch === session.current) setLoading(false)
        }
    }

    const busy = pending || loading || saving || profileText === ''
    const unsaved = profileText !== savedProfileText

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[min(46rem,calc(100dvh-2rem))] max-w-[calc(100vw_-_2rem)] flex min-h-0 flex-col overflow-hidden sm:max-w-5xl">
                <DialogHeader className="shrink-0">
                    <DialogTitle ref={titleRef} tabIndex={-1} className="pr-6 outline-none">
                        {stage === 'confirm'
                            ? m.profile_activation_confirm_title({
                                  channel: currentChannel.name,
                              })
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

                <div
                    data-channel-dialog-body
                    className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain pr-1">
                    {stage === 'edit' &&
                    draftId === null &&
                    (shippedTemplateText !== null || latestTemplateAvailable) ? (
                        <Button
                            type="button"
                            variant="outline"
                            className="justify-self-start"
                            disabled={busy || !builderValid || unsaved || reloadRequired}
                            onClick={() => void loadLatestTemplate()}>
                            {shippedTemplateText !== null
                                ? m.profile_load_shipped_template()
                                : m.profile_load_latest_linkedin_template()}
                        </Button>
                    ) : null}
                    {stage === 'edit' && !loading && profileText !== '' ? (
                        <ChannelContentBuilder
                            projectId={currentChannel.projectId}
                            key={currentChannel.id}
                            value={profileText}
                            disabled={busy || reloadRequired}
                            onValidityChange={setBuilderValid}
                            onChange={value => {
                                setProfileText(value)
                                setError(null)
                                setAssessment(null)
                            }}
                        />
                    ) : null}

                    {activeDefinition !== null && stage === 'confirm' ? (
                        <ChannelContentChanges before={activeDefinition} after={profileText} />
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
                    <DialogFooter>
                        {stage === 'confirm' ? (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => {
                                        setStage('edit')
                                        setAssessment(null)
                                    }}>
                                    {m.profile_activation_back()}
                                </Button>
                                <Button
                                    type="button"
                                    disabled={busy || reloadRequired}
                                    onClick={() => void confirmActivation()}>
                                    {m.profile_activation_confirm()}
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={saving}
                                    onClick={() => onOpenChange(false)}>
                                    {m.common_cancel()}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => void save()}
                                    disabled={
                                        busy ||
                                        !builderValid ||
                                        reloadRequired ||
                                        (draftId === null && !unsaved)
                                    }>
                                    {m.common_save()}
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                ) : (
                    <DialogFooter>
                        <Button type="button" onClick={() => onOpenChange(false)}>
                            {m.common_done()}
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    )
}

const profileMetadataKeys = ['id', 'origin', 'version', 'schemaHash', 'profileHash'] as const

function profilePresentation(profile: object) {
    const editable = Object.fromEntries(
        Object.entries(profile).filter(([key]) => !profileMetadataKeys.some(field => field === key))
    )
    return { text: JSON.stringify(editable, null, 2) }
}

function canonicalProfileValue(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonicalProfileValue).join(',') + ']'
    if (value !== null && typeof value === 'object') {
        return (
            '{' +
            Object.entries(value)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, entry]) => JSON.stringify(key) + ':' + canonicalProfileValue(entry))
                .join(',') +
            '}'
        )
    }
    return JSON.stringify(value)
}
