import { Button } from '@herald/ui/components/button'
import { Input } from '@herald/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@herald/ui/components/popover'
import { GalleryAddIcon } from '@solar-icons/react/linear/gallery-add'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { useId, useRef, useState } from 'react'

import { articleImageUrl } from '@/lib/article-image-url'
import * as m from '@/paraglide/messages.js'

export function ArticleImageControl({
    editor,
    disabled,
}: {
    readonly editor: Editor
    readonly disabled?: boolean
}) {
    const [open, setOpen] = useState(false)
    const [address, setAddress] = useState('')
    const [alt, setAlt] = useState('')
    const [invalid, setInvalid] = useState(false)
    const addressId = useId()
    const altId = useId()
    const errorId = useId()
    const selection = useRef(editor.state.selection.getBookmark())
    const replacing = useRef(false)
    function prepare() {
        selection.current = editor.state.selection.getBookmark()
        replacing.current = editor.isActive('image')
        const attrs = replacing.current ? editor.getAttributes('image') : {}
        setAddress(String(attrs.src ?? ''))
        setAlt(String(attrs.alt ?? ''))
        setInvalid(false)
    }
    function apply() {
        const src = articleImageUrl(address)
        if (!src) {
            setInvalid(true)
            return
        }
        const chain = editor.chain().command(({ tr }) => {
            closeHistory(tr)
            tr.setSelection(selection.current.resolve(tr.doc))
            return true
        })
        const success = replacing.current
            ? chain.updateAttributes('image', { src, alt }).run()
            : chain.setImage({ src, alt }).run()
        if (success) setOpen(false)
    }
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                onPointerDown={prepare}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') prepare()
                }}
                render={
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={m.editor_image_external()}
                        title={m.editor_image_external()}
                    />
                }>
                <GalleryAddIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent
                aria-label={m.editor_image_external()}
                align="start"
                className="w-80 max-w-[calc(100vw-2rem)] p-3"
                finalFocus={() => {
                    editor.view.focus()
                    return false
                }}>
                <div
                    className="space-y-3"
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault()
                            apply()
                        }
                    }}>
                    <div className="space-y-1.5">
                        <label htmlFor={addressId} className="text-sm font-medium">
                            {m.editor_image_address()}
                        </label>
                        <Input
                            id={addressId}
                            value={address}
                            inputMode="url"
                            autoComplete="url"
                            placeholder="https://"
                            aria-invalid={invalid || undefined}
                            aria-describedby={invalid ? errorId : undefined}
                            onChange={event => {
                                setAddress(event.target.value)
                                setInvalid(false)
                            }}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor={altId} className="text-sm font-medium">
                            {m.editor_image_alt()}
                        </label>
                        <Input
                            id={altId}
                            value={alt}
                            onChange={event => setAlt(event.target.value)}
                        />
                    </div>
                    {invalid ? (
                        <p id={errorId} role="alert" className="text-xs text-foreground">
                            {m.editor_image_invalid()}
                        </p>
                    ) : null}
                    <div className="flex justify-end">
                        <Button type="button" size="sm" onClick={apply}>
                            {m.common_apply()}
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
