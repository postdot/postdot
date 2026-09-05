import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
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
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { useState } from 'react'

import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import type {
    Channel,
    CustomHttpAuthentication,
    LinkedInConnectionDestination,
    PublisherConnection,
} from '@/lib/api'

interface PublisherConnectionPanelProps {
    readonly channels: readonly Channel[]
    readonly connections: readonly PublisherConnection[]
    readonly pending: boolean
    readonly onConnectCustomHttpPublisher: (
        channelId: string,
        input: {
            endpointUrl: string
            authentication: CustomHttpAuthentication
            externalAccountName?: string | null
            secret: string
        }
    ) => Promise<boolean>
    readonly onStartLinkedInConnection: (
        channelId: string,
        destination?: LinkedInConnectionDestination
    ) => Promise<void>
    readonly onStartBlueskyConnection: (channelId: string, handle: string) => Promise<void>
    readonly onDisconnectPublisher: (channelId: string) => Promise<void>
}

export function PublisherConnectionPanel({
    channels,
    connections,
    pending,
    onConnectCustomHttpPublisher,
    onStartLinkedInConnection,
    onStartBlueskyConnection,
    onDisconnectPublisher,
}: PublisherConnectionPanelProps) {
    const [organizationIds, setOrganizationIds] = useState<Record<string, string>>({})
    const connectionsByChannel = new Map(
        connections.map(connection => [connection.channelId, connection])
    )

    return (
        <section id="publisher-connections" className="pt-1">
            <DashboardSectionHeading
                description="Automatic delivery requires a connection on supported channels."
                meta={`${connections.length} connected`}
                title="Publisher connections"
            />

            <div className="mt-4 overflow-hidden rounded-md bg-surface-raised shadow-surface">
                {channels.length === 0 ? (
                    <Empty className="min-h-32 bg-muted">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <LinkIcon aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyTitle>No publisher connections</EmptyTitle>
                            <EmptyDescription>
                                Create a channel before configuring an automatic destination.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    channels.map(channel => {
                        const connection = connectionsByChannel.get(channel.id)

                        return (
                            <article
                                key={channel.id}
                                className="flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        {connection === undefined ? (
                                            <AddIcon aria-hidden="true" className="text-primary" />
                                        ) : (
                                            <CheckReadIcon
                                                aria-hidden="true"
                                                className="text-state-published"
                                            />
                                        )}
                                        <span>{channel.name}</span>
                                    </div>
                                    {channel.state === 'archived' ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            Archived — restore this channel before managing
                                            delivery.
                                        </p>
                                    ) : connection === undefined ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {channel.profileId === 'manual-message'
                                                ? 'Manual publication only for this channel profile.'
                                                : channel.profileId === 'bluesky'
                                                  ? 'Connect a Bluesky account to enable automatic publishing.'
                                                  : channel.profileId === 'linkedin'
                                                    ? 'No automatic publisher is connected.'
                                                    : 'This custom profile can be connected to a declarative HTTP endpoint.'}
                                        </p>
                                    ) : (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {connection.kind === 'custom_http'
                                                ? 'Custom HTTP publisher connected.'
                                                : connection.providerId === 'bluesky'
                                                  ? `Bluesky account · ${connection.destination?.name ?? connection.externalAccountName ?? connection.externalAccountId}`
                                                  : connection.destination?.type === 'organization'
                                                    ? `LinkedIn page · ${connection.destination.name ?? connection.destination.id}`
                                                    : `LinkedIn member · ${connection.externalAccountName ?? connection.externalAccountId}`}
                                        </p>
                                    )}
                                    {connection !== undefined &&
                                    connection.kind === 'custom_http' ? (
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {connection.endpointUrl ?? 'Custom HTTP endpoint'}
                                            {connection.authentication?.kind === 'header'
                                                ? ` · ${connection.authentication.headerName}`
                                                : connection.authentication?.kind === 'bearer'
                                                  ? ' · bearer authentication'
                                                  : ''}
                                        </p>
                                    ) : null}
                                    {connection !== undefined && connection.state !== 'active' ? (
                                        <p className="mt-1 text-sm text-destructive">
                                            Reconnection required before automatic publishing can
                                            resume.
                                        </p>
                                    ) : null}
                                </div>

                                {channel.state === 'archived' ? null : channel.profileId ===
                                      'linkedin' && connection === undefined ? (
                                    <div className="mt-4 grid gap-4 sm:mt-0 sm:min-w-80">
                                        <Button
                                            size="sm"
                                            onClick={() =>
                                                void onStartLinkedInConnection(channel.id)
                                            }
                                            disabled={pending}>
                                            <AddIcon aria-hidden="true" />
                                            Connect LinkedIn
                                        </Button>
                                        <form
                                            className="grid gap-2"
                                            onSubmit={event => {
                                                event.preventDefault()
                                                const id = organizationIds[channel.id]?.trim()
                                                if (id === undefined || id.length === 0) return
                                                void onStartLinkedInConnection(channel.id, {
                                                    type: 'organization',
                                                    id,
                                                })
                                            }}>
                                            <label
                                                className="text-xs text-muted-foreground"
                                                htmlFor={`linkedin-organization-${channel.id}`}>
                                                Connect a LinkedIn page
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    id={`linkedin-organization-${channel.id}`}
                                                    inputMode="numeric"
                                                    pattern="[0-9]+"
                                                    placeholder="Organization ID"
                                                    value={organizationIds[channel.id] ?? ''}
                                                    onChange={event =>
                                                        setOrganizationIds(current => ({
                                                            ...current,
                                                            [channel.id]: event.target.value,
                                                        }))
                                                    }
                                                    aria-describedby={`linkedin-organization-help-${channel.id}`}
                                                />
                                                <Button
                                                    type="submit"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={pending}>
                                                    Connect page
                                                </Button>
                                            </div>
                                            <p
                                                id={`linkedin-organization-help-${channel.id}`}
                                                className="text-xs text-muted-foreground">
                                                The page is checked before the connection is saved.
                                            </p>
                                        </form>
                                    </div>
                                ) : channel.profileId === 'bluesky' && connection === undefined ? (
                                    <BlueskyConnectionDialog
                                        channel={channel}
                                        disabled={pending}
                                        onConnect={onStartBlueskyConnection}
                                    />
                                ) : channel.profileId === 'linkedin' && connection !== undefined ? (
                                    <Button
                                        className="mt-4 sm:mt-0"
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => void onDisconnectPublisher(channel.id)}
                                        disabled={pending}>
                                        Disconnect publisher
                                    </Button>
                                ) : channel.profileId !== 'manual-message' &&
                                  channel.profileId !== 'linkedin' &&
                                  channel.profileId !== 'bluesky' &&
                                  connection === undefined ? (
                                    <CustomHttpConnectionDialog
                                        channel={channel}
                                        disabled={pending}
                                        onConnect={onConnectCustomHttpPublisher}
                                    />
                                ) : connection !== undefined ? (
                                    <Button
                                        className="mt-4 sm:mt-0"
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => void onDisconnectPublisher(channel.id)}
                                        disabled={pending}>
                                        Disconnect publisher
                                    </Button>
                                ) : null}
                            </article>
                        )
                    })
                )}
            </div>
        </section>
    )
}

