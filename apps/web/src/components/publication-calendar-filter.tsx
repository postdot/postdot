import type { FilterGroup } from '@/components/filter-controls'
import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel, PublicationSummary } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function calendarFilterState(publication: PublicationSummary, due: ReadonlySet<string>) {
    if (due.has(publication.id) || publication.state === 'ambiguous') return 'attention'
    return publication.state
}

/** The calendar's filter conditions, offered through the shared Filter menu. */
export function calendarFilterGroups({
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
}): FilterGroup[] {
    const labels: Record<string, string> = {
        draft: m.publication_state_draft(),
        scheduled: m.queue_scheduled(),
        published: m.publication_state_published(),
        failed: m.publication_state_failed(),
        attention: m.publication_needs_attention(),
    }
    return [
        {
            id: 'channels',
            label: m.calendar_filter_channels(),
            multiple: true,
            onChange: next => onChange(next, [...selectedStates]),
            options: channels.map(channel => ({
                label: channel.name,
                media: <ChannelAvatar channel={channel} size="xs" />,
                value: channel.id,
            })),
            selected: channelIds,
        },
        {
            id: 'states',
            label: m.calendar_filter_states(),
            multiple: true,
            onChange: next => onChange([...channelIds], next),
            options: Object.entries(labels)
                .filter(([state]) => states.includes(state) || selectedStates.includes(state))
                .map(([state, label]) => ({ label, value: state })),
            selected: selectedStates,
        },
    ]
}
