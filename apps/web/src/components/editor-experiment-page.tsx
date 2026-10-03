import { Button } from '@herald/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@herald/ui/components/popover'
import { Textarea } from '@herald/ui/components/textarea'
import { SmileCircleIcon } from '@solar-icons/react/linear/smile-circle'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'

import {
    editorExtensions,
    markdownCodec,
    plainDocument,
    plainText,
    requiresSourceMode,
    type EditorProfile,
} from '@/lib/editor-experiment/configuration'
import * as m from '@/paraglide/messages.js'

const EmojiPicker = lazy(() => import('./publication-emoji-picker'))
const profiles: EditorProfile[] = ['plain', 'discord', 'article']
const samples: Record<EditorProfile, string> = {
    plain: 'Hello 👋\n\n**This stays literal.**\nhttps://example.com\n',
    discord: '**Hello** 👋\n\n__Underline__ and ||spoiler||',
    article: '## Hello 👋\n\n- First\n- Second\n\n> A quotation\n\n```js\nconst answer = 42\n```',
}
const storageKey = 'herald-editor-experiment-v1'

function profileName(profile: EditorProfile) {
    return profile === 'plain' ? m.editor_lab_plain() : profile === 'discord' ? 'Discord' : 'DEV.to'
}

/** Development-only sandbox: never reads or writes a real composition. */
export function EditorExperimentPage() {
    const [selected, setSelected] = useState<EditorProfile>('plain')
    const [revision, setRevision] = useState(0)
    const [initial, setInitial] = useState(samples)
    const [values, setValues] = useState(samples)
    const [saved, setSaved] = useState(false)
    return (
        <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
            <h1 className="text-center text-2xl font-semibold">{m.editor_lab_title()}</h1>
            <p className="text-center text-sm text-muted-foreground">{m.editor_lab_scope()}</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label={m.editor_lab_profile()} className="flex gap-2">
                    {profiles.map(profile => (
                        <Button
                            key={profile}
                            variant={selected === profile ? 'default' : 'secondary'}
                            aria-pressed={selected === profile}
                            onClick={() => setSelected(profile)}>
                            {profileName(profile)}
                        </Button>
                    ))}
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => {
                            const stored = localStorage.getItem(storageKey)
                            if (!stored) return
                            try {
                                const parsed: unknown = JSON.parse(stored)
                                if (typeof parsed !== 'object' || parsed === null) return
                                const record = parsed as Record<string, unknown>
                                if (!profiles.every(profile => typeof record[profile] === 'string'))
                                    return
                                const restored = record as Record<EditorProfile, string>
                                setInitial(restored)
                                setValues(restored)
                                setRevision(value => value + 1)
                            } catch {
                                /* An invalid experiment snapshot cannot replace current text. */
                            }
                        }}>
                        {m.editor_lab_restore()}
                    </Button>
                    <Button
                        onClick={() => {
                            localStorage.setItem(storageKey, JSON.stringify(values))
                            setSaved(true)
                        }}>
                        {m.common_save()}
                    </Button>
                </div>
            </div>
            {saved ? (
                <p role="status" className="text-sm text-muted-foreground">
                    {m.editor_lab_saved()}
                </p>
            ) : null}
            {profiles.map(profile => (
                <div key={`${profile}-${revision}`} hidden={selected !== profile}>
                    <ExperimentSession
                        profile={profile}
                        initial={initial[profile]}
                        onChange={text => {
                            setValues(previous => ({ ...previous, [profile]: text }))
                            setSaved(false)
                        }}
                    />
                </div>
            ))}
        </main>
    )
}

function ExperimentSession({
    profile,
    initial,
    onChange,
}: {
    readonly profile: EditorProfile
    readonly initial: string
    readonly onChange: (text: string) => void
}) {
    const codec = useMemo(
        () => (profile === 'plain' ? undefined : markdownCodec(profile)),
        [profile]
    )
    const [output, setOutput] = useState(initial)
    const sourceEntry = useRef(initial)
    const [emojiOpen, setEmojiOpen] = useState(false)
    const [source, setSource] = useState(() => requiresSourceMode(profile, initial))
    const blocked = requiresSourceMode(profile, output)
    const editor = useEditor({
        extensions: editorExtensions(profile),
        content:
            codec && !requiresSourceMode(profile, initial)
                ? codec.parse(initial)
                : plainDocument(initial),
        enableContentCheck: true,
        editorProps: {
            attributes: {
                role: 'textbox',
                'aria-label': m.editor_lab_content(),
                'aria-multiline': 'true',
                class: 'min-h-64 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md [&_p]:min-h-6 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_h2]:text-xl [&_h3]:text-lg [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_pre]:bg-surface-inset [&_pre]:p-3 [&_a]:text-primary [&_a]:underline [&_mark]:bg-primary/20',
            },
            transformPastedText: text => text,
        },
        onUpdate: ({ editor: updated }) => {
            const text = codec ? codec.serialize(updated.getJSON()) : plainText(updated.getJSON())
            setOutput(text)
            onChange(text)
        },
    })
    const state = useEditorState({
        editor,
        selector: ({ editor: current }) => ({
            bold: current?.isActive('bold') ?? false,
            italic: current?.isActive('italic') ?? false,
            underline: current?.isActive('discordUnderline') ?? false,
            spoiler: current?.isActive('discordSpoiler') ?? false,
        }),
    })
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
                      active: editor.isActive('heading'),
                      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
                  },
                  {
                      label: m.editor_lab_list(),
                      glyph: '•',
                      active: editor.isActive('bulletList'),
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
            <div className="rounded-md bg-surface-raised shadow-sm">
                <div className="flex flex-wrap items-center gap-1 p-2">
                    {profile !== 'plain'
                        ? commands.map(command => (
                              <Button
                                  key={command.label}
                                  size="icon"
                                  variant={command.active ? 'secondary' : 'ghost'}
                                  aria-label={command.label}
                                  title={command.label}
                                  aria-pressed={Boolean(command.active)}
                                  disabled={source}
                                  onClick={command.run}>
                                  {command.glyph}
                              </Button>
                          ))
                        : null}
                    <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                        <PopoverTrigger
                            render={
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    disabled={source}
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
                                                    .insertContent({ type: 'text', text: emoji })
                                                    .run()
                                            )
                                        }}
                                    />
                                ) : null}
                            </Suspense>
                        </PopoverContent>
                    </Popover>
                    <Button
                        className="ml-auto"
                        variant="ghost"
                        aria-pressed={source}
                        disabled={source && blocked}
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
                </div>
                <div hidden={source}>
                    <EditorContent editor={editor} />
                </div>
                {source ? (
                    <Textarea
                        aria-label={m.editor_lab_raw()}
                        value={output}
                        className="min-h-64 font-mono"
                        onChange={event => {
                            setOutput(event.target.value)
                            onChange(event.target.value)
                        }}
                    />
                ) : null}
            </div>
            <label className="block space-y-2 text-sm text-muted-foreground">
                <span>
                    {m.editor_lab_output()} ·{' '}
                    {profile === 'article' ? 'Markdown' : m.editor_lab_plain()}
                </span>
                <Textarea readOnly value={output} className="min-h-32 font-mono text-sm" />
            </label>
        </div>
    )
}
