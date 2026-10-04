import { describe, expect, it } from 'bun:test'

import {
    formatCivilSchedule,
    formatProjectDateTime,
    parseDateTimeLocal,
    toDateTimeLocal,
} from './date-time'

describe('local date-time helpers', () => {
    it('round-trips a timestamp through the datetime-local representation', () => {
        const timestamp = Date.UTC(2026, 0, 2, 12, 34)

        expect(parseDateTimeLocal(toDateTimeLocal(timestamp))).toBe(timestamp)
    })

    it('distinguishes an empty value from an invalid value', () => {
        expect(parseDateTimeLocal('')).toBeNull()
        expect(parseDateTimeLocal('not-a-date')).toBe('invalid')
    })

    it('resolves and formats values in the project timezone', () => {
        const timestamp = Date.UTC(2026, 0, 2, 5, 34)

        expect(toDateTimeLocal(timestamp, 'America/New_York')).toBe('2026-01-02T00:34')
        expect(parseDateTimeLocal('2026-01-02T00:34', 'America/New_York')).toBe(timestamp)
        expect(formatProjectDateTime(timestamp, 'America/New_York')).toContain('Jan 2, 2026')
        expect(formatProjectDateTime(timestamp, 'America/New_York')).toContain('12:34 AM')
    })

    it('uses the project timezone when a timestamp crosses UTC midnight', () => {
        const timestamp = Date.UTC(2026, 8, 13, 1, 30)

        expect(toDateTimeLocal(timestamp, 'America/New_York')).toBe('2026-09-12T21:30')
    })

    it('rejects nonexistent and ambiguous daylight-saving local times', () => {
        expect(parseDateTimeLocal('2026-03-08T02:30', 'America/New_York')).toBe('nonexistent')
        expect(parseDateTimeLocal('2026-11-01T01:30', 'America/New_York')).toBe('ambiguous')
    })

    it('resolves a southern-European summer offset explicitly', () => {
        const timestamp = Date.UTC(2026, 6, 1, 10, 0)

        expect(parseDateTimeLocal('2026-07-01T12:00', 'Europe/Paris')).toBe(timestamp)
        expect(toDateTimeLocal(timestamp, 'Europe/Paris')).toBe('2026-07-01T12:00')
    })
})

describe('civil schedule display', () => {
    it('keeps project wall time without interpreting it in the browser timezone', () => {
        expect(formatCivilSchedule('2026-03-08T02:30', 'en')).toContain('02:30')
        expect(formatCivilSchedule('2026-03-08T02:30', 'fr')).toContain('02:30')
    })
    it('rejects malformed and impossible saved values without throwing', () => {
        for (const value of ['', 'broken', '2026-02-30T12:00', '2026-10-04T12:00Z']) {
            expect(formatCivilSchedule(value, 'en')).toBe('')
        }
    })
})
