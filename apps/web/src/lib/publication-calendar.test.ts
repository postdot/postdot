import { describe, expect, test } from 'bun:test'

import type { PublicationSummary } from '@/lib/api'

import {
    calendarDateFromKey,
    createCalendarMonth,
    getCalendarMonthTimestampRange,
    getCalendarViewportTimestampRange,
    getUnscheduledPublications,
    groupScheduledPublications,
    isCalendarDateKey,
    parseCalendarDateKey,
    startOfCalendarMonth,
    shiftCalendarMonth,
    toDateKey,
} from './publication-calendar'

function publication(id: string, scheduledAt: number | null, postTitle = id) {
    return {
        id,
        channelName: `${id} channel`,
        postTitle,
        scheduledAt,
    } as unknown as PublicationSummary
}

describe('publication calendar', () => {
    test('accepts canonical valid civil date keys only', () => {
        expect(isCalendarDateKey('2026-09-12')).toBe(true)
        expect(isCalendarDateKey('2024-02-29')).toBe(true)
        expect(isCalendarDateKey('2026-02-29')).toBe(false)
        expect(isCalendarDateKey('2026-9-12')).toBe(false)
        expect(isCalendarDateKey('2026-09-12T12:00')).toBe(false)
        expect(isCalendarDateKey(undefined)).toBe(false)
    })

    test('keeps civil date parsing independent from the host timezone', () => {
        const cursor = parseCalendarDateKey('0001-01-02')
        const expected = new Date(0)
        expected.setUTCFullYear(1, 0, 2)
        expected.setUTCHours(12, 0, 0, 0)
        expect(cursor).toEqual(expected)
        expect(cursor?.getUTCFullYear()).toBe(1)
        expect(cursor?.getUTCMonth()).toBe(0)
        expect(cursor?.getUTCDate()).toBe(2)
        expect(parseCalendarDateKey('2026-02-29')).toBeUndefined()
    })

    test('materializes the focused date in the project timezone', () => {
        const date = calendarDateFromKey('2026-09-12', 'Pacific/Kiritimati')

        if (date === undefined) throw new Error('expected a valid calendar date')
        expect(toDateKey(date, 'Pacific/Kiritimati')).toBe('2026-09-12')
        expect(calendarDateFromKey('not-a-date', 'UTC')).toBeUndefined()
    })

    test('builds a stable Monday-first six-week month grid', () => {
        const month = createCalendarMonth(
            new Date(Date.UTC(2026, 8, 1, 12)),
            [],
            new Date(Date.UTC(2026, 8, 12, 12))
        )

        expect(month.label).toBe('September 2026')
        expect(month.days).toHaveLength(42)
        expect(month.days[0]?.dateKey).toBe('2026-08-31')
        expect(month.days[0]?.isCurrentMonth).toBe(false)
        expect(month.days[12]?.dateKey).toBe('2026-09-12')
        expect(month.days[12]?.isToday).toBe(true)
        expect(month.days.at(-1)?.dateKey).toBe('2026-10-11')
    })

    test('groups only scheduled publications by local date and sorts them', () => {
        const first = Date.UTC(2026, 8, 12, 9, 0)
        const second = Date.UTC(2026, 8, 12, 11, 0)
        const grouped = groupScheduledPublications([
            publication('later', second, 'Later'),
            publication('unscheduled', null),
            publication('earlier', first, 'Earlier'),
        ])

        expect(grouped.get('2026-09-12')?.map(item => item.id)).toEqual(['earlier', 'later'])
        expect(getUnscheduledPublications([...grouped.values()].flat())).toEqual([])
        expect(toDateKey(new Date(first))).toBe('2026-09-12')
    })

    test('keeps unscheduled work outside the calendar date map', () => {
        const unscheduled = publication('unscheduled', null)
        const scheduled = publication('scheduled', Date.UTC(2026, 8, 12, 12))
        const month = createCalendarMonth(new Date(Date.UTC(2026, 8, 1, 12)), [
            unscheduled,
            scheduled,
        ])

        expect(getUnscheduledPublications([unscheduled, scheduled])).toEqual([unscheduled])
        expect(month.days.find(day => day.dateKey === '2026-09-12')?.publications).toEqual([
            scheduled,
        ])
    })

    test('shifts month cursors across year boundaries', () => {
        expect(shiftCalendarMonth(new Date(Date.UTC(2026, 11, 1, 12)), 1)).toEqual(
            new Date(Date.UTC(2027, 0, 1, 12))
        )
        expect(shiftCalendarMonth(new Date(Date.UTC(2027, 0, 1, 12)), -1)).toEqual(
            new Date(Date.UTC(2026, 11, 1, 12))
        )
    })

    test('groups a publication by its project date near UTC midnight', () => {
        const scheduled = publication('evening', Date.UTC(2026, 8, 13, 1, 30))
        const grouped = groupScheduledPublications([scheduled], 'America/New_York')

        expect(grouped.get('2026-09-12')?.map(item => item.id)).toEqual(['evening'])
        expect(toDateKey(new Date(scheduled.scheduledAt as number), 'America/New_York')).toBe(
            '2026-09-12'
        )
    })

    test('starts the calendar month from the project timezone', () => {
        const monthStart = startOfCalendarMonth(
            new Date(Date.UTC(2026, 8, 1, 1, 0)),
            'America/New_York'
        )

        expect(monthStart).toEqual(new Date(Date.UTC(2026, 7, 1, 12)))
    })

    test('builds an exclusive timestamp range in the project timezone', () => {
        expect(
            getCalendarMonthTimestampRange(new Date(Date.UTC(2026, 8, 1, 12)), 'America/New_York')
        ).toEqual({
            from: Date.UTC(2026, 8, 1, 4),
            to: Date.UTC(2026, 9, 1, 4),
        })
    })

    test('keeps adjacent months available for bounded multi-view reads', () => {
        expect(
            getCalendarViewportTimestampRange(
                new Date(Date.UTC(2026, 8, 1, 12)),
                'America/New_York'
            )
        ).toEqual({
            from: Date.UTC(2026, 7, 1, 4),
            to: Date.UTC(2026, 10, 1, 4),
        })
    })
})
