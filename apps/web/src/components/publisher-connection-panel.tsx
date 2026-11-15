import { Button, buttonVariants } from '@postdot/ui/components/button'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { Link } from '@tanstack/react-router'
import { Fragment, useEffect, useState } from 'react'

import type { ChannelLifecycleAction } from '@/components/channel-lifecycle-dialog'
import { ChannelActionsMenu } from '@/components/channel-row'
import { CustomHttpConnectionDialog } from '@/components/custom-http-connection-dialog'
import { channelProfileLabel } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import { StatusText, type StatusTone } from '@/components/status-text'
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
    readonly onCadence?: (channel: Channel) => void
    readonly onShare?: (channel: Channel) => void
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
    onCadence,
    onShare,
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
        setSelectedProviderApplications(current => ({
            ...current,
            [provider]: applicationId,
        }))
    }

    const connectionsByChannel = new Map(
        connections.map(connection => [connection.channelId, connection])
    )
    function needsPlatformSetup(channel: ChannelListItem): boolean {
        if (readOnly || channel.state === 'archived' || channel.execution.kind !== 'built_in')
            return false
        if (connectionsByChannel.get(channel.id)?.state === 'active') return false
        const provider = channel.execution.contractId
        return (
            isProviderApplicationProvider(provider) &&
            oauthReadiness[provider] === 'not_configured' &&
            applicationsFor(provider).length === 0
        )
    }
    if (channels.length === 0) return null

    return (
        <section
            id="publisher-connections"
            className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/60 bg-surface-raised shadow-surface">
            {channels.map(channel => {
                const canManageChannel = channel.canManage !== false
                const connection = connectionsByChannel.get(channel.id)
                const archived = channel.state === 'archived'
                const manual = channel.execution.kind === 'manual'
                const definition = manual
                    ? undefined
                    : providerRegistry.forExecution(channel.execution)
                const platform =
                    channel.execution.kind === 'declarative_http'
                        ? m.channel_custom_profile()
                        : manual
                          ? m.channel_platform_manual()
                          : channelProfileLabel(channel.profileId)
                const canConnect =
                    !manual && (connection === undefined || connection.state !== 'active')
                const needsSetup = needsPlatformSetup(channel)
                const provider =
                    channel.execution.kind === 'built_in' &&
                    isProviderApplicationProvider(channel.execution.contractId)
                        ? channel.execution.contractId
                        : undefined
                const status = channelStatus({
                    archived,
                    connection,
                    manual,
                    needsSetup,
                })
                const details = manual || archived ? [] : connectionDetails(connection)
                const note = archived
                    ? null
                    : needsSetup && !isInstanceAdmin
                      ? m.channel_setup_waiting({ platform })
                      : channel.execution.kind === 'built_in' &&
                          definition === undefined &&
                          connection === undefined
                        ? m.publisher_unsupported_contract()
                        : connection !== undefined && connection.state !== 'active'
                          ? m.publisher_reconnection_required()
                          : null
                const manageable = !readOnly && canManageChannel && !archived

                return (
                    <article
                        id={`publisher-connection-${channel.id}`}
                        key={channel.id}
                        className="grid min-w-0 scroll-mt-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-5">
                        <ChannelAvatar
                            channel={channel}
                            className={archived ? 'opacity-40' : undefined}
                            size="md"
                        />
                        <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
                                <p className="min-w-0 truncate text-sm font-medium">
                                    {channel.name}
                                </p>
                                {status ? (
                                    <StatusText tone={status.tone}>{status.label}</StatusText>
                                ) : null}
                            </div>
                            <p className="mt-0.5 flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                                {[
                                    ...(details.length > 0 ? details : [platform]),
                                    ...(channel.shared && !archived
                                        ? [m.channel_shared_badge()]
                                        : []),
                                ].map((part, index) => (
                                    <Fragment key={`${index}-${part}`}>
                                        {index > 0 ? <span aria-hidden="true">·</span> : null}
                                        <span className="min-w-0 break-words">{part}</span>
                                    </Fragment>
                                ))}
                            </p>
                            {note ? (
                                <p className="mt-1 text-xs text-muted-foreground">{note}</p>
                            ) : null}
                        </div>
                        <div className="col-span-2 col-start-2 row-start-2 flex justify-start empty:hidden sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-end">
                            {!manageable || !canConnect ? null : needsSetup ? (
                                isInstanceAdmin ? (
                                    <Link
                                        className={buttonVariants({
                                            size: 'sm',
                                            variant: 'outline',
                                        })}
                                        to="/dashboard/settings/provider-applications"
                                        search={{
                                            projectId: readinessProjectId,
                                            workspaceId: undefined,
                                        }}>
                                        <SettingsIcon aria-hidden="true" />
                                        {m.channel_setup_platform({ platform })}
                                    </Link>
                                ) : null
                            ) : provider !== undefined &&
                              oauthReadiness[provider] !== 'ready' &&
                              applicationsFor(provider).length === 0 ? (
                                oauthReadiness[provider] === 'unavailable' ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setReadinessAttempt(value => value + 1)}>
                                        {m.common_retry()}
                                    </Button>
                                ) : (
                                    <p role="status" className="text-xs text-muted-foreground">
                                        {m.common_loading()}
                                    </p>
                                )
                            ) : definition !== undefined ? (
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
                            ) : channel.execution.kind === 'declarative_http' ? (
                                <CustomHttpConnectionDialog
                                    channel={channel}
                                    disabled={pending}
                                    onConnect={onConnectCustomHttpPublisher}
                                    reconnect={connection !== undefined}
                                />
                            ) : null}
                        </div>
                        {readOnly ? null : (
                            <div className="col-start-3 row-start-1 sm:col-start-4">
                                <ChannelActionsMenu
                                    channel={channel}
                                    canManage={canManageChannel}
                                    disabled={pending}
                                    onDisconnect={
                                        connection?.state === 'active' && !archived
                                            ? () => void onDisconnectPublisher(channel.id)
                                            : undefined
                                    }
                                    onEditProfile={() => onEditProfile(channel)}
                                    onLifecycleAction={action => onLifecycleAction(action, channel)}
                                    onCadence={onCadence ? () => onCadence(channel) : undefined}
                                    onShare={onShare ? () => onShare(channel) : undefined}
                                />
                            </div>
                        )}
                    </article>
                )
            })}
        </section>
    )
}

