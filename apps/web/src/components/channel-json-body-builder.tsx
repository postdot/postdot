import { Button } from '@postbot/ui/components/button'
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
    changeJsonBodyProperty,
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
    const [newName, setNewName] = useState('')
    const [newType, setNewType] = useState<BodySource>('text')
    const [creationError, setCreationError] = useState(false)
    const valid = properties === null || !Object.values(invalid).some(Boolean)
    useEffect(() => onValidityChange(valid), [valid, onValidityChange])
    if (!properties) return null
    function update(name: string, value: JsonBodyLeaf) {
        const next = editJsonBodyProperty(profile, name, value)
        setInvalid(current => ({ ...current, [JSON.stringify(name)]: next === null }))
        if (next) onChange(next)
    }
    const sources: Record<BodySource, string> = {
        text: m.request_source_text(),
        number: m.request_source_number(),
        boolean: m.request_source_boolean(),
        null: m.request_body_null(),
        content: m.request_source_content(),
    }
    function resetDraft(name: string) {
        const key = JSON.stringify(name)
        setDrafts(current => {
            const next = { ...current }
            delete next[key]
            return next
        })
        setInvalid(current => {
            const next = { ...current }
            delete next[key]
            return next
        })
    }
    function sourcePicker(
        value: BodySource,
        onSelect: (source: BodySource) => void,
        label: string
    ) {
        return (
            <Select
                value={value}
                disabled={disabled}
                onValueChange={source => {
                    if (source && Object.hasOwn(sources, source)) onSelect(source as BodySource)
                }}>
                <SelectTrigger aria-label={label}>
                    <SelectValue>{sources[value]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {(Object.keys(sources) as BodySource[]).map(source => (
                        <SelectItem
                            key={source}
                            value={source}
                            disabled={source === 'content' && fields.length === 0}>
                            {sources[source]}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        )
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
                            <div className="flex items-center justify-between gap-3">
                                <FieldLabel htmlFor={fieldId}>{property.name}</FieldLabel>
                                {expression ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={disabled}
                                        aria-label={m.request_body_remove({ name: property.name })}
                                        onClick={() => {
                                            const next = changeJsonBodyProperty(
                                                profile,
                                                property.name,
                                                'remove'
                                            )
                                            if (next) {
                                                resetDraft(property.name)
                                                onChange(next)
                                            }
                                        }}>
                                        {m.common_remove()}
                                    </Button>
                                ) : null}
                            </div>
                            {expression
                                ? sourcePicker(
                                      sourceOf(expression),
                                      source => {
                                          if (source === sourceOf(expression)) return
                                          const next = changeJsonBodyProperty(
                                              profile,
                                              property.name,
                                              'replace',
                                              defaultValue(source, fields[0]?.path)
                                          )
                                          if (next) {
                                              resetDraft(property.name)
                                              onChange(next)
                                          }
                                      },
                                      m.request_body_source({ name: property.name })
                                  )
                                : null}
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
            <div className="grid gap-2 border-t border-border pt-3">
                <FieldLabel htmlFor={`${id}-new`}>{m.request_body_property_name()}</FieldLabel>
                <Input
                    id={`${id}-new`}
                    disabled={disabled}
                    value={newName}
                    onChange={event => {
                        setNewName(event.target.value)
                        setCreationError(false)
                    }}
                    maxLength={128}
                />
                {sourcePicker(newType, setNewType, m.request_value_source())}
                <Button
                    type="button"
                    variant="outline"
                    disabled={
                        disabled ||
                        !newName ||
                        properties.length >= 64 ||
                        (newType === 'content' && fields.length === 0)
                    }
                    onClick={() => {
                        const next = changeJsonBodyProperty(
                            profile,
                            newName,
                            'add',
                            defaultValue(newType, fields[0]?.path)
                        )
                        setCreationError(next === null)
                        if (next) {
                            resetDraft(newName)
                            onChange(next)
                            setNewName('')
                        }
                    }}>
                    {m.common_add()}
                </Button>
                {creationError ? (
                    <p role="alert" className="text-xs text-destructive">
                        {m.request_body_name_invalid()}
                    </p>
                ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{m.request_body_existing()}</p>
        </details>
    )
}

type BodySource = 'text' | 'number' | 'boolean' | 'null' | 'content'
function sourceOf(value: JsonBodyLeaf): BodySource {
    if (value.kind === 'content') return 'content'
    if (value.value === null) return 'null'
    return typeof value.value === 'string'
        ? 'text'
        : typeof value.value === 'number'
          ? 'number'
          : 'boolean'
}
function defaultValue(source: BodySource, pointer: string | undefined): JsonBodyLeaf {
    if (source === 'content') return { kind: 'content', pointer: pointer ?? '' }
    return {
        kind: 'literal',
        value:
            source === 'text' ? '' : source === 'number' ? 0 : source === 'boolean' ? false : null,
    }
}
