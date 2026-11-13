import { MAX_THREAD_MESSAGES } from '@postdot/core'
import { Button } from '@postdot/ui/components/button'
import { Textarea } from '@postdot/ui/components/textarea'
import { parseXPostText } from '@postdot/x/text'
import { useRef } from 'react'

import * as m from '@/paraglide/messages.js'

import type { ProviderFieldProps } from './contract'

function ThreadControl({
    value,
    disabled,
    fieldId,
    onChange,
    error,
    provider,
}: ProviderFieldProps & { readonly provider: 'x' | 'bluesky' | 'mastodon' }) {
    const messages: readonly { text: string }[] = Array.isArray(value) ? value : []
    const nextKey = useRef(0)
    const keys = useRef<number[]>([])
    while (keys.current.length < messages.length) keys.current.push(nextKey.current++)
    keys.current.length = messages.length
    const editorElements = useRef(new Map<number, HTMLTextAreaElement>())
    function move(index: number, delta: number) {
        const updated = [...messages]
        const movedKeys = [...keys.current]
        ;[updated[index], updated[index + delta]] = [updated[index + delta]!, updated[index]!]
        ;[movedKeys[index], movedKeys[index + delta]] = [
            movedKeys[index + delta]!,
            movedKeys[index]!,
        ]
        keys.current = movedKeys
        onChange(updated)
        editorElements.current.get(movedKeys[index + delta]!)?.focus()
    }
    return (
        <fieldset
            disabled={disabled}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            className="min-w-0 space-y-3"
            data-thread-editor>
            <legend className="text-sm font-medium">{m.thread_title()}</legend>
            {messages.length ? (
                <p className="text-xs leading-5 text-muted-foreground">{m.thread_help()}</p>
            ) : null}
            {messages.map((message, index) => {
                const number = index + 2
                const key = keys.current[index]!
                const count =
                    provider === 'x'
                        ? parseXPostText(message.text).weightedLength
                        : provider === 'bluesky'
                          ? [
                                ...new Intl.Segmenter(undefined, {
                                    granularity: 'grapheme',
                                }).segment(message.text),
                            ].length
                          : message.text.length
                const limit = provider === 'x' ? 280 : provider === 'bluesky' ? 300 : 500
                const invalid =
                    !message.text.trim() ||
                    count === null ||
                    count > limit ||
                    (provider === 'x' && !parseXPostText(message.text).valid) ||
                    (provider === 'bluesky' && message.text.length > 3000)
                const id = `${fieldId}-${key}`
                return (
                    <div key={key} className="min-w-0 space-y-2 border-t border-border pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="text-sm font-medium" htmlFor={id}>
                                {m.thread_message({ number })}
                            </label>
                            <div className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={disabled || index === 0}
                                    aria-label={m.thread_move_up({ number })}
                                    onClick={() => move(index, -1)}>
                                    {m.thread_up()}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={disabled || index === messages.length - 1}
                                    aria-label={m.thread_move_down({ number })}
                                    onClick={() => move(index, 1)}>
                                    {m.thread_down()}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={disabled}
                                    aria-label={m.thread_remove({ number })}
                                    onClick={() => {
                                        keys.current.splice(index, 1)
                                        const updated = messages.filter(
                                            (_, position) => position !== index
                                        )
                                        onChange(updated.length ? updated : undefined)
                                    }}>
                                    {m.common_remove()}
                                </Button>
                            </div>
                        </div>
                        <Textarea
                            id={id}
                            ref={node => {
                                if (node) editorElements.current.set(key, node)
                                else editorElements.current.delete(key)
                            }}
                            value={message.text}
                            disabled={disabled}
                            rows={3}
                            aria-invalid={invalid}
                            aria-describedby={`${id}-count${invalid ? ` ${id}-error` : ''}`}
                            onChange={event =>
                                onChange(
                                    messages.map((item, position) =>
                                        position === index ? { text: event.target.value } : item
                                    )
                                )
                            }
                        />
                        <div className="flex flex-wrap justify-between gap-2 text-xs">
                            {invalid ? (
                                <p id={`${id}-error`} className="text-destructive">
                                    {m.thread_message_invalid()}
                                </p>
                            ) : (
                                <span />
                            )}
                            <p
                                id={`${id}-count`}
                                className={invalid ? 'text-destructive' : 'text-muted-foreground'}>
                                {m.thread_count({ count: count ?? '—', limit })}
                            </p>
                        </div>
                    </div>
                )
            })}
            <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled || messages.length >= MAX_THREAD_MESSAGES - 1}
                onClick={() => onChange([...messages, { text: '' }])}>
                {m.thread_add()}
            </Button>
            {messages.length >= MAX_THREAD_MESSAGES - 1 ? (
                <p className="text-xs text-muted-foreground">
                    {m.thread_limit({ limit: MAX_THREAD_MESSAGES })}
                </p>
            ) : null}
            {error ? (
                <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            ) : null}
        </fieldset>
    )
}

export const threadControls = {
    x: (props: ProviderFieldProps) => <ThreadControl {...props} provider="x" />,
    bluesky: (props: ProviderFieldProps) => <ThreadControl {...props} provider="bluesky" />,
    mastodon: (props: ProviderFieldProps) => <ThreadControl {...props} provider="mastodon" />,
}
