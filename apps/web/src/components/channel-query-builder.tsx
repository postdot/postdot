import { Button } from '@postdot/ui/components/button'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import { useId, useState } from 'react'

import { editQuery, projectQuery } from '@/lib/channel-query-builder'
import * as m from '@/paraglide/messages.js'

export function ChannelQueryBuilder({
    profile,
    onChange,
    disabled,
}: {
    readonly profile: unknown
    readonly onChange: (profile: Record<string, unknown>) => void
    readonly disabled: boolean
}) {
    const id = useId()
    const [name, setName] = useState('')
    const [error, setError] = useState(false)
    const rows = projectQuery(profile)
    if (!rows) return null
    return (
        <details className="space-y-3">
            <summary className="cursor-pointer text-sm">{m.request_query()}</summary>
            <div className="space-y-3 pt-2">
                {rows.map((row, index) => (
                    <Field key={row.name} className="gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <FieldLabel htmlFor={`${id}-${index}`}>{row.name}</FieldLabel>
                            {row.value !== null ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={disabled}
                                    aria-label={m.request_query_remove({ name: row.name })}
                                    onClick={() => {
                                        const next = editQuery(profile, row.name, 'remove')
                                        if (next) onChange(next)
                                    }}>
                                    {m.common_remove()}
                                </Button>
                            ) : null}
                        </div>
                        <Input
                            id={`${id}-${index}`}
                            disabled={disabled}
                            readOnly={row.value === null}
                            value={row.value ?? m.request_query_preserved()}
                            onChange={event => {
                                const next = editQuery(
                                    profile,
                                    row.name,
                                    'edit',
                                    event.target.value
                                )
                                if (next) onChange(next)
                            }}
                        />
                    </Field>
                ))}
                <div className="space-y-2 border-t border-border pt-3">
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={`${id}-new`}>{m.request_query_name()}</FieldLabel>
                        <Input
                            id={`${id}-new`}
                            disabled={disabled}
                            maxLength={128}
                            value={name}
                            aria-invalid={error || undefined}
                            aria-describedby={error ? `${id}-error` : undefined}
                            onChange={event => {
                                setName(event.target.value)
                                setError(false)
                            }}
                        />
                    </Field>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled || !name || rows.length >= 64}
                        onClick={() => {
                            const next = editQuery(profile, name, 'add')
                            setError(!next)
                            if (next) {
                                onChange(next)
                                setName('')
                            }
                        }}>
                        {m.common_add()}
                    </Button>
                    {error ? (
                        <p role="alert" id={`${id}-error`} className="text-xs text-destructive">
                            {m.request_query_invalid()}
                        </p>
                    ) : null}
                </div>
            </div>
        </details>
    )
}
