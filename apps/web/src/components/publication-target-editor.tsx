import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Textarea } from '@herald/ui/components/textarea'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CloseIcon } from '@solar-icons/react/bold/close'
import { useEffect, useMemo, useState } from 'react'

import {
    decodeTargetEnumValue,
    encodeTargetEnumValue,
    getTargetEditorFields,
    readTargetField,
    type TargetEditorField,
    type TargetEditorPrimitive,
    unsetTargetFieldValue,
    updateTargetField,
} from '@/lib/target-editor'

interface PublicationTargetEditorProps {
    readonly profile: unknown
    readonly target: Record<string, unknown> | null
    readonly rawText: string
    readonly onTargetChange: (target: Record<string, unknown>) => void
    readonly onRawTextChange: (value: string) => void
    readonly disabled?: boolean
}

export function PublicationTargetEditor({
    profile,
    target,
    rawText,
    onTargetChange,
    onRawTextChange,
    disabled = false,
}: PublicationTargetEditorProps) {
    const fields = useMemo(() => getTargetEditorFields(profile), [profile])
    const [advancedOpen, setAdvancedOpen] = useState(target === null)

    useEffect(() => {
        if (target === null) setAdvancedOpen(true)
    }, [target])

    function updateField(field: TargetEditorField, value: unknown | undefined) {
        if (target === null) return
        onTargetChange(updateTargetField(target, field.path, value))
    }

    return (
        <div data-target-editor="true" className="min-w-0">
            {target === null ? (
                <Alert variant="destructive" className="rounded-md">
                    <AlertTitle>Structured fields are unavailable</AlertTitle>
                    <AlertDescription>
                        Repair the target JSON below before using the channel controls.
                    </AlertDescription>
                </Alert>
            ) : null}

            {fields.length === 0 ? (
                <p className="text-sm leading-6 text-muted-foreground">
                    This channel has no declared field bindings. Use Advanced JSON to edit its
                    target payload.
                </p>
            ) : (
                <div className="grid min-w-0 gap-5">
                    {fields.map((field, index) => (
                        <TargetFieldControl
                            key={`${field.bindingId}-${field.path}`}
                            field={field}
                            fieldId={targetFieldId(field, index)}
                            value={
                                target === null ? undefined : readTargetField(target, field.path)
                            }
                            disabled={disabled || target === null}
                            onChange={value => updateField(field, value)}
                        />
                    ))}
                </div>
            )}

            <details
                data-target-advanced="true"
                open={advancedOpen}
                onToggle={event => setAdvancedOpen(event.currentTarget.open)}
                className="mt-6 rounded-md bg-muted/45 p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                    Advanced JSON
                </summary>
                <div className="mt-3 grid gap-3">
                    <p className="text-xs leading-5 text-muted-foreground">
                        Use this escape hatch for provider-specific fields or schema shapes that do
                        not have a standard control. The server still validates the complete payload
                        before it can be promoted.
                    </p>
                    <Field className="min-w-0 gap-1.5">
                        <FieldLabel htmlFor="target-json">Target JSON</FieldLabel>
                        <Textarea
                            id="target-json"
                            value={rawText}
                            onChange={event => onRawTextChange(event.target.value)}
                            disabled={disabled}
                            spellCheck={false}
                            rows={12}
                            className="min-h-52 min-w-0 max-w-full resize-y bg-surface-field px-3 py-2 font-mono text-xs leading-6 text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
                        />
                    </Field>
                </div>
            </details>
        </div>
    )
}

