import type { PublicationSummary } from '@/lib/api'

export const calendarWeekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

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
    readonly year: number
}

export function createCalendarMonth(
    cursor: Date,
    publications: readonly PublicationSummary[],
    today = new Date()
): CalendarMonth {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const monthStart = new Date(year, month, 1)
    const gridStart = startOfMondayWeek(monthStart)
    const publicationsByDate = groupScheduledPublications(publications)
    const todayKey = toDateKey(today)
    const days = Array.from({ length: 42 }, (_, index) => {
        const date = addDays(gridStart, index)
        const dateKey = toDateKey(date)

        return {
            date,
            dateKey,
            dayOfMonth: date.getDate(),
            isCurrentMonth: date.getMonth() === month,
            isToday: dateKey === todayKey,
            publications: publicationsByDate.get(dateKey) ?? [],
        }
    })

    return {
        days,
        label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
            monthStart
        ),
        month,
        year,
    }
}

export function groupScheduledPublications(publications: readonly PublicationSummary[]) {
    const grouped = new Map<string, PublicationSummary[]>()

    for (const publication of publications) {
        if (publication.scheduledAt === null) continue

        const dateKey = toDateKey(new Date(publication.scheduledAt))
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
    return new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1)
}

export function startOfCalendarMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function toDateKey(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function addDays(date: Date, amount: number) {
    const result = new Date(date)
    result.setDate(result.getDate() + amount)
    return result
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
    const result = new Date(date)
    const daysSinceMonday = (result.getDay() + 6) % 7
    result.setDate(result.getDate() - daysSinceMonday)
    return result
}
