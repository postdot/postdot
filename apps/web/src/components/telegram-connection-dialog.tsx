import { isTelegramChannelId } from '@postbot/telegram'
import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@postbot/ui/components/popover'
import { InfoCircleIcon } from '@solar-icons/react/linear/info-circle'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useState } from 'react'

import type { Channel } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { useConnectionAction } from '@/lib/use-connection-action'
import * as m from '@/paraglide/messages.js'

interface TelegramConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (
        channelId: string,
        input: { botToken: string; chatReference: string }
    ) => Promise<boolean>
    readonly reconnect?: boolean
}

export function TelegramConnectionDialog({
    channel,
    disabled,
    onConnect,
    reconnect = false,
}: TelegramConnectionDialogProps) {
    useLanguage()
    const [open, setOpen] = useState(false)
    const [botToken, setBotToken] = useState('')
    const [targetChannelId, setTargetChannelId] = useState('')
    const { submitting, error, setError, run } = useConnectionAction()

    function reset() {
        setBotToken('')
        setTargetChannelId('')
        setError(null)
    }

    async function submit() {
        if (disabled || submitting) return
        if (
            !(
                isTelegramChannelId(targetChannelId.trim()) ||
                /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(targetChannelId.trim())
            )
        ) {
            setError(m.provider_telegram_channel_invalid())
            return
        }
        if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken) || botToken.length > 512) {
            setError(m.provider_bot_token_required())
            return
        }

        setError(null)
        const connected = await run(() =>
            onConnect(channel.id, {
                botToken,
                chatReference: targetChannelId.trim(),
            })
        )
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
                variant="outline"
                onClick={() => setOpen(true)}
                disabled={disabled || submitting}>
                <LinkIcon aria-hidden="true" />
                {reconnect
                    ? m.provider_reconnect_title({ provider: 'Telegram' })
                    : m.provider_connect_telegram()}
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    if (submitting) return
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent
                    aria-describedby={undefined}
                    className="max-h-[min(42rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-sm overflow-hidden bg-background sm:max-w-sm">
                    <form
                        className="flex min-h-0 flex-col gap-4"
                        onSubmit={event => {
                            event.preventDefault()
                            void submit()
                        }}
                        aria-busy={submitting}>
                        <DialogHeader className="shrink-0">
                            <DialogTitle>
                                {reconnect
                                    ? m.provider_reconnect_title({ provider: channel.name })
                                    : m.provider_connect_title({ provider: channel.name })}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="grid min-h-0 gap-4 overflow-y-auto">
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor={`telegram-channel-${channel.id}`}>
                                    {m.provider_telegram_channel_id()}
                                </FieldLabel>
                                <Input
                                    disabled={disabled || submitting}
                                    id={`telegram-channel-${channel.id}`}
                                    autoFocus
                                    value={targetChannelId}
                                    onChange={event => {
                                        setTargetChannelId(event.target.value)
                                        setError(null)
                                    }}
                                    placeholder={m.provider_telegram_channel_placeholder()}
                                />
                            </Field>
                            <Field className="gap-1.5">
                                <div className="flex items-center gap-1">
                                    <FieldLabel htmlFor={`telegram-token-${channel.id}`}>
                                        {m.provider_bot_token()}
                                    </FieldLabel>
                                    <Popover>
                                        <PopoverTrigger
                                            render={
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                />
                                            }
                                            aria-label={m.provider_telegram_token_help_label()}>
                                            <InfoCircleIcon aria-hidden="true" />
                                        </PopoverTrigger>
                                        <PopoverContent
                                            className="max-w-[calc(100vw-2rem)] text-sm"
                                            side="top">
                                            {m.provider_telegram_token_help()}
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <Input
                                    disabled={disabled || submitting}
                                    id={`telegram-token-${channel.id}`}
                                    type="password"
                                    autoComplete="off"
                                    value={botToken}
                                    onChange={event => {
                                        setBotToken(event.target.value)
                                        setError(null)
                                    }}
                                />
                            </Field>
                            {error === null ? null : (
                                <p className="text-sm text-destructive" role="alert">
                                    {error}
                                </p>
                            )}
                        </div>
                        <DialogFooter className="shrink-0 bg-transparent">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                    reset()
                                    setOpen(false)
                                }}
                                disabled={disabled || submitting}>
                                {m.common_cancel()}
                            </Button>
                            <Button type="submit" disabled={disabled || submitting}>
                                <LinkIcon aria-hidden="true" />
                                {reconnect
                                    ? m.provider_reconnect_title({ provider: 'Telegram' })
                                    : m.provider_connect_telegram()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