function TargetFieldControl({
    field,
    fieldId,
    value,
    disabled,
    onChange,
}: {
    readonly field: TargetEditorField
    readonly fieldId: string
    readonly value: unknown
    readonly disabled: boolean
    readonly onChange: (value: unknown | undefined) => void
}) {
    const description = fieldDescription(field)

    if (field.kind === 'media') {
        const count = Array.isArray(value) ? value.length : 0
        return (
            <div
                data-target-field={field.bindingId}
                className="rounded-md bg-muted/55 px-4 py-3 shadow-field">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{field.label}</p>
                    <span className="text-xs font-medium text-muted-foreground">
                        {count} selected
                    </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Media is managed by the source attachments above and mapped into this channel
                    field.
                    {description ? ` ${description}` : ''}
                </p>
            </div>
        )
    }

    if (field.kind === 'unsupported' || field.kind === 'readonly') {
        return (
            <div
                data-target-field={field.bindingId}
                className="rounded-md bg-muted/55 px-4 py-3 shadow-field">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{field.label}</p>
                    <span className="text-xs font-medium text-muted-foreground">
                        {field.kind === 'readonly' ? 'Read only' : 'Advanced JSON'}
                    </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {field.kind === 'readonly'
                        ? 'This channel contract marks the field as read only.'
                        : 'This field shape is intentionally left to the advanced editor so custom channels remain expressive.'}
                    {description ? ` ${description}` : ''}
                </p>
            </div>
        )
    }

    return (
        <div data-target-field={field.bindingId}>
            <Field className="min-w-0 gap-1.5">
                <FieldLabel htmlFor={fieldId}>{field.label}</FieldLabel>
                {field.kind === 'text' ? (
                    field.semantic === 'primary_text' ? (
                        <Textarea
                            id={fieldId}
                            value={typeof value === 'string' ? value : ''}
                            onChange={event =>
                                onChange(optionalTextValue(event.target.value, field.required))
                            }
                            disabled={disabled}
                            minLength={field.minLength ?? undefined}
                            maxLength={field.maxLength ?? undefined}
                            rows={6}
                            className="min-h-32 min-w-0 max-w-full text-sm leading-6"
                        />
                    ) : (
                        <Input
                            id={fieldId}
                            value={typeof value === 'string' ? value : ''}
                            onChange={event =>
                                onChange(optionalTextValue(event.target.value, field.required))
                            }
                            disabled={disabled}
                            minLength={field.minLength ?? undefined}
                            maxLength={field.maxLength ?? undefined}
                            className="min-w-0"
                        />
                    )
                ) : field.kind === 'number' ? (
                    <NumberField
                        id={fieldId}
                        value={value}
                        disabled={disabled}
                        min={field.minimum ?? undefined}
                        max={field.maximum ?? undefined}
                        step={field.multipleOf ?? (field.schemaType === 'integer' ? 1 : 'any')}
                        onChange={onChange}
                    />
                ) : field.kind === 'boolean' ? (
                    <BooleanField value={value} disabled={disabled} onChange={onChange} />
                ) : field.kind === 'enum' ? (
                    <EnumField
                        field={field}
                        value={value}
                        disabled={disabled}
                        onChange={onChange}
                    />
                ) : (
                    <StringListField
                        field={field}
                        fieldId={fieldId}
                        value={value}
                        disabled={disabled}
                        onChange={onChange}
                    />
                )}
                {description ? <FieldDescription>{description}</FieldDescription> : null}
            </Field>
        </div>
    )
}

function BooleanField({
    value,
    disabled,
    onChange,
}: {
    readonly value: unknown
    readonly disabled: boolean
    readonly onChange: (value: unknown | undefined) => void
}) {
    const selectedValue =
        value === true ? 'true' : value === false ? 'false' : unsetTargetFieldValue
    return (
        <Select
            value={selectedValue}
            onValueChange={next =>
                onChange(next === unsetTargetFieldValue ? undefined : next === 'true')
            }>
            <SelectTrigger disabled={disabled}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
                <SelectItem value={unsetTargetFieldValue}>Not set</SelectItem>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
            </SelectContent>
        </Select>
    )
}

function EnumField({
    field,
    value,
    disabled,
    onChange,
}: {
    readonly field: TargetEditorField
    readonly value: unknown
    readonly disabled: boolean
    readonly onChange: (value: unknown | undefined) => void
}) {
    const selectedValue = field.enumValues.some(candidate => Object.is(candidate, value))
        ? encodeTargetEnumValue(value as TargetEditorPrimitive)
        : unsetTargetFieldValue
    return (
        <Select
            value={selectedValue}
            onValueChange={next =>
                onChange(decodeTargetEnumValue(next ?? unsetTargetFieldValue, field.enumValues))
            }>
            <SelectTrigger disabled={disabled}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
                <SelectItem value={unsetTargetFieldValue} disabled={field.required}>
                    Not set
                </SelectItem>
                {field.enumValues.map(enumValue => {
                    const encoded = encodeTargetEnumValue(enumValue)
                    return (
                        <SelectItem key={encoded} value={encoded}>
                            {enumLabel(enumValue)}
                        </SelectItem>
                    )
                })}
            </SelectContent>
        </Select>
    )
}

