import { describe, expect, it } from 'bun:test'

import { parseDateTimeLocal, toDateTimeLocal } from './date-time'

describe('local date-time helpers', () => {
    it('round-trips a timestamp through the datetime-local representation', () => {
        const timestamp = Date.UTC(2026, 0, 2, 12, 34)

        expect(parseDateTimeLocal(toDateTimeLocal(timestamp))).toBe(timestamp)
    })

    it('distinguishes an empty value from an invalid value', () => {
        expect(parseDateTimeLocal('')).toBeNull()
        expect(parseDateTimeLocal('not-a-date')).toBe('invalid')
    })
})
