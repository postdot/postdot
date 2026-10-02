import { Button } from '@herald/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@herald/ui/components/popover'
import { Textarea } from '@herald/ui/components/textarea'
import { cn } from '@herald/ui/lib/utils'
import { SmileCircleIcon } from '@solar-icons/react/linear/smile-circle'
import { lazy, Suspense, useRef, useState, type ComponentProps } from 'react'

import * as m from '@/paraglide/messages.js'

const EmojiPicker = lazy(() => import('./publication-emoji-picker'))

type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'ref'> & {
    readonly value: string
    readonly onValueChange: (value: string) => void
}

/** Text commands remain separate from the publication payload and preview. */
export function PublicationTextEditor({
    value,
    onValueChange,
    className,
    disabled,
    ...props
}: Props) {
    const textarea = useRef<HTMLTextAreaElement>(null)
    const selection = useRef({ start: 0, end: 0 })
    const [open, setOpen] = useState(false)
    function insert(emoji: string) {
        const { start, end } = selection.current
        const next = value.slice(0, start) + emoji + value.slice(end)
        if (props.maxLength !== undefined && next.length > props.maxLength) return
        setOpen(false)
        requestAnimationFrame(() => {
            const input = textarea.current
            if (!input) return
            input.focus()
            input.setSelectionRange(start, end)
            // Native insertion keeps the textarea undo history when supported.
            if (!document.execCommand('insertText', false, emoji)) onValueChange(next)
            input.setSelectionRange(start + emoji.length, start + emoji.length)
        })
    }
    return (
        <div className="relative min-w-0">
            <Textarea
                {...props}
                ref={textarea}
                disabled={disabled}
                value={value}
                onChange={event => onValueChange(event.target.value)}
                className={cn(className, 'pb-12')}
            />
            <div className="absolute bottom-2 right-2">
                <Popover
                    open={open}
                    onOpenChange={next => {
                        if (next && textarea.current)
                            selection.current = {
                                start: textarea.current.selectionStart,
                                end: textarea.current.selectionEnd,
                            }
                        setOpen(next)
                    }}>
                    <PopoverTrigger
                        render={
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                disabled={disabled}
                                aria-label={m.publication_emoji_insert()}
                                title={m.publication_emoji_insert()}
                            />
                        }>
                        <SmileCircleIcon aria-hidden="true" />
                    </PopoverTrigger>
                    <PopoverContent
                        align="end"
                        side="top"
                        finalFocus={textarea}
                        aria-label={m.publication_emoji_insert()}
                        className="w-80 max-w-[calc(100vw-2rem)]">
                        <Suspense
                            fallback={
                                <div className="p-4 text-sm text-muted-foreground">
                                    {m.common_loading()}
                                </div>
                            }>
                            {open ? (
                                <EmojiPicker
                                    onSelect={insert}
                                    remainingCharacters={
                                        props.maxLength === undefined
                                            ? undefined
                                            : props.maxLength -
                                              (value.length -
                                                  (selection.current.end - selection.current.start))
                                    }
                                />
                            ) : null}
                        </Suspense>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    )
}