function channelStatus({
    archived,
    connection,
    manual,
    needsSetup,
}: {
    readonly archived: boolean
    readonly connection: PublisherConnection | undefined
    readonly manual: boolean
    readonly needsSetup: boolean
}): { readonly label: string; readonly tone: StatusTone } | null {
    if (archived) return { label: m.channel_archived(), tone: 'neutral' }
    if (manual) return null
    if (connection?.state === 'active') return { label: m.channel_connected(), tone: 'positive' }
    if (connection?.state === 'revoked')
        return { label: m.publisher_access_revoked(), tone: 'critical' }
    if (connection !== undefined)
        return {
            label: m.publisher_reconnect_required_status(),
            tone: 'attention',
        }
    if (needsSetup) return { label: m.publisher_setup_required(), tone: 'attention' }
    return { label: m.channel_needs_connection(), tone: 'attention' }
}

/** The connected account, as people recognise it: handle, page or endpoint. */
function connectionDetails(connection: PublisherConnection | undefined): string[] {
    if (connection === undefined) return []
    if (connection.kind === 'custom_http') {
        const endpoint = connection.endpointUrl ?? m.publisher_custom_endpoint()
        return [endpoint]
    }
    const definition = providerRegistry.get(connection.providerId)
    const account =
        definition?.accountLabel(connection) ??
        connection.destination?.name ??
        connection.externalAccountName ??
        connection.externalAccountId
    return account ? [account] : []
}

/** Installation application identities are supplied by provider modules. */
function isProviderApplicationProvider(value: string): value is ProviderApplicationProvider {
    return providerRegistry.get(value)?.applicationProvider !== undefined
}
