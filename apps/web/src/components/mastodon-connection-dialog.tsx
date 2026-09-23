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
    const [error, setError] = useState<string | null>(null)

    function reset() {
        setInstanceUrl('')
        setError(null)
    }

    async function submit() {
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
        await onConnect(channel.id, parsed.origin)
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
                    ? m.provider_reconnect_title({ provider: 'Mastodon' })
                    : m.provider_connect_title({ provider: 'Mastodon' })}
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
                        <DialogDescription>{m.provider_mastodon_description()}</DialogDescription>
                    </DialogHeader>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={`mastodon-instance-${channel.id}`}>
                            {m.provider_instance()}
                        </FieldLabel>
                        <Input
                            id={`mastodon-instance-${channel.id}`}
                            autoFocus
                            autoComplete="url"
                            inputMode="url"
                            value={instanceUrl}
                            onChange={event => setInstanceUrl(event.target.value)}
                            placeholder={m.provider_instance_placeholder()}
                            aria-describedby={`mastodon-instance-help-${channel.id}`}
                        />
                        <FieldDescription id={`mastodon-instance-help-${channel.id}`}>
                            {m.provider_mastodon_help()}
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
                            {m.common_cancel()}
                        </Button>
                        <Button type="button" onClick={() => void submit()} disabled={disabled}>
                            <LinkIcon aria-hidden="true" />
                            {m.provider_continue_mastodon()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
