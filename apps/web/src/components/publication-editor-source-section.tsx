import { Button } from '@herald/ui/components/button'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { PenIcon } from '@solar-icons/react/linear/pen'
import { lazy, Suspense, useState } from 'react'

import { MediaAttachmentPicker, type MediaSelection } from '@/components/media-attachment-picker'
import { PublicationTextEditor } from '@/components/publication-text-editor'
import type { MediaReference, PublicationEditorState } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

const ConfiguredEditor = lazy(() =>
    import('./configured-publication-editor').then(module => ({
        default: module.ConfiguredPublicationEditor,
    }))
)

type SourceContent = PublicationEditorState['post']['sourceContent']

interface PublicationEditorSourceSectionProps {
    readonly configuredEditor?: boolean
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
    configuredEditor = true,
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
    const [mediaToolbar, setMediaToolbar] = useState<HTMLDivElement | null>(null)
    const [bodyExpanded, setBodyExpanded] = useState(sourceContent.media.length === 0)
    const showBodyField = bodyExpanded || Boolean(body?.text) || sourceContent.media.length === 0

    if (readOnly) {
        return (
            <section className="min-w-0 rounded-xl bg-surface-raised p-4 shadow-surface">
                <h2 className="text-sm font-medium">{m.publication_new_source()}</h2>
                <div className="min-w-0 space-y-4 pt-3">
                    {body?.text ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">
                            {body.text}
                        </p>
                    ) : null}
                    <ReadOnlySourceMeta sourceContent={sourceContent} />
                    <MediaAttachmentPicker
                        triggerContainer={showBodyField ? mediaToolbar : undefined}
                        projectId={projectId}
                        readOnly
                        variant="publication-new-inline"
                        value={sourceContent.media}
                        onChange={onMediaChange}
                        onAssetsChange={onAssetsChange}
                        disabled
                    />
                    <p className="text-xs text-muted-foreground">
                        {m.editor_source_revision({ revision: sourceRevision })}
                    </p>
                </div>
            </section>
        )
    }

    return (
        <section className="min-w-0">
            <div className="rounded-md bg-surface-raised p-4 shadow-surface sm:p-5">
                <div className="grid min-w-0 gap-4">
                    {showBodyField ? (
                        <Field className="min-w-0 gap-1.5">
                            <FieldLabel className="sr-only" htmlFor="source-body">
                                {m.editor_source_body()}
                            </FieldLabel>
                            {configuredEditor ? (
                                <Suspense fallback={null}>
                                    <ConfiguredEditor
                                        onToolbarMount={setMediaToolbar}
                                        compact
                                        key={body?.format ?? 'plain_text'}
                                        id="source-body"
                                        profile={body?.format === 'markdown' ? 'article' : 'plain'}
                                        label={m.editor_source_body()}
                                        value={body?.text ?? ''}
                                        onValueChange={onTextChange}
                                        disabled={disabled}
                                    />
                                </Suspense>
                            ) : (
                                <PublicationTextEditor
                                    onToolbarMount={setMediaToolbar}
                                    id="source-body"
                                    value={body?.text ?? ''}
                                    onValueChange={onTextChange}
                                    disabled={disabled}
                                    rows={sourceContent.media.length > 0 && !body?.text ? 3 : 7}
                                    placeholder={m.editor_source_body_placeholder()}
                                    className={`${sourceContent.media.length > 0 && !body?.text ? 'min-h-24' : 'min-h-40'} min-w-0 max-w-full border-0 bg-transparent p-0 text-sm leading-6 shadow-none dark:bg-transparent`}
                                />
                            )}
                        </Field>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="w-fit"
                            disabled={disabled}
                            onClick={() => setBodyExpanded(true)}>
                            <PenIcon aria-hidden="true" />
                            {m.editor_add_text()}
                        </Button>
                    )}
                    <MediaAttachmentPicker
                        triggerContainer={showBodyField ? mediaToolbar : undefined}
                        projectId={projectId}
                        variant="publication-new-inline"
                        value={sourceContent.media}
                        onChange={onMediaChange}
                        onAssetsChange={onAssetsChange}
                        disabled={mediaDisabled}
                    />
                    <details className="w-fit max-w-full rounded-lg bg-surface-inset/45 px-3 py-2 open:w-full">
                        <summary className="cursor-pointer text-sm font-medium text-foreground">
                            {m.editor_content_options()}
                        </summary>
                        <div className="mt-4 grid min-w-0 gap-4">
                            <p className="text-xs text-muted-foreground">
                                {m.editor_source_revision({ revision: sourceRevision })}
                            </p>
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
                        </div>
                    </details>
                </div>
            </div>
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
