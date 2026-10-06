import type { PublicationApprovalRequest } from '@herald/client'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { DateTimePicker } from '@/components/date-time-picker'
import { api } from '@/lib/api'
import {
    dateTimeLocalErrorMessage,
    formatProjectDateTime,
    parseDateTimeLocal,
    toDateTimeLocal,
} from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import { isActiveChannelProfilePromotionError } from '@/lib/publication-promotion'
import * as m from '@/paraglide/messages.js'

export function PublicationApprovalRequests({
    projectId,
    timeZone,
}: {
    readonly projectId: string
    readonly timeZone: string
}) {
    const requestsQuery = useQuery({
        queryKey: projectQueryKeys.publicationApprovals(projectId),
        queryFn: () => api.listPublicationApprovalRequests(projectId),
        refetchInterval: 30_000,
        staleTime: 15_000,
    })
    const [now, setNow] = useState(() => Date.now())
    const requests = requestsQuery.data?.requests ?? []

    useEffect(() => {
        if (requests.length === 0) return
        const interval = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(interval)
    }, [requests.length])

    if (requestsQuery.isError) {
        return (
            <p className="mt-4 text-sm text-destructive" role="alert">
                {m.approval_requests_load_failed()}
            </p>
        )
    }
    if (requests.length === 0) return null

    return (
        <section aria-labelledby="publication-approval-title" className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
                <h2
                    className="font-heading text-lg font-medium leading-none"
                    id="publication-approval-title">
                    {m.approval_requests_title()}
                </h2>
                <Badge className="min-w-5 px-1.5 py-0 text-xs" variant="secondary">
                    {requests.length}
                </Badge>
            </div>
            <div className="space-y-2">
                {requests.map(request => (
                    <PublicationApprovalRequestRow
                        key={request.id}
                        now={now}
                        projectId={projectId}
                        request={request}
                        timeZone={timeZone}
                    />
                ))}
            </div>
        </section>
    )
}

