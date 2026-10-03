import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { X_TEXT_COUNTING_ALGORITHM, parseXPostText } from '@herald/x/text'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { lazy, Suspense, useEffect, useState } from 'react'

import { PublicationTextEditor } from '@/components/publication-text-editor'
import { XWeightedTextCount } from '@/components/x-weighted-text-count'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import {
    decodeTargetEnumValue,
    encodeTargetEnumValue,
    type TargetEditorField,
    type TargetEditorPrimitive,
    unsetTargetFieldValue,
} from '@/lib/target-editor'
import * as m from '@/paraglide/messages.js'

const ConfiguredEditor = lazy(() =>
    import('./configured-publication-editor').then(module => ({
        default: module.ConfiguredPublicationEditor,
    }))
)

interface TargetFieldControlProps {
    readonly error?: string
    readonly editorProfile?: 'discord' | 'article'
    readonly field: TargetEditorField
    readonly fieldId: string
    readonly value: unknown
    readonly disabled: boolean
    readonly compact?: boolean
    readonly onChange: (value: unknown | undefined) => void
}

export function TargetFieldControl({
    error,
    editorProfile,
    field,
    fieldId,
    value,
    disabled,
    compact = false,
    onChange,
}: TargetFieldControlProps) {
    const { locale } = useLanguage()
    const errorId = error ? `${fieldId}-error` : undefined
    const errorNode = error ? <FieldError id={errorId}>{error}</FieldError> : null
    const weightedLimit =
        field.weightedLengthAlgorithm === X_TEXT_COUNTING_ALGORITHM ? field.maxWeightedLength : null
    const weightedText =
        weightedLimit === null ? null : parseXPostText(typeof value === 'string' ? value : '')
    const weightedTextInvalid =
        weightedText !== null &&
        typeof value === 'string' &&
        value.trim().length > 0 &&
        !weightedText.valid
    const description =
        compact && field.kind !== 'unsupported' && field.kind !== 'readonly'
            ? null
            : fieldDescription(field, locale)

    if (field.kind === 'media') {
        const count = Array.isArray(value) ? value.length : 0
        return (
            <div
                data-target-field={field.bindingId}
                className="rounded-md bg-muted/55 px-4 py-3 shadow-field">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{field.label}</p>
                    <span className="text-xs font-medium text-muted-foreground">
                        {m.editor_target_selected({ count })}
                    </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {m.editor_target_media_managed()}
                    {description ? ` ${description}` : ''}
                </p>
                {errorNode}
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
                        {field.kind === 'readonly'
                            ? m.editor_target_read_only()
                            : m.editor_target_advanced()}
                    </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {field.kind === 'readonly'
                        ? m.editor_target_read_only_description()
                        : m.editor_target_unsupported_description()}
                    {description ? ` ${description}` : ''}
                </p>
                {errorNode}
            </div>
        )
    }

    return (
        <div data-target-field={field.bindingId}>
            <Field className="min-w-0 gap-1.5">
                <FieldLabel htmlFor={fieldId}>{field.label}</FieldLabel>
                {field.kind === 'text' ? (
                    field.semantic === 'primary_text' ? (
                        <div className="grid min-w-0 gap-1.5">
                            {editorProfile ? (
                                <Suspense fallback={null}>
                                    <ConfiguredEditor
                                        compact
                                        id={fieldId}
                                        profile={editorProfile}
                                        invalid={Boolean(error)}
                                        describedBy={errorId}
                                        label={field.label}
                                        value={typeof value === 'string' ? value : ''}
                                        onValueChange={text =>
                                            onChange(optionalTextValue(text, field.required))
                                        }
                                        disabled={disabled}
                                        maxLength={field.maxLength ?? undefined}
                                    />
                                </Suspense>
                            ) : (
                                <PublicationTextEditor
                                    id={fieldId}
                                    value={typeof value === 'string' ? value : ''}
                                    onValueChange={text =>
                                        onChange(optionalTextValue(text, field.required))
                                    }
                                    disabled={disabled}
                                    minLength={field.minLength ?? undefined}
                                    maxLength={field.maxLength ?? undefined}
                                    aria-invalid={
                                        Boolean(error) || weightedTextInvalid || undefined
                                    }
                                    aria-describedby={
                                        [
                                            errorId,
                                            weightedText === null
                                                ? undefined
                                                : `${fieldId}-weighted-count`,
                                        ]
                                            .filter(Boolean)
                                            .join(' ') || undefined
                                    }
                                    rows={6}
                                    className="min-h-32 min-w-0 max-w-full text-sm leading-6"
                                />
                            )}
                            {weightedText !== null ? (
                                <XWeightedTextCount
                                    id={`${fieldId}-weighted-count`}
                                    invalid={weightedTextInvalid}
                                    result={weightedText}
                                />
                            ) : null}
                        </div>
                    ) : (
                        <Input
                            id={fieldId}
                            aria-invalid={Boolean(error) || undefined}
                            aria-describedby={errorId}
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
                {errorNode}
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
                <SelectItem value={unsetTargetFieldValue}>{m.editor_target_not_set()}</SelectItem>
                <SelectItem value="true">{m.editor_target_yes()}</SelectItem>
                <SelectItem value="false">{m.editor_target_no()}</SelectItem>
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
                    {m.editor_target_not_set()}
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
                <AlertTitle>{m.editor_target_review_list()}</AlertTitle>
                <AlertDescription>{m.editor_target_list_strings_only()}</AlertDescription>
            </Alert>
        )
    }

    const items = values as string[]

    return (
        <div className="grid gap-2">
            {items.length === 0 ? (
                <p className="rounded-md bg-muted/55 px-3 py-2 text-xs text-muted-foreground">
                    {m.editor_target_no_values()}
                </p>
            ) : (
                items.map((item, index) => (
                    <div key={`${fieldId}-${index}`} className="flex min-w-0 items-center gap-2">
                        <Input
                            id={`${fieldId}-${index}`}
                            aria-label={m.editor_target_item({
                                label: field.label,
                                index: String(index + 1),
                            })}
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
                            aria-label={m.editor_target_remove_item({
                                label: field.label,
                                index: String(index + 1),
                            })}
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
                {m.editor_target_add_value()}
            </Button>
        </div>
    )
}

function fieldDescription(field: TargetEditorField, locale: string): string | null {
    const constraints: string[] = []
    if (
        field.maxWeightedLength === null &&
        (field.minLength !== null || field.maxLength !== null)
    ) {
        if (field.minLength !== null && field.maxLength !== null) {
            constraints.push(
                m.editor_constraint_characters_range({
                    min: formatNumber(field.minLength, locale),
                    max: formatNumber(field.maxLength, locale),
                })
            )
        } else if (field.maxLength !== null) {
            constraints.push(
                m.editor_constraint_up_to_characters({
                    count: formatNumber(field.maxLength, locale),
                })
            )
        } else if (field.minLength !== null) {
            constraints.push(
                m.editor_constraint_at_least_characters({
                    count: formatNumber(field.minLength, locale),
                })
            )
        }
    }
    if (field.kind === 'string-list') {
        if (field.minItems !== null && field.maxItems !== null) {
            constraints.push(
                m.editor_constraint_values_range({
                    min: formatNumber(field.minItems, locale),
                    max: formatNumber(field.maxItems, locale),
                })
            )
        } else if (field.maxItems !== null) {
            constraints.push(
                m.editor_constraint_up_to_values({ count: formatNumber(field.maxItems, locale) })
            )
        } else if (field.minItems !== null) {
            constraints.push(
                m.editor_constraint_at_least_values({ count: formatNumber(field.minItems, locale) })
            )
        }
    }
    if (field.kind === 'number') {
        if (field.minimum !== null && field.maximum !== null) {
            constraints.push(
                m.editor_constraint_between({
                    min: formatNumber(field.minimum, locale),
                    max: formatNumber(field.maximum, locale),
                })
            )
        } else if (field.minimum !== null) {
            constraints.push(
                m.editor_constraint_at_least({ count: formatNumber(field.minimum, locale) })
            )
        } else if (field.maximum !== null) {
            constraints.push(
                m.editor_constraint_at_most({ count: formatNumber(field.maximum, locale) })
            )
        }
        if (field.multipleOf !== null) {
            constraints.push(
                m.editor_constraint_increments({
                    count: formatNumber(field.multipleOf, locale),
                })
            )
        }
    }
    if (field.acceptedSourceFormats.length > 0) {
        constraints.push(
            m.editor_constraint_source({ formats: field.acceptedSourceFormats.join(', ') })
        )
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
    if (value === null) return m.editor_target_null()
    if (typeof value === 'boolean') return value ? m.editor_target_yes() : m.editor_target_no()
    return String(value)
}
