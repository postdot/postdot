import { Button } from '@herald/ui/components/button'
import { Field as UiField, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Textarea } from '@herald/ui/components/textarea'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CloseIcon } from '@solar-icons/react/bold/close'
import { Link } from '@tanstack/react-router'
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel, PublisherConnection } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import {
    createPublicationTarget,
    type DeliveryMode,
    type PublicationTargetDraft,
} from '@/lib/publication-authoring'
import * as m from '@/paraglide/messages.js'

interface PublicationTargetListProps {
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

export function PublicationTargetList({
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
}: PublicationTargetListProps) {
    useLanguage()
    const [activeTargetId, setActiveTargetId] = useState(targets[0]?.id ?? '')
    const selectedChannelIds = new Set(
        targets.map(target => target.channelId).filter(channelId => channelId !== '')
    )
    const activeTarget = targets.find(target => target.id === activeTargetId) ?? targets[0]
    const availableChannel = channels.find(channel => !selectedChannelIds.has(channel.id))

    useEffect(() => {
        if (targets.some(target => target.id === activeTargetId)) return
        setActiveTargetId(targets[0]?.id ?? '')
    }, [activeTargetId, targets])

    function updateTarget(id: string, patch: Partial<PublicationTargetDraft>) {
        if (
            patch.channelId !== undefined &&
            patch.channelId !== '' &&
            targets.some(target => target.id !== id && target.channelId === patch.channelId)
        ) {
            return
        }
        onChange(currentTargets =>
            currentTargets.map(target => (target.id === id ? { ...target, ...patch } : target))
        )
    }

    function addTarget() {
        if (availableChannel === undefined) return
        const nextTarget = {
            ...createPublicationTarget(availableChannel.id, timeZone),
            deliveryMode: defaultDeliveryMode,
            scheduledAt: defaultScheduledAt,
        }
        setActiveTargetId(nextTarget.id)
        onChange(currentTargets => [...currentTargets, nextTarget])
    }

    function removeTarget(id: string) {
        if (targets.length === 1) return
        const nextTargets = targets.filter(target => target.id !== id)
        if (activeTargetId === id) setActiveTargetId(nextTargets[0]?.id ?? '')
        onChange(nextTargets)
    }

    return (
        <div className="space-y-4">
            <section className="rounded-md bg-muted/55 p-3 shadow-field sm:p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-sm font-medium">
                        {m.publication_new_defaults_for_channels()}
                    </h3>
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
                            required
                            type="datetime-local"
                            value={defaultScheduledAt}
                            disabled={disabled}
                            onChange={event => onDefaultScheduledAtChange(event.target.value)}
                        />
                    </TargetField>
                </div>
            </section>

            <div className="flex min-w-0 items-center gap-2" role="tablist">
                <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
                    {targets.map((target, index) => {
                        const channel = channels.find(
                            candidate => candidate.id === target.channelId
                        )
                        const status = resolveConnectionStatus(
                            channel,
                            connections.find(candidate => candidate.channelId === target.channelId),
                            target.deliveryMode
                        )
                        const active = activeTarget?.id === target.id
                        return (
                            <button
                                key={target.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setActiveTargetId(target.id)}
                                className={`flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                                    active
                                        ? 'bg-background text-foreground shadow-field'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                }`}>
                                {channel ? <ChannelAvatar channel={channel} size="sm" /> : null}
                                <span className="max-w-40 truncate">
                                    {channel?.name ??
                                        m.publication_new_destination({ index: String(index + 1) })}
                                </span>
                                {status ? (
                                    <span
                                        aria-label={status.label}
                                        className={`size-1.5 shrink-0 rounded-full ${status.dotClassName}`}
                                    />
                                ) : null}
                            </button>
                        )
                    })}
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || availableChannel === undefined}
                    title={
                        availableChannel === undefined
                            ? m.publication_new_all_channels_selected()
                            : undefined
                    }
                    onClick={addTarget}>
                    <AddIcon aria-hidden="true" />
                    {m.publication_new_add_destination()}
                </Button>
            </div>

            {activeTarget ? (
                <PublicationTargetCard
                    key={activeTarget.id}
                    channels={channels}
                    connections={connections}
                    disabled={disabled}
                    index={targets.indexOf(activeTarget)}
                    onChange={patch => updateTarget(activeTarget.id, patch)}
                    onRemove={() => removeTarget(activeTarget.id)}
                    onToggleCustomization={customized =>
                        onTargetCustomizationChange(activeTarget.id, customized)
                    }
                    projectId={projectId}
                    selectedChannelIds={selectedChannelIds}
                    target={activeTarget}
                    usesDefaults={!customizedTargetIds.has(activeTarget.id)}
                    removable={targets.length > 1}
                />
            ) : null}
        </div>
    )
}