function PublicationApprovalRequestRow({
    now,
    projectId,
    request,
    timeZone,
}: {
    readonly now: number
    readonly projectId: string
    readonly request: PublicationApprovalRequest
    readonly timeZone: string
}) {
    const queryClient = useQueryClient()
    const { locale } = useLanguage()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<'active_profile' | 'action' | null>(null)
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
    const [scheduleValue, setScheduleValue] = useState('')
    const [scheduleError, setScheduleError] = useState<string | null>(null)
    const editorQuery = useQuery({
        queryKey: projectQueryKeys.publicationEditor(projectId, request.publicationId),
        queryFn: async () =>
            (await api.getPublicationEditor(projectId, request.publicationId)).editor,
        staleTime: 30_000,
    })
    const overdue = request.proposedScheduledAt <= now

    async function refreshAfterDecision() {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: projectQueryKeys.publicationApprovals(projectId),
            }),
            queryClient.invalidateQueries({
                queryKey: projectQueryKeys.publicationQueues(projectId),
            }),
            queryClient.invalidateQueries({
                queryKey: projectQueryKeys.publicationEditors(projectId),
            }),
        ])
    }

    async function approve(
        options: { readonly scheduledAt?: number; readonly publishNow?: boolean } = {}
    ): Promise<boolean> {
        setBusy(true)
        setError(null)
        try {
            await api.approvePublicationApprovalRequest(projectId, request.publicationId, options)
            await refreshAfterDecision()
            return true
        } catch (caughtError) {
            setError(
                isActiveChannelProfilePromotionError(caughtError) ? 'active_profile' : 'action'
            )
            return false
        } finally {
            setBusy(false)
        }
    }

    async function reject() {
        setBusy(true)
        setError(null)
        try {
            await api.rejectPublicationApprovalRequest(projectId, request.publicationId)
            await refreshAfterDecision()
        } catch {
            setError('action')
        } finally {
            setBusy(false)
        }
    }

    function openScheduleDialog() {
        const nextHour = Math.ceil((Date.now() + 60 * 60 * 1_000) / 60_000) * 60_000
        setScheduleValue(toDateTimeLocal(nextHour, timeZone))
        setScheduleError(null)
        setScheduleDialogOpen(true)
    }

    async function scheduleWithNewTime() {
        const parsed = parseDateTimeLocal(scheduleValue, timeZone)
        if (parsed === null) {
            setScheduleError(m.approval_requests_date_required())
            return
        }
        if (typeof parsed !== 'number') {
            setScheduleError(dateTimeLocalErrorMessage(parsed))
            return
        }
        if (parsed < Date.now()) {
            setScheduleError(dateTimeLocalErrorMessage('past'))
            return
        }
        if (await approve({ scheduledAt: parsed })) setScheduleDialogOpen(false)
    }

    const publicationTitle = editorQuery.data?.post.title || m.publication_untitled()
    const channelName = editorQuery.data?.channel.name

    return (
        <>
            <article className="flex min-w-0 flex-col gap-3 rounded-lg bg-surface-inset/60 p-3 shadow-surface sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                    <Link
                        className="block truncate text-sm font-medium hover:underline"
                        params={{ projectId, publicationId: request.publicationId }}
                        to="/dashboard/projects/$projectId/publications/$publicationId">
                        {publicationTitle}
                    </Link>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {channelName ? <span>{channelName}</span> : null}
                        <span>
                            {m.approval_requests_proposed_for({
                                date: formatProjectDateTime(
                                    request.proposedScheduledAt,
                                    timeZone,
                                    locale
                                ),
                            })}
                        </span>
                        {overdue ? (
                            <Badge className="px-1.5 py-0 text-[0.65rem]" variant="secondary">
                                {m.approval_requests_time_passed()}
                            </Badge>
                        ) : null}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {overdue ? (
                        <>
                            <Button
                                disabled={busy}
                                onClick={openScheduleDialog}
                                size="sm"
                                variant="ghost">
                                {m.approval_requests_change_time()}
                            </Button>
                            <Button
                                disabled={busy}
                                onClick={() => void approve({ publishNow: true })}
                                size="sm">
                                {m.approval_requests_publish_now()}
                            </Button>
                        </>
                    ) : (
                        <Button disabled={busy} onClick={() => void approve()} size="sm">
                            {m.approval_requests_approve()}
                        </Button>
                    )}
                    <Button disabled={busy} onClick={() => void reject()} size="sm" variant="ghost">
                        {m.approval_requests_reject()}
                    </Button>
                </div>
                {error ? (
                    <p className="text-xs text-destructive sm:basis-full" role="alert">
                        {error === 'active_profile'
                            ? m.approval_requests_active_profile_mismatch()
                            : m.approval_requests_action_failed()}
                    </p>
                ) : null}
            </article>

            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{m.approval_requests_change_time()}</DialogTitle>
                    </DialogHeader>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={`approval-time-${request.id}`}>
                            {m.queue_reschedule_deliver_at()}
                        </FieldLabel>
                        <DateTimePicker
                            id={`approval-time-${request.id}`}
                            value={scheduleValue}
                            ariaInvalid={scheduleError !== null}
                            onChange={value => {
                                setScheduleValue(value)
                                setScheduleError(null)
                            }}
                            disabled={busy}
                            dateLabel={m.date_time_picker_date()}
                            locale={locale}
                            placeholder={m.date_time_picker_placeholder()}
                            timeLabel={m.date_time_picker_time()}
                            timeZone={timeZone}
                        />
                        {scheduleError !== null ? (
                            <p className="text-xs text-destructive" role="alert">
                                {scheduleError}
                            </p>
                        ) : null}
                    </Field>
                    <DialogFooter>
                        <Button
                            disabled={busy}
                            onClick={() => setScheduleDialogOpen(false)}
                            variant="ghost">
                            {m.common_cancel()}
                        </Button>
                        <Button disabled={busy} onClick={() => void scheduleWithNewTime()}>
                            {m.approval_requests_schedule()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
