import { getZonedDateTimeParts } from './date-time'

interface TimeGridDateRange {
    readonly end: Date
    readonly start: Date
}

interface TimeGridOccurrence {
    readonly allDay: boolean
    readonly end: Date
    readonly key?: string
    readonly start: Date
}

/**
 * Return the first timed occurrence that contributes to a visible time grid.
 * All-day events do not establish a useful vertical time anchor.
 */
function getFirstVisibleTimedOccurrence<T extends TimeGridOccurrence>(
    occurrences: readonly T[],
    visibleRange: TimeGridDateRange
): T | undefined {
    const rangeStart = visibleRange.start.getTime()
    const rangeEnd = visibleRange.end.getTime()
    let first: T | undefined

    for (const occurrence of occurrences) {
        if (
            occurrence.allDay ||
            occurrence.end.getTime() <= rangeStart ||
            occurrence.start.getTime() >= rangeEnd
        ) {
            continue
        }

        if (first === undefined || occurrence.start.getTime() < first.start.getTime()) {
            first = occurrence
        }
    }

    return first
}

interface InitialTimeGridAnchorOptions {
    /** Number of slots kept before the first timed publication for orientation. */
    readonly contextIntervals?: number
    readonly endHour: number
    readonly interval: number
    readonly occurrences: readonly TimeGridOccurrence[]
    readonly startHour: number
    readonly timeZone: string
    readonly visibleRange: TimeGridDateRange
}

/**
 * Choose the first visible time slot without inventing a universal working
 * day. Empty ranges use the configured start (00:00 in Postbot); populated
 * ranges keep a small amount of temporal context before their first event.
 */
function getInitialTimeGridAnchor({
    contextIntervals = 2,
    endHour,
    interval,
    occurrences,
    startHour,
    timeZone,
    visibleRange,
}: InitialTimeGridAnchorOptions): number {
    const normalizedStartHour = Math.max(0, Math.min(23, startHour))
    const normalizedEndHour = Math.max(normalizedStartHour + 1, Math.min(24, endHour))
    const normalizedInterval = Math.max(1, Math.round(interval))
    const first = getFirstVisibleTimedOccurrence(occurrences, visibleRange)
    const startMinute = normalizedStartHour * 60

    if (first === undefined) return startMinute

    const firstVisibleTimestamp = Math.max(first.start.getTime(), visibleRange.start.getTime())
    const firstParts = getZonedDateTimeParts(firstVisibleTimestamp, timeZone)
    const firstMinute = firstParts.hour * 60 + firstParts.minute
    const contextMinutes = Math.max(0, Math.round(contextIntervals)) * normalizedInterval
    const candidate =
        Math.floor(firstMinute / normalizedInterval) * normalizedInterval - contextMinutes
    const latestStartMinute = normalizedEndHour * 60 - normalizedInterval

    return Math.min(latestStartMinute, Math.max(startMinute, candidate))
}

export type { InitialTimeGridAnchorOptions, TimeGridDateRange, TimeGridOccurrence }
export { getFirstVisibleTimedOccurrence, getInitialTimeGridAnchor }
