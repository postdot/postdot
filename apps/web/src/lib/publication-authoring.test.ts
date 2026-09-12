import { describe, expect, test } from 'bun:test'

import {
    calendarDateTimeLocal,
    createPublicationTarget,
    parseCalendarDate,
    parseCalendarTime,
} from './publication-authoring'

describe('publication authoring date context', () => {
    test('accepts valid civil calendar dates', () => {
        expect(parseCalendarDate('2026-09-05')).toBe('2026-09-05')
        expect(parseCalendarDate('2024-02-29')).toBe('2024-02-29')
    })

    test('rejects malformed and impossible calendar dates', () => {
        expect(parseCalendarDate('2026-9-05')).toBeUndefined()
        expect(parseCalendarDate('2026-02-29')).toBeUndefined()
        expect(parseCalendarDate('2026-04-31')).toBeUndefined()
        expect(parseCalendarDate(null)).toBeUndefined()
    })

    test('uses the selected calendar date for the initial target schedule', () => {
        expect(calendarDateTimeLocal('2026-09-05')).toBe('2026-09-05T09:00')
        expect(calendarDateTimeLocal('2026-09-05', '16:30')).toBe('2026-09-05T16:30')
        expect(
            createPublicationTarget('channel-1', 'America/New_York', '2026-09-05').scheduledAt
        ).toBe('2026-09-05T09:00')
    })

    test('accepts only canonical hour and minute values from calendar links', () => {
        expect(parseCalendarTime('00:00')).toBe('00:00')
        expect(parseCalendarTime('23:59')).toBe('23:59')
        expect(parseCalendarTime('9:00')).toBeUndefined()
        expect(parseCalendarTime('24:00')).toBeUndefined()
    })
})
