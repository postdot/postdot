import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Textarea } from '@herald/ui/components/textarea'
import { useEffect, useMemo, useState } from 'react'

import { TargetFieldControl } from '@/components/publication-target-field-control'
import { useLanguage } from '@/lib/i18n'
import {
    getTargetEditorFields,
    readTargetField,
    type TargetEditorField,
    updateTargetField,
} from '@/lib/target-editor'
import * as m from '@/paraglide/messages.js'

interface PublicationTargetEditorProps {
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
    const fields = useMemo(() => getTargetEditorFields(profile, locale), [profile, locale])
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
                    <details className="mt-4 rounded-md bg-muted/45 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-foreground">
                            {m.editor_target_advanced()}
                        </summary>
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
                    {fields.map((field, index) => (
                        <TargetFieldControl
                            key={`${field.bindingId}-${field.path}`}
                            field={field}
                            fieldId={targetFieldId(field, index)}
                            value={
                                target === null ? undefined : readTargetField(target, field.path)
                            }
                            disabled={disabled || target === null}
                            compact={compact}
                            onChange={value => updateField(field, value)}
                        />
                    ))}
                </div>
            )}

            {!readOnly ? (
                <details
                    data-target-advanced="true"
                    open={advancedOpen}
                    onToggle={event => setAdvancedOpen(event.currentTarget.open)}
                    className={
                        compact
                            ? 'mt-4 rounded-md bg-surface-inset/45 p-3'
                            : 'mt-6 rounded-md bg-muted/45 p-4'
                    }>
                    <summary className="cursor-pointer text-sm font-medium text-foreground">
                        {m.editor_target_advanced()}
                    </summary>
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
        <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2">
            {fields.map(field => (
                <div
                    key={`${field.bindingId}-${field.path}`}
                    className="min-w-0 rounded-lg bg-surface-inset/55 px-3 py-2.5">
                    <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
                    <p className="mt-1 break-words text-sm font-medium">
                        {formatReadOnlyValue(readTargetField(target, field.path), field)}
                    </p>
                </div>
            ))}
        </div>
    )
}

function formatReadOnlyValue(value: unknown, field: TargetEditorField): string {
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
