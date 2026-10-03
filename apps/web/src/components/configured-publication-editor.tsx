import { Button } from '@herald/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@herald/ui/components/popover'
import { SmileCircleIcon } from '@solar-icons/react/linear/smile-circle'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import {
    editorExtensions,
    markdownCodec,
    plainDocument,
    plainText,
    requiresSourceMode,
    type EditorProfile,
} from '@/lib/editor-experiment/configuration'
import * as m from '@/paraglide/messages.js'

import { PublicationTextEditor } from './publication-text-editor'

const EmojiPicker = lazy(() => import('./publication-emoji-picker'))

/** Controlled string boundary; engine documents never enter publishing or recovery payloads. */
export function ConfiguredPublicationEditor({
    profile,
    value,
    onValueChange,
    label,
    disabled,
    describedBy,
    invalid,
    id,
    maxLength,
    compact = false,
}: {
    readonly profile: EditorProfile
    readonly value: string
    readonly onValueChange: (value: string) => void
    readonly label: string
    readonly disabled?: boolean
    readonly describedBy?: string
    readonly invalid?: boolean
    readonly id?: string
    readonly maxLength?: number
    readonly compact?: boolean
}) {
    const codec = useMemo(
        () => (profile === 'plain' ? undefined : markdownCodec(profile)),
        [profile]
    )
    const output = value
    const lastEmitted = useRef(value)
    const [initial] = useState(value)
    const publish = (text: string) => {
        lastEmitted.current = text
        onValueChange(text)
    }
    const sourceEntry = useRef(initial)
    const [emojiOpen, setEmojiOpen] = useState(false)
    const [source, setSource] = useState(() => requiresSourceMode(profile, initial))
    const blocked = useMemo(
        () => requiresSourceMode(profile, output, codec),
        [profile, output, codec]
    )
    const extensions = useMemo(
        () => [
            ...editorExtensions(profile),
            Extension.create({
                // Provider limits count serialized delimiters, not only visible text.
                name: 'serializedLengthLimit',
                addProseMirrorPlugins: () => [
                    new Plugin({
                        filterTransaction: (transaction, previous) => {
                            if (
                                !transaction.docChanged ||
                                maxLength === undefined ||
                                transaction.getMeta('heraldExternalContent')
                            )
                                return true
                            const length = (doc: typeof transaction.doc) =>
                                (codec ? codec.serialize(doc.toJSON()) : plainText(doc.toJSON()))
                                    .length
                            const next = length(transaction.doc)
                            return next <= maxLength || next <= length(previous.doc)
                        },
                    }),
                ],
            }),
        ],
        [profile, codec, maxLength]
    )
    const editor = useEditor({
        extensions,
        editable: !disabled,
        content:
            codec && !requiresSourceMode(profile, initial)
                ? codec.parse(initial)
                : plainDocument(initial),
        enableContentCheck: true,
        editorProps: {
            attributes: {
                role: 'textbox',
                ...(id && !source ? { id } : {}),
                'aria-label': label,
                ...(describedBy ? { 'aria-describedby': describedBy } : {}),
                ...(invalid ? { 'aria-invalid': 'true' } : {}),
                'aria-disabled': String(Boolean(disabled)),
                'aria-multiline': 'true',
                class: `${compact ? 'min-h-32' : 'min-h-64'} whitespace-pre-wrap p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary rounded-md [&_p]:min-h-6 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_h2]:text-xl [&_h3]:text-lg [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_pre]:bg-surface-inset [&_pre]:p-3 [&_a]:text-primary [&_a]:underline [&_mark]:bg-primary/20`,
            },
            transformPastedText: text => text,
        },
        onUpdate: ({ editor: updated }) => {
            const text = codec ? codec.serialize(updated.getJSON()) : plainText(updated.getJSON())
            publish(text)
        },
    })
    const state = useEditorState({
        editor,
        selector: ({ editor: current }) => ({
            bold: current?.isActive('bold') ?? false,
            italic: current?.isActive('italic') ?? false,
            underline: current?.isActive('discordUnderline') ?? false,
            heading: current?.isActive('heading') ?? false,
            list: current?.isActive('bulletList') ?? false,
            strike: current?.isActive('strike') ?? false,
            code: current?.isActive('code') ?? false,
            spoiler: current?.isActive('discordSpoiler') ?? false,
        }),
    })
    useEffect(() => {
        if (!editor || value === lastEmitted.current) return
        lastEmitted.current = value
        const raw = requiresSourceMode(profile, value, codec)
        setSource(raw)
        editor
            .chain()
            .command(({ tr }) => {
                tr.setMeta('heraldExternalContent', true)
                return true
            })
            .setContent(codec && !raw ? codec.parse(value) : plainDocument(value), {
                emitUpdate: false,
            })
            .run()
    }, [editor, profile, value, codec])
    useEffect(() => {
        editor?.setEditable(!disabled, false)
    }, [editor, disabled])
    if (!editor) return null
    const commands = [
        {
            label: m.editor_lab_bold(),
            glyph: <strong>B</strong>,
            active: state?.bold,
            run: () => editor.chain().focus().toggleBold().run(),
        },
        {
            label: m.editor_lab_italic(),
            glyph: <em>I</em>,
            active: state?.italic,
            run: () => editor.chain().focus().toggleItalic().run(),
        },
        {
            label: m.editor_format_strike(),
            glyph: <s>S</s>,
            active: state?.strike,
            run: () => editor.chain().focus().toggleStrike().run(),
        },
        {
            label: m.editor_format_code(),
            glyph: '</>',
            active: state?.code,
            run: () => editor.chain().focus().toggleCode().run(),
        },
        ...(profile === 'discord'
            ? [
                  {
                      label: m.editor_lab_underline(),
                      glyph: <u>U</u>,
                      active: state?.underline,
                      run: () => editor.chain().focus().toggleMark('discordUnderline').run(),
                  },
                  {
                      label: m.editor_lab_spoiler(),
                      glyph: '||',
                      active: state?.spoiler,
                      run: () => editor.chain().focus().toggleMark('discordSpoiler').run(),
                  },
              ]
            : []),
        ...(profile === 'article'
            ? [
                  {
                      label: m.editor_lab_heading(),
                      glyph: 'H2',
                      active: state?.heading,
                      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
                  },
                  {
                      label: m.editor_lab_list(),
                      glyph: '•',
                      active: state?.list,
                      run: () => editor.chain().focus().toggleBulletList().run(),
                  },
              ]
            : []),
    ]
    return (
        <div className="space-y-4">
            {blocked ? (
                <p role="status" className="text-sm text-muted-foreground">
                    {m.editor_lab_unsupported()}
                </p>
            ) : null}
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1 p-2">
                    {profile !== 'plain'
                        ? commands.map(command => (
                              <Button
                                  type="button"
                                  key={command.label}
                                  size="icon"
                                  variant={command.active ? 'secondary' : 'ghost'}
                                  aria-label={command.label}
                                  title={command.label}
                                  aria-pressed={Boolean(command.active)}
                                  disabled={source || disabled}
                                  onClick={command.run}>
                                  {command.glyph}
                              </Button>
                          ))
                        : null}
                    {!source ? (
                        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                            <PopoverTrigger
                                render={
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        disabled={source || disabled}
                                        aria-label={m.publication_emoji_insert()}
                                        title={m.publication_emoji_insert()}
                                    />
                                }>
                                <SmileCircleIcon aria-hidden="true" />
                            </PopoverTrigger>
                            <PopoverContent
                                side="bottom"
                                align="start"
                                className="w-80 max-w-[calc(100vw-2rem)]">
                                <Suspense fallback={<p>{m.common_loading()}</p>}>
                                    {emojiOpen ? (
                                        <EmojiPicker
                                            onSelect={emoji => {
                                                setEmojiOpen(false)
                                                requestAnimationFrame(() =>
                                                    editor
                                                        .chain()
                                                        .focus()
                                                        .insertContent({
                                                            type: 'text',
                                                            text: emoji,
                                                        })
                                                        .run()
                                                )
                                            }}
                                        />
                                    ) : null}
                                </Suspense>
                            </PopoverContent>
                        </Popover>
                    ) : null}
                    {profile !== 'plain' ? (
                        <Button
                            type="button"
                            className="ml-auto"
                            variant="ghost"
                            aria-pressed={source}
                            disabled={disabled || (source && blocked)}
                            onClick={() => {
                                if (source && output !== sourceEntry.current)
                                    editor.commands.setContent(
                                        codec ? codec.parse(output) : plainDocument(output),
                                        { emitUpdate: false }
                                    )
                                if (!source) sourceEntry.current = output
                                setSource(value => !value)
                            }}>
                            {m.editor_lab_source()}
                        </Button>
                    ) : null}
                </div>
                <div hidden={source} className="relative">
                    <EditorContent editor={editor} />
                    {value === '' ? (
                        <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-4 top-4 text-muted-foreground">
                            {m.publication_new_source_placeholder()}
                        </span>
                    ) : null}
                </div>
                {source ? (
                    <PublicationTextEditor
                        id={id}
                        maxLength={maxLength}
                        aria-label={m.editor_lab_raw()}
                        aria-describedby={describedBy}
                        aria-invalid={invalid || undefined}
                        value={output}
                        disabled={disabled}
                        className={`${compact ? 'min-h-32' : 'min-h-64'} font-mono`}
                        onValueChange={publish}
                    />
                ) : null}
            </div>
        </div>
    )
}
