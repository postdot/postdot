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
import { useEffect, useState } from 'react'

import { BlueskyConnectionDialog } from '@/components/bluesky-connection-dialog'
import { CustomHttpConnectionDialog } from '@/components/custom-http-connection-dialog'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { DevtoConnectionDialog } from '@/components/devto-connection-dialog'
import { DiscordConnectionDialog } from '@/components/discord-connection-dialog'
import { ChannelAvatar } from '@/components/identity-visuals'
import { MastodonConnectionDialog } from '@/components/mastodon-connection-dialog'
import { ProviderApplicationSelect } from '@/components/provider-application-select'
import type {
    Channel,
    CustomHttpAuthentication,
    LinkedInConnectionDestination,
    ProviderApplication,
    ProviderApplicationProvider,
    PublisherConnection,
} from '@/lib/api'
import { api } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

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
        destination?: LinkedInConnectionDestination,
        providerApplicationId?: string
    ) => Promise<void>
    readonly onStartBlueskyConnection: (
        channelId: string,
        handle: string,
        providerApplicationId?: string
    ) => Promise<void>
    readonly onStartMastodonConnection: (channelId: string, instanceUrl: string) => Promise<void>
    readonly onConnectDiscordPublisher: (
        channelId: string,
        input: { botToken: string; channelId: string }
    ) => Promise<boolean>
    readonly onConnectDevtoPublisher: (channelId: string, apiKey: string) => Promise<boolean>
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
    onConnectDevtoPublisher,
    onDisconnectPublisher,
}: PublisherConnectionPanelProps) {
    useLanguage()
    const [organizationIds, setOrganizationIds] = useState<Record<string, string>>({})
    const [providerApplications, setProviderApplications] = useState<ProviderApplication[]>([])
    const [selectedProviderApplications, setSelectedProviderApplications] = useState<
        Partial<Record<ProviderApplicationProvider, string>>
    >({})

    useEffect(() => {
        let cancelled = false

        void api
            .listProviderApplications()
            .then(response => {
                if (cancelled) return
                setProviderApplications(
                    response.applications.filter(application => application.state === 'active')
                )
            })
            .catch(() => {
                if (!cancelled) setProviderApplications([])
            })

        return () => {
            cancelled = true
        }
    }, [])

    function applicationsFor(provider: ProviderApplicationProvider) {
        return providerApplications.filter(application => application.providerId === provider)
    }

    function selectedApplicationId(provider: ProviderApplicationProvider): string | undefined {
        const applications = applicationsFor(provider)
        if (applications.length < 2) return undefined

        const selected = selectedProviderApplications[provider]
        if (
            selected !== undefined &&
            applications.some(application => application.id === selected)
        ) {
            return selected
        }

        return applications.find(application => application.isDefault)?.id ?? applications[0]?.id
    }

    function selectApplication(provider: ProviderApplicationProvider, applicationId: string) {
        setSelectedProviderApplications(current => ({ ...current, [provider]: applicationId }))
    }

    const linkedInApplications = applicationsFor('linkedin')
    const linkedInApplicationId = selectedApplicationId('linkedin')
    const blueskyApplications = applicationsFor('bluesky')
    const blueskyApplicationId = selectedApplicationId('bluesky')
    const connectionsByChannel = new Map(
        connections.map(connection => [connection.channelId, connection])
    )

    return (
        <section id="publisher-connections" className="pt-1">
            <DashboardSectionHeading
                description={m.publisher_connections_description()}
                meta={m.common_connection_count({ count: connections.length })}
                title={m.publisher_connections_title()}
            />

            <div className="mt-4 overflow-hidden rounded-md bg-surface-raised shadow-surface">
                {channels.length === 0 ? (
                    <Empty className="min-h-32 bg-muted">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <LinkIcon aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyTitle>{m.publisher_no_connections()}</EmptyTitle>
                            <EmptyDescription>
                                {m.publisher_no_connections_description()}
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
                                        <ChannelAvatar channel={channel} size="md" />
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
                                            {m.publisher_archived_restore()}
                                        </p>
                                    ) : connection === undefined ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {channel.profileId === 'manual-message'
                                                ? m.publisher_manual_only()
                                                : channel.profileId === 'bluesky'
                                                  ? m.publisher_connect_account({
                                                        provider: 'Bluesky',
                                                    })
                                                  : channel.profileId === 'mastodon'
                                                    ? m.publisher_connect_account({
                                                          provider: 'Mastodon',
                                                      })
                                                    : channel.profileId === 'discord'
                                                      ? m.publisher_connect_bot({
                                                            provider: 'Discord',
                                                        })
                                                      : channel.profileId === 'devto'
                                                        ? m.publisher_connect_api_key({
                                                              provider: 'DEV.to',
                                                          })
                                                        : channel.profileId === 'linkedin'
                                                          ? m.publisher_no_automatic()
                                                          : m.publisher_custom_profile()}
                                        </p>
                                    ) : (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {connection.kind === 'custom_http'
                                                ? m.publisher_custom_http_connected()
                                                : connection.providerId === 'bluesky'
                                                  ? m.publisher_account({
                                                        provider: 'Bluesky',
                                                        account:
                                                            connection.destination?.name ??
                                                            connection.externalAccountName ??
                                                            connection.externalAccountId,
                                                    })
                                                  : connection.providerId === 'mastodon'
                                                    ? m.publisher_account({
                                                          provider: 'Mastodon',
                                                          account:
                                                              connection.destination?.name ??
                                                              connection.externalAccountName ??
                                                              connection.externalAccountId,
                                                      })
                                                    : connection.providerId === 'discord'
                                                      ? m.publisher_channel({
                                                            provider: 'Discord',
                                                            account:
                                                                connection.destination?.name ??
                                                                connection.destination?.id ??
                                                                connection.externalAccountId,
                                                        })
                                                      : connection.providerId === 'devto'
                                                        ? m.publisher_account({
                                                              provider: 'DEV.to',
                                                              account:
                                                                  connection.destination?.name ??
                                                                  connection.externalAccountName ??
                                                                  connection.externalAccountId,
                                                          })
                                                        : connection.destination?.type ===
                                                            'organization'
                                                          ? m.publisher_page({
                                                                account:
                                                                    connection.destination.name ??
                                                                    connection.destination.id,
                                                            })
                                                          : m.publisher_member({
                                                                account:
                                                                    connection.externalAccountName ??
                                                                    connection.externalAccountId,
                                                            })}
                                        </p>
                                    )}
                                    {connection !== undefined &&
                                    connection.kind === 'custom_http' ? (
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {connection.endpointUrl ??
                                                m.publisher_custom_endpoint()}
                                            {connection.authentication?.kind === 'header'
                                                ? ` · ${connection.authentication.headerName}`
                                                : connection.authentication?.kind === 'bearer'
                                                  ? ` · ${m.publisher_bearer_auth()}`
                                                  : connection.authentication?.kind === 'path'
                                                    ? ` · ${m.publisher_path_auth()}`
                                                    : ''}
                                        </p>
                                    ) : null}
                                    {connection !== undefined && connection.state !== 'active' ? (
                                        <p className="mt-1 text-sm text-destructive">
                                            {m.publisher_reconnection_required()}
                                        </p>
                                    ) : null}
                                </div>

                                {channel.state === 'archived' ? null : channel.profileId ===
                                      'linkedin' && connection === undefined ? (
                                    <div className="mt-4 grid gap-4 sm:mt-0 sm:min-w-80">
                                        <ProviderApplicationSelect
                                            applications={linkedInApplications}
                                            disabled={pending}
                                            id={`linkedin-application-${channel.id}`}
                                            onValueChange={applicationId =>
                                                selectApplication('linkedin', applicationId)
                                            }
                                            value={linkedInApplicationId ?? ''}
                                        />
                                        <Button
                                            size="sm"
                                            onClick={() =>
                                                void onStartLinkedInConnection(
                                                    channel.id,
                                                    undefined,
                                                    linkedInApplicationId
                                                )
                                            }
                                            disabled={pending}>
                                            <AddIcon aria-hidden="true" />
                                            {m.provider_connect_title({ provider: 'LinkedIn' })}
                                        </Button>
                                        <form
                                            className="grid gap-2"
                                            onSubmit={event => {
                                                event.preventDefault()
                                                const id = organizationIds[channel.id]?.trim()
                                                if (id === undefined || id.length === 0) return
                                                void onStartLinkedInConnection(
                                                    channel.id,
                                                    {
                                                        type: 'organization',
                                                        id,
                                                    },
                                                    linkedInApplicationId
                                                )
                                            }}>
                                            <label
                                                className="text-xs text-muted-foreground"
                                                htmlFor={`linkedin-organization-${channel.id}`}>
                                                {m.publisher_connect_page()}
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    id={`linkedin-organization-${channel.id}`}
                                                    inputMode="numeric"
                                                    pattern="[0-9]+"
                                                    placeholder={m.publisher_organization_id()}
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
                                                    {m.publisher_connect_page_button()}
                                                </Button>
                                            </div>
                                            <p
                                                id={`linkedin-organization-help-${channel.id}`}
                                                className="text-xs text-muted-foreground">
                                                {m.publisher_page_checked()}
                                            </p>
                                        </form>
                                    </div>
                                ) : channel.profileId === 'bluesky' && connection === undefined ? (
                                    <BlueskyConnectionDialog
                                        channel={channel}
                                        disabled={pending}
                                        onConnect={onStartBlueskyConnection}
                                        onProviderApplicationChange={applicationId =>
                                            selectApplication('bluesky', applicationId)
                                        }
                                        providerApplicationId={blueskyApplicationId}
                                        providerApplications={blueskyApplications}
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
                                ) : channel.profileId === 'devto' && connection === undefined ? (
                                    <DevtoConnectionDialog
                                        channel={channel}
                                        disabled={pending}
                                        onConnect={onConnectDevtoPublisher}
                                    />
                                ) : channel.profileId === 'linkedin' && connection !== undefined ? (
                                    <Button
                                        className="mt-4 sm:mt-0"
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => void onDisconnectPublisher(channel.id)}
                                        disabled={pending}>
                                        {m.publisher_disconnect()}
                                    </Button>
                                ) : channel.profileId !== 'manual-message' &&
                                  channel.profileId !== 'linkedin' &&
                                  channel.profileId !== 'bluesky' &&
                                  channel.profileId !== 'mastodon' &&
                                  channel.profileId !== 'discord' &&
                                  channel.profileId !== 'devto' &&
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
                                        {m.publisher_disconnect()}
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
