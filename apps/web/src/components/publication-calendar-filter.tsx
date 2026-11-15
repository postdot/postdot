import { Button } from '@postdot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuCheckboxItem,
} from '@postdot/ui/components/dropdown-menu'

import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel, PublicationSummary } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function calendarFilterState(publication: PublicationSummary, due: ReadonlySet<string>) {
    if (due.has(publication.id) || publication.state === 'ambiguous') return 'attention'
    return publication.state
}
export function PublicationCalendarFilter({
    channels,
    states,
    channelIds,
    selectedStates,
    onChange,
}: {
    readonly channels: readonly Channel[]
    readonly states: readonly string[]
    readonly channelIds: readonly string[]
    readonly selectedStates: readonly string[]
    readonly onChange: (channels: string[], states: string[]) => void
}) {
    const labels: Record<string, string> = {
        draft: m.publication_state_draft(),
        scheduled: m.queue_scheduled(),
        published: m.publication_state_published(),
        failed: m.publication_state_failed(),
        attention: m.publication_needs_attention(),
    }
    const toggle = (values: readonly string[], id: string) =>
        values.includes(id) ? values.filter(v => v !== id) : [...values, id]
    if (
        channels.length < 2 &&
        states.length < 2 &&
        channelIds.length === 0 &&
        selectedStates.length === 0
    )
        return null
    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
                {m.calendar_filter()}
                {channelIds.length + selectedStates.length > 0
                    ? ` · ${channelIds.length + selectedStates.length}`
                    : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto">
                {channels.length > 1 ? (
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>{m.calendar_filter_channels()}</DropdownMenuLabel>
                        {channels.map(channel => (
                            <DropdownMenuCheckboxItem
                                key={channel.id}
                                checked={channelIds.includes(channel.id)}
                                onCheckedChange={() =>
                                    onChange(toggle(channelIds, channel.id), [...selectedStates])
                                }>
                                <ChannelAvatar channel={channel} size="xs" />
                                <span className="truncate">{channel.name}</span>
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuGroup>
                ) : null}
                {states.length > 1 ? (
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>{m.calendar_filter_states()}</DropdownMenuLabel>
                        {Object.entries(labels).map(([state, label]) => (
                            <DropdownMenuCheckboxItem
                                key={state}
                                checked={selectedStates.includes(state)}
                                onCheckedChange={() =>
                                    onChange([...channelIds], toggle(selectedStates, state))
                                }>
                                {label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuGroup>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
