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
}

export function PublicationTargetEditor({
    profile,
    target,
    rawText,
    onTargetChange,
    onRawTextChange,
    disabled = false,
}: PublicationTargetEditorProps) {
    useLanguage()
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
                    <AlertTitle>{m.editor_target_structured_unavailable()}</AlertTitle>
                    <AlertDescription>{m.editor_target_repair()}</AlertDescription>
                </Alert>
            ) : null}

            {fields.length === 0 ? (
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
                            rows={12}
                            className="min-h-52 min-w-0 max-w-full resize-y bg-surface-field px-3 py-2 font-mono text-xs leading-6 text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
                        />
                    </Field>
                </div>
            </details>
        </div>
    )
}

function targetFieldId(field: TargetEditorField, index: number): string {
    const suffix = field.bindingId.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
    return `target-field-${index}-${suffix}`
}
