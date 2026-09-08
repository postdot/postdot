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

import { ProviderApplicationSelect } from '@/components/provider-application-select'
import type { Channel, ProviderApplication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface BlueskyConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (
        channelId: string,
        handle: string,
        providerApplicationId?: string
    ) => Promise<void>
    readonly onProviderApplicationChange: (providerApplicationId: string) => void
    readonly providerApplicationId?: string
    readonly providerApplications: readonly ProviderApplication[]
}

export function BlueskyConnectionDialog({
    channel,
    disabled,
    onConnect,
    onProviderApplicationChange,
    providerApplicationId,
    providerApplications,
}: BlueskyConnectionDialogProps) {
    useLanguage()
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
            setError(m.provider_handle_required())
            return
        }

        setError(null)
        await onConnect(channel.id, normalizedHandle, providerApplicationId)
    }

    return (
        <>
            <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
                <AddIcon aria-hidden="true" />
                {m.provider_connect_title({ provider: 'Bluesky' })}
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {m.provider_connect_title({ provider: channel.name })}
                        </DialogTitle>
                        <DialogDescription>{m.provider_bluesky_description()}</DialogDescription>
                    </DialogHeader>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={`bluesky-handle-${channel.id}`}>
                            {m.provider_handle()}
                        </FieldLabel>
                        <Input
                            id={`bluesky-handle-${channel.id}`}
                            autoFocus
                            autoComplete="username"
                            value={handle}
                            onChange={event => setHandle(event.target.value)}
                            placeholder={m.provider_handle_placeholder()}
                            aria-describedby={`bluesky-handle-help-${channel.id}`}
                        />
                        <FieldDescription id={`bluesky-handle-help-${channel.id}`}>
                            {m.provider_bluesky_help()}
                        </FieldDescription>
                    </Field>
                    <ProviderApplicationSelect
                        applications={providerApplications}
                        disabled={disabled}
                        id={`bluesky-application-${channel.id}`}
                        onValueChange={onProviderApplicationChange}
                        value={providerApplicationId ?? ''}
                    />
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
                            {m.provider_continue()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
