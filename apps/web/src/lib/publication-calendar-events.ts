import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types'
import type { ChannelOccupancy, PublicationSummary } from '@/lib/api'
import { publicationIdentityLabel } from '@/lib/publication-identity'

type PublicationCalendarView = 'month' | 'week' | 'day' | 'agenda'

export interface PublicationEventData {
    readonly due: boolean
    readonly occupancy?: undefined
    readonly publication: PublicationSummary
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
