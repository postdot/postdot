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

interface DiscordConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (
        channelId: string,
        input: { botToken: string; channelId: string }
    ) => Promise<boolean>
}

export function DiscordConnectionDialog({
    channel,
    disabled,
    onConnect,
}: DiscordConnectionDialogProps) {
    const [open, setOpen] = useState(false)
    const [botToken, setBotToken] = useState('')
    const [targetChannelId, setTargetChannelId] = useState('')
    const [error, setError] = useState<string | null>(null)

    function reset() {
        setBotToken('')
        setTargetChannelId('')
        setError(null)
    }

    async function submit() {
        if (!/^\d{17,20}$/.test(targetChannelId.trim())) {
            setError('Enter the 17 to 20 digit Discord channel ID.')
            return
        }
        if (botToken.length < 32) {
            setError('Enter the Discord Bot token.')
            return
        }

        setError(null)
        const connected = await onConnect(channel.id, {
            botToken,
            channelId: targetChannelId.trim(),
        })
        if (connected) {
            reset()
            setOpen(false)
        }
    }

    return (
        <>
            <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
                <AddIcon aria-hidden="true" />
                Connect Discord
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
                            Discord publishes through a project Bot token. The token is stored
                            encrypted and is never shown again.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4">
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`discord-channel-${channel.id}`}>
                                Discord channel ID
                            </FieldLabel>
                            <Input
                                id={`discord-channel-${channel.id}`}
                                autoFocus
                                inputMode="numeric"
                                value={targetChannelId}
                                onChange={event => setTargetChannelId(event.target.value)}
                                placeholder="123456789012345678"
                            />
                            <FieldDescription>
                                Right-click the channel in Discord and copy its ID with Developer
                                Mode enabled.
                            </FieldDescription>
                        </Field>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`discord-token-${channel.id}`}>
                                Bot token
                            </FieldLabel>
                            <Input
                                id={`discord-token-${channel.id}`}
                                type="password"
                                autoComplete="off"
                                value={botToken}
                                onChange={event => setBotToken(event.target.value)}
                            />
                            <FieldDescription>
                                The bot must have Send Messages permission in this channel.
                            </FieldDescription>
                        </Field>
                        {error === null ? null : (
                            <p className="text-sm text-destructive" role="alert">
                                {error}
                            </p>
                        )}
                    </div>
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
                            Connect Discord
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
