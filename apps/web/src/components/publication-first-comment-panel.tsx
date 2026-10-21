import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Badge } from '@postbot/ui/components/badge'
import { Button } from '@postbot/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@postbot/ui/components/field'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { Textarea } from '@postbot/ui/components/textarea'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { api, ApiError, type Publication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import {
    countFirstCommentGraphemes,
    firstCommentAccepted,
    firstCommentCancellable,
    firstCommentConflicted,
    firstCommentDelayOptions,
    firstCommentEdited,
    firstCommentEditState,
    firstCommentExternalLinkAllowed,
    firstCommentFormEditable,
    firstCommentMaxGraphemes,
    firstCommentMaxTextLength,
    firstCommentReloaded,
    firstCommentSubmitRevision,
    firstCommentTextProblem,
    firstCommentVersion,
    type FirstCommentDelayOption,
    type FirstCommentEditState,
    type PublicationFirstCommentState,
} from '@/lib/publication-first-comment'
import * as m from '@/paraglide/messages.js'

/** A first comment is only prepared while the publication can still be changed. */
const creatablePublicationStates = new Set<Publication['state']>(['draft', 'scheduled'])

interface FirstCommentStateNotice {
    readonly tone: 'muted' | 'attention' | 'failed'
    readonly text: string
}

interface FirstCommentRequestBase {
    readonly expectedRevision: number
    /** The newest request owns the panel; a stale response applies nothing. */
    readonly requestId: number
    /** The local edit count at dispatch, so a late response keeps newer input. */
    readonly editCount: number
}

interface FirstCommentSaveRequest extends FirstCommentRequestBase {
    readonly text: string
    readonly delaySeconds: number
}

type FirstCommentCancelRequest = FirstCommentRequestBase

export function PublicationFirstCommentPanel({
    projectId,
    publicationId,
    publicationState,
    disabled,
    timeZone,
    onAccessRefused,
}: {
    readonly projectId: string
    readonly publicationId: string
    readonly publicationState: Publication['state']
    readonly disabled: boolean
    readonly timeZone: string
    readonly onAccessRefused?: () => void
}) {
    const { locale } = useLanguage()
    const client = useQueryClient()
    const textId = useId()
    const counterId = useId()
    const textErrorId = useId()
    const delayId = useId()
    const delayDescriptionId = useId()
    const key = useMemo(
        () => [...projectQueryKeys.publicationEditor(projectId, publicationId), 'first-comment'],
        [projectId, publicationId]
    )
    const query = useQuery({
        queryKey: key,
        queryFn: () => api.getPublicationFirstComment(projectId, publicationId),
        staleTime: 0,
        refetchOnWindowFocus: false,
        retry: false,
    })
    const [open, setOpen] = useState(false)
    const revealed = useRef(false)
    const [edit, setEdit] = useState<FirstCommentEditState>(firstCommentEditState)
    const [conflictPending, setConflictPending] = useState(false)
    const [attempted, setAttempted] = useState(false)
    const [notice, setNotice] = useState<'saved' | 'cancelled' | null>(null)
    const requestId = useRef(0)
    const refusalReported = useRef(false)

    const response = query.data
    const item = response?.firstComment ?? null
    const live = useMemo(() => firstCommentVersion(item), [item])

    // An existing configuration opens the section once, so an outcome is never
    // hidden behind a collapsed control after a background refresh.
    useEffect(() => {
        if (revealed.current || item === null) return
        revealed.current = true
        setOpen(true)
    }, [item])

    // A refused read is authoritative, but it is reported from an effect: the
    // parent owns the verification and must not be updated while rendering.
    const refused =
        query.isError &&
        query.error instanceof ApiError &&
        (query.error.status === 403 || query.error.status === 404)
    useEffect(() => {
        if (!refused) {
            refusalReported.current = false
            return
        }
        if (refusalReported.current) return
        refusalReported.current = true
        onAccessRefused?.()
    }, [refused, onAccessRefused])

    // A refused save keeps the local text and delay and shows the server
    // version that refused it, so the operator decides between reviewing that
    // version and resubmitting against it.
    const applyConflict = (request: FirstCommentRequestBase) => {
        setConflictPending(true)
        void (async () => {
            const refreshed = await query.refetch().catch(() => null)
            if (request.requestId !== requestId.current) return
            setEdit(current =>
                firstCommentConflicted(
                    current,
                    firstCommentVersion(refreshed?.data?.firstComment ?? item)
                )
            )
            setConflictPending(false)
        })()
    }

    const save = useMutation({
        mutationFn: (request: FirstCommentSaveRequest) =>
            api.savePublicationFirstComment(projectId, publicationId, {
                text: request.text,
                delaySeconds: request.delaySeconds,
                expectedRevision: request.expectedRevision,
            }),
        onSuccess: (result, request) => {
            if (request.requestId !== requestId.current) return
            client.setQueryData(key, result)
            setEdit(current =>
                firstCommentAccepted(
                    current,
                    request.editCount,
                    firstCommentVersion(result.firstComment)
                )
            )
            setNotice('saved')
        },
        onError: (error, request) => {
            if (request.requestId !== requestId.current) return
            if (error instanceof ApiError && error.status === 409) {
                applyConflict(request)
                return
            }
            if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
                onAccessRefused?.()
            }
        },
    })

    const cancel = useMutation({
        mutationFn: (request: FirstCommentCancelRequest) =>
            api.cancelPublicationFirstComment(projectId, publicationId, {
                expectedRevision: request.expectedRevision,
            }),
        onSuccess: (result, request) => {
            if (request.requestId !== requestId.current) return
            client.setQueryData(key, result)
            setEdit(current =>
                firstCommentAccepted(
                    current,
                    request.editCount,
                    firstCommentVersion(result.firstComment)
                )
            )
            setNotice('cancelled')
        },
        onError: (error, request) => {
            if (request.requestId !== requestId.current) return
            if (error instanceof ApiError && error.status === 409) {
                applyConflict(request)
                return
            }
            if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
                onAccessRefused?.()
            }
        },
    })

    // A background refresh must never take the keyboard away from an operator
    // who is already writing; only a mutation or a conflict reload blocks it.
    const busy = save.isPending || cancel.isPending || conflictPending

    if (query.isPending) return null

    if (query.isError) {
        const error = query.error
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
            return null
        }
        return (
            <div role="alert" className="mt-5 space-y-2 text-sm text-state-failed">
                <p>{m.first_comment_read_failed()}</p>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void query.refetch()}>
                    {m.common_retry()}
                </Button>
            </div>
        )
    }

    if (response === undefined) return null

    const editable = firstCommentFormEditable(response, disabled)
    const creatable = editable && item === null && creatablePublicationStates.has(publicationState)
    if (item === null && !creatable) return null

    const formatDate = (timestamp: number) =>
        new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone,
        }).format(timestamp)
    const delayLabel = (option: FirstCommentDelayOption) => {
        if (option.unit === 'immediate') return m.first_comment_delay_immediate()
        if (option.unit === 'seconds')
            return m.first_comment_delay_seconds({ count: String(option.amount) })
        if (option.unit === 'minutes')
            return m.first_comment_delay_minutes({ count: String(option.amount) })
        if (option.unit === 'hours')
            return m.first_comment_delay_hours({ count: String(option.amount) })
        return m.first_comment_delay_days({ count: String(option.amount) })
    }
    const text = edit.draftText ?? edit.baseline?.text ?? live.text
    const delaySeconds = edit.draftDelaySeconds ?? edit.baseline?.delaySeconds ?? live.delaySeconds
    const delayOptions = firstCommentDelayOptions(delaySeconds)
    const delayItems = delayOptions.map(option => ({
        value: String(option.value),
        label: delayLabel(option),
    }))
    const suspended = item?.state === 'suspended'
    const readOnlyOutcome = item !== null && !editable
    const stateNotice = item === null ? null : firstCommentStateNotice(item.state)
    const cancellable = firstCommentCancellable(response, disabled)
    const graphemes = countFirstCommentGraphemes(text)
    const textProblem = firstCommentTextProblem(text)
    const textInvalid = attempted && textProblem !== null
    const expectedRevision = firstCommentSubmitRevision(edit, live)

    const nextRequest = () => {
        const nextRequestId = requestId.current + 1
        requestId.current = nextRequestId
        return { requestId: nextRequestId, editCount: edit.editCount }
    }

    return (
        <details
            className="mt-5 min-w-0 rounded-md bg-surface-inset/35 px-4 py-3"
            open={open}
            onToggle={event => setOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium">
                <span className="flex flex-wrap items-center gap-2">
                    {m.first_comment_title()}
                    {item ? (
                        <Badge className={firstCommentStateClass(item.state)}>
                            {firstCommentStateLabel(item.state)}
                        </Badge>
                    ) : null}
                </span>
            </summary>
            <div className="mt-4 space-y-4">
                {item ? (
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                            {m.first_comment_author({ name: item.authorName })}
                        </p>
                        {item.dueAt !== null ? (
                            <p className="text-xs text-muted-foreground">
                                {m.first_comment_due_at({ date: formatDate(item.dueAt) })}
                            </p>
                        ) : null}
                        {stateNotice ? (
                            stateNotice.tone === 'muted' ? (
                                <p className="text-xs text-muted-foreground">{stateNotice.text}</p>
                            ) : (
                                <Alert
                                    className={
                                        stateNotice.tone === 'failed'
                                            ? 'border-state-failed/40 bg-state-failed/10'
                                            : 'border-state-attention/40 bg-state-attention/10'
                                    }>
                                    <AlertDescription
                                        className={
                                            stateNotice.tone === 'failed'
                                                ? 'text-state-failed'
                                                : 'text-state-attention'
                                        }>
                                        {stateNotice.text}
                                    </AlertDescription>
                                </Alert>
                            )
                        ) : null}
                        {item.lastError ? (
                            <details className="text-xs text-muted-foreground">
                                <summary className="cursor-pointer">
                                    {m.first_comment_delivery_details()}
                                </summary>
                                <p className="mt-1 break-words">{item.lastError}</p>
                            </details>
                        ) : null}
                        {firstCommentExternalLinkAllowed(item.externalUrl) ? (
                            <a
                                href={item.externalUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                                {m.first_comment_open_original()}
                            </a>
                        ) : null}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">{m.first_comment_description()}</p>
                )}

                {readOnlyOutcome && item ? (
                    <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                        {item.text}
                    </p>
                ) : null}

                {edit.conflict !== null ? (
                    <Alert className="border-state-attention/40 bg-state-attention/10">
                        <AlertTitle>{m.first_comment_conflict()}</AlertTitle>
                        <AlertDescription>
                            <p className="mt-1">
                                <span className="font-medium">
                                    {m.first_comment_conflict_current()}
                                </span>
                                <span className="mt-1 block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                    {edit.conflict.text}
                                </span>
                                <span className="mt-1 block text-xs">
                                    {m.first_comment_conflict_revision({
                                        revision: String(edit.conflict.revision),
                                    })}
                                </span>
                            </p>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                    setNotice(null)
                                    setEdit(current => firstCommentReloaded(current, live))
                                }}>
                                {m.first_comment_conflict_reload()}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : null}

                {editable ? (
                    <form
                        className="space-y-4"
                        onSubmit={event => {
                            event.preventDefault()
                            setAttempted(true)
                            if (busy || textProblem !== null) return
                            setNotice(null)
                            save.mutate({
                                text,
                                delaySeconds,
                                expectedRevision,
                                ...nextRequest(),
                            })
                        }}>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={textId}>{m.first_comment_text_label()}</FieldLabel>
                            <Textarea
                                id={textId}
                                value={text}
                                placeholder={m.first_comment_text_placeholder()}
                                disabled={busy}
                                aria-invalid={textInvalid || undefined}
                                aria-describedby={
                                    textInvalid ? `${counterId} ${textErrorId}` : counterId
                                }
                                onChange={event => {
                                    setNotice(null)
                                    setEdit(current =>
                                        firstCommentEdited(current, live, {
                                            text: event.target.value,
                                        })
                                    )
                                }}
                            />
                            <FieldDescription id={counterId} className="text-xs">
                                {graphemes}/{firstCommentMaxGraphemes}
                            </FieldDescription>
                            {textInvalid ? (
                                <FieldError id={textErrorId}>
                                    {textProblem === 'empty'
                                        ? m.first_comment_text_empty()
                                        : textProblem === 'too_long'
                                          ? m.first_comment_text_too_long({
                                                limit: String(firstCommentMaxGraphemes),
                                            })
                                          : m.first_comment_text_too_long_units({
                                                limit: String(firstCommentMaxTextLength),
                                            })}
                                </FieldError>
                            ) : null}
                        </Field>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={delayId}>
                                {m.first_comment_delay_label()}
                            </FieldLabel>
                            <Select
                                items={delayItems}
                                value={String(delaySeconds)}
                                onValueChange={value => {
                                    setNotice(null)
                                    setEdit(current =>
                                        firstCommentEdited(current, live, {
                                            delaySeconds: Number(value),
                                        })
                                    )
                                }}>
                                <SelectTrigger
                                    id={delayId}
                                    disabled={busy}
                                    aria-describedby={delayDescriptionId}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {delayOptions.map(option => (
                                        <SelectItem key={option.value} value={String(option.value)}>
                                            {delayLabel(option)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FieldDescription id={delayDescriptionId} className="text-xs">
                                {m.first_comment_delay_description()}
                            </FieldDescription>
                        </Field>
                        <p className="text-xs text-muted-foreground">{m.first_comment_consent()}</p>
                        {save.isError && edit.conflict === null ? (
                            <p role="alert" className="text-sm text-state-failed">
                                {m.first_comment_save_failed()}
                            </p>
                        ) : null}
                        {cancel.isError && edit.conflict === null ? (
                            <p role="alert" className="text-sm text-state-failed">
                                {m.first_comment_cancel_failed()}
                            </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                            <Button type="submit" disabled={busy}>
                                {save.isPending
                                    ? m.common_loading()
                                    : edit.conflict !== null
                                      ? m.first_comment_save_against_current()
                                      : suspended
                                        ? m.first_comment_reactivate()
                                        : m.first_comment_save_enable()}
                            </Button>
                            {cancellable ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => {
                                        setNotice(null)
                                        cancel.mutate({
                                            expectedRevision,
                                            ...nextRequest(),
                                        })
                                    }}>
                                    {cancel.isPending
                                        ? m.common_loading()
                                        : m.first_comment_cancel()}
                                </Button>
                            ) : null}
                        </div>
                    </form>
                ) : null}

                {notice ? (
                    <p role="status" className="text-xs text-muted-foreground">
                        {notice === 'saved' ? m.first_comment_saved() : m.first_comment_canceled()}
                    </p>
                ) : null}
            </div>
        </details>
    )
}

function firstCommentStateLabel(state: PublicationFirstCommentState): string {
    switch (state) {
        case 'waiting':
            return m.first_comment_state_waiting()
        case 'pending':
            return m.first_comment_state_pending()
        case 'running':
            return m.first_comment_state_running()
        case 'suspended':
            return m.first_comment_state_suspended()
        case 'sent':
            return m.first_comment_state_sent()
        case 'failed':
            return m.first_comment_state_failed()
        case 'ambiguous':
            return m.first_comment_state_ambiguous()
        case 'cancelled':
            return m.first_comment_state_cancelled()
    }
}

function firstCommentStateClass(state: PublicationFirstCommentState): string {
    switch (state) {
        case 'waiting':
            return 'border-transparent bg-state-draft/15 text-state-draft'
        case 'pending':
            return 'border-transparent bg-state-queued/15 text-state-queued'
        case 'running':
            return 'border-transparent bg-primary/15 text-primary'
        case 'suspended':
            return 'border-transparent bg-state-attention/15 text-state-attention'
        case 'sent':
            return 'border-transparent bg-state-published/15 text-state-published'
        case 'failed':
            return 'border-transparent bg-state-failed/15 text-state-failed'
        case 'ambiguous':
            return 'border-transparent bg-state-attention/15 text-state-attention'
        case 'cancelled':
            return 'border-transparent bg-secondary text-secondary-foreground'
    }
}

function firstCommentStateNotice(
    state: PublicationFirstCommentState
): FirstCommentStateNotice | null {
    switch (state) {
        case 'waiting':
            return { tone: 'muted', text: m.first_comment_waiting_notice() }
        case 'suspended':
            return { tone: 'attention', text: m.first_comment_suspended_notice() }
        case 'failed':
            return { tone: 'failed', text: m.first_comment_failed_notice() }
        case 'ambiguous':
            return { tone: 'attention', text: m.first_comment_ambiguous_notice() }
        case 'cancelled':
            return { tone: 'muted', text: m.first_comment_cancelled_notice() }
        case 'pending':
        case 'running':
        case 'sent':
            return null
    }
}
