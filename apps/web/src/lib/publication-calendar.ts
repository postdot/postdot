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

export function toDateKey(date: Date, timeZone = 'UTC') {
    const parts = getZonedDateTimeParts(date.getTime(), timeZone)
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function createCivilDate(year: number, month: number, day: number) {
    return new Date(Date.UTC(year, month, day, 12))
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
