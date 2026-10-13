import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types'
import type { PublicationSummary } from '@/lib/api'
import { publicationIdentityLabel } from '@/lib/publication-identity'

type PublicationCalendarView = 'month' | 'week' | 'day' | 'agenda'

export interface PublicationCalendarEventData {
    readonly due: boolean
    readonly publication: PublicationSummary
}

function isPublicationCalendarView(value: unknown): value is PublicationCalendarView {
    return value === 'month' || value === 'week' || value === 'day' || value === 'agenda'
}

/**
 * Adapts Postbot's point-in-time publications to the local ReUI calendar
 * contract. A publication is intentionally a zero-duration event: the
 * calendar should communicate when it is scheduled, not invent a duration.
 */
export function toPublicationCalendarEvents(
    publications: readonly PublicationSummary[],
    duePublicationIds: ReadonlySet<string>
): CalendarEvent<PublicationCalendarEventData>[] {
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
