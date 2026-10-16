import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Field, FieldDescription, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import { Switch } from '@postbot/ui/components/switch'
import { useEffect, useId, useMemo, useState } from 'react'

import { TargetFieldControl } from '@/components/publication-target-field-control'
import {
    builderRecord,
    editBuilderField,
    projectBuilderFields,
    type BuilderEdit,
    type BuilderReason,
} from '@/lib/channel-content-builder'
import { useLanguage } from '@/lib/i18n'
import { getTargetEditorFields, readTargetField, updateTargetField } from '@/lib/target-editor'
import * as m from '@/paraglide/messages.js'

/** Shared content rules; does not modify transport or perform preview requests. */
export function ChannelContentBuilder({
    value,
    onChange,
    disabled = false,
    onValidityChange,
}: {
    readonly value: string
    readonly onChange: (value: string) => void
    readonly disabled?: boolean
    readonly onValidityChange: (valid: boolean) => void
}) {
    const { locale } = useLanguage()
    const instanceId = useId()
    const profile = useMemo(() => {
        try {
            const parsed: unknown = JSON.parse(value)
            return builderRecord(parsed) ? parsed : null
        } catch {
            return null
        }
    }, [value])
    const fields = useMemo(() => projectBuilderFields(profile), [profile])
    const previewFields = useMemo(
        () =>
            getTargetEditorFields(profile, locale).map(field => ({
                ...field,
                label: localizedFieldLabel(field.semantic, field.label),
            })),
        [profile, locale]
    )
    const [showLanguage, setShowLanguage] = useState(false)
    const [preview, setPreview] = useState<Record<string, unknown>>({})
    const [invalid, setInvalid] = useState<Record<string, boolean>>({})
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        onValidityChange(profile !== null && !error && !Object.values(invalid).some(Boolean))
    }, [profile, error, invalid, onValidityChange])
    useEffect(() => () => onValidityChange(true), [onValidityChange])
    function update(id: string, edit: BuilderEdit) {
        const result = editBuilderField(profile, id, edit)
        if (!result.ok) {
            setError(
                result.reason === 'bounds' ? m.builder_invalid_number() : reasonLabel(result.reason)
            )
            return
        }
        setError(null)
        onChange(JSON.stringify(result.profile, null, 2))
    }
    function validity(key: string, valid: boolean) {
        setInvalid(current => ({ ...current, [key]: !valid }))
    }
    return (
        <div data-channel-content-builder className="grid min-w-0 gap-6 lg:grid-cols-[1fr_0.9fr]">
            <div className="min-w-0 space-y-5">
                {fields.length === 0 ? (
                    <Alert>
                        <AlertTitle>{m.builder_preserved()}</AlertTitle>
                        <AlertDescription>{m.builder_complex()}</AlertDescription>
                    </Alert>
                ) : null}
                {fields.map(field => {
                    const label =
                        previewFields.find(item => item.bindingId === field.id)?.label ?? field.id
                    const locked = disabled || field.reason !== undefined
                    const id = `${instanceId}-${field.id}`
                    const controls = (
                        <fieldset
                            key={field.id}
                            className="min-w-0 space-y-3 rounded-sm border border-border p-3">
                            <legend className="px-1 text-sm font-medium">{label}</legend>
                            {field.reason ? (
                                <p className="text-xs leading-5 text-muted-foreground">
                                    {reasonLabel(field.reason)}
                                </p>
                            ) : null}
                            {field.kind !== 'media' ? (
                                <label
                                    className="flex items-center justify-between gap-3 text-sm"
                                    htmlFor={`${id}-required`}>
                                    <span>{m.builder_required()}</span>
                                    <Switch
                                        id={`${id}-required`}
                                        checked={field.required}
                                        disabled={locked}
                                        onCheckedChange={checked =>
                                            update(field.id, { required: checked })
                                        }
                                    />
                                </label>
                            ) : null}
                            <BuilderNumber
                                key={`${field.id}-maximum`}
                                id={`${id}-maximum`}
                                label={
                                    field.kind === 'media'
                                        ? m.builder_max_files()
                                        : m.builder_max_length()
                                }
                                value={field.maximum}
                                minimum={Math.max(field.minimum, field.kind === 'text' ? 1 : 0)}
                                disabled={locked}
                                onValid={valid => validity(`${field.id}-maximum`, valid)}
                                onChange={maximum => update(field.id, { maximum: maximum! })}
                            />
                            {field.kind === 'text' ? (
                                field.semantic === 'language' ? null : (
                                    <details>
                                        <summary className="cursor-pointer text-xs text-muted-foreground">
                                            {m.builder_formats()}
                                        </summary>
                                        <div className="flex flex-wrap gap-2">
                                            {['plain_text', 'markdown'].map(format => (
                                                <label
                                                    key={format}
                                                    className="flex items-center gap-2 text-xs">
                                                    <input
                                                        className="size-3.5 accent-primary"
                                                        type="checkbox"
                                                        checked={field.formats.includes(format)}
                                                        disabled={
                                                            locked ||
                                                            (field.formats.length === 1 &&
                                                                field.formats.includes(format))
                                                        }
                                                        onChange={event =>
                                                            update(field.id, {
                                                                formats: event.target.checked
                                                                    ? [...field.formats, format]
                                                                    : field.formats.filter(
                                                                          item => item !== format
                                                                      ),
                                                            })
                                                        }
                                                    />
                                                    {format === 'markdown'
                                                        ? 'Markdown'
                                                        : m.builder_plain_text()}
                                                </label>
                                            ))}
                                        </div>
                                    </details>
                                )
                            ) : (
                                <>
                                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                                        {(['image', 'video', 'audio', 'document'] as const).map(
                                            family => (
                                                <label
                                                    key={family}
                                                    className="flex items-center gap-2 text-xs">
                                                    <input
                                                        className="size-3.5 accent-primary"
                                                        type="checkbox"
                                                        checked={field.families.includes(family)}
                                                        disabled={
                                                            locked ||
                                                            !field.familiesEditable ||
                                                            (field.families.length === 1 &&
                                                                field.families.includes(family))
                                                        }
                                                        onChange={event =>
                                                            update(field.id, {
                                                                families: event.target.checked
                                                                    ? [...field.families, family]
                                                                    : field.families.filter(
                                                                          item => item !== family
                                                                      ),
                                                            })
                                                        }
                                                    />
                                                    {familyLabel(family)}
                                                </label>
                                            )
                                        )}
                                    </div>
                                    <details>
                                        <summary className="cursor-pointer text-xs text-muted-foreground">
                                            {m.builder_file_limits()}
                                        </summary>
                                        <BuilderNumber
                                            id={`${id}-bytes`}
                                            label={m.builder_max_bytes()}
                                            value={
                                                field.maxBytes === undefined
                                                    ? null
                                                    : field.maxBytes / 1_000_000
                                            }
                                            minimum={0.000001}
                                            decimal
                                            nullable
                                            disabled={locked}
                                            onValid={valid => validity(`${field.id}-bytes`, valid)}
                                            onChange={megabytes =>
                                                update(field.id, {
                                                    maxBytes:
                                                        megabytes === null
                                                            ? null
                                                            : Math.round(megabytes * 1_000_000),
                                                })
                                            }
                                        />
                                    </details>
                                </>
                            )}
                            {field.maxGraphemes !== undefined ? (
                                <p className="text-xs text-muted-foreground">
                                    {m.builder_graphemes({ count: field.maxGraphemes })}
                                </p>
                            ) : null}
                            {field.maxWeightedLength !== undefined ? (
                                <p className="text-xs text-muted-foreground">
                                    {m.builder_weighted({ count: field.maxWeightedLength })}
                                </p>
                            ) : null}
                        </fieldset>
                    )
                    return field.semantic === 'language' ? (
                        <details
                            key={field.id}
                            className="space-y-3"
                            onToggle={event => setShowLanguage(event.currentTarget.open)}>
                            <summary className="cursor-pointer text-sm text-muted-foreground">
                                {m.builder_content_language()}
                            </summary>
                            <p className="text-xs text-muted-foreground">
                                {m.builder_language_hint()}
                            </p>
                            {controls}
                        </details>
                    ) : (
                        controls
                    )
                })}
                {error ? (
                    <p role="alert" className="text-xs text-destructive">
                        {error}
                    </p>
                ) : null}
            </div>
            <section
                aria-label={m.builder_preview()}
                className="min-w-0 self-start rounded-sm bg-surface-inset p-4 shadow-field lg:sticky lg:top-0">
                <h3 className="text-sm font-medium">{m.builder_preview()}</h3>
                <p className="mb-5 mt-1 text-xs leading-5 text-muted-foreground">
                    {m.builder_preview_hint()}
                </p>
                <div className="grid min-w-0 gap-4">
                    {previewFields
                        .filter(
                            field => field.semantic !== 'language' || showLanguage || field.required
                        )
                        .map((field, index) => (
                            <TargetFieldControl
                                key={`${field.bindingId}-${field.path}`}
                                field={{
                                    ...field,
                                    label:
                                        field.required &&
                                        (field.kind !== 'media' || (field.minItems ?? 0) > 0)
                                            ? `${field.label} *`
                                            : field.label,
                                }}
                                compact
                                fieldId={`${instanceId}-preview-${index}`}
                                value={readTargetField(preview, field.path)}
                                disabled={disabled}
                                onChange={next =>
                                    setPreview(current =>
                                        updateTargetField(current, field.path, next)
                                    )
                                }
                            />
                        ))}
                </div>
            </section>
        </div>
    )
}
function reasonLabel(reason: BuilderReason) {
    return reason === 'provider'
        ? m.builder_provider()
        : reason === 'relation'
          ? m.builder_relation()
          : reason === 'mismatch'
            ? m.builder_mismatch()
            : m.builder_complex()
}
function familyLabel(family: string) {
    return family === 'image'
        ? m.media_filter_images()
        : family === 'video'
          ? m.builder_videos()
          : family === 'audio'
            ? m.media_filter_audio()
            : m.media_filter_documents()
}
function BuilderNumber({
    id,
    label,
    value,
    minimum,
    disabled,
    onValid,
    onChange,
    nullable = false,
    decimal = false,
}: {
    readonly id: string
    readonly label: string
    readonly value: number | null
    readonly minimum: number
    readonly disabled: boolean
    readonly onValid: (valid: boolean) => void
    readonly onChange: (value: number | null) => void
    readonly nullable?: boolean
    readonly decimal?: boolean
}) {
    const [text, setText] = useState(value === null ? '' : String(value))
    const [invalid, setInvalid] = useState(false)
    useEffect(() => {
        setText(value === null ? '' : String(value))
        setInvalid(false)
    }, [value])
    return (
        <Field className="gap-1.5">
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Input
                id={id}
                type="number"
                min={minimum}
                step={decimal ? 'any' : 1}
                value={text}
                disabled={disabled}
                aria-invalid={invalid}
                aria-describedby={invalid ? `${id}-error` : undefined}
                onChange={event => {
                    const next = event.target.value
                    setText(next)
                    const numeric = Number(next)
                    const valid =
                        next === ''
                            ? nullable
                            : Number.isFinite(numeric) &&
                              numeric >= minimum &&
                              (decimal
                                  ? Number.isSafeInteger(Math.round(numeric * 1_000_000))
                                  : Number.isSafeInteger(numeric))
                    setInvalid(!valid)
                    onValid(valid)
                    if (valid) onChange(next === '' ? null : numeric)
                }}
            />
            {invalid ? (
                <FieldDescription id={`${id}-error`} className="text-destructive">
                    {m.builder_invalid_number()}
                </FieldDescription>
            ) : null}
        </Field>
    )
}

function localizedFieldLabel(semantic: string, label: string) {
    if (!['Body', 'Headline', 'Language', 'Media', 'Text'].includes(label)) return label
    return semantic === 'primary_text'
        ? m.editor_source_body()
        : semantic === 'headline'
          ? m.editor_source_headline()
          : semantic === 'language'
            ? m.editor_source_language()
            : semantic === 'ordered_media'
              ? m.media_attachments_title()
              : label
}
