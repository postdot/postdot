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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, formatApiError, type Channel, type CustomHttpAuthentication } from '@/lib/api'
import { customHttpAuthenticationKinds } from '@/lib/custom-http-authentication'
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

    const profile = useQuery({
        queryKey: ['project', channel.projectId, 'http-connection-profile', channel.id],
        queryFn: () => api.getChannelProfileState(channel.projectId, channel.id),
        enabled: open,
        staleTime: 0,
        retry: false,
    })
    const authenticationKinds = customHttpAuthenticationKinds(
        profile.data?.active.profile.execution
    )
    const selectedAuthentication = authenticationKinds.includes(authenticationKind)
        ? authenticationKind
        : authenticationKinds[0]
    const profileReady =
        !profile.isFetching && !profile.isError && selectedAuthentication !== undefined

    function reset() {
        setEndpointUrl('')
        setAuthenticationKind('none')
        setHeaderName('')
        setExternalAccountName('')
        setSecret('')
        setError(null)
    }

    async function submit() {
        if (disabled || submitting || !profileReady || selectedAuthentication === undefined) return
        if (endpointUrl.trim() === '') {
            setError(m.provider_endpoint_required())
            return
        }
        if (secret.length < 32) {
            setError(m.provider_secret_min_length())
            return
        }
        if (selectedAuthentication === 'header' && headerName.trim() === '') {
            setError(m.provider_header_auth_required())
            return
        }

        const authentication: CustomHttpAuthentication =
            selectedAuthentication === 'header'
                ? { kind: 'header', headerName: headerName.trim() }
                : { kind: selectedAuthentication }
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
                <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-sm flex min-h-0 flex-col overflow-hidden bg-background sm:max-w-sm">
                    <form
                        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden"
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
                        <div
                            data-channel-dialog-body
                            className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain pr-1">
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor={`custom-http-endpoint-${channel.id}`}>
                                    {m.provider_endpoint_url()}
                                </FieldLabel>
                                <Input
                                    disabled={disabled || submitting}
                                    id={`custom-http-endpoint-${channel.id}`}
                                    type="url"
                                    required
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
                                    value={selectedAuthentication ?? null}
                                    onValueChange={value => {
                                        setError(null)
                                        setAuthenticationKind(
                                            value as 'none' | 'bearer' | 'header' | 'path'
                                        )
                                    }}>
                                    <SelectTrigger
                                        disabled={disabled || submitting || !profileReady}
                                        id={`custom-http-auth-${channel.id}`}>
                                        <SelectValue>
                                            {
                                                {
                                                    none: m.provider_no_authentication(),
                                                    bearer: m.provider_bearer_token(),
                                                    header: m.provider_custom_header(),
                                                    path: m.provider_path_authentication(),
                                                }[selectedAuthentication ?? 'none']
                                            }
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent align="start">
                                        {authenticationKinds.map(kind => (
                                            <SelectItem key={kind} value={kind}>
                                                {
                                                    {
                                                        none: m.provider_no_authentication(),
                                                        bearer: m.provider_bearer_token(),
                                                        header: m.provider_custom_header(),
                                                        path: m.provider_path_authentication(),
                                                    }[kind]
                                                }
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            {selectedAuthentication === 'header' ? (
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
                            {selectedAuthentication === 'path' ? (
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
                                    autoComplete="new-password"
                                    minLength={32}
                                    required
                                    value={secret}
                                    onChange={event => {
                                        setSecret(event.target.value)
                                        setError(null)
                                    }}
                                />
                                <FieldDescription>{m.provider_http_secret_help()}</FieldDescription>
                            </Field>
                            {profile.isPending ? (
                                <p role="status" className="text-sm text-muted-foreground">
                                    {m.common_loading()}
                                </p>
                            ) : null}
                            {!profile.isPending &&
                            !profile.isError &&
                            authenticationKinds.length === 0 ? (
                                <p role="alert" className="text-sm text-destructive">
                                    {m.profile_definition_invalid()}
                                </p>
                            ) : null}
                            {profile.isError ? (
                                <div role="alert" className="grid gap-2 text-sm text-destructive">
                                    <p>{formatApiError(profile.error)}</p>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void profile.refetch()}>
                                        {m.common_retry()}
                                    </Button>
                                </div>
                            ) : null}
                            {error ? (
                                <p role="alert" className="text-sm text-destructive">
                                    {error}
                                </p>
                            ) : null}
                        </div>
                        <DialogFooter className="mx-0 mb-0 bg-transparent px-0 pb-0">
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
                            <Button
                                type="submit"
                                disabled={disabled || submitting || !profileReady}>
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
