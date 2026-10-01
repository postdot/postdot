import { Button } from '@herald/ui/components/button'
import { Field as UiField, FieldLabel } from '@herald/ui/components/field'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@herald/ui/components/tooltip'
import { cn } from '@herald/ui/lib/utils'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { LayersMinimalisticIcon } from '@solar-icons/react/linear/layers-minimalistic'
import { Link } from '@tanstack/react-router'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import {
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
} from 'react'

import { DateTimePicker } from '@/components/date-time-picker'
import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel, PublisherConnection } from '@/lib/api'
import { channelVariant } from '@/lib/channel-identity'
import { useChannelIdentityPeers } from '@/lib/channel-identity-context'
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
        <div
            data-publication-channel-selection="true"
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl bg-surface-inset/55 px-3 py-2 shadow-surface sm:px-4">
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                {m.publication_new_destinations()}
            </span>
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
                className="flex min-w-0 flex-1 flex-wrap items-center gap-2 p-0.5"
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
                                        className={`relative h-11 min-w-0 max-w-full shrink-0 gap-2 rounded-xl px-2 ${active ? 'bg-primary/10 text-primary shadow-control' : selected ? '' : 'opacity-40 grayscale hover:opacity-80 hover:grayscale-0'}`}>
                                        <ChannelAvatar channel={channel} size="md" />
                                        {active ? (
                                            <span className="min-w-0 max-w-32 truncate text-sm">
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
    readonly createChannel?: ReactNode
    readonly activeTabId: string
    readonly channels: readonly Channel[]
    readonly defaultDeliveryMode: DeliveryMode
    readonly defaultScheduledAt: string
    readonly disabled: boolean
    readonly onChange: Dispatch<SetStateAction<PublicationTargetDraft[]>>
    readonly onActiveTabChange: (tabId: string) => void
    readonly onRemoveTarget: (targetId: string) => void
    readonly projectId: string
    readonly targets: readonly PublicationTargetDraft[]
    readonly timeZone: string
}

export function PublicationChannelTabs({
    createChannel,
    activeTabId,
    channels,
    defaultDeliveryMode,
    defaultScheduledAt,
    disabled,
    onChange,
    onActiveTabChange,
    onRemoveTarget,
    projectId,
    targets,
    timeZone,
}: PublicationChannelTabsProps) {
    useLanguage()
    const identityPeers = useChannelIdentityPeers()
    function channelLabel(channel: Channel) {
        const variant = channelVariant(channel.id, identityPeers)
        return variant === undefined ? channel.name : `${channel.name} · ${variant}`
    }
    const reduceMotion = useReducedMotion()
    const railRef = useRef<HTMLDivElement>(null)
    const pendingFocus = useRef<{ channelId: string; selected: boolean } | null>(null)
    const movement = reduceMotion
        ? { duration: 0 }
        : { type: 'spring' as const, stiffness: 420, damping: 38 }
    function addChannel(channelId: string) {
        const channel = channels.find(item => item.id === channelId)
        if (targets.some(target => target.channelId === channelId)) return
        const deliveryMode = supportsAutomaticDelivery(channel) ? defaultDeliveryMode : 'manual'
        const nextTarget = {
            ...createPublicationTarget(channelId, timeZone),
            deliveryMode,
            scheduledAt: defaultScheduledAt,
        }
        pendingFocus.current = { channelId, selected: true }
        onChange(current => [...current.filter(target => target.channelId !== ''), nextTarget])
    }

    function removeChannel(target: PublicationTargetDraft) {
        pendingFocus.current = { channelId: target.channelId, selected: false }
        onRemoveTarget(target.id)
    }

    const selectedTargets = targets.filter(target => target.channelId !== '')
    const availableChannels = channels.filter(
        channel => !selectedTargets.some(target => target.channelId === channel.id)
    )

    useEffect(() => {
        const nextFocus = pendingFocus.current
        if (nextFocus === null) return
        const selector = nextFocus.selected
            ? '[data-channel-selected-button]'
            : '[data-channel-available]'
        const button = Array.from(
            railRef.current?.querySelectorAll<HTMLButtonElement>(selector) ?? []
        ).find(element => element.dataset.channelId === nextFocus.channelId)
        if (button === undefined) return
        button.focus()
        pendingFocus.current = null
    }, [targets])

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
        <LayoutGroup id="new-publication-channels">
            <div
                ref={railRef}
                data-publication-channel-selection="true"
                className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
                <div
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-3 py-2"
                    role="group"
                    aria-label={m.publication_new_editing_scope()}>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    aria-label={m.publication_new_common_tab()}
                                    title={m.publication_new_common_tab()}
                                    className={`size-11 shrink-0 gap-2 rounded-md p-0 text-sm shadow-control ${activeTabId === publicationSharedTabId ? 'bg-primary/12 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background hover:bg-primary/16' : 'bg-surface-control text-muted-foreground hover:bg-surface-control-hover'}`}
                                    aria-pressed={activeTabId === publicationSharedTabId}
                                    disabled={disabled}
                                    onClick={() => onActiveTabChange(publicationSharedTabId)}>
                                    <LayersMinimalisticIcon aria-hidden="true" className="size-4" />
                                    <span className="sr-only">
                                        {m.publication_new_common_tab()}
                                    </span>
                                </Button>
                            }
                        />
                        <TooltipContent>{m.publication_new_common_tab()}</TooltipContent>
                    </Tooltip>
                    {selectedTargets.map(target => {
                        const channel = channels.find(item => item.id === target.channelId)
                        if (channel === undefined) return null
                        return (
                            <motion.div
                                key={target.id}
                                layoutId={`channel-${channel.id}`}
                                transition={movement}
                                data-channel-selected="true"
                                className={`relative flex size-11 shrink-0 items-stretch rounded-md shadow-control ${activeTabId === target.id ? 'bg-primary/12 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background' : 'bg-surface-control'}`}>
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="size-11 min-w-0 justify-center overflow-hidden rounded-md border-0 p-0 hover:bg-primary/8"
                                                aria-label={channelLabel(channel)}
                                                title={channelLabel(channel)}
                                                aria-pressed={activeTabId === target.id}
                                                data-channel-selected-button="true"
                                                data-channel-id={channel.id}
                                                disabled={disabled}
                                                onClick={() => onActiveTabChange(target.id)}>
                                                <ChannelAvatar
                                                    channel={channel}
                                                    size="md"
                                                    className="!h-full !w-11 !rounded-none"
                                                />
                                                <span className="sr-only">
                                                    {channelLabel(channel)}
                                                </span>
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>{channelLabel(channel)}</TooltipContent>
                                </Tooltip>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    className={cn(
                                        'absolute -right-2 -top-2 z-10 size-6 rounded-full border-0 bg-surface-control p-0 text-muted-foreground shadow-control hover:bg-surface-control-hover hover:text-foreground [&_svg]:size-3',
                                        activeTabId !== target.id &&
                                            'max-sm:hidden [@media(pointer:coarse)]:hidden'
                                    )}
                                    aria-label={m.publication_new_remove_channel({
                                        channel: channelLabel(channel),
                                    })}
                                    disabled={disabled}
                                    onClick={() => removeChannel(target)}>
                                    <CloseIcon aria-hidden="true" />
                                </Button>
                            </motion.div>
                        )
                    })}
                </div>
                {createChannel !== undefined ? <div className="py-1">{createChannel}</div> : null}
                {availableChannels.length > 0 ? (
                    <>
                        <div
                            className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-3 py-2"
                            role="group"
                            aria-label={m.publication_new_destinations()}>
                            {availableChannels.map(channel => (
                                <motion.div
                                    key={channel.id}
                                    layoutId={`channel-${channel.id}`}
                                    transition={movement}
                                    className="shrink-0">
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    disabled={disabled}
                                                    data-channel-available="true"
                                                    data-channel-id={channel.id}
                                                    aria-label={m.publication_new_add_channel_named(
                                                        {
                                                            channel: channelLabel(channel),
                                                        }
                                                    )}
                                                    onClick={() => addChannel(channel.id)}
                                                    title={channelLabel(channel)}
                                                    className="size-11 overflow-hidden rounded-md bg-surface-inset/55 p-0 text-muted-foreground shadow-control grayscale transition-[filter,background-color,color] hover:bg-surface-control-hover hover:text-foreground hover:grayscale-0 focus-visible:text-foreground focus-visible:grayscale-0">
                                                    <ChannelAvatar
                                                        channel={channel}
                                                        size="md"
                                                        className="!h-full !w-11 !rounded-none opacity-65"
                                                    />
                                                    <span className="sr-only">
                                                        {channelLabel(channel)}
                                                    </span>
                                                </Button>
                                            }
                                        />
                                        <TooltipContent>{channelLabel(channel)}</TooltipContent>
                                    </Tooltip>
                                </motion.div>
                            ))}
                        </div>
                    </>
                ) : null}
            </div>
        </LayoutGroup>
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
    readonly onDefaultDeliveryModeChange: (deliveryMode: DeliveryMode) => void
    readonly onDefaultScheduledAtChange: (scheduledAt: string) => void
    readonly onChange: Dispatch<SetStateAction<PublicationTargetDraft[]>>
    readonly onTargetCustomizationChange: (targetId: string, customized: boolean) => void
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
    onDefaultDeliveryModeChange,
    onDefaultScheduledAtChange,
    onChange,
    onTargetCustomizationChange,
    projectId,
    targets,
    timeZone,
}: PublicationChannelSettingsProps) {
    const { locale } = useLanguage()
    const activeTarget = targets.find(target => target.id === activeTargetId)
    const activeChannel = channels.find(channel => channel.id === activeTarget?.channelId)
    const activeConnection = connections.find(
        connection => connection.channelId === activeTarget?.channelId
    )
    const activeStatus =
        activeTarget === undefined || activeChannel === undefined
            ? null
            : resolveConnectionStatus(activeChannel, activeConnection, activeTarget.deliveryMode)
    const automaticConnectionNeedsSetup =
        activeChannel !== undefined &&
        activeChannel.profileId !== 'manual-message' &&
        activeConnection?.state !== 'active'
    const [deliveryDetailsOpen, setDeliveryDetailsOpen] = useState(automaticConnectionNeedsSetup)

    useEffect(() => {
        setDeliveryDetailsOpen(automaticConnectionNeedsSetup)
    }, [activeTarget?.id, automaticConnectionNeedsSetup])
    const automaticDeliveryAllowedForDefaults = targets.every(target =>
        supportsAutomaticDelivery(channels.find(channel => channel.id === target.channelId))
    )
    const automaticDeliveryAllowedForActiveTarget = supportsAutomaticDelivery(activeChannel)

    function updateTarget(id: string, patch: Partial<PublicationTargetDraft>) {
        onChange(currentTargets =>
            currentTargets.map(target => (target.id === id ? { ...target, ...patch } : target))
        )
    }

    return (
        <div data-publication-settings="true" className="min-w-0">
            <section data-publication-shared-settings="true">
                <div className="grid gap-3 sm:grid-cols-2">
                    <TargetField
                        htmlFor="publication-default-delivery"
                        label={m.publication_new_default_delivery()}>
                        <Select
                            items={{
                                manual: m.publication_new_manual_publication(),
                                ...(automaticDeliveryAllowedForDefaults
                                    ? { automatic: m.publication_new_automatic_publication() }
                                    : {}),
                            }}
                            value={
                                automaticDeliveryAllowedForDefaults ? defaultDeliveryMode : 'manual'
                            }
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
                                {automaticDeliveryAllowedForDefaults ? (
                                    <SelectItem value="automatic">
                                        {m.publication_new_automatic_publication()}
                                    </SelectItem>
                                ) : null}
                            </SelectContent>
                        </Select>
                    </TargetField>
                    <TargetField
                        htmlFor="publication-default-schedule"
                        label={m.publication_new_default_schedule()}>
                        <DateTimePicker
                            id="publication-default-schedule"
                            value={defaultScheduledAt}
                            disabled={disabled}
                            onChange={onDefaultScheduledAtChange}
                            clearLabel={m.common_clear()}
                            dateLabel={m.date_time_picker_date()}
                            locale={locale}
                            placeholder={m.date_time_picker_placeholder()}
                            timeLabel={m.date_time_picker_time()}
                            timeZone={timeZone}
                        />
                    </TargetField>
                </div>
            </section>

            {automaticConnectionNeedsSetup ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-state-attention/10 px-3 py-2.5 text-xs">
                    <span className="text-state-attention">
                        {m.publication_new_automatic_connection_required()}
                    </span>
                    <Link
                        className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline"
                        params={{ projectId }}
                        to="/dashboard/projects/$projectId/channels">
                        {m.publication_new_manage_connection()}
                    </Link>
                </div>
            ) : null}

            {activeChannel !== undefined && activeTarget !== undefined ? (
                <details
                    data-publication-active-channel-settings="true"
                    className="mt-3 rounded-lg bg-surface-raised/70 p-3"
                    open={deliveryDetailsOpen}
                    onToggle={event => setDeliveryDetailsOpen(event.currentTarget.open)}>
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
                                        {activeStatus.requiresConnection &&
                                        !automaticConnectionNeedsSetup ? (
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
                    </div>

                    {customizedTargetIds.has(activeTarget.id) ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <TargetField
                                htmlFor={`publication-target-${activeTarget.id}-delivery`}
                                label={m.publication_new_delivery_mode()}>
                                <Select
                                    items={{
                                        manual: m.publication_new_manual_publication(),
                                        ...(automaticDeliveryAllowedForActiveTarget
                                            ? {
                                                  automatic:
                                                      m.publication_new_automatic_publication(),
                                              }
                                            : {}),
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
                                        {automaticDeliveryAllowedForActiveTarget ? (
                                            <SelectItem value="automatic">
                                                {m.publication_new_automatic_publication()}
                                            </SelectItem>
                                        ) : null}
                                    </SelectContent>
                                </Select>
                            </TargetField>
                            <TargetField
                                htmlFor={`publication-target-${activeTarget.id}-schedule`}
                                label={m.publication_new_scheduled_for()}>
                                <DateTimePicker
                                    id={`publication-target-${activeTarget.id}-schedule`}
                                    required
                                    value={activeTarget.scheduledAt}
                                    disabled={disabled}
                                    onChange={scheduledAt =>
                                        updateTarget(activeTarget.id, { scheduledAt })
                                    }
                                    clearLabel={m.common_clear()}
                                    dateLabel={m.date_time_picker_date()}
                                    locale={locale}
                                    placeholder={m.date_time_picker_placeholder()}
                                    timeLabel={m.date_time_picker_time()}
                                    timeZone={timeZone}
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

function supportsAutomaticDelivery(channel: Channel | undefined) {
    return channel?.profileId !== 'manual-message'
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