function BlueskyConnectionDialog({
    channel,
    disabled,
    onConnect,
}: {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (channelId: string, handle: string) => Promise<void>
}) {
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
            setError('Enter a Bluesky handle.')
            return
        }

        setError(null)
        await onConnect(channel.id, normalizedHandle)
    }

    return (
        <>
            <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
                <AddIcon aria-hidden="true" />
                Connect Bluesky
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
                            Enter the Bluesky handle that owns this account. Herald will open
                            Bluesky&apos;s authorization page; no app password is required.
                        </DialogDescription>
                    </DialogHeader>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={`bluesky-handle-${channel.id}`}>
                            Bluesky handle
                        </FieldLabel>
                        <Input
                            id={`bluesky-handle-${channel.id}`}
                            autoFocus
                            autoComplete="username"
                            value={handle}
                            onChange={event => setHandle(event.target.value)}
                            placeholder="saoudi-h.bsky.social"
                            aria-describedby={`bluesky-handle-help-${channel.id}`}
                        />
                        <FieldDescription id={`bluesky-handle-help-${channel.id}`}>
                            You can enter it with or without the @ prefix. Custom domains are
                            supported.
                        </FieldDescription>
                    </Field>
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
                            Continue to Bluesky
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

function CustomHttpConnectionDialog({
    channel,
    disabled,
    onConnect,
}: {
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
}) {
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
