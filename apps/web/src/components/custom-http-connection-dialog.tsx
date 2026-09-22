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
import { AddIcon } from '@solar-icons/react/linear/add'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useState } from 'react'

import type { Channel, CustomHttpAuthentication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

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
    readonly reconnect?: boolean
}

export function CustomHttpConnectionDialog({
    channel,
    disabled,
    onConnect,
    reconnect = false,
}: CustomHttpConnectionDialogProps) {
    useLanguage()
    const [open, setOpen] = useState(false)
    const [endpointUrl, setEndpointUrl] = useState('')
    const [authenticationKind, setAuthenticationKind] = useState<
        'none' | 'bearer' | 'header' | 'path'
    >('none')
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
            setError(m.provider_endpoint_required())
            return
        }
        if (secret.length < 32) {
            setError(m.provider_secret_min_length())
            return
        }
        if (authenticationKind === 'header' && headerName.trim() === '') {
            setError(m.provider_header_auth_required())
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
            <Button
                className="self-end sm:self-start"
                size="sm"
                onClick={() => setOpen(true)}
                disabled={disabled}>
                <AddIcon aria-hidden="true" />
                {reconnect
                    ? m.provider_reconnect_title({ provider: 'custom HTTP' })
                    : m.provider_connect_http()}
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
                        <DialogDescription>
                            {m.provider_http_connect_description()}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4">
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`custom-http-endpoint-${channel.id}`}>
                                {m.provider_endpoint_url()}
                            </FieldLabel>
                            <Input
                                id={`custom-http-endpoint-${channel.id}`}
                                type="url"
                                value={endpointUrl}
                                onChange={event => setEndpointUrl(event.target.value)}
                                placeholder={m.provider_endpoint_placeholder()}
                            />
                        </Field>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`custom-http-auth-${channel.id}`}>
                                {m.provider_authentication()}
                            </FieldLabel>
                            <Select
                                value={authenticationKind}
                                onValueChange={value =>
                                    setAuthenticationKind(
                                        value as 'none' | 'bearer' | 'header' | 'path'
                                    )
                                }>
                                <SelectTrigger id={`custom-http-auth-${channel.id}`}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="start">
                                    <SelectItem value="none">
                                        {m.provider_no_authentication()}
                                    </SelectItem>
                                    <SelectItem value="bearer">
                                        {m.provider_bearer_token()}
                                    </SelectItem>
                                    <SelectItem value="header">
                                        {m.provider_custom_header()}
                                    </SelectItem>
                                    <SelectItem value="path">
                                        {m.provider_path_authentication()}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>
                        {authenticationKind === 'header' ? (
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor={`custom-http-header-${channel.id}`}>
                                    {m.provider_header_name()}
                                </FieldLabel>
                                <Input
                                    id={`custom-http-header-${channel.id}`}
                                    value={headerName}
                                    onChange={event => setHeaderName(event.target.value)}
                                    placeholder={m.provider_header_name_placeholder()}
                                />
                            </Field>
                        ) : null}
                        {authenticationKind === 'path' ? (
                            <FieldDescription>{m.provider_path_auth_help()}</FieldDescription>
                        ) : null}
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`custom-http-account-${channel.id}`}>
                                {m.provider_external_account_name()}
                            </FieldLabel>
                            <Input
                                id={`custom-http-account-${channel.id}`}
                                value={externalAccountName}
                                onChange={event => setExternalAccountName(event.target.value)}
                                placeholder={m.provider_external_account_placeholder()}
                            />
                        </Field>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor={`custom-http-secret-${channel.id}`}>
                                {m.provider_connection_secret()}
                            </FieldLabel>
                            <Input
                                id={`custom-http-secret-${channel.id}`}
                                type="password"
                                value={secret}
                                onChange={event => setSecret(event.target.value)}
                            />
                            <FieldDescription>{m.provider_http_secret_help()}</FieldDescription>
                        </Field>
                        {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
                                ? m.provider_reconnect_title({ provider: 'custom HTTP' })
                                : m.provider_connect_endpoint()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
