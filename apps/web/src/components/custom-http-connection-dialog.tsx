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
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useState } from 'react'

import type { Channel, CustomHttpAuthentication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { useConnectionAction } from '@/lib/use-connection-action'
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
    const { submitting, error, setError, run } = useConnectionAction()

    function reset() {
        setEndpointUrl('')
        setAuthenticationKind('none')
        setHeaderName('')
        setExternalAccountName('')
        setSecret('')
        setError(null)
    }

    async function submit() {
        if (disabled || submitting) return
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
        const connected = await run(() =>
            onConnect(channel.id, {
                endpointUrl: endpointUrl.trim(),
                authentication,
                externalAccountName: externalAccountName.trim() || null,
                secret,
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
                    ? m.provider_reconnect_title({ provider: 'custom HTTP' })
                    : m.provider_connect_http()}
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
                                {m.provider_http_connect_description()}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4">
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor={`custom-http-endpoint-${channel.id}`}>
                                    {m.provider_endpoint_url()}
                                </FieldLabel>
                                <Input
                                    disabled={disabled || submitting}
                                    id={`custom-http-endpoint-${channel.id}`}
                                    type="url"
                                    value={endpointUrl}
                                    onChange={event => {
                                        setEndpointUrl(event.target.value)
                                        setError(null)
                                    }}
                                    placeholder={m.provider_endpoint_placeholder()}
                                />
                            </Field>
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor={`custom-http-auth-${channel.id}`}>
                                    {m.provider_authentication()}
                                </FieldLabel>
                                <Select
                                    value={authenticationKind}
                                    onValueChange={value => {
                                        setError(null)
                                        setAuthenticationKind(
                                            value as 'none' | 'bearer' | 'header' | 'path'
                                        )
                                    }}>
                                    <SelectTrigger
                                        disabled={disabled || submitting}
                                        id={`custom-http-auth-${channel.id}`}>
                                        <SelectValue>
                                            {
                                                {
                                                    none: m.provider_no_authentication(),
                                                    bearer: m.provider_bearer_token(),
                                                    header: m.provider_custom_header(),
                                                    path: m.provider_path_authentication(),
                                                }[authenticationKind]
                                            }
                                        </SelectValue>
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
                                        disabled={disabled || submitting}
                                        id={`custom-http-header-${channel.id}`}
                                        value={headerName}
                                        onChange={event => {
                                            setHeaderName(event.target.value)
                                            setError(null)
                                        }}
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
                                    disabled={disabled || submitting}
                                    id={`custom-http-account-${channel.id}`}
                                    value={externalAccountName}
                                    onChange={event => {
                                        setExternalAccountName(event.target.value)
                                        setError(null)
                                    }}
                                    placeholder={m.provider_external_account_placeholder()}
                                />
                            </Field>
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor={`custom-http-secret-${channel.id}`}>
                                    {m.provider_connection_secret()}
                                </FieldLabel>
                                <Input
                                    disabled={disabled || submitting}
                                    id={`custom-http-secret-${channel.id}`}
                                    type="password"
                                    value={secret}
                                    onChange={event => {
                                        setSecret(event.target.value)
                                        setError(null)
                                    }}
                                />
                                <FieldDescription>{m.provider_http_secret_help()}</FieldDescription>
                            </Field>
                            {error ? (
                                <p role="alert" className="text-sm text-destructive">
                                    {error}
                                </p>
                            ) : null}
                        </div>
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
                                    ? m.provider_reconnect_title({ provider: 'custom HTTP' })
                                    : m.provider_connect_endpoint()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
