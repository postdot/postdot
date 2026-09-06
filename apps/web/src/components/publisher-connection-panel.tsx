import { Button } from '@herald/ui/components/button'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { Input } from '@herald/ui/components/input'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { useState } from 'react'

import { BlueskyConnectionDialog } from '@/components/bluesky-connection-dialog'
import { CustomHttpConnectionDialog } from '@/components/custom-http-connection-dialog'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { DiscordConnectionDialog } from '@/components/discord-connection-dialog'
import { MastodonConnectionDialog } from '@/components/mastodon-connection-dialog'
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
    readonly onStartMastodonConnection: (channelId: string, instanceUrl: string) => Promise<void>
    readonly onConnectDiscordPublisher: (
        channelId: string,
        input: { botToken: string; channelId: string }
    ) => Promise<boolean>
    readonly onDisconnectPublisher: (channelId: string) => Promise<void>
}

export function PublisherConnectionPanel({
    channels,
    connections,
    pending,
    onConnectCustomHttpPublisher,
    onStartLinkedInConnection,
    onStartBlueskyConnection,
    onStartMastodonConnection,
    onConnectDiscordPublisher,
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
                                                  : channel.profileId === 'mastodon'
                                                    ? 'Connect a Mastodon account to enable automatic publishing.'
                                                    : channel.profileId === 'discord'
                                                      ? 'Connect a Discord bot to enable automatic publishing.'
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
                                                  : connection.providerId === 'mastodon'
                                                    ? `Mastodon account · ${connection.destination?.name ?? connection.externalAccountName ?? connection.externalAccountId}`
                                                    : connection.providerId === 'discord'
                                                      ? `Discord channel · ${connection.destination?.name ?? connection.destination?.id ?? connection.externalAccountId}`
                                                      : connection.destination?.type ===
                                                          'organization'
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
                                ) : channel.profileId === 'mastodon' && connection === undefined ? (
                                    <MastodonConnectionDialog
                                        channel={channel}
                                        disabled={pending}
                                        onConnect={onStartMastodonConnection}
                                    />
                                ) : channel.profileId === 'discord' && connection === undefined ? (
                                    <DiscordConnectionDialog
                                        channel={channel}
                                        disabled={pending}
                                        onConnect={onConnectDiscordPublisher}
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
                                  channel.profileId !== 'mastodon' &&
                                  channel.profileId !== 'discord' &&
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
