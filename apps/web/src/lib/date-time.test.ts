import { describe, expect, it } from 'bun:test'

import {
    detectDefaultProjectTimeZone,
    moveProjectSchedule,
    formatCivilSchedule,
    formatProjectDateTime,
    listSupportedProjectTimeZones,
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
        const thisYear = new Date().getUTCFullYear() === 2026
        expect(formatProjectDateTime(timestamp, 'America/New_York')).toContain(
            thisYear ? 'Jan 2' : 'Jan 2, 2026'
        )
        expect(formatProjectDateTime(timestamp, 'America/New_York')).toContain('12:34 AM')
    })

    it('omits the current year and keeps other years', () => {
        const now = new Date()
        const current = Date.UTC(now.getUTCFullYear(), 5, 15, 12)
        const previous = Date.UTC(now.getUTCFullYear() - 1, 5, 15, 12)
        expect(formatProjectDateTime(current, 'UTC')).not.toContain(String(now.getUTCFullYear()))
        expect(formatProjectDateTime(previous, 'UTC')).toContain(String(now.getUTCFullYear() - 1))
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

    it('detects a valid default project timezone and lists supported IANA zones with UTC first', () => {
        const detected = detectDefaultProjectTimeZone()
        expect(detected.length).toBeGreaterThan(0)
        expect(() => Intl.DateTimeFormat('en-US', { timeZone: detected })).not.toThrow()

        const zones = listSupportedProjectTimeZones('Europe/Paris')
        expect(zones[0]).toBe('UTC')
        expect(zones).toContain('Europe/Paris')
        expect(zones).toContain('America/New_York')
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

describe('moving project schedules', () => {
    it('keeps 09:00 across spring and autumn DST changes for days and weeks', () => {
        for (const [from, to, hours] of [
            ['2027-03-27T09:00', '2027-03-28T09:00', 23],
            ['2027-10-30T09:00', '2027-10-31T09:00', 25],
        ] as const) {
            const start = parseDateTimeLocal(from, 'Europe/Paris') as number
            const end = parseDateTimeLocal(to, 'Europe/Paris') as number
            expect(moveProjectSchedule(start, 1, '24', 'Europe/Paris')).toBe(end)
            expect(end - start).toBe(hours * 3_600_000)
            expect(moveProjectSchedule(end, -1, '24', 'Europe/Paris')).toBe(start)
            expect(moveProjectSchedule(start, 24, '1', 'Europe/Paris')).toBe(start + 86_400_000)
            const week = moveProjectSchedule(start, 1, '168', 'Europe/Paris') as number
            expect(toDateTimeLocal(week, 'Europe/Paris').slice(-5)).toBe('09:00')
        }
    })
    it('rejects nonexistent and ambiguous destination times', () => {
        const spring = parseDateTimeLocal('2027-03-27T02:30', 'Europe/Paris') as number
        const autumn = parseDateTimeLocal('2027-10-30T02:30', 'Europe/Paris') as number
        expect(moveProjectSchedule(spring, 1, '24', 'Europe/Paris')).toBe('nonexistent')
        expect(moveProjectSchedule(autumn, 1, '24', 'Europe/Paris')).toBe('ambiguous')
    })
})
