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
import { AddIcon } from '@solar-icons/react/linear/add'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useState } from 'react'

import type { Channel } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface DiscordConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (
        channelId: string,
        input: { botToken: string; channelId: string }
    ) => Promise<boolean>
    readonly reconnect?: boolean
}

export function DiscordConnectionDialog({
    channel,
    disabled,
    onConnect,
    reconnect = false,
}: DiscordConnectionDialogProps) {
    useLanguage()
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
            setError(m.provider_discord_channel_invalid())
            return
        }
        if (botToken.length < 32) {
            setError(m.provider_bot_token_required())
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
            <Button
                className="self-end sm:self-start"
                size="sm"
                onClick={() => setOpen(true)}
                disabled={disabled}>
                <AddIcon aria-hidden="true" />
                {reconnect
                    ? m.provider_reconnect_title({ provider: 'Discord' })
                    : m.provider_connect_discord()}
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-lg overflow-x-hidden overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {reconnect
                                ? m.provider_reconnect_title({ provider: channel.name })
                                : m.provider_connect_title({ provider: channel.name })}
                        </DialogTitle>
                        <DialogDescription>{m.provider_discord_description()}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4">
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`discord-channel-${channel.id}`}>
                                {m.provider_discord_channel_id()}
                            </FieldLabel>
                            <Input
                                id={`discord-channel-${channel.id}`}
                                autoFocus
                                inputMode="numeric"
                                value={targetChannelId}
                                onChange={event => setTargetChannelId(event.target.value)}
                                placeholder={m.provider_discord_channel_placeholder()}
                            />
                            <FieldDescription>{m.provider_discord_channel_help()}</FieldDescription>
                        </Field>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`discord-token-${channel.id}`}>
                                {m.provider_bot_token()}
                            </FieldLabel>
                            <Input
                                id={`discord-token-${channel.id}`}
                                type="password"
                                autoComplete="off"
                                value={botToken}
                                onChange={event => setBotToken(event.target.value)}
                            />
                            <FieldDescription>{m.provider_discord_token_help()}</FieldDescription>
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
                            {m.common_cancel()}
                        </Button>
                        <Button type="button" onClick={() => void submit()} disabled={disabled}>
                            <LinkIcon aria-hidden="true" />
                            {reconnect
                                ? m.provider_reconnect_title({ provider: 'Discord' })
                                : m.provider_connect_discord()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
