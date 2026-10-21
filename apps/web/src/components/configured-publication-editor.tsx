import { Button } from '@postdot/ui/components/button'
import { Input } from '@postdot/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@postdot/ui/components/popover'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { SmileCircleIcon } from '@solar-icons/react/linear/smile-circle'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'

import {
    editorExtensions,
    markdownCodec,
    plainDocument,
    plainText,
    requiresSourceMode,
    type EditorProfile,
} from '@/lib/editor-experiment/configuration'
import * as m from '@/paraglide/messages.js'

import { ActionTooltip } from './action-tooltip'
import { ArticleImageControl } from './article-image-control'
import { PublicationEmojiPickerSkeleton } from './publication-emoji-picker-skeleton'
import { PublicationTextEditor } from './publication-text-editor'

const loadEmojiPicker = () => import('./publication-emoji-picker')
const EmojiPicker = lazy(loadEmojiPicker)

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
    onToolbarMount,
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
    readonly onToolbarMount?: (node: HTMLDivElement | null) => void
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
    const [linkOpen, setLinkOpen] = useState(false)
    const [linkValue, setLinkValue] = useState('')
    const [linkError, setLinkError] = useState(false)
    const linkErrorId = useId()
    const linkSelection = useRef({ from: 1, to: 1 })
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
                                transaction.getMeta('postbotExternalContent')
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
                class: `${compact ? 'min-h-32' : 'min-h-64'} whitespace-pre-wrap p-4 outline-none rounded-md [&_p]:min-h-6 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_h2]:text-xl [&_h3]:text-lg [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_pre]:bg-surface-inset [&_pre]:p-3 [&_a]:text-primary [&_a]:underline [&_mark]:bg-primary/20 [&_mark]:text-inherit`,
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
            link: current?.isActive('link') ?? false,
            heading: current?.isActive('heading', { level: 2 }) ?? false,
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
                tr.setMeta('postbotExternalContent', true)
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
    function prepareLink() {
        if (!editor) return
        let selection = { from: editor.state.selection.from, to: editor.state.selection.to }
        const view = editor.view
        const visibleSelection = view.dom.ownerDocument.getSelection()
        if (
            visibleSelection?.anchorNode &&
            visibleSelection.focusNode &&
            view.dom.contains(visibleSelection.anchorNode) &&
            view.dom.contains(visibleSelection.focusNode)
        ) {
            // DOM selection can precede ProseMirror's selection observer on a fast toolbar click.
            const anchor = view.posAtDOM(visibleSelection.anchorNode, visibleSelection.anchorOffset)
            const focus = view.posAtDOM(visibleSelection.focusNode, visibleSelection.focusOffset)
            selection = { from: Math.min(anchor, focus), to: Math.max(anchor, focus) }
            editor.commands.setTextSelection(selection)
        }
        linkSelection.current = selection
        setLinkValue(String(editor.getAttributes('link').href ?? ''))
        setLinkError(false)
    }
    function applyLink(remove = false) {
        if (!editor) return
        const href = linkValue.trim()
        if (!remove) {
            try {
                const url = new URL(href)
                if (
                    !['https:', 'http:', 'mailto:'].includes(url.protocol) ||
                    url.username ||
                    url.password
                )
                    throw new Error('invalid_link')
            } catch {
                setLinkError(true)
                return
            }
        }
        const selection = linkSelection.current
        const chain = editor.chain().setTextSelection(selection).extendMarkRange('link')
        if (remove) chain.unsetLink().run()
        else if (selection.from === selection.to && !editor.isActive('link'))
            chain
                .insertContent({
                    type: 'text',
                    text: href,
                    marks: [{ type: 'link', attrs: { href } }],
                })
                .run()
        else chain.setLink({ href }).run()
        setLinkOpen(false)
    }
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
                <div data-editor-toolbar="true" className="flex flex-wrap items-center gap-1 p-2">
                    <div ref={onToolbarMount} className="contents" />
                    {profile !== 'plain'
                        ? commands.map(command => (
                              <ActionTooltip key={command.label} label={command.label}>
                                  <Button
                                      type="button"
                                      size="icon"
                                      variant={command.active ? 'secondary' : 'ghost'}
                                      aria-label={command.label}
                                      aria-pressed={Boolean(command.active)}
                                      disabled={source || disabled}
                                      onMouseDown={event => event.preventDefault()}
                                      onClick={command.run}>
                                      {command.glyph}
                                  </Button>
                              </ActionTooltip>
                          ))
                        : null}
                    {profile === 'article' ? (
                        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
                            <ActionTooltip label={m.editor_format_link()}>
                                <PopoverTrigger
                                    onPointerDown={prepareLink}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ')
                                            prepareLink()
                                    }}
                                    render={
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant={state?.link ? 'secondary' : 'ghost'}
                                            aria-label={m.editor_format_link()}
                                            disabled={source || disabled}
                                        />
                                    }>
                                    <LinkIcon aria-hidden="true" />
                                </PopoverTrigger>
                            </ActionTooltip>
                            <PopoverContent
                                aria-label={m.editor_format_link()}
                                className="w-80 max-w-[calc(100vw-2rem)] p-3"
                                align="start"
                                finalFocus={() => {
                                    editor.view.focus()
                                    return false
                                }}>
                                <Input
                                    aria-label={m.editor_link_address()}
                                    value={linkValue}
                                    inputMode="url"
                                    autoComplete="url"
                                    placeholder="https://"
                                    aria-invalid={linkError || undefined}
                                    aria-describedby={linkError ? linkErrorId : undefined}
                                    onChange={event => {
                                        setLinkValue(event.target.value)
                                        setLinkError(false)
                                    }}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault()
                                            applyLink()
                                        }
                                    }}
                                />
                                {linkError ? (
                                    <p
                                        id={linkErrorId}
                                        role="alert"
                                        className="mt-2 text-xs text-foreground">
                                        {m.editor_link_invalid()}
                                    </p>
                                ) : null}
                                <div className="mt-3 flex justify-end gap-2">
                                    {state?.link ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => applyLink(true)}>
                                            {m.editor_link_remove()}
                                        </Button>
                                    ) : null}
                                    <Button type="button" size="sm" onClick={() => applyLink()}>
                                        {m.common_apply()}
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>
                    ) : null}
                    {profile === 'article' ? (
                        <ArticleImageControl editor={editor} disabled={source || disabled} />
                    ) : null}
                    {!source ? (
                        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                            <ActionTooltip label={m.publication_emoji_insert()}>
                                <PopoverTrigger
                                    render={
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            disabled={source || disabled}
                                            aria-label={m.publication_emoji_insert()}
                                            onPointerEnter={() => {
                                                void loadEmojiPicker()
                                            }}
                                            onFocus={() => {
                                                void loadEmojiPicker()
                                            }}
                                        />
                                    }>
                                    <SmileCircleIcon aria-hidden="true" />
                                </PopoverTrigger>
                            </ActionTooltip>
                            <PopoverContent
                                aria-label={m.publication_emoji_insert()}
                                side="bottom"
                                align="start"
                                className="w-80 max-w-[calc(100vw-2rem)]"
                                finalFocus={() => {
                                    editor.view.focus()
                                    return false
                                }}>
                                <Suspense fallback={<PublicationEmojiPickerSkeleton />}>
                                    {emojiOpen ? (
                                        <EmojiPicker
                                            onSelect={emoji => {
                                                editor.commands.insertContent({
                                                    type: 'text',
                                                    text: emoji,
                                                })
                                                setEmojiOpen(false)
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
