import { describe, expect, test } from 'bun:test'

import type { PublicationSummary } from '@/lib/api'

import {
    calendarDateFromKey,
    formatCalendarTitle,
    getCalendarViewportTimestampRange,
    getUnscheduledPublications,
    isCalendarDateKey,
    parseCalendarDateKey,
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

    test('keeps unscheduled work outside the calendar range', () => {
        const unscheduled = publication('unscheduled', null)
        const scheduled = publication('scheduled', Date.UTC(2026, 8, 12, 12))

        expect(getUnscheduledPublications([unscheduled, scheduled])).toEqual([unscheduled])
        expect(toDateKey(new Date(scheduled.scheduledAt as number))).toBe('2026-09-12')
    })

    test('keeps a publication on its project date near UTC midnight', () => {
        const scheduled = publication('evening', Date.UTC(2026, 8, 13, 1, 30))

        expect(toDateKey(new Date(scheduled.scheduledAt as number), 'America/New_York')).toBe(
            '2026-09-12'
        )
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

describe('localized calendar period labels', () => {
    const range = { start: new Date('2026-09-28T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') }
    test('uses natural French and English order across months with an exclusive end', () => {
        expect(formatCalendarTitle('week', range.start, range, 'fr', 'UTC')).toMatch(
            /28 sept.*4 oct.*2026/
        )
        expect(formatCalendarTitle('week', range.start, range, 'en', 'UTC')).toMatch(
            /Sep 28.*Oct 4.*2026/
        )
    })
    test('keeps day and month titles in the project timezone', () => {
        const instant = new Date('2026-10-01T01:00:00Z')
        expect(formatCalendarTitle('day', instant, range, 'fr', 'America/New_York')).toMatch(
            /30 sept.*2026/
        )
        expect(formatCalendarTitle('month', instant, range, 'en', 'America/New_York')).toBe(
            'September 2026'
        )
    })
    test('shows both years when a period crosses the year boundary', () => {
        const years = {
            start: new Date('2025-12-29T00:00:00Z'),
            end: new Date('2026-01-05T00:00:00Z'),
        }
        const title = formatCalendarTitle('week', years.start, years, 'fr', 'UTC')
        expect(title).toMatch(/29.*2025.*4.*2026/)
    })
})
