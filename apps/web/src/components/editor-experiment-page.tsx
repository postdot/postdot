import { Button } from '@postbot/ui/components/button'
import { Textarea } from '@postbot/ui/components/textarea'
import { useState } from 'react'

import { ConfiguredPublicationEditor } from '@/components/configured-publication-editor'
import { type EditorProfile } from '@/lib/editor-experiment/configuration'
import * as m from '@/paraglide/messages.js'

const profiles: EditorProfile[] = ['plain', 'discord', 'article']
const samples: Record<EditorProfile, string> = {
    plain: 'Hello 👋\n\n**This stays literal.**\nhttps://example.com\n',
    discord: '**Hello** 👋\n\n__Underline__ and ||spoiler||',
    article: '## Hello 👋\n\n- First\n- Second\n\n> A quotation\n\n```js\nconst answer = 42\n```',
}
const storageKey = 'postbot-editor-experiment-v1'

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
    const [value, setValue] = useState(initial)
    return (
        <div className="space-y-4">
            <ConfiguredPublicationEditor
                profile={profile}
                value={value}
                label={m.editor_lab_content()}
                onValueChange={text => {
                    setValue(text)
                    onChange(text)
                }}
            />
            <label className="block space-y-2 text-sm text-muted-foreground">
                <span>
                    {m.editor_lab_output()} ·{' '}
                    {profile === 'article' ? 'Markdown' : m.editor_lab_plain()}
                </span>
                <Textarea readOnly value={value} className="min-h-32 font-mono text-sm" />
            </label>
        </div>
    )
}
