import { Button } from '@herald/ui/components/button'
import { Field as UiField, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@herald/ui/components/tooltip'
import { CloseIcon } from '@solar-icons/react/bold/close'
import { Link } from '@tanstack/react-router'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel, PublisherConnection } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import {
    createPublicationTarget,
    type DeliveryMode,
    type PublicationTargetDraft,
} from '@/lib/publication-authoring'
import * as m from '@/paraglide/messages.js'

export const publicationSharedTabId = 'shared'

export interface PublicationChannelRailProps {
    readonly activeChannelId: string
    readonly channels: readonly Channel[]
    readonly disabled: boolean
    readonly onActiveChannelChange: (channelId: string) => void
    readonly onSharedChange?: () => void
    readonly selectedChannelIds?: ReadonlySet<string>
    readonly sharedActive?: boolean
}

export function PublicationChannelRail({
    activeChannelId,
    channels,
    disabled,
    onActiveChannelChange,
    onSharedChange,
    selectedChannelIds,
    sharedActive = false,
}: PublicationChannelRailProps) {
    useLanguage()
    const allChannelsSelected = selectedChannelIds === undefined

    return (
        <div data-publication-channel-selection="true" className="flex min-w-0 items-center gap-3">
            {onSharedChange ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={
                        sharedActive ? 'shrink-0 bg-surface-control shadow-control' : 'shrink-0'
                    }
                    aria-pressed={sharedActive}
                    disabled={disabled}
                    onClick={onSharedChange}>
                    {m.publication_new_shared_content()}
                </Button>
            ) : null}
            <div
                className="flex min-w-0 items-center gap-2 overflow-x-auto p-1"
                role="group"
                aria-label={m.publication_new_destinations()}>
                {channels.map(channel => {
                    const selected = allChannelsSelected || selectedChannelIds.has(channel.id)
                    const active = channel.id === activeChannelId
                    return (
                        <Tooltip key={channel.id}>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        aria-label={channel.name}
                                        aria-pressed={selected}
                                        data-active-channel={active || undefined}
                                        disabled={disabled}
                                        onClick={() => onActiveChannelChange(channel.id)}
                                        className={`relative h-11 shrink-0 gap-2 rounded-xl px-2 ${active ? 'bg-primary/10 text-primary shadow-control' : selected ? '' : 'opacity-40 grayscale hover:opacity-80 hover:grayscale-0'}`}>
                                        <ChannelAvatar channel={channel} size="md" />
                                        {active ? (
                                            <span className="max-w-32 truncate text-sm">
                                                {channel.name}
                                            </span>
                                        ) : null}
                                        {selected && !active ? (
                                            <span className="absolute bottom-1 right-1 size-1.5 rounded-full bg-primary" />
                                        ) : null}
                                    </Button>
                                }
                            />
                            <TooltipContent>{channel.name}</TooltipContent>
                        </Tooltip>
                    )
                })}
            </div>
        </div>
    )
}

export interface PublicationChannelTabsProps {
    readonly activeTargetId: string
    readonly channels: readonly Channel[]
    readonly connections: readonly PublisherConnection[]
    readonly defaultDeliveryMode: DeliveryMode
    readonly defaultScheduledAt: string
    readonly disabled: boolean
    readonly onActiveTargetChange: (targetId: string) => void
    readonly onChange: Dispatch<SetStateAction<PublicationTargetDraft[]>>
    readonly projectId: string
    readonly targets: readonly PublicationTargetDraft[]
    readonly timeZone: string
}

export function PublicationChannelTabs({
    activeTargetId,
    channels,
    defaultDeliveryMode,
    defaultScheduledAt,
    disabled,
    onActiveTargetChange,
    onChange,
    projectId,
    targets,
    timeZone,
}: PublicationChannelTabsProps) {
    useLanguage()
    function activateChannel(channelId: string) {
        const existing = targets.find(target => target.channelId === channelId)
        if (existing) {
            onActiveTargetChange(existing.id)
            return
        }
        const nextTarget = {
            ...createPublicationTarget(channelId, timeZone),
            deliveryMode: defaultDeliveryMode,
            scheduledAt: defaultScheduledAt,
        }
        onChange(current => [...current.filter(target => target.channelId !== ''), nextTarget])
        onActiveTargetChange(nextTarget.id)
    }

    if (channels.length === 0) {
        return (
            <div
                data-publication-channel-selection="true"
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">
                    {m.publication_new_add_channel()}
                </span>
                <Link
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    params={{ projectId }}
                    to="/dashboard/projects/$projectId/channels">
                    {m.publication_new_manage_channels()}
                </Link>
            </div>
        )
    }

    return (
        <PublicationChannelRail
            activeChannelId={targets.find(target => target.id === activeTargetId)?.channelId ?? ''}
            channels={channels}
            disabled={disabled}
            onActiveChannelChange={activateChannel}
            onSharedChange={() => onActiveTargetChange(publicationSharedTabId)}
            selectedChannelIds={new Set(targets.map(target => target.channelId))}
            sharedActive={activeTargetId === publicationSharedTabId}
        />
    )
}