function PublicationTargetCard({
    channels,
    connections,
    disabled,
    index,
    onChange,
    onRemove,
    onToggleCustomization,
    projectId,
    removable,
    selectedChannelIds,
    target,
    usesDefaults,
}: {
    readonly channels: readonly Channel[]
    readonly connections: readonly PublisherConnection[]
    readonly disabled: boolean
    readonly index: number
    readonly onChange: (patch: Partial<PublicationTargetDraft>) => void
    readonly onRemove: () => void
    readonly onToggleCustomization: (customized: boolean) => void
    readonly projectId: string
    readonly removable: boolean
    readonly selectedChannelIds: ReadonlySet<string>
    readonly target: PublicationTargetDraft
    readonly usesDefaults: boolean
}) {
    useLanguage()
    const [overrideOpen, setOverrideOpen] = useState(target.content.trim() !== '')
    const channel = channels.find(candidate => candidate.id === target.channelId)
    const connection = connections.find(candidate => candidate.channelId === target.channelId)
    const fieldPrefix = `publication-target-${target.id}`
    const connectionStatus = resolveConnectionStatus(channel, connection, target.deliveryMode)

    return (
        <div className="space-y-4 rounded-md bg-background/70 p-4 shadow-field sm:p-5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    {channel ? <ChannelAvatar channel={channel} size="md" /> : null}
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                            {m.publication_new_destination({ index: String(index + 1) })}
                        </p>
                        {channel ? (
                            <p className="mt-1 truncate text-sm font-medium">{channel.name}</p>
                        ) : null}
                        {connectionStatus ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                <span className={connectionStatus.className}>
                                    {connectionStatus.label}
                                </span>
                                {connectionStatus.requiresConnection ? (
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
                {removable ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={m.publication_new_remove_destination({
                            index: String(index + 1),
                        })}
                        disabled={disabled}
                        onClick={onRemove}>
                        <CloseIcon aria-hidden="true" />
                    </Button>
                ) : null}
            </div>

            <TargetField htmlFor={`${fieldPrefix}-channel`} label={m.publication_new_channel()}>
                <Select
                    required
                    items={Object.fromEntries(
                        channels.map(candidate => [candidate.id, candidate.name])
                    )}
                    value={target.channelId || null}
                    onValueChange={value => onChange({ channelId: value ?? '' })}
                    disabled={disabled}>
                    <SelectTrigger id={`${fieldPrefix}-channel`}>
                        <SelectValue placeholder={m.publication_new_choose_channel()} />
                    </SelectTrigger>
                    <SelectContent align="start">
                        {channels.map(candidate => {
                            const alreadySelected =
                                candidate.id !== target.channelId &&
                                selectedChannelIds.has(candidate.id)
                            return (
                                <SelectItem
                                    key={candidate.id}
                                    value={candidate.id}
                                    disabled={alreadySelected}
                                    title={
                                        alreadySelected
                                            ? m.publication_new_channel_already_selected()
                                            : undefined
                                    }>
                                    {candidate.name}
                                </SelectItem>
                            )
                        })}
                    </SelectContent>
                </Select>
            </TargetField>

            <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-muted-foreground">
                        {m.publication_new_channel_copy()}
                    </span>
                    {overrideOpen ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={disabled}
                            onClick={() => {
                                onChange({ content: '' })
                                setOverrideOpen(false)
                            }}>
                            {m.publication_new_use_source()}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={disabled}
                            onClick={() => setOverrideOpen(true)}>
                            {m.publication_new_customize_channel()}
                        </Button>
                    )}
                </div>
                {overrideOpen ? (
                    <TargetField
                        htmlFor={`${fieldPrefix}-content`}
                        label={m.publication_new_channel_copy()}>
                        <Textarea
                            id={`${fieldPrefix}-content`}
                            value={target.content}
                            disabled={disabled}
                            onChange={event => onChange({ content: event.target.value })}
                            placeholder={m.publication_new_optional_override()}
                            rows={4}
                            className="min-h-28 leading-6"
                        />
                    </TargetField>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        {m.publication_new_source_fallback()}
                    </p>
                )}
            </div>

            {usesDefaults ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/55 px-3 py-2.5 shadow-field">
                    <span className="text-xs text-muted-foreground">
                        {m.publication_new_uses_defaults()}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={disabled}
                        onClick={() => onToggleCustomization(true)}>
                        {m.publication_new_customize_delivery()}
                    </Button>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={disabled}
                            onClick={() => onToggleCustomization(false)}>
                            {m.publication_new_use_defaults()}
                        </Button>
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                        <TargetField
                            htmlFor={`${fieldPrefix}-delivery`}
                            label={m.publication_new_delivery_mode()}>
                            <Select
                                items={{
                                    manual: m.publication_new_manual_publication(),
                                    automatic: m.publication_new_automatic_publication(),
                                }}
                                value={target.deliveryMode}
                                onValueChange={value =>
                                    onChange({ deliveryMode: value as DeliveryMode })
                                }
                                disabled={disabled}>
                                <SelectTrigger id={`${fieldPrefix}-delivery`}>
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
                            htmlFor={`${fieldPrefix}-schedule`}
                            label={m.publication_new_scheduled_for()}>
                            <Input
                                id={`${fieldPrefix}-schedule`}
                                required
                                type="datetime-local"
                                value={target.scheduledAt}
                                disabled={disabled}
                                onChange={event => onChange({ scheduledAt: event.target.value })}
                            />
                        </TargetField>
                    </div>
                </div>
            )}
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
    hint,
    htmlFor,
    label,
}: {
    readonly children: ReactNode
    readonly hint?: string
    readonly htmlFor: string
    readonly label: string
}) {
    return (
        <UiField className="min-w-0 gap-1.5">
            <FieldLabel htmlFor={htmlFor} className="text-muted-foreground">
                {label}
            </FieldLabel>
            {children}
            {hint ? (
                <FieldDescription className="text-xs leading-5">{hint}</FieldDescription>
            ) : null}
        </UiField>
    )
}
