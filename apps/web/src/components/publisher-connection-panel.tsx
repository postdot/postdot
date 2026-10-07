import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import { Input } from '@herald/ui/components/input'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { BlueskyConnectionDialog } from '@/components/bluesky-connection-dialog'
import type { ChannelLifecycleAction } from '@/components/channel-lifecycle-dialog'
import { ChannelActionsMenu, ChannelRow } from '@/components/channel-row'
import { CustomHttpConnectionDialog } from '@/components/custom-http-connection-dialog'
import { DevtoConnectionDialog } from '@/components/devto-connection-dialog'
import { DiscordConnectionDialog } from '@/components/discord-connection-dialog'
import { ChannelAvatar } from '@/components/identity-visuals'
import { MastodonConnectionDialog } from '@/components/mastodon-connection-dialog'
import { ProviderApplicationSelect } from '@/components/provider-application-select'
import type {
    Channel,
    ChannelListItem,
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
    readonly channels: readonly ChannelListItem[]
    readonly connections: readonly PublisherConnection[]
    readonly pending: boolean
    readonly onEditProfile: (channel: Channel) => void
    readonly onLifecycleAction: (action: ChannelLifecycleAction, channel: Channel) => void
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
    readonly onStartXConnection: (
        channelId: string,
        providerApplicationId?: string
    ) => Promise<void>
    readonly onConnectDiscordPublisher: (
        channelId: string,
        input: { botToken: string; channelId: string }
    ) => Promise<boolean>
    readonly onConnectDevtoPublisher: (channelId: string, apiKey: string) => Promise<boolean>
    readonly onDisconnectPublisher: (channelId: string) => Promise<void>
    readonly isInstanceAdmin?: boolean
    readonly readOnly?: boolean
}

