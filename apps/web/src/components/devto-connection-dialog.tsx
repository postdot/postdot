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

interface DevtoConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (channelId: string, apiKey: string) => Promise<boolean>
}

export function DevtoConnectionDialog({
    channel,
    disabled,
    onConnect,
}: DevtoConnectionDialogProps) {
    const [open, setOpen] = useState(false)
    const [apiKey, setApiKey] = useState('')
    const [error, setError] = useState<string | null>(null)

    function reset() {
        setApiKey('')
        setError(null)
    }

    async function submit() {
        const normalized = apiKey.trim()
        if (normalized.length === 0 || /\s/.test(normalized)) {
            setError('Enter a valid DEV.to API key.')
            return
        }

        setError(null)
        const connected = await onConnect(channel.id, normalized)
        if (connected) {
            reset()
            setOpen(false)
        }
    }

    return (
        <>
            <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
                <AddIcon aria-hidden="true" />
                Connect DEV.to
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
                            DEV.to publishes through a project API key. The key is checked once,
                            encrypted, and never shown again.
                        </DialogDescription>
                    </DialogHeader>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={`devto-api-key-${channel.id}`}>
                            DEV.to API key
                        </FieldLabel>
                        <Input
                            id={`devto-api-key-${channel.id}`}
                            autoFocus
                            type="password"
                            autoComplete="off"
                            value={apiKey}
                            onChange={event => setApiKey(event.target.value)}
                            aria-describedby={`devto-api-key-help-${channel.id}`}
                        />
                        <FieldDescription id={`devto-api-key-help-${channel.id}`}>
                            Create or copy the key from your DEV.to account settings. Herald uses it
                            only to publish articles for this project channel.
                        </FieldDescription>
                        {error === null ? null : (
                            <p className="text-sm text-destructive" role="alert">
                                {error}
                            </p>
                        )}
                    </Field>
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
                            Connect DEV.to
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
