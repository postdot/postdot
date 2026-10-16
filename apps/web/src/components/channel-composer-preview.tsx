import { useId, useMemo, useState } from 'react'

import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { TargetFieldControl } from '@/components/publication-target-field-control'
import { PublicationTextEditor } from '@/components/publication-text-editor'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { getTargetEditorFields, readTargetField, updateTargetField } from '@/lib/target-editor'
import * as m from '@/paraglide/messages.js'

/** Local writing sample: the composer toolbar is shared; uploads stay disabled. */
export function ChannelComposerPreview({
    projectId,
    scopeId,
    profile,
    target,
    onChange,
    disabled,
}: {
    readonly projectId: string
    readonly scopeId: string
    readonly profile: unknown
    readonly target: Record<string, unknown>
    readonly onChange: (target: Record<string, unknown>) => void
    readonly disabled: boolean
}) {
    const { locale } = useLanguage()
    const id = useId()
    const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
    const fields = useMemo(() => getTargetEditorFields(profile, locale), [profile, locale])
    const body = fields.find(field => field.semantic === 'primary_text' && field.kind === 'text')
    const media = fields.find(field => field.kind === 'media')
    const text = body ? readTargetField(target, body.path) : ''
    const value = typeof text === 'string' ? text : ''
    const count = Array.from(value).length
    const invalid =
        body?.maxLength !== null && body?.maxLength !== undefined && count > body.maxLength
    return (
        <div className="min-w-0">
            <div className="grid gap-4">
                {fields
                    .filter(field => field !== body && field !== media)
                    .map((field, index) => {
                        const control = (
                            <TargetFieldControl
                                field={field}
                                fieldId={`${id}-${index}`}
                                value={readTargetField(target, field.path)}
                                disabled={disabled}
                                compact
                                onChange={next =>
                                    onChange(updateTargetField(target, field.path, next))
                                }
                            />
                        )
                        return field.semantic === 'language' ? (
                            <details key={field.bindingId}>
                                <summary className="cursor-pointer text-xs text-muted-foreground">
                                    {m.builder_content_language()}
                                </summary>
                                <div className="mt-3">{control}</div>
                            </details>
                        ) : (
                            <div key={field.bindingId}>{control}</div>
                        )
                    })}
            </div>
            {body ? (
                <PublicationTextEditor
                    appearance="composer"
                    id={`${id}-body`}
                    aria-label={m.publication_new_channel_copy()}
                    aria-describedby={body.maxLength !== null ? `${id}-count` : undefined}
                    aria-invalid={invalid || undefined}
                    onToolbarMount={setToolbar}
                    value={value}
                    onValueChange={next => onChange(updateTargetField(target, body.path, next))}
                    disabled={disabled}
                    placeholder={m.publication_new_source_placeholder()}
                    rows={9}
                />
            ) : null}
            {body?.maxLength !== null && body?.maxLength !== undefined ? (
                <p
                    id={`${id}-count`}
                    className={`px-4 pb-3 text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {m.composer_character_count({
                        count: formatNumber(count, locale),
                        limit: formatNumber(body.maxLength, locale),
                    })}
                </p>
            ) : null}
            {media ? (
                <div title={m.builder_preview_media_disabled()}>
                    <MediaAttachmentPicker
                        variant="publication-new-inline"
                        triggerContainer={toolbar}
                        scopeId={scopeId}
                        projectId={projectId}
                        value={[]}
                        disabled
                        onChange={() => {}}
                    />
                </div>
            ) : null}
        </div>
    )
}
