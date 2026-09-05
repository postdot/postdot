import { describe, expect, test } from 'bun:test'

import {
    calendarDateTimeLocal,
    createPublicationTarget,
    parseCalendarDate,
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
        expect(
            createPublicationTarget('channel-1', 'America/New_York', '2026-09-05').scheduledAt
        ).toBe('2026-09-05T09:00')
    })
})