function StringListField({
    field,
    fieldId,
    value,
    disabled,
    onChange,
}: {
    readonly field: TargetEditorField
    readonly fieldId: string
    readonly value: unknown
    readonly disabled: boolean
    readonly onChange: (value: unknown | undefined) => void
}) {
    const values = Array.isArray(value) ? value : []
    const hasInvalidValue =
        (value !== undefined && !Array.isArray(value)) ||
        values.some(item => typeof item !== 'string')

    if (hasInvalidValue) {
        return (
            <Alert variant="destructive" className="rounded-md">
                <AlertTitle>Review this list in Advanced JSON</AlertTitle>
                <AlertDescription>
                    The current target does not contain only strings, so the structured control will
                    not rewrite it automatically.
                </AlertDescription>
            </Alert>
        )
    }

    const items = values as string[]

    return (
        <div className="grid gap-2">
            {items.length === 0 ? (
                <p className="rounded-md bg-muted/55 px-3 py-2 text-xs text-muted-foreground">
                    No values added.
                </p>
            ) : (
                items.map((item, index) => (
                    <div key={`${fieldId}-${index}`} className="flex min-w-0 items-center gap-2">
                        <Input
                            id={`${fieldId}-${index}`}
                            aria-label={`${field.label} item ${index + 1}`}
                            value={item}
                            onChange={event => {
                                const next = [...items]
                                next[index] = event.target.value
                                onChange(next)
                            }}
                            disabled={disabled}
                            maxLength={field.maxLength ?? undefined}
                            className="min-w-0"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${field.label} item ${index + 1}`}
                            onClick={() =>
                                onChange(items.filter((_, itemIndex) => itemIndex !== index))
                            }
                            disabled={
                                disabled ||
                                (field.minItems !== null && items.length <= field.minItems)
                            }>
                            <CloseIcon aria-hidden="true" />
                        </Button>
                    </div>
                ))
            )}
            <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-fit"
                onClick={() => onChange([...items, ''])}
                disabled={disabled || (field.maxItems !== null && items.length >= field.maxItems)}>
                <AddIcon aria-hidden="true" />
                Add value
            </Button>
        </div>
    )
}

function fieldDescription(field: TargetEditorField): string | null {
    const constraints: string[] = []
    if (field.minLength !== null || field.maxLength !== null) {
        if (field.minLength !== null && field.maxLength !== null) {
            constraints.push(`${field.minLength}–${field.maxLength} characters`)
        } else if (field.maxLength !== null) {
            constraints.push(`Up to ${field.maxLength} characters`)
        } else if (field.minLength !== null) {
            constraints.push(`At least ${field.minLength} characters`)
        }
    }
    if (field.kind === 'string-list') {
        if (field.minItems !== null && field.maxItems !== null) {
            constraints.push(`${field.minItems}–${field.maxItems} values`)
        } else if (field.maxItems !== null) {
            constraints.push(`Up to ${field.maxItems} values`)
        } else if (field.minItems !== null) {
            constraints.push(`At least ${field.minItems} values`)
        }
    }
    if (field.kind === 'number') {
        if (field.minimum !== null && field.maximum !== null) {
            constraints.push(`Between ${field.minimum} and ${field.maximum}`)
        } else if (field.minimum !== null) {
            constraints.push(`At least ${field.minimum}`)
        } else if (field.maximum !== null) {
            constraints.push(`At most ${field.maximum}`)
        }
        if (field.multipleOf !== null) constraints.push(`In increments of ${field.multipleOf}`)
    }
    if (field.acceptedSourceFormats.length > 0) {
        constraints.push(`Source: ${field.acceptedSourceFormats.join(', ')}`)
    }
    return [field.description, ...constraints].filter(Boolean).join(' · ') || null
}

function optionalTextValue(value: string, required: boolean): string | undefined {
    return value === '' && !required ? undefined : value
}

function NumberField({
    id,
    value,
    disabled,
    min,
    max,
    step,
    onChange,
}: {
    readonly id: string
    readonly value: unknown
    readonly disabled: boolean
    readonly min?: number
    readonly max?: number
    readonly step?: number | 'any'
    readonly onChange: (value: unknown | undefined) => void
}) {
    const [draftValue, setDraftValue] = useState(formatNumberValue(value))

    useEffect(() => {
        setDraftValue(formatNumberValue(value))
    }, [value])

    return (
        <Input
            id={id}
            type="text"
            inputMode="decimal"
            value={draftValue}
            onChange={event => {
                const next = event.target.value
                setDraftValue(next)

                if (next.trim() === '') {
                    onChange(undefined)
                    return
                }

                if (!isCompleteNumber(next)) return
                const parsed = Number(next)
                if (Number.isFinite(parsed)) onChange(parsed)
            }}
            disabled={disabled}
            min={min}
            max={max}
            step={step}
            className="min-w-0"
        />
    )
}

function formatNumberValue(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function isCompleteNumber(value: string): boolean {
    return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value.trim())
}

function enumLabel(value: TargetEditorPrimitive): string {
    if (value === null) return 'Null'
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    return String(value)
}

function targetFieldId(field: TargetEditorField, index: number): string {
    const suffix = field.bindingId.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
    return `target-field-${index}-${suffix}`
}
