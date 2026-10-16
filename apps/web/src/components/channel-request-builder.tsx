import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { useEffect, useId, useState } from 'react'

import {
    editMappedRequest,
    parseRequestStatuses,
    projectMappedRequest,
    requestOutcomeKeys,
    type RequestEdit,
    type RequestOutcomeKey,
} from '@/lib/channel-request-builder'
import * as m from '@/paraglide/messages.js'

export function ChannelRequestBuilder({
    profile,
    onChange,
    disabled,
    onValidityChange,
}: {
    readonly profile: unknown
    readonly onChange: (profile: Record<string, unknown>) => void
    readonly disabled: boolean
    readonly onValidityChange: (valid: boolean) => void
}) {
    const id = useId()
    const view = projectMappedRequest(profile)
    const [segments, setSegments] = useState<Record<number, string>>({})
    const [statuses, setStatuses] = useState<Partial<Record<RequestOutcomeKey, string>>>({})
    const [errors, setErrors] = useState<Record<string, string>>({})
    const valid = view === null || Object.keys(errors).length === 0
    useEffect(() => onValidityChange(valid), [valid, onValidityChange])
    if (!view) return null
    const labels = {
        successStatuses: m.request_success(),
        retryableStatuses: m.request_retryable(),
        rejectedStatuses: m.request_rejected(),
        ambiguousStatuses: m.request_ambiguous(),
    }
    function apply(key: string, edit: RequestEdit) {
        const result = editMappedRequest(profile, edit)
        setErrors(current => {
            const next = { ...current }
            if (result.ok) delete next[key]
            else
                next[key] =
                    result.reason === 'overlap' ? m.request_status_overlap() : m.request_invalid()
            return next
        })
        if (result.ok) onChange(result.profile)
    }
    function updateStatuses(key: RequestOutcomeKey, value: string) {
        const next = { ...statuses, [key]: value }
        setStatuses(next)
        const read = (outcome: RequestOutcomeKey) =>
            parseRequestStatuses(next[outcome] ?? statusText(view?.response?.[outcome]))
        const successStatuses = read('successStatuses')
        const retryableStatuses = read('retryableStatuses')
        const rejectedStatuses = read('rejectedStatuses')
        const ambiguousStatuses = read('ambiguousStatuses')
        if (!successStatuses || !retryableStatuses || !rejectedStatuses || !ambiguousStatuses) {
            setErrors(current => ({ ...current, statuses: m.request_status_invalid() }))
            return
        }
        const groups = { successStatuses, retryableStatuses, rejectedStatuses, ambiguousStatuses }
        apply('statuses', { kind: 'outcomes', value: groups })
    }
    return (
        <fieldset
            className="min-w-0 space-y-4 rounded-sm border border-border p-4"
            disabled={disabled}>
            <legend className="px-1 text-sm font-medium">{m.request_title()}</legend>
            <Field className="gap-1.5">
                <FieldLabel htmlFor={`${id}-method`}>{m.request_method()}</FieldLabel>
                <Select
                    value={view.method}
                    disabled={disabled}
                    onValueChange={value => {
                        if (value === 'POST' || value === 'PUT' || value === 'PATCH')
                            apply('method', { kind: 'method', value })
                    }}>
                    <SelectTrigger id={`${id}-method`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {(['POST', 'PUT', 'PATCH'] as const).map(method => (
                            <SelectItem key={method} value={method}>
                                {method}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>
            {view.segments.map(segment => (
                <Field key={segment.index} className="gap-1.5">
                    <FieldLabel htmlFor={`${id}-path-${segment.index}`}>
                        {m.request_segment({ number: segment.index + 1 })}
                    </FieldLabel>
                    <Input
                        id={`${id}-path-${segment.index}`}
                        disabled={disabled}
                        readOnly={!segment.editable}
                        value={
                            segment.editable
                                ? (segments[segment.index] ?? String(segment.value))
                                : dynamicLabel(segment.value)
                        }
                        aria-invalid={Boolean(errors[`segment-${segment.index}`]) || undefined}
                        aria-describedby={
                            errors[`segment-${segment.index}`]
                                ? `${id}-error-${segment.index}`
                                : undefined
                        }
                        onChange={event => {
                            const value = event.target.value
                            setSegments(current => ({ ...current, [segment.index]: value }))
                            apply(`segment-${segment.index}`, {
                                kind: 'segment',
                                index: segment.index,
                                value,
                            })
                        }}
                    />
                    {errors[`segment-${segment.index}`] ? (
                        <p id={`${id}-error-${segment.index}`} className="text-xs text-destructive">
                            {errors[`segment-${segment.index}`]}
                        </p>
                    ) : null}
                </Field>
            ))}
            <details className="space-y-3">
                <summary className="cursor-pointer text-sm">{m.request_responses()}</summary>
                <div className="grid gap-3 pt-2 sm:grid-cols-2">
                    {requestOutcomeKeys.map(key => (
                        <Field key={key} className="gap-1.5">
                            <FieldLabel htmlFor={`${id}-${key}`}>{labels[key]}</FieldLabel>
                            <Input
                                id={`${id}-${key}`}
                                disabled={disabled}
                                value={statuses[key] ?? statusText(view.response?.[key])}
                                aria-invalid={Boolean(errors.statuses) || undefined}
                                aria-describedby={
                                    errors.statuses ? `${id}-statuses-error` : undefined
                                }
                                onChange={event => updateStatuses(key, event.target.value)}
                            />
                        </Field>
                    ))}
                </div>
                {errors.statuses ? (
                    <p
                        id={`${id}-statuses-error`}
                        role="alert"
                        className="text-xs text-destructive">
                        {errors.statuses}
                    </p>
                ) : null}
            </details>
            <p className="text-xs text-muted-foreground">{m.request_preserved()}</p>
        </fieldset>
    )
}
function statusText(value: unknown) {
    return Array.isArray(value) ? value.join(', ') : ''
}
function dynamicLabel(value: unknown) {
    if (typeof value === 'object' && value !== null && 'kind' in value) {
        if (value.kind === 'secret') return m.request_secret()
        if ('pointer' in value && typeof value.pointer === 'string')
            return m.request_dynamic({ path: value.pointer })
    }
    return m.request_dynamic({ path: '—' })
}
