import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useState } from 'react'

import type { Channel } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { useConnectionAction } from '@/lib/use-connection-action'
import * as m from '@/paraglide/messages.js'

interface MastodonConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (channelId: string, instanceUrl: string) => Promise<void>
    readonly reconnect?: boolean
}

export function MastodonConnectionDialog({
    channel,
    disabled,
    onConnect,
    reconnect = false,
}: MastodonConnectionDialogProps) {
    useLanguage()
    const [open, setOpen] = useState(false)
    const [instanceUrl, setInstanceUrl] = useState('')
    const { submitting, error, setError, run } = useConnectionAction()

    function reset() {
        setInstanceUrl('')
        setError(null)
    }

    async function submit() {
        if (disabled || submitting) return
        const normalizedInstanceUrl = instanceUrl.trim()
        if (normalizedInstanceUrl === '') {
            setError(m.provider_instance_required())
            return
        }

        let parsed: URL
        try {
            parsed = new URL(normalizedInstanceUrl)
        } catch {
            setError(m.provider_instance_invalid())
            return
        }
        if (
            parsed.protocol !== 'https:' ||
            parsed.username ||
            parsed.password ||
            (parsed.pathname !== '/' && parsed.pathname !== '')
        ) {
            setError(m.provider_instance_origin())
            return
        }

        setError(null)
        await run(() => onConnect(channel.id, parsed.origin))
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
                    ? m.provider_reconnect_title({ provider: 'Mastodon' })
                    : m.provider_connect_title({ provider: 'Mastodon' })}
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
                            <DialogDescription>
                                {m.provider_mastodon_description()}
                            </DialogDescription>
                        </DialogHeader>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`mastodon-instance-${channel.id}`}>
                                {m.provider_instance()}
                            </FieldLabel>
                            <Input
                                disabled={disabled || submitting}
                                id={`mastodon-instance-${channel.id}`}
                                autoFocus
                                autoComplete="url"
                                inputMode="url"
                                value={instanceUrl}
                                onChange={event => {
                                    setInstanceUrl(event.target.value)
                                    setError(null)
                                }}
                                placeholder={m.provider_instance_placeholder()}
                            />
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
                                {m.provider_continue_mastodon()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
