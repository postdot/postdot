import { Badge } from '@postdot/ui/components/badge'
import { Button } from '@postdot/ui/components/button'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import type { ChannelLifecycleAction } from '@/components/channel-lifecycle-dialog'
import { ChannelActionsMenu, ChannelRow } from '@/components/channel-row'
import { CustomHttpConnectionDialog } from '@/components/custom-http-connection-dialog'
import { ChannelAvatar } from '@/components/identity-visuals'
import type {
    Channel,
    ChannelListItem,
    CustomHttpAuthentication,
    ProviderApplication,
    ProviderApplicationProvider,
    PublisherConnection,
} from '@/lib/api'
import { api } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'
import { ProviderConnection } from '@/providers/connection'
import { providerRegistry, installedProviders } from '@/providers/registry'

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
    readonly onPublisherConnected: () => Promise<boolean>
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
    onPublisherConnected,
    onDisconnectPublisher,
    isInstanceAdmin = false,
    readOnly = false,
}: PublisherConnectionPanelProps) {
    useLanguage()
    const [oauthReadiness, setOauthReadiness] = useState<
        Partial<Record<ProviderApplicationProvider, 'ready' | 'not_configured' | 'unavailable'>>
    >({})
    const [readinessAttempt, setReadinessAttempt] = useState(0)
    const readinessProjectId = channels[0]?.projectId
    useEffect(() => {
        if (readOnly || !readinessProjectId) return
        let cancelled = false
        setOauthReadiness({})
        void api
            .listPublisherConnections(readinessProjectId)
            .then(response => {
                if (!cancelled) setOauthReadiness(response.oauthReadiness)
            })
            .catch(() => {
                if (!cancelled)
                    setOauthReadiness(
                        Object.fromEntries(
                            installedProviders.flatMap(definition => {
                                const provider = providerRegistry.get(
                                    definition.id
                                )?.applicationProvider
                                return provider ? [[provider, 'unavailable' as const]] : []
                            })
                        )
                    )
            })
        return () => {
            cancelled = true
        }
    }, [readOnly, readinessProjectId, readinessAttempt])
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
                !isProviderApplicationProvider(channel.execution.contractId)
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
        if (applications.length < 2) return applications[0]?.id

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

    const connectionsByChannel = new Map(
        connections.map(connection => [connection.channelId, connection])
    )
    const missingProviders = readOnly
        ? []
        : [
              ...new Set(
                  channels.flatMap(channel => {
                      if (
                          channel.state === 'archived' ||
                          channel.execution.kind !== 'built_in' ||
                          connectionsByChannel.get(channel.id)?.state === 'active'
                      )
                          return []
                      const provider = channel.execution.contractId
                      return isProviderApplicationProvider(provider) &&
                          oauthReadiness[provider as ProviderApplicationProvider] ===
                              'not_configured' &&
                          applicationsFor(provider as ProviderApplicationProvider).length === 0
                          ? [providerLabel(provider as ProviderApplicationProvider)]
                          : []
                  })
              ),
          ]
    if (channels.length === 0) return null

    return (
        <section id="publisher-connections">
            {missingProviders.length > 0 ? (
                <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 text-sm sm:px-5">
                    <p className="text-muted-foreground">
                        <span>{m.publisher_oauth_setup_required()}</span>{' '}
                        {missingProviders.join(', ')}
                    </p>
                    {isInstanceAdmin ? (
                        <Link
                            className="text-primary hover:underline"
                            to="/dashboard/settings/provider-applications"
                            search={{ projectId: readinessProjectId, workspaceId: undefined }}>
                            {m.provider_apps_title()}
                        </Link>
                    ) : (
                        <p className="text-muted-foreground">{m.publisher_oauth_contact_admin()}</p>
                    )}
                </div>
            ) : null}
            <div className="divide-y divide-border/40">
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
                    const definition = providerRegistry.forExecution(channel.execution)
                    const canConnect = connection === undefined || connection.state !== 'active'
                    const needsSetup =
                        canConnect &&
                        missingProviders.includes(
                            isProviderApplicationProvider(connectionKind)
                                ? providerLabel(connectionKind)
                                : ''
                        )
                    const connectionLabel =
                        channel.state === 'archived'
                            ? m.channel_archived()
                            : needsSetup
                              ? m.publisher_setup_required()
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
                            className="relative flex min-w-0 scroll-mt-20 flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/35 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:gap-5 lg:pr-16">
                            <div className="flex min-w-0 flex-1 items-start gap-3 pr-9 lg:pr-0">
                                <ChannelAvatar channel={channel} size="md" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
                                        <p className="min-w-0 break-words">{channel.name}</p>
                                        <Badge
                                            className={connectionBadgeClass}
                                            variant={
                                                channel.state === 'archived'
                                                    ? 'outline'
                                                    : 'secondary'
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
                                      definition?.connectionHint !== undefined ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {definition.connectionHint()}
                                        </p>
                                    ) : connection === undefined &&
                                      channel.execution.kind === 'built_in' &&
                                      definition === undefined ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {m.publisher_unsupported_contract()}
                                        </p>
                                    ) : connection === undefined ? null : connection.kind !==
                                      'custom_http' ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {providerRegistry
                                                .get(connection.providerId)
                                                ?.accountLabel(connection) ??
                                                (connection.destination?.type === 'organization'
                                                    ? m.publisher_page({
                                                          account:
                                                              connection.destination.name ??
                                                              connection.destination.id,
                                                      })
                                                    : m.publisher_member({
                                                          account:
                                                              connection.externalAccountName ??
                                                              connection.externalAccountId,
                                                      }))}
                                        </p>
                                    ) : null}
                                    {connection !== undefined &&
                                    connection.kind !== 'custom_http' &&
                                    providerRegistry.get(connection.providerId)?.accountDetails !==
                                        undefined ? (
                                        <p className="mt-1 break-all text-xs text-muted-foreground">
                                            {providerRegistry
                                                .get(connection.providerId)
                                                ?.accountDetails?.(connection)}
                                        </p>
                                    ) : null}
                                    {connection !== undefined &&
                                    connection.kind === 'custom_http' ? (
                                        <p className="mt-1 break-all text-sm text-muted-foreground">
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
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {connection.state === 'revoked'
                                                ? m.publisher_access_revoked_description()
                                                : m.publisher_reconnection_required()}
                                        </p>
                                    ) : null}
                                </div>
                            </div>

                            {readOnly || channel.state === 'archived' ? null : canConnect &&
                              isProviderApplicationProvider(connectionKind) &&
                              oauthReadiness[connectionKind as ProviderApplicationProvider] !==
                                  'ready' &&
                              applicationsFor(connectionKind as ProviderApplicationProvider)
                                  .length === 0 ? (
                                needsSetup ? null : (
                                    <div className="flex flex-col gap-2 text-sm sm:items-end">
                                        <p className="text-muted-foreground">
                                            {oauthReadiness[
                                                connectionKind as ProviderApplicationProvider
                                            ] === 'unavailable'
                                                ? m.api_request_failed()
                                                : m.common_loading()}
                                        </p>
                                        {oauthReadiness[
                                            connectionKind as ProviderApplicationProvider
                                        ] === 'unavailable' ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    setReadinessAttempt(value => value + 1)
                                                }>
                                                {m.common_retry()}
                                            </Button>
                                        ) : null}
                                    </div>
                                )
                            ) : definition !== undefined && canConnect ? (
                                <ProviderConnection
                                    definition={definition}
                                    channel={channel}
                                    disabled={pending}
                                    reconnect={connection !== undefined}
                                    applications={
                                        definition.applicationProvider
                                            ? applicationsFor(definition.applicationProvider)
                                            : []
                                    }
                                    applicationId={
                                        definition.applicationProvider
                                            ? selectedApplicationId(definition.applicationProvider)
                                            : undefined
                                    }
                                    onApplicationChange={id => {
                                        if (definition.applicationProvider)
                                            selectApplication(definition.applicationProvider, id)
                                    }}
                                    onConnected={onPublisherConnected}
                                />
                            ) : channel.execution.kind === 'declarative_http' && canConnect ? (
                                <CustomHttpConnectionDialog
                                    channel={channel}
                                    disabled={pending}
                                    onConnect={onConnectCustomHttpPublisher}
                                    reconnect={connection !== undefined}
                                />
                            ) : null}
                            {readOnly ? null : (
                                <div className="absolute top-4 right-4 sm:right-5">
                                    <ChannelActionsMenu
                                        channel={channel}
                                        disabled={pending}
                                        onDisconnect={
                                            connection?.state === 'active' &&
                                            channel.state !== 'archived'
                                                ? () => void onDisconnectPublisher(channel.id)
                                                : undefined
                                        }
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

/** Installation application identities are supplied by provider modules. */
function isProviderApplicationProvider(value: string): value is ProviderApplicationProvider {
    return providerRegistry.get(value)?.applicationProvider !== undefined
}
function providerLabel(provider: ProviderApplicationProvider): string {
    return providerRegistry.get(provider)?.name ?? provider
}