export interface PublicationChannelSettingsProps {
    readonly activeTargetId: string
    readonly channels: readonly Channel[]
    readonly connections: readonly PublisherConnection[]
    readonly customizedTargetIds: ReadonlySet<string>
    readonly defaultDeliveryMode: DeliveryMode
    readonly defaultScheduledAt: string
    readonly disabled: boolean
    readonly onActiveTargetChange: (targetId: string) => void
    readonly onDefaultDeliveryModeChange: (deliveryMode: DeliveryMode) => void
    readonly onDefaultScheduledAtChange: (scheduledAt: string) => void
    readonly onChange: Dispatch<SetStateAction<PublicationTargetDraft[]>>
    readonly onTargetCustomizationChange: (targetId: string, customized: boolean) => void
    readonly onRemoveTarget: (targetId: string) => void
    readonly projectId: string
    readonly targets: readonly PublicationTargetDraft[]
    readonly timeZone: string
}

export function PublicationChannelSettings({
    activeTargetId,
    channels,
    connections,
    customizedTargetIds,
    defaultDeliveryMode,
    defaultScheduledAt,
    disabled,
    onActiveTargetChange,
    onDefaultDeliveryModeChange,
    onDefaultScheduledAtChange,
    onChange,
    onTargetCustomizationChange,
    onRemoveTarget,
    projectId,
    targets,
    timeZone,
}: PublicationChannelSettingsProps) {
    useLanguage()
    const activeTarget = targets.find(target => target.id === activeTargetId)
    const activeChannel = channels.find(channel => channel.id === activeTarget?.channelId)
    const activeConnection = connections.find(
        connection => connection.channelId === activeTarget?.channelId
    )
    const activeStatus =
        activeTarget === undefined || activeChannel === undefined
            ? null
            : resolveConnectionStatus(activeChannel, activeConnection, activeTarget.deliveryMode)

    function updateTarget(id: string, patch: Partial<PublicationTargetDraft>) {
        onChange(currentTargets =>
            currentTargets.map(target => (target.id === id ? { ...target, ...patch } : target))
        )
    }

    return (
        <div
            data-publication-settings="true"
            className="rounded-xl bg-surface-inset/60 px-4 py-3 sm:px-5">
            <section data-publication-shared-settings="true">
                <div className="flex justify-end">
                    <span className="text-xs text-muted-foreground">
                        {m.publication_new_project_time({ timeZone })}
                    </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <TargetField
                        htmlFor="publication-default-delivery"
                        label={m.publication_new_default_delivery()}>
                        <Select
                            items={{
                                manual: m.publication_new_manual_publication(),
                                automatic: m.publication_new_automatic_publication(),
                            }}
                            value={defaultDeliveryMode}
                            onValueChange={value =>
                                onDefaultDeliveryModeChange(value as DeliveryMode)
                            }
                            disabled={disabled}>
                            <SelectTrigger id="publication-default-delivery">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="start">
                                <SelectItem value="manual">
                                    {m.publication_new_manual_publication()}
                                </SelectItem>
                                <SelectItem value="automatic">
                                    {m.publication_new_automatic_publication()}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </TargetField>
                    <TargetField
                        htmlFor="publication-default-schedule"
                        label={m.publication_new_default_schedule()}>
                        <Input
                            id="publication-default-schedule"
                            type="datetime-local"
                            value={defaultScheduledAt}
                            disabled={disabled}
                            onChange={event => onDefaultScheduledAtChange(event.target.value)}
                        />
                    </TargetField>
                </div>
            </section>

            {activeChannel !== undefined && activeTarget !== undefined ? (
                <details
                    data-publication-active-channel-settings="true"
                    className="mt-3 rounded-lg bg-surface-raised/70 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        {m.publication_new_customize_delivery()}
                    </summary>
                    <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <ChannelAvatar channel={activeChannel} size="md" />
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{activeChannel.name}</p>
                                {activeStatus ? (
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                        <span className={activeStatus.className}>
                                            {activeStatus.label}
                                        </span>
                                        {activeStatus.requiresConnection ? (
                                            <Link
                                                className="text-primary underline-offset-4 hover:underline"
                                                params={{ projectId }}
                                                to="/dashboard/projects/$projectId/channels">
                                                {m.publication_new_manage_connection()}
                                            </Link>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        {targets.length > 1 ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={m.publication_new_remove_destination({
                                    index: String(targets.indexOf(activeTarget) + 1),
                                })}
                                disabled={disabled}
                                onClick={() => {
                                    const nextTargets = targets.filter(
                                        target => target.id !== activeTarget.id
                                    )
                                    onRemoveTarget(activeTarget.id)
                                    onActiveTargetChange(
                                        nextTargets[0]?.id ?? publicationSharedTabId
                                    )
                                }}>
                                <CloseIcon aria-hidden="true" />
                            </Button>
                        ) : null}
                    </div>

                    {customizedTargetIds.has(activeTarget.id) ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <TargetField
                                htmlFor={`publication-target-${activeTarget.id}-delivery`}
                                label={m.publication_new_delivery_mode()}>
                                <Select
                                    items={{
                                        manual: m.publication_new_manual_publication(),
                                        automatic: m.publication_new_automatic_publication(),
                                    }}
                                    value={activeTarget.deliveryMode}
                                    onValueChange={value =>
                                        updateTarget(activeTarget.id, {
                                            deliveryMode: value as DeliveryMode,
                                        })
                                    }
                                    disabled={disabled}>
                                    <SelectTrigger
                                        id={`publication-target-${activeTarget.id}-delivery`}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent align="start">
                                        <SelectItem value="manual">
                                            {m.publication_new_manual_publication()}
                                        </SelectItem>
                                        <SelectItem value="automatic">
                                            {m.publication_new_automatic_publication()}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </TargetField>
                            <TargetField
                                htmlFor={`publication-target-${activeTarget.id}-schedule`}
                                label={m.publication_new_scheduled_for()}>
                                <Input
                                    id={`publication-target-${activeTarget.id}-schedule`}
                                    required
                                    type="datetime-local"
                                    value={activeTarget.scheduledAt}
                                    disabled={disabled}
                                    onChange={event =>
                                        updateTarget(activeTarget.id, {
                                            scheduledAt: event.target.value,
                                        })
                                    }
                                />
                            </TargetField>
                            <div className="sm:col-span-2 flex justify-end">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    disabled={disabled}
                                    onClick={() =>
                                        onTargetCustomizationChange(activeTarget.id, false)
                                    }>
                                    {m.publication_new_use_defaults()}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                                {m.publication_new_uses_defaults()}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                disabled={disabled}
                                onClick={() => onTargetCustomizationChange(activeTarget.id, true)}>
                                {m.publication_new_customize_delivery()}
                            </Button>
                        </div>
                    )}
                </details>
            ) : null}
        </div>
    )
}

function resolveConnectionStatus(
    channel: Channel | undefined,
    connection: PublisherConnection | undefined,
    deliveryMode: DeliveryMode
) {
    if (channel === undefined) return null
    if (channel.profileId === 'manual-message') {
        return {
            className: 'text-state-queued',
            dotClassName: 'bg-state-queued',
            label: m.channel_manual(),
            requiresConnection: false,
        }
    }
    if (connection?.state === 'active') {
        return {
            className: 'text-state-published',
            dotClassName: 'bg-state-published',
            label: m.channel_connected(),
            requiresConnection: false,
        }
    }
    if (deliveryMode === 'manual') {
        return {
            className: 'text-muted-foreground',
            dotClassName: 'bg-muted-foreground',
            label: m.publication_new_manual_publication(),
            requiresConnection: false,
        }
    }
    if (connection?.state === 'reconnect_required' || connection?.state === 'revoked') {
        return {
            className: 'text-state-attention',
            dotClassName: 'bg-state-attention',
            label: m.publisher_reconnection_required(),
            requiresConnection: true,
        }
    }
    return {
        className: 'text-state-attention',
        dotClassName: 'bg-state-attention',
        label: m.channel_needs_connection(),
        requiresConnection: true,
    }
}

function TargetField({
    children,
    htmlFor,
    label,
}: {
    readonly children: ReactNode
    readonly htmlFor: string
    readonly label: string
}) {
    return (
        <UiField className="min-w-0 gap-1.5">
            <FieldLabel htmlFor={htmlFor} className="text-muted-foreground">
                {label}
            </FieldLabel>
            {children}
        </UiField>
    )
}
