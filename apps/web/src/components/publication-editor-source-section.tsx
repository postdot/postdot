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
import type { PublicationEditorState } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

type SourceContent = PublicationEditorState['post']['sourceContent']

interface PublicationEditorSourceSectionProps {
    readonly projectId: string
    readonly sourceContent: SourceContent
    readonly sourceRevision: number
    readonly disabled: boolean
    readonly mediaDisabled: boolean
    readonly onTextChange: (text: string) => void
    readonly onFormatChange: (format: 'plain_text' | 'markdown') => void
    readonly onOptionalFieldChange: (field: 'headline' | 'language', value: string) => void
    readonly onMediaChange: (media: MediaSelection[]) => void
}

export function PublicationEditorSourceSection({
    projectId,
    sourceContent,
    sourceRevision,
    disabled,
    mediaDisabled,
    onTextChange,
    onFormatChange,
    onOptionalFieldChange,
    onMediaChange,
}: PublicationEditorSourceSectionProps) {
    useLanguage()
    const body = sourceContent.body

    return (
        <section className="min-w-0">
            <Card>
                <CardContent className="p-6 sm:p-7">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">
                                {m.editor_source_title()}
                            </p>
                            <h2 className="mt-2 font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                {m.editor_shared_authoring_content()}
                            </h2>
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                {m.editor_source_description_extended()}
                            </p>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                            {m.editor_source_revision({ revision: sourceRevision })}
                        </span>
                    </div>

                    <div className="mt-6 grid min-w-0 gap-4">
                        <Field className="min-w-0 gap-1.5">
                            <FieldLabel htmlFor="source-body">{m.editor_source_body()}</FieldLabel>
                            <Textarea
                                id="source-body"
                                value={body?.text ?? ''}
                                onChange={event => onTextChange(event.target.value)}
                                disabled={disabled}
                                rows={9}
                                className="min-h-44 min-w-0 max-w-full text-sm leading-6"
                            />
                        </Field>
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
                                        onFormatChange(value as 'plain_text' | 'markdown')
                                    }>
                                    <SelectTrigger id="source-format" disabled={disabled}>
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
                                        onOptionalFieldChange('headline', event.target.value)
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
                                    onOptionalFieldChange('language', event.target.value)
                                }
                                placeholder={m.editor_source_language_placeholder()}
                                disabled={disabled}
                                className="min-w-0"
                            />
                        </Field>
                        <MediaAttachmentPicker
                            projectId={projectId}
                            value={sourceContent.media}
                            onChange={onMediaChange}
                            disabled={mediaDisabled}
                        />
                    </div>
                </CardContent>
            </Card>
        </section>
    )
}
