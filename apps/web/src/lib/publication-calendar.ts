import { TZDate } from '@date-fns/tz'

import type { PublicationSummary } from '@/lib/api'
import { getZonedDateTimeParts, parseDateTimeLocal } from '@/lib/date-time'

interface CalendarTimestampRange {
    readonly from: number
    readonly to: number
}

export function getUnscheduledPublications(publications: readonly PublicationSummary[]) {
    return publications.filter(publication => publication.scheduledAt === null)
}

function shiftCalendarMonth(cursor: Date, offset: number) {
    return createCivilDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + offset, 1)
}

/**
 * Bounded read window for the ReUI calendar's month, week, and agenda modes.
 * The adjacent months cover the six-week month frame, a week crossing a month
 * boundary, and the default thirty-day agenda without turning the calendar read
 * into an unbounded project-history query.
 */
export function getCalendarViewportTimestampRange(
    cursor: Date,
    timeZone = 'UTC'
): CalendarTimestampRange {
    const from = calendarBoundary(shiftCalendarMonth(cursor, -1), timeZone)
    const to = calendarBoundary(shiftCalendarMonth(cursor, 2), timeZone)
    if (to <= from) throw new Error('Calendar viewport range is invalid')
    return { from, to }
}

export function toDateKey(date: Date, timeZone = 'UTC') {
    const parts = getZonedDateTimeParts(date.getTime(), timeZone)
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/**
 * Validate the date-only format used by calendar URLs without letting the
 * host runtime reinterpret the value as UTC or local time.
 */
export function isCalendarDateKey(value: unknown): value is string {
    return readCalendarDateParts(value) !== null
}

/** Parse a calendar URL date as a civil UTC-noon cursor for calendar math. */
export function parseCalendarDateKey(value: unknown): Date | undefined {
    const parts = readCalendarDateParts(value)
    return parts === null ? undefined : createCivilDate(parts.year, parts.month - 1, parts.day)
}

/**
 * Materialize a calendar URL date at local noon in the project's timezone.
 * The timezone-aware instance keeps the focused civil day stable even when a
 * project's offset would move a UTC-noon Date across a date boundary.
 */
export function calendarDateFromKey(value: unknown, timeZone = 'UTC'): Date | undefined {
    const parts = readCalendarDateParts(value)
    return parts === null
        ? undefined
        : new TZDate(parts.year, parts.month - 1, parts.day, 12, timeZone)
}

function createCivilDate(year: number, month: number, day: number) {
    const date = new Date(0)
    date.setUTCFullYear(year, month, day)
    date.setUTCHours(12, 0, 0, 0)
    return date
}

function readCalendarDateParts(value: unknown) {
    if (typeof value !== 'string') return null
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (match === null) return null

    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (
        year < 1 ||
        year > 9999 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > daysInMonth(year, month)
    ) {
        return null
    }

    return { day, month, year }
}

function daysInMonth(year: number, month: number) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    if (month === 2) return leapYear ? 29 : 28
    return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function calendarBoundary(date: Date, timeZone: string) {
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T00:00`
    const timestamp = parseDateTimeLocal(value, timeZone)
    if (typeof timestamp !== 'number') {
        throw new Error(`Calendar boundary cannot be represented in ${timeZone}`)
    }
    return timestamp
}
