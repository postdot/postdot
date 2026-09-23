import { Card, CardContent } from '@herald/ui/components/card'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Textarea } from '@herald/ui/components/textarea'

import { MediaAttachmentPicker, type MediaSelection } from '@/components/media-attachment-picker'
import type { MediaReference, PublicationEditorState } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

type SourceContent = PublicationEditorState['post']['sourceContent']

interface PublicationEditorSourceSectionProps {
    readonly projectId: string
    readonly sourceContent: SourceContent
    readonly sourceRevision: number
    readonly disabled: boolean
    readonly readOnly?: boolean
    readonly mediaDisabled: boolean
    readonly onTextChange: (text: string) => void
    readonly onFormatChange: (format: 'plain_text' | 'markdown') => void
    readonly onOptionalFieldChange: (field: 'headline' | 'language', value: string) => void
    readonly onMediaChange: (media: MediaSelection[]) => void
    readonly onAssetsChange?: (assets: MediaReference[]) => void
}

export function PublicationEditorSourceSection({
    projectId,
    sourceContent,
    sourceRevision,
    disabled,
    readOnly = false,
    mediaDisabled,
    onTextChange,
    onFormatChange,
    onOptionalFieldChange,
    onMediaChange,
    onAssetsChange,
}: PublicationEditorSourceSectionProps) {
    useLanguage()
    const body = sourceContent.body

    return (
        <section className="min-w-0">
            <Card className="rounded-xl">
                <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <h2 className="font-heading text-xl font-[580] leading-tight">
                            {m.publication_new_source()}
                        </h2>
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <span>{m.editor_source_revision({ revision: sourceRevision })}</span>
                            {readOnly ? (
                                <span className="rounded-full bg-surface-inset px-2 py-0.5">
                                    {m.editor_read_only()}
                                </span>
                            ) : null}
                        </div>
                    </div>

                    {readOnly ? (
                        <div className="mt-5 grid min-w-0 gap-4">
                            <div className="rounded-lg bg-surface-inset/55 px-4 py-3">
                                <p className="text-xs font-medium text-muted-foreground">
                                    {m.editor_source_body()}
                                </p>
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                                    {body?.text || '—'}
                                </p>
                            </div>
                            <ReadOnlySourceMeta sourceContent={sourceContent} />
                        </div>
                    ) : (
                        <div className="mt-5 grid min-w-0 gap-4">
                            <Field className="min-w-0 gap-1.5">
                                <FieldLabel htmlFor="source-body">
                                    {m.editor_source_body()}
                                </FieldLabel>
                                <Textarea
                                    id="source-body"
                                    value={body?.text ?? ''}
                                    onChange={event => onTextChange(event.target.value)}
                                    disabled={disabled}
                                    rows={7}
                                    className="min-h-40 min-w-0 max-w-full text-sm leading-6"
                                />
                            </Field>
                            <details className="rounded-lg bg-surface-inset/45 p-3">
                                <summary className="cursor-pointer text-sm font-medium text-foreground">
                                    {m.editor_content_options()}
                                </summary>
                                <div className="mt-4 grid min-w-0 gap-4">
                                    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                                        <Field className="min-w-0 gap-1.5">
                                            <FieldLabel htmlFor="source-format">
                                                {m.editor_source_format()}
                                            </FieldLabel>
                                            <Select
                                                items={{
                                                    plain_text: m.editor_plain_text(),
                                                    markdown: m.editor_markdown(),
                                                }}
                                                value={body?.format ?? 'plain_text'}
                                                onValueChange={value =>
                                                    onFormatChange(
                                                        value as 'plain_text' | 'markdown'
                                                    )
                                                }>
                                                <SelectTrigger
                                                    id="source-format"
                                                    disabled={disabled}>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent align="start">
                                                    <SelectItem value="plain_text">
                                                        {m.editor_plain_text()}
                                                    </SelectItem>
                                                    <SelectItem value="markdown">
                                                        {m.editor_markdown()}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                        <Field className="min-w-0 gap-1.5">
                                            <FieldLabel htmlFor="source-headline">
                                                {m.editor_source_headline()}
                                            </FieldLabel>
                                            <Input
                                                id="source-headline"
                                                value={sourceContent.headline ?? ''}
                                                onChange={event =>
                                                    onOptionalFieldChange(
                                                        'headline',
                                                        event.target.value
                                                    )
                                                }
                                                placeholder={m.editor_source_headline_placeholder()}
                                                disabled={disabled}
                                                className="min-w-0"
                                            />
                                        </Field>
                                    </div>
                                    <Field className="min-w-0 gap-1.5">
                                        <FieldLabel htmlFor="source-language">
                                            {m.editor_source_language()}
                                        </FieldLabel>
                                        <Input
                                            id="source-language"
                                            value={sourceContent.language ?? ''}
                                            onChange={event =>
                                                onOptionalFieldChange(
                                                    'language',
                                                    event.target.value
                                                )
                                            }
                                            placeholder={m.editor_source_language_placeholder()}
                                            disabled={disabled}
                                            className="min-w-0"
                                        />
                                    </Field>
                                </div>
                            </details>
                        </div>
                    )}

                    <MediaAttachmentPicker
                        projectId={projectId}
                        readOnly={readOnly}
                        variant="publication-new-inline"
                        value={sourceContent.media}
                        onChange={onMediaChange}
                        onAssetsChange={onAssetsChange}
                        disabled={mediaDisabled || readOnly}
                    />
                </CardContent>
            </Card>
        </section>
    )
}

function ReadOnlySourceMeta({ sourceContent }: { readonly sourceContent: SourceContent }) {
    const values = [
        sourceContent.headline
            ? { label: m.editor_source_headline(), value: sourceContent.headline }
            : null,
        sourceContent.language
            ? { label: m.editor_source_language(), value: sourceContent.language }
            : null,
        sourceContent.body
            ? {
                  label: m.editor_source_format(),
                  value:
                      sourceContent.body.format === 'markdown'
                          ? m.editor_markdown()
                          : m.editor_plain_text(),
              }
            : null,
    ].flatMap(item => (item === null ? [] : [item]))

    if (values.length === 0) return null

    return (
        <dl className="grid min-w-0 gap-3 sm:grid-cols-3">
            {values.map(item => (
                <div key={item.label} className="min-w-0 rounded-lg bg-surface-inset/45 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{item.label}</dt>
                    <dd className="mt-1 truncate text-sm font-medium">{item.value}</dd>
                </div>
            ))}
        </dl>
    )
}
