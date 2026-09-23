import { describe, expect, test } from 'bun:test'

import type { PublicationSummary } from '@/lib/api'

import {
    calendarDateFromKey,
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
