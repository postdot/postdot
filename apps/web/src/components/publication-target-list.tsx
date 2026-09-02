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
import type { Dispatch, ReactNode, SetStateAction } from 'react'

import type { Channel } from '@/lib/api'
import {
    createPublicationTarget,
    type DeliveryMode,
    type PublicationTargetDraft,
} from '@/lib/publication-authoring'

interface PublicationTargetListProps {
    readonly channels: readonly Channel[]
    readonly disabled: boolean
    readonly onChange: Dispatch<SetStateAction<PublicationTargetDraft[]>>
    readonly targets: readonly PublicationTargetDraft[]
}

export function PublicationTargetList({
    channels,
    disabled,
    onChange,
    targets,
}: PublicationTargetListProps) {
    function updateTarget(id: string, patch: Partial<PublicationTargetDraft>) {
        onChange(currentTargets =>
            currentTargets.map(target => (target.id === id ? { ...target, ...patch } : target))
        )
    }

    function addTarget() {
        onChange(currentTargets => [...currentTargets, createPublicationTarget()])
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
                    disabled={disabled}
                    index={index}
                    onChange={patch => updateTarget(target.id, patch)}
                    onRemove={() => removeTarget(target.id)}
                    target={target}
                    removable={targets.length > 1}
                />
            ))}

            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={addTarget}>
                <AddIcon aria-hidden="true" />
                Add destination
            </Button>
        </div>
    )
}

function PublicationTargetCard({
    channels,
    disabled,
    index,
    onChange,
    onRemove,
    removable,
    target,
}: {
    readonly channels: readonly Channel[]
    readonly disabled: boolean
    readonly index: number
    readonly onChange: (patch: Partial<PublicationTargetDraft>) => void
    readonly onRemove: () => void
    readonly removable: boolean
    readonly target: PublicationTargetDraft
}) {
    const channel = channels.find(candidate => candidate.id === target.channelId)
    const fieldPrefix = `publication-target-${target.id}`
    const channelLabel = channel?.name ?? 'Choose a channel'
    const copyHint =
        channel?.profileId === 'linkedin'
            ? 'Optional LinkedIn commentary override. Leave empty to adapt the source.'
            : 'Optional target-specific override. Leave empty to adapt the source.'

    return (
        <div className="space-y-4 rounded-md bg-background/70 p-4 shadow-field sm:p-5">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Destination {index + 1}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">{channelLabel}</p>
                </div>
                {removable ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove destination ${index + 1}`}
                        disabled={disabled}
                        onClick={onRemove}>
                        <CloseIcon aria-hidden="true" />
                    </Button>
                ) : null}
            </div>

            <TargetField htmlFor={`${fieldPrefix}-channel`} label="Channel">
                <Select
                    required
                    items={Object.fromEntries(
                        channels.map(candidate => [candidate.id, candidate.name])
                    )}
                    value={target.channelId || null}
                    onValueChange={value => onChange({ channelId: value ?? '' })}
                    disabled={disabled}>
                    <SelectTrigger id={`${fieldPrefix}-channel`}>
                        <SelectValue placeholder="Select a channel" />
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

            <TargetField htmlFor={`${fieldPrefix}-content`} label="Channel copy" hint={copyHint}>
                <Textarea
                    id={`${fieldPrefix}-content`}
                    value={target.content}
                    disabled={disabled}
                    onChange={event => onChange({ content: event.target.value })}
                    placeholder="Optional override"
                    rows={4}
                    className="min-h-28 leading-6"
                />
            </TargetField>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <TargetField htmlFor={`${fieldPrefix}-delivery`} label="Delivery mode">
                    <Select
                        items={{
                            manual: 'Manual publication',
                            automatic: 'Automatic publication',
                        }}
                        value={target.deliveryMode}
                        onValueChange={value => onChange({ deliveryMode: value as DeliveryMode })}
                        disabled={disabled}>
                        <SelectTrigger id={`${fieldPrefix}-delivery`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                            <SelectItem value="manual">Manual publication</SelectItem>
                            <SelectItem value="automatic">Automatic publication</SelectItem>
                        </SelectContent>
                    </Select>
                </TargetField>
                <TargetField
                    htmlFor={`${fieldPrefix}-schedule`}
                    label="Scheduled for"
                    hint="Local browser time.">
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
