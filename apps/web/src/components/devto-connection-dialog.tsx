import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useState } from 'react'

import type { Channel } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { useConnectionAction } from '@/lib/use-connection-action'
import * as m from '@/paraglide/messages.js'

interface DevtoConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (channelId: string, apiKey: string) => Promise<boolean>
    readonly reconnect?: boolean
}

export function DevtoConnectionDialog({
    channel,
    disabled,
    onConnect,
    reconnect = false,
}: DevtoConnectionDialogProps) {
    useLanguage()
    const [open, setOpen] = useState(false)
    const [apiKey, setApiKey] = useState('')
    const { submitting, error, setError, run } = useConnectionAction()

    function reset() {
        setApiKey('')
        setError(null)
    }

    async function submit() {
        if (disabled || submitting) return
        const normalized = apiKey.trim()
        if (normalized.length === 0 || /\s/.test(normalized)) {
            setError(m.provider_devto_api_key_required())
            return
        }

        setError(null)
        const connected = await run(() => onConnect(channel.id, normalized))
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
                    ? m.provider_reconnect_title({ provider: 'DEV.to' })
                    : m.provider_connect_devto()}
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    if (submitting) return
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-sm overflow-x-hidden overflow-y-auto bg-background sm:max-w-sm">
                    <form
                        className="grid gap-4"
                        onSubmit={event => {
                            event.preventDefault()
                            void submit()
                        }}
                        aria-busy={submitting}>
                        <DialogHeader>
                            <DialogTitle>
                                {reconnect
                                    ? m.provider_reconnect_title({ provider: channel.name })
                                    : m.provider_connect_title({ provider: channel.name })}
                            </DialogTitle>
                            <DialogDescription>{m.provider_devto_description()}</DialogDescription>
                        </DialogHeader>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`devto-api-key-${channel.id}`}>
                                {m.provider_devto_api_key()}
                            </FieldLabel>
                            <Input
                                disabled={disabled || submitting}
                                id={`devto-api-key-${channel.id}`}
                                autoFocus
                                type="password"
                                autoComplete="off"
                                value={apiKey}
                                onChange={event => {
                                    setApiKey(event.target.value)
                                    setError(null)
                                }}
                                aria-describedby={`devto-api-key-help-${channel.id}`}
                            />
                            <FieldDescription id={`devto-api-key-help-${channel.id}`}>
                                {m.provider_devto_api_key_help()}
                            </FieldDescription>
                            {error === null ? null : (
                                <p className="text-sm text-destructive" role="alert">
                                    {error}
                                </p>
                            )}
                        </Field>
                        <DialogFooter className="bg-transparent">
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
                                    ? m.provider_reconnect_title({ provider: 'DEV.to' })
                                    : m.provider_connect_devto()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
