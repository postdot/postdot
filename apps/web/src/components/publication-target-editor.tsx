import { readMastodonPoll } from '@postbot/mastodon/poll'
import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Textarea } from '@postbot/ui/components/textarea'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { useEffect, useMemo, useState } from 'react'

import { mastodonPollDuration } from '@/components/mastodon-poll-control'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { TargetFieldControl } from '@/components/publication-target-field-control'
import { useLanguage } from '@/lib/i18n'
import {
    getTargetEditorFields,
    getTargetEditorProfile,
    readTargetField,
    type TargetEditorField,
    updateTargetField,
} from '@/lib/target-editor'
import { getTargetMediaSelections, updateTargetMedia } from '@/lib/target-media'
import { validationField } from '@/lib/target-validation'
import * as m from '@/paraglide/messages.js'

interface PublicationTargetEditorProps {
    readonly previewOnly?: boolean
    readonly validationIssues?: readonly Record<string, unknown>[]
    readonly projectId?: string
    readonly mediaScopeId?: string
    readonly configuredEditor?: boolean
    readonly profile: unknown
    readonly target: Record<string, unknown> | null
    readonly rawText: string
    readonly onTargetChange: (target: Record<string, unknown>) => void
    readonly onRawTextChange: (value: string) => void
    readonly disabled?: boolean
    readonly readOnly?: boolean
    readonly compact?: boolean
}

export function PublicationTargetEditor({
    validationIssues = [],
    previewOnly = false,
    projectId,
    mediaScopeId,
    configuredEditor = true,
    profile,
    target,
    rawText,
    onTargetChange,
    onRawTextChange,
    disabled = false,
    readOnly = false,
    compact = false,
}: PublicationTargetEditorProps) {
    const { locale } = useLanguage()
    const fields = useMemo(
        () => getTargetEditorFields(profile, locale, target),
        [profile, locale, target]
    )
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
                    <AlertTitle>{m.editor_target_structured_unavailable()}</AlertTitle>
                    <AlertDescription>{m.editor_target_repair()}</AlertDescription>
                </Alert>
            ) : null}

            {readOnly ? (
                <>
                    {target !== null && fields.length > 0 ? (
                        <ReadOnlyTargetFields fields={fields} target={target} />
                    ) : null}
                    <details data-target-advanced="true" className="group mt-4">
                        <AdvancedSummary />
                        <pre className="mt-3 max-h-72 max-w-full overflow-auto rounded-md bg-surface-field p-3 font-mono text-xs leading-5">
                            {rawText}
                        </pre>
                    </details>
                </>
            ) : fields.length === 0 ? (
                <p className="text-sm leading-6 text-muted-foreground">
                    {m.editor_target_no_bindings()}
                </p>
            ) : (
                <div className="grid min-w-0 gap-5">
                    {fields.map((field, index) =>
                        field.kind === 'media' && projectId !== undefined && target !== null ? (
                            <TargetMediaField
                                previewOnly={previewOnly}
                                key={`${field.bindingId}-${field.path}`}
                                projectId={projectId}
                                scopeId={`${mediaScopeId ?? 'target'}:${field.bindingId}`}
                                field={field}
                                profile={profile}
                                target={target}
                                disabled={disabled || previewOnly}
                                error={fieldValidationMessage(
                                    field,
                                    validationIssues.filter(
                                        issue => validationField(fields, issue) === field
                                    ),
                                    readTargetField(target, field.path)
                                )}
                                onChange={onTargetChange}
                            />
                        ) : (
                            <TargetFieldControl
                                editorProfile={
                                    configuredEditor ? getTargetEditorProfile(profile) : undefined
                                }
                                key={`${field.bindingId}-${field.path}`}
                                field={field}
                                error={fieldValidationMessage(
                                    field,
                                    validationIssues.filter(
                                        issue => validationField(fields, issue) === field
                                    ),
                                    target === null
                                        ? undefined
                                        : readTargetField(target, field.path)
                                )}
                                fieldId={targetFieldId(field, index)}
                                value={
                                    target === null
                                        ? undefined
                                        : readTargetField(target, field.path)
                                }
                                disabled={disabled || target === null}
                                compact={compact}
                                onChange={value => updateField(field, value)}
                            />
                        )
                    )}
                </div>
            )}

            {!readOnly && !previewOnly ? (
                <details
                    data-target-advanced="true"
                    open={advancedOpen}
                    onToggle={event => setAdvancedOpen(event.currentTarget.open)}
                    className={compact ? 'group mt-4' : 'group mt-6'}>
                    <AdvancedSummary />
                    <div className="mt-3 grid gap-3">
                        <p className="text-xs leading-5 text-muted-foreground">
                            {m.editor_target_advanced_escape()}
                        </p>
                        <Field className="min-w-0 gap-1.5">
                            <FieldLabel htmlFor="target-json">{m.editor_target_json()}</FieldLabel>
                            <Textarea
                                id="target-json"
                                value={rawText}
                                onChange={event => onRawTextChange(event.target.value)}
                                disabled={disabled}
                                spellCheck={false}
                                rows={10}
                                className="min-h-44 min-w-0 max-w-full resize-y bg-surface-field px-3 py-2 font-mono text-xs leading-6 text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
                            />
                        </Field>
                    </div>
                </details>
            ) : null}
        </div>
    )
}

