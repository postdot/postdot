import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Field, FieldDescription, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { Switch } from '@postdot/ui/components/switch'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { ChannelComposerPreview } from '@/components/channel-composer-preview'
import { ChannelRequestBuilder } from '@/components/channel-request-builder'
import {
    builderRecord,
    setBuilderTitleMode,
    type BuilderTitleMode,
    editBuilderField,
    projectBuilderFields,
    type BuilderEdit,
    type BuilderReason,
} from '@/lib/channel-content-builder'
import { useLanguage } from '@/lib/i18n'
import { parseLocalizedNumber } from '@/lib/localized-number'
import { getTargetEditorFields } from '@/lib/target-editor'
import * as m from '@/paraglide/messages.js'

/** Shared content rules; does not modify transport or perform preview requests. */
export function ChannelContentBuilder({
    value,
    onChange,
    disabled = false,
    onValidityChange,
    projectId,
}: {
    readonly projectId: string
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
    const savedTitle = useRef<unknown>(null)
    const lastMediaMaximum = useRef<Record<string, number>>({})
    const [preview, setPreview] = useState<Record<string, unknown>>({})
    const [invalid, setInvalid] = useState<Record<string, boolean>>({})
    const [requestValid, setRequestValid] = useState(true)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        onValidityChange(
            profile !== null && requestValid && !error && !Object.values(invalid).some(Boolean)
        )
    }, [profile, requestValid, error, invalid, onValidityChange])
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
    const headline = fields.find(field => field.semantic === 'headline')
    const titleMode: BuilderTitleMode = headline
        ? headline.required
            ? 'required'
            : 'optional'
        : 'absent'
    const titleItems = {
        absent: m.builder_title_absent(),
        optional: m.builder_optional(),
        required: m.builder_required(),
    }
    const titleControl = (
        <Field className="gap-1.5">
            <FieldLabel htmlFor={`${instanceId}-title-mode`} className="sr-only">
                {m.builder_title()}
            </FieldLabel>
            <Select
                items={titleItems}
                value={titleMode}
                disabled={
                    disabled ||
                    Boolean(headline?.reason) ||
                    (builderRecord(profile?.execution) && profile.execution.kind === 'built_in')
                }
                onValueChange={mode => {
                    if (!mode) return
                    if (headline && mode === 'absent') savedTitle.current = structuredClone(profile)
                    const result = setBuilderTitleMode(
                        profile,
                        mode as BuilderTitleMode,
                        savedTitle.current
                    )
                    if (result.ok) {
                        setError(null)
                        if (mode === 'absent')
                            setInvalid(current =>
                                Object.fromEntries(
                                    Object.entries(current).filter(
                                        ([key]) => !key.startsWith(`${headline?.id ?? 'headline'}-`)
                                    )
                                )
                            )
                        onChange(JSON.stringify(result.profile, null, 2))
                    } else
                        setError(
                            reasonLabel(result.reason === 'bounds' ? 'complex' : result.reason)
                        )
                }}>
                <SelectTrigger id={`${instanceId}-title-mode`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {Object.entries(titleItems).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                            {label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    )
    const orderedFields = [...fields].sort(
        (left, right) =>
            Number(right.semantic === 'headline') - Number(left.semantic === 'headline')
    )
    return (
        <div data-channel-content-builder className="grid min-w-0 gap-6 lg:grid-cols-[1fr_0.9fr]">
            <div className="min-w-0 space-y-5">
                {headline === undefined ? (
                    <fieldset className="min-w-0 space-y-3 rounded-sm border border-border p-3">
                        <legend className="px-1 text-sm font-medium">{m.builder_title()}</legend>
                        {titleControl}
                    </fieldset>
                ) : null}
                {fields.length === 0 ? (
                    <Alert>
                        <AlertTitle>{m.builder_preserved()}</AlertTitle>
                        <AlertDescription>{m.builder_complex()}</AlertDescription>
                    </Alert>
                ) : null}
                {orderedFields.map(field => {
                    const label =
                        field.semantic === 'headline'
                            ? m.builder_title()
                            : (previewFields.find(item => item.bindingId === field.id)?.label ??
                              field.id)
                    const locked = disabled || field.reason !== undefined
                    const id = `${instanceId}-${field.id}`
                    const controls = (
                        <fieldset
                            key={field.id}
                            className="min-w-0 space-y-3 rounded-sm border border-border p-3">
                            <legend className="px-1 text-sm font-medium">{label}</legend>
                            {field.semantic === 'headline' ? titleControl : null}
                            {field.reason ? (
                                <p className="text-xs leading-5 text-muted-foreground">
                                    {reasonLabel(field.reason)}
                                </p>
                            ) : null}
                            {field.kind !== 'media' && field.semantic !== 'headline' ? (
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
                            {field.kind === 'media' ? (
                                <label
                                    className="flex items-center justify-between gap-3 text-sm"
                                    htmlFor={`${id}-allowed`}>
                                    <span>{m.builder_media_allowed()}</span>
                                    <Switch
                                        id={`${id}-allowed`}
                                        checked={field.maximum > 0}
                                        disabled={locked || field.minimum > 0}
                                        onCheckedChange={checked =>
                                            update(field.id, {
                                                maximum: checked
                                                    ? (lastMediaMaximum.current[field.id] ?? 4)
                                                    : 0,
                                            })
                                        }
                                    />
                                </label>
                            ) : null}
                            {field.kind === 'media' && field.maximum === 0 ? null : (
                                <BuilderNumber
                                    key={`${field.id}-maximum`}
                                    id={`${id}-maximum`}
                                    label={
                                        field.kind === 'media'
                                            ? m.builder_max_files()
                                            : m.builder_max_length()
                                    }
                                    unit={
                                        field.kind === 'media'
                                            ? m.builder_unit_files()
                                            : m.builder_unit_characters()
                                    }
                                    locale={locale}
                                    value={field.maximum}
                                    minimum={Math.max(field.minimum, field.kind === 'text' ? 1 : 0)}
                                    disabled={locked}
                                    onValid={valid => validity(`${field.id}-maximum`, valid)}
                                    onChange={maximum => {
                                        if (field.kind === 'media' && maximum)
                                            lastMediaMaximum.current[field.id] = maximum
                                        update(field.id, { maximum: maximum! })
                                    }}
                                />
                            )}
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
                            ) : field.maximum === 0 ? null : (
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
                                            unit="MB"
                                            locale={locale}
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
                            {field.maxWeightedLength !== undefined ? (
                                <p className="text-xs text-muted-foreground">
                                    {m.builder_weighted({
                                        count: new Intl.NumberFormat(locale).format(
                                            field.maxWeightedLength
                                        ),
                                    })}
                                </p>
                            ) : field.maxGraphemes !== undefined ? (
                                <p className="text-xs text-muted-foreground">
                                    {m.builder_graphemes({
                                        count: new Intl.NumberFormat(locale).format(
                                            field.maxGraphemes
                                        ),
                                    })}
                                </p>
                            ) : null}
                        </fieldset>
                    )
                    return field.semantic === 'language' ? (
                        <details key={field.id} className="space-y-3">
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
                <ChannelRequestBuilder
                    profile={profile}
                    disabled={disabled}
                    onValidityChange={setRequestValid}
                    onChange={next => onChange(JSON.stringify(next, null, 2))}
                />
                {error ? (
                    <p role="alert" className="text-xs text-destructive">
                        {error}
                    </p>
                ) : null}
            </div>
            <section
                aria-label={m.builder_preview()}
                className="min-w-0 self-start rounded-sm bg-background p-4 shadow-field lg:sticky lg:top-0">
                <h3 className="text-sm font-medium">{m.builder_preview()}</h3>
                <p className="mb-5 mt-1 text-xs leading-5 text-muted-foreground">
                    {m.builder_preview_hint()}
                </p>
                <ChannelComposerPreview
                    projectId={projectId}
                    scopeId={`profile-preview:${instanceId}`}
                    profile={profile}
                    target={preview}
                    onChange={setPreview}
                    disabled={disabled}
                />
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
    locale,
    unit,
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
    readonly locale: string
    readonly unit: string
    readonly value: number | null
    readonly minimum: number
    readonly disabled: boolean
    readonly onValid: (valid: boolean) => void
    readonly onChange: (value: number | null) => void
    readonly nullable?: boolean
    readonly decimal?: boolean
}) {
    const format = (input: number | null) =>
        input === null
            ? ''
            : new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(input)
    const [text, setText] = useState(format(value))
    const [invalid, setInvalid] = useState(false)
    const editing = useRef(false)
    useEffect(() => {
        if (editing.current) return
        setText(format(value))
        setInvalid(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, locale])
    return (
        <Field className="gap-1.5">
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <div className="flex items-center gap-2">
                <Input
                    id={id}
                    type="text"
                    inputMode={decimal ? 'decimal' : 'numeric'}
                    className="max-w-40 tabular-nums"
                    value={text}
                    disabled={disabled}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? `${id}-error` : `${id}-unit`}
                    onFocus={() => {
                        editing.current = true
                    }}
                    onBlur={() => {
                        editing.current = false
                        if (!invalid) setText(format(value))
                    }}
                    onChange={event => {
                        const next = event.target.value
                        setText(next)
                        const numeric = parseLocalizedNumber(next, locale)
                        const valid =
                            next.trim() === ''
                                ? nullable
                                : Number.isFinite(numeric) &&
                                  numeric >= minimum &&
                                  (decimal
                                      ? Number.isSafeInteger(Math.round(numeric * 1_000_000))
                                      : Number.isSafeInteger(numeric))
                        setInvalid(!valid)
                        onValid(valid)
                        if (valid) onChange(next.trim() === '' ? null : numeric)
                    }}
                />
                <span id={`${id}-unit`} className="text-sm text-muted-foreground">
                    {unit}
                </span>
            </div>
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
