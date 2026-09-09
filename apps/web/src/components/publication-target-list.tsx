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
import type { Dispatch, ReactNode, SetStateAction } from 'react'

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
    readonly disabled: boolean
    readonly onChange: Dispatch<SetStateAction<PublicationTargetDraft[]>>
    readonly projectId: string
    readonly targets: readonly PublicationTargetDraft[]
    readonly timeZone: string
}

export function PublicationTargetList({
    channels,
    connections,
    disabled,
    onChange,
    projectId,
    targets,
    timeZone,
}: PublicationTargetListProps) {
    useLanguage()
    function updateTarget(id: string, patch: Partial<PublicationTargetDraft>) {
        onChange(currentTargets =>
            currentTargets.map(target => (target.id === id ? { ...target, ...patch } : target))
        )
    }

    function addTarget() {
        onChange(currentTargets => [...currentTargets, createPublicationTarget('', timeZone)])
    }

    function removeTarget(id: string) {
        onChange(currentTargets =>
            currentTargets.length === 1
                ? currentTargets
                : currentTargets.filter(target => target.id !== id)
        )
    }

    return (
        <div className="space-y-3">
            {targets.map((target, index) => (
                <PublicationTargetCard
                    key={target.id}
                    channels={channels}
                    connections={connections}
                    disabled={disabled}
                    index={index}
                    onChange={patch => updateTarget(target.id, patch)}
                    onRemove={() => removeTarget(target.id)}
                    projectId={projectId}
                    target={target}
                    removable={targets.length > 1}
                    timeZone={timeZone}
                />
            ))}

            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={addTarget}>
                <AddIcon aria-hidden="true" />
                {m.compose_add_destination()}
            </Button>
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
    projectId,
    removable,
    target,
    timeZone,
}: {
    readonly channels: readonly Channel[]
    readonly connections: readonly PublisherConnection[]
    readonly disabled: boolean
    readonly index: number
    readonly onChange: (patch: Partial<PublicationTargetDraft>) => void
    readonly onRemove: () => void
    readonly projectId: string
    readonly removable: boolean
    readonly target: PublicationTargetDraft
    readonly timeZone: string
}) {
    useLanguage()
    const channel = channels.find(candidate => candidate.id === target.channelId)
    const connection = connections.find(candidate => candidate.channelId === target.channelId)
    const fieldPrefix = `publication-target-${target.id}`
    const channelLabel = channel?.name ?? m.compose_choose_channel()
    const copyHint =
        channel?.profileId === 'linkedin'
            ? m.compose_linkedin_override()
            : m.compose_target_override()
    const connectionStatus = resolveConnectionStatus(channel, connection, target.deliveryMode)

    return (
        <div className="space-y-4 rounded-md bg-background/70 p-4 shadow-field sm:p-5">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                        {m.compose_destination({ index: String(index + 1) })}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">{channelLabel}</p>
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
                                    {m.compose_manage_connection()}
                                </Link>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                {removable ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={m.compose_remove_destination({ index: String(index + 1) })}
                        disabled={disabled}
                        onClick={onRemove}>
                        <CloseIcon aria-hidden="true" />
                    </Button>
                ) : null}
            </div>

            <TargetField htmlFor={`${fieldPrefix}-channel`} label={m.compose_channel()}>
                <Select
                    required
                    items={Object.fromEntries(
                        channels.map(candidate => [candidate.id, candidate.name])
                    )}
                    value={target.channelId || null}
                    onValueChange={value => onChange({ channelId: value ?? '' })}
                    disabled={disabled}>
                    <SelectTrigger id={`${fieldPrefix}-channel`}>
                        <SelectValue placeholder={m.compose_choose_channel()} />
                    </SelectTrigger>
                    <SelectContent align="start">
                        {channels.map(candidate => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                                {candidate.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </TargetField>

            <TargetField
                htmlFor={`${fieldPrefix}-content`}
                label={m.compose_channel_copy()}
                hint={copyHint}>
                <Textarea
                    id={`${fieldPrefix}-content`}
                    value={target.content}
                    disabled={disabled}
                    onChange={event => onChange({ content: event.target.value })}
                    placeholder={m.compose_optional_override()}
                    rows={4}
                    className="min-h-28 leading-6"
                />
            </TargetField>

            <div className="grid gap-4 xl:grid-cols-2">
                <TargetField htmlFor={`${fieldPrefix}-delivery`} label={m.compose_delivery_mode()}>
                    <Select
                        items={{
                            manual: m.compose_manual_publication(),
                            automatic: m.compose_automatic_publication(),
                        }}
                        value={target.deliveryMode}
                        onValueChange={value => onChange({ deliveryMode: value as DeliveryMode })}
                        disabled={disabled}>
                        <SelectTrigger id={`${fieldPrefix}-delivery`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                            <SelectItem value="manual">{m.compose_manual_publication()}</SelectItem>
                            <SelectItem value="automatic">
                                {m.compose_automatic_publication()}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </TargetField>
                <TargetField
                    htmlFor={`${fieldPrefix}-schedule`}
                    label={m.compose_scheduled_for()}
                    hint={m.compose_project_time({ timeZone })}>
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
            label: m.channel_manual(),
            requiresConnection: false,
        }
    }
    if (connection?.state === 'active') {
        return {
            className: 'text-state-published',
            label: m.channel_connected(),
            requiresConnection: false,
        }
    }
    if (deliveryMode === 'manual') {
        return {
            className: 'text-muted-foreground',
            label: m.compose_manual_publication(),
            requiresConnection: false,
        }
    }
    if (connection?.state === 'reconnect_required' || connection?.state === 'revoked') {
        return {
            className: 'text-state-attention',
            label: m.publisher_reconnection_required(),
            requiresConnection: true,
        }
    }
    return {
        className: 'text-state-attention',
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
