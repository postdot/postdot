import { TZDate } from '@date-fns/tz'

import type { PublicationSummary } from '@/lib/api'
import { getZonedDateTimeParts, parseDateTimeLocal } from '@/lib/date-time'

export function calendarWeekdays(locale = 'en') {
    const monday = Date.UTC(2021, 10, 1)
    const formatter = new Intl.DateTimeFormat(locale, {
        timeZone: 'UTC',
        weekday: 'short',
    })
    return Array.from({ length: 7 }, (_, index) =>
        formatter.format(new Date(monday + index * 86_400_000))
    )
}

export interface CalendarDay {
    readonly date: Date
    readonly dateKey: string
    readonly dayOfMonth: number
    readonly isCurrentMonth: boolean
    readonly isToday: boolean
    readonly publications: readonly PublicationSummary[]
}

export interface CalendarMonth {
    readonly days: readonly CalendarDay[]
    readonly label: string
    readonly month: number
    readonly timeZone: string
    readonly year: number
}

export interface CalendarMonthTimestampRange {
    readonly from: number
    readonly to: number
}

export function createCalendarMonth(
    cursor: Date,
    publications: readonly PublicationSummary[],
    today = new Date(),
    timeZone = 'UTC',
    locale = 'en'
): CalendarMonth {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth()
    const monthStart = createCivilDate(year, month, 1)
    const gridStart = startOfMondayWeek(monthStart)
    const publicationsByDate = groupScheduledPublications(publications, timeZone)
    const todayKey = toDateKey(today, timeZone)
    const days = Array.from({ length: 42 }, (_, index) => {
        const date = addDays(gridStart, index)
        const dateKey = toCivilDateKey(date)

        return {
            date,
            dateKey,
            dayOfMonth: date.getUTCDate(),
            isCurrentMonth: date.getUTCMonth() === month,
            isToday: dateKey === todayKey,
            publications: publicationsByDate.get(dateKey) ?? [],
        }
    })

    return {
        days,
        label: new Intl.DateTimeFormat(locale, {
            month: 'long',
            timeZone: 'UTC',
            year: 'numeric',
        }).format(monthStart),
        month,
        timeZone,
        year,
    }
}

export function groupScheduledPublications(
    publications: readonly PublicationSummary[],
    timeZone = 'UTC'
) {
    const grouped = new Map<string, PublicationSummary[]>()

    for (const publication of publications) {
        if (publication.scheduledAt === null) continue

        const dateKey = toDateKey(new Date(publication.scheduledAt), timeZone)
        const current = grouped.get(dateKey) ?? []
        current.push(publication)
        grouped.set(dateKey, current)
    }

    for (const current of grouped.values()) {
        current.sort(comparePublications)
    }

    return grouped
}

export function getUnscheduledPublications(publications: readonly PublicationSummary[]) {
    return publications.filter(publication => publication.scheduledAt === null)
}

export function shiftCalendarMonth(cursor: Date, offset: number) {
    return createCivilDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + offset, 1)
}

export function startOfCalendarMonth(date = new Date(), timeZone = 'UTC') {
    const parts = getZonedDateTimeParts(date.getTime(), timeZone)
    return createCivilDate(parts.year, parts.month - 1, 1)
}

export function getCalendarMonthTimestampRange(
    cursor: Date,
    timeZone = 'UTC'
): CalendarMonthTimestampRange {
    const start = calendarBoundary(cursor, timeZone)
    const end = calendarBoundary(shiftCalendarMonth(cursor, 1), timeZone)
    if (end <= start) throw new Error('Calendar month range is invalid')
    return { from: start, to: end }
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
): CalendarMonthTimestampRange {
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

function toCivilDateKey(date: Date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function addDays(date: Date, amount: number) {
    return createCivilDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + amount)
}

function comparePublications(left: PublicationSummary, right: PublicationSummary) {
    if (left.scheduledAt !== right.scheduledAt) {
        return (
            (left.scheduledAt ?? Number.MAX_SAFE_INTEGER) -
            (right.scheduledAt ?? Number.MAX_SAFE_INTEGER)
        )
    }

    return `${left.postTitle ?? ''}\u0000${left.channelName}`.localeCompare(
        `${right.postTitle ?? ''}\u0000${right.channelName}`
    )
}

function startOfMondayWeek(date: Date) {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7
    return addDays(date, -daysSinceMonday)
}

function calendarBoundary(date: Date, timeZone: string) {
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T00:00`
    const timestamp = parseDateTimeLocal(value, timeZone)
    if (typeof timestamp !== 'number') {
        throw new Error(`Calendar boundary cannot be represented in ${timeZone}`)
    }
    return timestamp
}
