import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { AddIcon } from '@solar-icons/react/bold/add'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { useState } from 'react'

import type { Channel } from '@/lib/api'

interface BlueskyConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (channelId: string, handle: string) => Promise<void>
}

export function BlueskyConnectionDialog({
    channel,
    disabled,
    onConnect,
}: BlueskyConnectionDialogProps) {
    const [open, setOpen] = useState(false)
    const [handle, setHandle] = useState('')
    const [error, setError] = useState<string | null>(null)

    function reset() {
        setHandle('')
        setError(null)
    }

    async function submit() {
        const normalizedHandle = handle.trim().replace(/^@+/, '')
        if (normalizedHandle === '') {
            setError('Enter a Bluesky handle.')
            return
        }

        setError(null)
        await onConnect(channel.id, normalizedHandle)
    }

    return (
        <>
            <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
                <AddIcon aria-hidden="true" />
                Connect Bluesky
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Connect {channel.name}</DialogTitle>
                        <DialogDescription>
                            Enter the Bluesky handle that owns this account. Herald will open
                            Bluesky&apos;s authorization page; no app password is required.
                        </DialogDescription>
                    </DialogHeader>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={`bluesky-handle-${channel.id}`}>
                            Bluesky handle
                        </FieldLabel>
                        <Input
                            id={`bluesky-handle-${channel.id}`}
                            autoFocus
                            autoComplete="username"
                            value={handle}
                            onChange={event => setHandle(event.target.value)}
                            placeholder="saoudi-h.bsky.social"
                            aria-describedby={`bluesky-handle-help-${channel.id}`}
                        />
                        <FieldDescription id={`bluesky-handle-help-${channel.id}`}>
                            You can enter it with or without the @ prefix. Custom domains are
                            supported.
                        </FieldDescription>
                    </Field>
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setOpen(false)}
                            disabled={disabled}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={() => void submit()} disabled={disabled}>
                            <LinkIcon aria-hidden="true" />
                            Continue to Bluesky
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
