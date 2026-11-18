import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Tooltip, TooltipTrigger, TooltipContent } from '@postdot/ui/components/tooltip'
import { useMemo, useState } from 'react'

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
import { providerField } from '@/providers/registry'

interface PublicationTargetEditorProps {
    readonly omitPaths?: readonly string[]
    readonly previewOnly?: boolean
    readonly validationIssues?: readonly Record<string, unknown>[]
    readonly projectId?: string
    readonly mediaScopeId?: string
    readonly configuredEditor?: boolean
    readonly profile: unknown
    readonly target: Record<string, unknown> | null
    readonly onTargetChange: (target: Record<string, unknown>) => void
    readonly disabled?: boolean
    readonly readOnly?: boolean
    readonly compact?: boolean
}

export function PublicationTargetEditor({
    omitPaths,
    validationIssues = [],
    previewOnly = false,
    projectId,
    mediaScopeId,
    configuredEditor = true,
    profile,
    target,
    onTargetChange,
    disabled = false,
    readOnly = false,
    compact = false,
}: PublicationTargetEditorProps) {
    const { locale, catalogVersion } = useLanguage()
    const fields = useMemo(
        () =>
            getTargetEditorFields(profile, locale, target).filter(
                field => !omitPaths?.includes(field.path)
            ),
        [profile, locale, catalogVersion, target, omitPaths]
    )
    function updateField(field: TargetEditorField, value: unknown | undefined) {
        if (target === null) return
        onTargetChange(updateTargetField(target, field.path, value))
    }

    const question = useMemo(() => {
        if (target === null) return ''
        const field = fields.find(candidate => candidate.semantic === 'primary_text')
        if (field === undefined) return ''
        const value = readTargetField(target, field.path)
        return typeof value === 'string' ? value : ''
    }, [fields, target])

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
                                question={question}
                                onChange={value => updateField(field, value)}
                            />
                        )
                    )}
                </div>
            )}
        </div>
    )
}

export function ReadOnlyTargetFields({
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

function formatReadOnlyValue(value: unknown, field: TargetEditorField): string {
    const extension = providerField(field.kind)
    if (extension) return extension.summarize(value)
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
    if (issue.code === 'schema.minimum' && field.minimum !== null)
        return m.editor_field_minimum({ count: field.minimum })
    if (issue.code === 'devto.canonical_url_invalid') return m.editor_field_devto_canonical_url()
    if (issue.code === 'devto.tag_invalid') return m.editor_field_devto_tag()
    if (issue.code === 'devto.tags_duplicate') return m.editor_field_devto_tags_duplicate()
    if (issue.code === 'devto.text_blank') return m.editor_field_devto_text_blank()
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
        <Tooltip>
            <TooltipTrigger
                render={
                    <div data-target-field={field.bindingId} className="min-w-0">
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
                }
            />
            <TooltipContent>
                {previewOnly ? m.builder_preview_media_disabled() : undefined}
            </TooltipContent>
        </Tooltip>
    )
}