function ReadOnlyTargetFields({
    fields,
    target,
}: {
    readonly fields: readonly TargetEditorField[]
    readonly target: Record<string, unknown>
}) {
    return (
        <dl data-target-readonly="true" className="mt-5 grid min-w-0 gap-5">
            {fields.map(field => (
                <div
                    key={`${field.bindingId}-${field.path}`}
                    className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-sm text-muted-foreground">{field.label}</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6">
                        {formatReadOnlyValue(readTargetField(target, field.path), field)}
                    </dd>
                </div>
            ))}
        </dl>
    )
}

function AdvancedSummary() {
    return (
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
            {m.editor_target_advanced()}
            <AltArrowDownIcon
                aria-hidden="true"
                size={16}
                className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            />
        </summary>
    )
}

function formatReadOnlyValue(value: unknown, field: TargetEditorField): string {
    if (field.kind === 'mastodon-poll') {
        const poll = readMastodonPoll(value)
        return poll
            ? [
                  ...poll.options.map((option, index) => `${index + 1}. ${option}`),
                  m.poll_closes_after({ duration: mastodonPollDuration(poll.expiresIn) }),
                  ...(poll.multiple ? [m.poll_multiple()] : []),
                  ...(poll.hideTotals ? [m.poll_hide_totals()] : []),
              ].join('\n')
            : '—'
    }
    if (field.kind === 'media' && Array.isArray(value)) {
        return m.editor_target_selected({ count: value.length })
    }
    if (value === undefined) return m.editor_target_not_set()
    if (value === null) return m.editor_target_null()
    if (value === true) return m.editor_target_yes()
    if (value === false) return m.editor_target_no()
    if (typeof value === 'string') return value || m.editor_target_not_set()
    if (Array.isArray(value)) {
        return value.length === 0 ? m.editor_target_no_values() : JSON.stringify(value)
    }
    return JSON.stringify(value)
}

function targetFieldId(field: TargetEditorField, index: number): string {
    const suffix = field.bindingId.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
    return `target-field-${index}-${suffix}`
}

function fieldValidationMessage(
    field: TargetEditorField,
    issues: readonly Record<string, unknown>[],
    value: unknown
): string | undefined {
    const issue = issues[0]
    if (issue === undefined) return undefined
    if (
        issue.code === 'schema.required' ||
        (issue.code === 'schema.minLength' && (value === undefined || value === ''))
    )
        return m.editor_field_required({ field: field.label })
    if (issue.code === 'schema.minLength' && field.minLength !== null)
        return m.editor_field_min_length({ count: field.minLength })
    if (issue.code === 'schema.maxLength' && field.maxLength !== null)
        return m.editor_field_max_length({ count: field.maxLength })
    if (issue.code === 'schema.minItems' && field.minItems !== null)
        return m.editor_field_min_items({ count: field.minItems })
    if (issue.code === 'schema.maxItems' && field.maxItems !== null)
        return m.editor_field_max_items({ count: field.maxItems })
    return m.editor_field_invalid()
}

function TargetMediaField({
    projectId,
    scopeId,
    previewOnly = false,
    field,
    profile,
    target,
    disabled,
    error,
    onChange,
}: {
    readonly projectId: string
    readonly scopeId: string
    readonly previewOnly?: boolean
    readonly field: TargetEditorField
    readonly profile: unknown
    readonly target: Record<string, unknown>
    readonly disabled: boolean
    readonly error?: string
    readonly onChange: (target: Record<string, unknown>) => void
}) {
    const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
    return (
        <div
            data-target-field={field.bindingId}
            className="min-w-0"
            title={previewOnly ? m.builder_preview_media_disabled() : undefined}>
            <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
                <span className="text-sm font-medium">{field.label}</span>
                <div ref={setToolbar} className="flex items-center" />
            </div>
            <MediaAttachmentPicker
                variant="publication-new-inline"
                triggerContainer={toolbar}
                scopeId={scopeId}
                projectId={projectId}
                value={getTargetMediaSelections(profile, target, field.bindingId)}
                disabled={disabled}
                onChange={media =>
                    onChange(updateTargetMedia(profile, target, media, field.bindingId))
                }
            />
            {error ? (
                <p role="status" className="mt-2 text-xs text-state-failed">
                    {error}
                </p>
            ) : null}
        </div>
    )
}