export function PublisherConnectionPanel({
    channels,
    connections,
    pending,
    onEditProfile,
    onLifecycleAction,
    onConnectCustomHttpPublisher,
    onStartLinkedInConnection,
    onStartBlueskyConnection,
    onStartMastodonConnection,
    onStartXConnection,
    onConnectDiscordPublisher,
    onConnectDevtoPublisher,
    onDisconnectPublisher,
    isInstanceAdmin = false,
    readOnly = false,
}: PublisherConnectionPanelProps) {
    useLanguage()
    const [organizationIds, setOrganizationIds] = useState<Record<string, string>>({})
    const [providerApplications, setProviderApplications] = useState<ProviderApplication[]>([])
    const [selectedProviderApplications, setSelectedProviderApplications] = useState<
        Partial<Record<ProviderApplicationProvider, string>>
    >({})
    const connectableChannels = channels.filter(channel => channel.execution.kind !== 'manual')

    const needsProviderApplications =
        !readOnly &&
        isInstanceAdmin &&
        connectableChannels.some(channel => {
            if (
                channel.execution.kind !== 'built_in' ||
                !['linkedin', 'bluesky', 'x'].includes(channel.execution.contractId)
            )
                return false
            const connection = connections.find(item => item.channelId === channel.id)
            return connection === undefined || connection.state !== 'active'
        })

    useEffect(() => {
        if (!needsProviderApplications) {
            setProviderApplications([])
            return
        }

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
    }, [needsProviderApplications])

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
    const xApplications = applicationsFor('x')
    const xApplicationId = selectedApplicationId('x') ?? xApplications[0]?.id
    const connectionsByChannel = new Map(
        connections.map(connection => [connection.channelId, connection])
    )
    if (channels.length === 0) return null

    return (
        <section id="publisher-connections">
            <div className="overflow-hidden rounded-md bg-surface-raised shadow-surface">
                {channels.map(channel => {
                    const connection = connectionsByChannel.get(channel.id)
                    if (channel.execution.kind === 'manual') {
                        return (
                            <ChannelRow
                                key={channel.id}
                                channel={channel}
                                connection={connection}
                                disabled={pending}
                                onEditProfile={() => onEditProfile(channel)}
                                onLifecycleAction={action => onLifecycleAction(action, channel)}
                                readOnly={readOnly}
                            />
                        )
                    }
                    const connectionKind =
                        channel.execution.kind === 'built_in'
                            ? channel.execution.contractId
                            : 'custom_http'
                    const canConnect = connection === undefined || connection.state !== 'active'
                    const connectionLabel =
                        channel.state === 'archived'
                            ? m.channel_archived()
                            : connection === undefined
                              ? m.channel_needs_connection()
                              : connection.state === 'active'
                                ? m.channel_connected()
                                : connection.state === 'revoked'
                                  ? m.publisher_access_revoked()
                                  : m.publisher_reconnect_required_status()
                    const connectionBadgeClass =
                        channel.state === 'archived'
                            ? undefined
                            : connection?.state === 'active'
                              ? 'bg-state-published/10 text-state-published'
                              : 'bg-state-attention/10 text-state-attention'

                    return (
                        <article
                            id={`publisher-connection-${channel.id}`}
                            key={channel.id}
                            className="relative flex min-w-0 scroll-mt-20 flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/35 sm:px-5 lg:flex-row lg:items-start lg:justify-between lg:gap-5 lg:pr-16">
                            <div className="min-w-0 flex-1 pr-9 lg:pr-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
                                    <ChannelAvatar channel={channel} size="md" />
                                    <p className="min-w-0 truncate">{channel.name}</p>
                                    <Badge
                                        className={connectionBadgeClass}
                                        variant={
                                            channel.state === 'archived' ? 'outline' : 'secondary'
                                        }>
                                        {connection?.state === 'active' ? (
                                            <CheckIcon aria-hidden="true" />
                                        ) : null}
                                        {connectionLabel}
                                    </Badge>
                                </div>
                                {channel.state === 'archived' ? (
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        {m.publisher_archived_restore()}
                                    </p>
                                ) : connection === undefined &&
                                  channel.execution.kind === 'declarative_http' ? (
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        {m.publisher_custom_profile()}
                                    </p>
                                ) : connection === undefined &&
                                  channel.execution.kind === 'built_in' &&
                                  ![
                                      'linkedin',
                                      'bluesky',
                                      'mastodon',
                                      'discord',
                                      'devto',
                                      'x',
                                  ].includes(connectionKind) ? (
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        {m.publisher_unsupported_contract()}
                                    </p>
                                ) : connection === undefined ? null : connection.kind !==
                                  'custom_http' ? (
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        {connection.providerId === 'bluesky'
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
                                                  : connection.destination?.type === 'organization'
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
                                ) : null}
                                {connection !== undefined && connection.kind === 'custom_http' ? (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {connection.endpointUrl ?? m.publisher_custom_endpoint()}
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
                                    <p className="mt-1 text-sm text-state-attention">
                                        {connection.state === 'revoked'
                                            ? m.publisher_access_revoked_description()
                                            : m.publisher_reconnection_required()}
                                    </p>
                                ) : null}
                            </div>

                            {readOnly || channel.state === 'archived' ? null : connectionKind ===
                                  'linkedin' && canConnect ? (
                                <div className="grid w-full gap-3 lg:w-80 lg:shrink-0">
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
                                        {connection === undefined
                                            ? m.provider_connect_title({ provider: 'LinkedIn' })
                                            : m.provider_reconnect_title({
                                                  provider: 'LinkedIn',
                                              })}
                                    </Button>
                                    <details className="group">
                                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                                            {m.publisher_connect_page()}
                                        </summary>
                                        <form
                                            className="mt-3 grid gap-2"
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
                                                className="sr-only"
                                                htmlFor={`linkedin-organization-${channel.id}`}>
                                                {m.publisher_connect_page()}
                                            </label>
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                                                    className="w-full sm:w-auto"
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
                                    </details>
                                </div>
                            ) : connectionKind === 'bluesky' && canConnect ? (
                                <BlueskyConnectionDialog
                                    channel={channel}
                                    disabled={pending}
                                    onConnect={onStartBlueskyConnection}
                                    onProviderApplicationChange={applicationId =>
                                        selectApplication('bluesky', applicationId)
                                    }
                                    providerApplicationId={blueskyApplicationId}
                                    providerApplications={blueskyApplications}
                                    reconnect={connection !== undefined}
                                />
                            ) : connectionKind === 'mastodon' && canConnect ? (
                                <MastodonConnectionDialog
                                    channel={channel}
                                    disabled={pending}
                                    onConnect={onStartMastodonConnection}
                                    reconnect={connection !== undefined}
                                />
                            ) : connectionKind === 'x' && canConnect ? (
                                <div className="grid w-full gap-3 lg:w-80 lg:shrink-0">
                                    {isInstanceAdmin ? (
                                        <ProviderApplicationSelect
                                            applications={xApplications}
                                            disabled={pending}
                                            id={`x-application-${channel.id}`}
                                            onValueChange={applicationId =>
                                                selectApplication('x', applicationId)
                                            }
                                            value={xApplicationId ?? ''}
                                        />
                                    ) : null}
                                    <Button
                                        size="sm"
                                        onClick={() =>
                                            void onStartXConnection(channel.id, xApplicationId)
                                        }
                                        disabled={pending}>
                                        <AddIcon aria-hidden="true" />
                                        {connection === undefined
                                            ? m.provider_connect_title({ provider: 'X' })
                                            : m.provider_reconnect_title({ provider: 'X' })}
                                    </Button>
                                    <p className="text-xs text-muted-foreground">
                                        {isInstanceAdmin ? (
                                            <Link
                                                className="text-primary hover:underline"
                                                search={{
                                                    projectId: channel.projectId,
                                                    workspaceId: undefined,
                                                }}
                                                to="/dashboard/settings/provider-applications">
                                                {m.publisher_x_configure_application()}
                                            </Link>
                                        ) : (
                                            m.publisher_x_admin_setup_required()
                                        )}
                                    </p>
                                </div>
                            ) : connectionKind === 'discord' && canConnect ? (
                                <DiscordConnectionDialog
                                    channel={channel}
                                    disabled={pending}
                                    onConnect={onConnectDiscordPublisher}
                                    reconnect={connection !== undefined}
                                />
                            ) : connectionKind === 'devto' && canConnect ? (
                                <DevtoConnectionDialog
                                    channel={channel}
                                    disabled={pending}
                                    onConnect={onConnectDevtoPublisher}
                                    reconnect={connection !== undefined}
                                />
                            ) : connectionKind === 'linkedin' && connection?.state === 'active' ? (
                                <Button
                                    className="self-end text-destructive hover:bg-state-failed/10 hover:text-destructive sm:self-start"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void onDisconnectPublisher(channel.id)}
                                    disabled={pending}>
                                    {m.publisher_disconnect()}
                                </Button>
                            ) : channel.execution.kind === 'declarative_http' && canConnect ? (
                                <CustomHttpConnectionDialog
                                    channel={channel}
                                    disabled={pending}
                                    onConnect={onConnectCustomHttpPublisher}
                                    reconnect={connection !== undefined}
                                />
                            ) : connection?.state === 'active' ? (
                                <Button
                                    className="self-end text-destructive hover:bg-state-failed/10 hover:text-destructive sm:self-start"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void onDisconnectPublisher(channel.id)}
                                    disabled={pending}>
                                    {m.publisher_disconnect()}
                                </Button>
                            ) : null}
                            {readOnly ? null : (
                                <div className="absolute top-4 right-4 sm:right-5">
                                    <ChannelActionsMenu
                                        channel={channel}
                                        disabled={pending}
                                        onEditProfile={() => onEditProfile(channel)}
                                        onLifecycleAction={action =>
                                            onLifecycleAction(action, channel)
                                        }
                                    />
                                </div>
                            )}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
