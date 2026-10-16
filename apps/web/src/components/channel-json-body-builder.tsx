import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { Switch } from '@postbot/ui/components/switch'
import { useEffect, useId, useState } from 'react'

import {
    editJsonBodyProperty,
    projectJsonBody,
    type JsonBodyLeaf,
} from '@/lib/channel-json-body-builder'
import { getTargetEditorFields } from '@/lib/target-editor'
import * as m from '@/paraglide/messages.js'

export function ChannelJsonBodyBuilder({
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
    const properties = projectJsonBody(profile)
    const fields = getTargetEditorFields(profile)
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [invalid, setInvalid] = useState<Record<string, boolean>>({})
    const valid = properties === null || !Object.values(invalid).some(Boolean)
    useEffect(() => onValidityChange(valid), [valid, onValidityChange])
    if (!properties) return null
    function update(name: string, value: JsonBodyLeaf) {
        const next = editJsonBodyProperty(profile, name, value)
        setInvalid(current => ({ ...current, [JSON.stringify(name)]: next === null }))
        if (next) onChange(next)
    }
    return (
        <details className="space-y-3">
            <summary className="cursor-pointer text-sm">{m.request_json_body()}</summary>
            <div className="grid gap-4 pt-2">
                {properties.map((property, index) => {
                    const expression = property.expression
                    const fieldId = `${id}-${index}`
                    const stateKey = JSON.stringify(property.name)
                    return (
                        <Field key={property.name} className="gap-1.5">
                            <FieldLabel htmlFor={fieldId}>{property.name}</FieldLabel>
                            {expression === null ? (
                                <p className="text-xs text-muted-foreground">
                                    {m.request_body_preserved()}
                                </p>
                            ) : expression.kind === 'content' ? (
                                <Select
                                    value={expression.pointer}
                                    disabled={disabled || fields.length === 0}
                                    onValueChange={pointer => {
                                        if (pointer !== null)
                                            update(property.name, { kind: 'content', pointer })
                                    }}>
                                    <SelectTrigger id={fieldId}>
                                        <SelectValue>
                                            {fields.find(field => field.path === expression.pointer)
                                                ?.label ?? expression.pointer}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {fields.map(field => (
                                            <SelectItem key={field.path} value={field.path}>
                                                {field.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : typeof expression.value === 'boolean' ? (
                                <div>
                                    <Switch
                                        id={fieldId}
                                        disabled={disabled}
                                        checked={expression.value}
                                        onCheckedChange={value =>
                                            update(property.name, { kind: 'literal', value })
                                        }
                                    />
                                </div>
                            ) : expression.value === null ? (
                                <p className="text-xs text-muted-foreground">
                                    {m.request_body_null()}
                                </p>
                            ) : (
                                <Input
                                    id={fieldId}
                                    disabled={disabled}
                                    value={drafts[stateKey] ?? String(expression.value)}
                                    aria-invalid={invalid[stateKey] || undefined}
                                    aria-describedby={
                                        invalid[stateKey] ? `${fieldId}-error` : undefined
                                    }
                                    onChange={event => {
                                        const text = event.target.value
                                        setDrafts(current => ({
                                            ...current,
                                            [stateKey]: text,
                                        }))
                                        if (typeof expression.value === 'number') {
                                            if (
                                                text.trim() === '' ||
                                                !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(
                                                    text
                                                ) ||
                                                !Number.isFinite(Number(text))
                                            ) {
                                                setInvalid(current => ({
                                                    ...current,
                                                    [stateKey]: true,
                                                }))
                                                return
                                            }
                                            update(property.name, {
                                                kind: 'literal',
                                                value: Number(text),
                                            })
                                        } else
                                            update(property.name, { kind: 'literal', value: text })
                                    }}
                                />
                            )}
                            {invalid[stateKey] ? (
                                <p
                                    role="alert"
                                    id={`${fieldId}-error`}
                                    className="text-xs text-destructive">
                                    {m.request_body_invalid()}
                                </p>
                            ) : null}
                        </Field>
                    )
                })}
            </div>
            <p className="text-xs text-muted-foreground">{m.request_body_existing()}</p>
        </details>
    )
}
