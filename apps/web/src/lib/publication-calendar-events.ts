import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types'
import type { ChannelOccupancy, PublicationSummary } from '@/lib/api'
import { toDateKey } from '@/lib/publication-calendar'
import { publicationIdentityLabel } from '@/lib/publication-identity'

type PublicationCalendarView = 'month' | 'week' | 'day' | 'agenda'

export interface PublicationEventData {
    readonly due: boolean
    readonly occupancy?: undefined
    /** The first publication of the group, used for the title and the preview. */
    readonly publication: PublicationSummary
    /** Every channel publication of the same post at the same minute (ADR-103 §3). */
    readonly publications: readonly PublicationSummary[]
}

/** Read-only time taken on a shared channel by another project; it is never selectable. */
export interface OccupancyEventData {
    readonly due: false
    readonly occupancy: ChannelOccupancy
    readonly publication?: undefined
}

export type PublicationCalendarEventData = PublicationEventData | OccupancyEventData

function isPublicationCalendarView(value: unknown): value is PublicationCalendarView {
    return value === 'month' || value === 'week' || value === 'day' || value === 'agenda'
}

/**
 * Adapts Postdot's point-in-time publications to the local ReUI calendar
 * contract. A publication is intentionally a zero-duration event: the
 * calendar should communicate when it is scheduled, not invent a duration.
 */
export function toPublicationCalendarEvents(
    publications: readonly PublicationSummary[],
    duePublicationIds: ReadonlySet<string>
): CalendarEvent<PublicationEventData>[] {
    return publications
        .filter((publication): publication is PublicationSummary & { scheduledAt: number } => {
            return publication.scheduledAt !== null
        })
        .map(publication => {
            const start = new Date(publication.scheduledAt)

            return {
                allDay: false,
                color: publicationColor(publication, duePublicationIds.has(publication.id)),
                data: {
                    due: duePublicationIds.has(publication.id),
                    publication,
                    publications: [publication],
                },
                end: start,
                id: publication.id,
                readOnly: true,
                start,
                title: publicationIdentityLabel(publication),
            }
        })
        .filter(event => !Number.isNaN(event.start.getTime()))
        .sort((left, right) => {
            const startDifference = left.start.getTime() - right.start.getTime()
            if (startDifference !== 0) return startDifference
            return left.id.localeCompare(right.id)
        })
}

/**
 * A post sent to several channels is one calendar entry with its channels, not one line per
 * channel (ADR-103 §3). Views that only show the day (month, agenda) group a post's channels
 * across the whole civil day in `dayTimeZone`, so channels staggered by a cadence still read
 * as one post; views placed on a time axis (week, day) group the same minute only. The group
 * keeps its earliest publication as lead, so a single-channel entry is unchanged, and takes
 * the most urgent state colour of its members.
 */
export function groupPublicationCalendarEvents(
    events: readonly CalendarEvent<PublicationEventData>[],
    dayTimeZone?: string
): CalendarEvent<PublicationEventData>[] {
    const groups = new Map<string, CalendarEvent<PublicationEventData>>()
    for (const event of events) {
        const data = event.data
        if (data === undefined) continue
        const slot =
            dayTimeZone === undefined
                ? String(Math.floor(event.start.getTime() / 60_000))
                : toDateKey(event.start, dayTimeZone)
        const key = `${data.publication.postId}:${slot}`
        const current = groups.get(key)
        if (current?.data === undefined) {
            groups.set(key, event)
            continue
        }
        groups.set(key, {
            ...current,
            color: mostUrgentColor(current.color, event.color),
            data: {
                ...current.data,
                due: current.data.due || data.due,
                publications: [...current.data.publications, ...data.publications],
            },
        })
    }
    return [...groups.values()]
}

const colorUrgency = [
    'var(--color-state-failed)',
    'var(--color-state-attention)',
    'var(--color-primary)',
    'var(--color-state-published)',
]

function mostUrgentColor(left: string | undefined, right: string | undefined) {
    const rank = (color: string | undefined) => {
        const index = colorUrgency.indexOf(color ?? '')
        return index < 0 ? colorUrgency.length : index
    }
    return rank(right) < rank(left) ? right : left
}

/**
 * Occupancy from other projects is shown beside, never inside, this project's own work.
 * `label` is already localized and holds only what the caller is allowed to know.
 */
export function toOccupancyCalendarEvents(
    occupancy: readonly ChannelOccupancy[],
    label: (item: ChannelOccupancy) => string
): CalendarEvent<OccupancyEventData>[] {
    return occupancy.map((item, index) => {
        const start = new Date(item.at)
        return {
            allDay: false,
            color: 'var(--color-muted-foreground)',
            data: { due: false, occupancy: item },
            end: start,
            id: `occupancy:${item.channelId}:${item.at}:${index}`,
            readOnly: true,
            start,
            title: label(item),
        }
    })
}

export type { PublicationCalendarView }
export { isPublicationCalendarView }

function publicationColor(publication: PublicationSummary, due: boolean) {
    if (publication.state === 'failed' || publication.state === 'ambiguous') {
        return 'var(--color-state-failed)'
    }
    if (due) return 'var(--color-state-attention)'
    if (publication.state === 'published') return 'var(--color-state-published)'
    return 'var(--color-primary)'
}
