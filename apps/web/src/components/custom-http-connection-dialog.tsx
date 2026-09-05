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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { AddIcon } from '@solar-icons/react/bold/add'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { useState } from 'react'

import type { Channel, CustomHttpAuthentication } from '@/lib/api'

interface CustomHttpConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (
        channelId: string,
        input: {
            endpointUrl: string
            authentication: CustomHttpAuthentication
            externalAccountName?: string | null
            secret: string
        }
    ) => Promise<boolean>
}

export function CustomHttpConnectionDialog({
    channel,
    disabled,
    onConnect,
}: CustomHttpConnectionDialogProps) {
    const [open, setOpen] = useState(false)
    const [endpointUrl, setEndpointUrl] = useState('')
    const [authenticationKind, setAuthenticationKind] = useState<'none' | 'bearer' | 'header'>(
        'none'
    )
    const [headerName, setHeaderName] = useState('')
    const [externalAccountName, setExternalAccountName] = useState('')
    const [secret, setSecret] = useState('')
    const [error, setError] = useState<string | null>(null)

    function reset() {
        setEndpointUrl('')
        setAuthenticationKind('none')
        setHeaderName('')
        setExternalAccountName('')
        setSecret('')
        setError(null)
    }

    async function submit() {
        if (endpointUrl.trim() === '') {
            setError('Enter the endpoint URL.')
            return
        }
        if (secret.length < 32) {
            setError('The connection secret must contain at least 32 characters.')
            return
        }
        if (authenticationKind === 'header' && headerName.trim() === '') {
            setError('Enter the header name used for authentication.')
            return
        }

        const authentication: CustomHttpAuthentication =
            authenticationKind === 'header'
                ? { kind: 'header', headerName: headerName.trim() }
                : { kind: authenticationKind }
        const connected = await onConnect(channel.id, {
            endpointUrl: endpointUrl.trim(),
            authentication,
            externalAccountName: externalAccountName.trim() || null,
            secret,
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
                Connect HTTP
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
                            Store the endpoint configuration for this custom channel. The secret is
                            used by the server and is never shown again.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4">
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`custom-http-endpoint-${channel.id}`}>
                                Endpoint URL
                            </FieldLabel>
                            <Input
                                id={`custom-http-endpoint-${channel.id}`}
                                type="url"
                                value={endpointUrl}
                                onChange={event => setEndpointUrl(event.target.value)}
                                placeholder="https://example.test/herald"
                            />
                        </Field>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`custom-http-auth-${channel.id}`}>
                                Authentication
                            </FieldLabel>
                            <Select
                                value={authenticationKind}
                                onValueChange={value =>
                                    setAuthenticationKind(value as 'none' | 'bearer' | 'header')
                                }>
                                <SelectTrigger id={`custom-http-auth-${channel.id}`}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="start">
                                    <SelectItem value="none">No authentication</SelectItem>
                                    <SelectItem value="bearer">Bearer token</SelectItem>
                                    <SelectItem value="header">Custom header</SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>
                        {authenticationKind === 'header' ? (
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor={`custom-http-header-${channel.id}`}>
                                    Header name
                                </FieldLabel>
                                <Input
                                    id={`custom-http-header-${channel.id}`}
                                    value={headerName}
                                    onChange={event => setHeaderName(event.target.value)}
                                    placeholder="X-Herald-Secret"
                                />
                            </Field>
                        ) : null}
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`custom-http-account-${channel.id}`}>
                                External account name
                            </FieldLabel>
                            <Input
                                id={`custom-http-account-${channel.id}`}
                                value={externalAccountName}
                                onChange={event => setExternalAccountName(event.target.value)}
                                placeholder="Community forum"
                            />
                        </Field>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`custom-http-secret-${channel.id}`}>
                                Connection secret
                            </FieldLabel>
                            <Input
                                id={`custom-http-secret-${channel.id}`}
                                type="password"
                                value={secret}
                                onChange={event => setSecret(event.target.value)}
                            />
                            <FieldDescription>
                                At least 32 characters. Herald stores only the protected secret.
                            </FieldDescription>
                        </Field>
                        {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
                            Connect endpoint
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
