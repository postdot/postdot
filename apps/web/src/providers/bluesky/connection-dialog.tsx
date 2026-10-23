import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useState } from 'react'

import { ProviderApplicationSelect } from '@/components/provider-application-select'
import { type Channel, type ProviderApplication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { useConnectionAction } from '@/lib/use-connection-action'
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
    readonly reconnect?: boolean
}

export function BlueskyConnectionDialog({
    channel,
    disabled,
    onConnect,
    onProviderApplicationChange,
    providerApplicationId,
    providerApplications,
    reconnect = false,
}: BlueskyConnectionDialogProps) {
    useLanguage()
    const [open, setOpen] = useState(false)
    const [handle, setHandle] = useState('')
    const { submitting, error, setError, run } = useConnectionAction()

    function reset() {
        setHandle('')
        setError(null)
    }

    async function submit() {
        if (disabled || submitting) return
        const normalizedHandle = handle.trim().replace(/^@+/, '')
        if (normalizedHandle === '') {
            setError(m.provider_handle_required())
            return
        }

        await run(() => onConnect(channel.id, normalizedHandle, providerApplicationId))
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
                    ? m.provider_reconnect_title({ provider: 'Bluesky' })
                    : m.provider_connect_title({ provider: 'Bluesky' })}
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
                                {m.provider_bluesky_description()}
                            </DialogDescription>
                        </DialogHeader>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`bluesky-handle-${channel.id}`}>
                                {m.provider_handle()}
                            </FieldLabel>
                            <Input
                                disabled={disabled || submitting}
                                id={`bluesky-handle-${channel.id}`}
                                autoFocus
                                autoComplete="username"
                                value={handle}
                                onChange={event => {
                                    setHandle(event.target.value)
                                    setError(null)
                                }}
                                placeholder={m.provider_handle_placeholder()}
                                aria-invalid={error !== null}
                            />
                        </Field>
                        <ProviderApplicationSelect
                            applications={providerApplications}
                            disabled={disabled || submitting}
                            id={`bluesky-application-${channel.id}`}
                            onValueChange={onProviderApplicationChange}
                            value={providerApplicationId ?? ''}
                        />
                        {error ? (
                            <p role="alert" className="text-sm text-destructive">
                                {error}
                            </p>
                        ) : null}
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
                                {m.provider_continue()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
