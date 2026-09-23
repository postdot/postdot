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
import { useEffect, useState } from 'react'

import { api, formatApiError, type Channel, type ChannelProfileAssessment } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
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
    const [draftId, setDraftId] = useState<string | null>(null)
    const [draftRevision, setDraftRevision] = useState<number | undefined>(undefined)
    const [assessment, setAssessment] = useState<ChannelProfileAssessment | null>(null)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open || channel === null) return

        let cancelled = false
        setLoading(true)
        setError(null)
        setAssessment(null)
        void api
            .getChannelProfileState(channel.projectId, channel.id)
            .then(state => {
                if (cancelled) return
                const version = state.draft ?? state.active
                setProfileText(JSON.stringify(version.profile, null, 2))
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
            profile = parsed as Record<string, unknown>
        } catch {
            setError(m.profile_invalid_json())
            return
        }

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
            setDraftId(response.profile.id)
            setDraftRevision(response.profile.revision)
            setProfileText(JSON.stringify(response.profile.profile, null, 2))
        } catch (caughtError) {
            setError(formatApiError(caughtError))
        } finally {
            setSaving(false)
        }
    }

    async function previewDraft() {
        if (draftId === null) {
            setError(m.profile_save_before_preview())
            return
        }
        setSaving(true)
        setError(null)
        try {
            const response = await api.previewChannelProfileActivation(
                currentChannel.projectId,
                currentChannel.id,
                draftId
            )
            setAssessment(response.assessment)
        } catch (caughtError) {
            setError(formatApiError(caughtError))
        } finally {
            setSaving(false)
        }
    }

    async function activateDraft() {
        if (draftId === null || assessment === null) {
            setError(m.profile_preview_before_activate())
            return
        }
        setSaving(true)
        setError(null)
        try {
            await api.activateChannelProfile(
                currentChannel.projectId,
                currentChannel.id,
                draftId,
                draftRevision
            )
            await onRefreshProject()
            onOpenChange(false)
        } catch (caughtError) {
            setError(formatApiError(caughtError))
        } finally {
            setSaving(false)
        }
    }

    const busy = pending || loading || saving

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[min(46rem,calc(100vh-2rem))] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {m.profile_editor_title({ channel: currentChannel.name })}
                    </DialogTitle>
                    <DialogDescription>{m.profile_editor_description()}</DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor="channel-profile-json">{m.profile_json()}</FieldLabel>
                        <Textarea
                            id="channel-profile-json"
                            value={profileText}
                            onChange={event => setProfileText(event.target.value)}
                            spellCheck={false}
                            rows={18}
                            disabled={busy}
                            className="font-mono text-xs leading-5"
                        />
                        <FieldDescription>{m.profile_json_description()}</FieldDescription>
                    </Field>

                    {error ? (
                        <Alert variant="destructive">
                            <AlertTitle>{m.profile_action_failed()}</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}

                    {assessment ? (
                        <Alert variant={assessment.hasReviewRequired ? 'destructive' : 'default'}>
                            <AlertTitle>
                                {assessment.hasReviewRequired
                                    ? m.profile_review_required()
                                    : m.profile_ready()}
                            </AlertTitle>
                            <AlertDescription>
                                {m.common_change_count({ count: assessment.changes.length })} ·{' '}
                                {m.common_draft_impact_count({
                                    count: assessment.workingDrafts.length,
                                })}{' '}
                                ·{' '}
                                {m.common_target_impact_count({
                                    count: assessment.pendingTargets.length,
                                })}
                                .
                            </AlertDescription>
                        </Alert>
                    ) : null}
                </div>

                <DialogFooter className="flex-wrap sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void saveDraft()}
                            disabled={busy}>
                            <CodeFileIcon aria-hidden="true" />
                            {m.profile_save_draft()}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void previewDraft()}
                            disabled={busy || draftId === null}>
                            <RefreshIcon aria-hidden="true" />
                            {m.profile_preview_impact()}
                        </Button>
                    </div>
                    <Button
                        type="button"
                        onClick={() => void activateDraft()}
                        disabled={busy || assessment === null || assessment.hasReviewRequired}>
                        <CheckIcon aria-hidden="true" />
                        {m.profile_activate()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
