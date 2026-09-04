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
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { CodeFileIcon } from '@solar-icons/react/bold/code-file'
import { RefreshIcon } from '@solar-icons/react/bold/refresh'
import { useEffect, useState } from 'react'

import { api, formatApiError, type Channel, type ChannelProfileAssessment } from '@/lib/api'

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
                setError('The profile must be a JSON object.')
                return
            }
            profile = parsed as Record<string, unknown>
        } catch {
            setError('The profile is not valid JSON.')
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
            setError('Save the draft before previewing its impact.')
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
            setError('Preview the saved draft before activating it.')
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
                    <DialogTitle>Edit {currentChannel.name} profile</DialogTitle>
                    <DialogDescription>
                        Save a draft, inspect its impact, then activate it explicitly. An active
                        profile is never replaced silently.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor="channel-profile-json">Profile JSON</FieldLabel>
                        <Textarea
                            id="channel-profile-json"
                            value={profileText}
                            onChange={event => setProfileText(event.target.value)}
                            spellCheck={false}
                            rows={18}
                            disabled={busy}
                            className="font-mono text-xs leading-5"
                        />
                        <FieldDescription>
                            The server validates the schema, bindings, capabilities, and execution
                            contract before accepting the draft.
                        </FieldDescription>
                    </Field>

                    {error ? (
                        <Alert variant="destructive">
                            <AlertTitle>Profile action failed</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}

                    {assessment ? (
                        <Alert variant={assessment.hasReviewRequired ? 'destructive' : 'default'}>
                            <AlertTitle>
                                {assessment.hasReviewRequired
                                    ? 'Review required before activation'
                                    : 'Profile is ready to activate'}
                            </AlertTitle>
                            <AlertDescription>
                                {assessment.changes.length} profile change
                                {assessment.changes.length === 1 ? '' : 's'} ·{' '}
                                {assessment.workingDrafts.length} working draft impact
                                {assessment.workingDrafts.length === 1 ? '' : 's'} ·{' '}
                                {assessment.pendingTargets.length} pending target impact
                                {assessment.pendingTargets.length === 1 ? '' : 's'}.
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
                            Save draft
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void previewDraft()}
                            disabled={busy || draftId === null}>
                            <RefreshIcon aria-hidden="true" />
                            Preview impact
                        </Button>
                    </div>
                    <Button
                        type="button"
                        onClick={() => void activateDraft()}
                        disabled={busy || assessment === null || assessment.hasReviewRequired}>
                        <CheckReadIcon aria-hidden="true" />
                        Activate profile
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
