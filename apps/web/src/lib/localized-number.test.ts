import { describe, expect, test } from 'bun:test'

import { parseLocalizedNumber } from './localized-number'

describe('parseLocalizedNumber', () => {
    test('reads grouped numbers as people type them', () => {
        expect(parseLocalizedNumber('1,000,000', 'en')).toBe(1_000_000)
        expect(parseLocalizedNumber('1 000 000', 'fr')).toBe(1_000_000)
        expect(parseLocalizedNumber('1 000', 'fr')).toBe(1000)
        expect(parseLocalizedNumber('1.000', 'de')).toBe(1000)
        expect(parseLocalizedNumber('2,5', 'fr')).toBe(2.5)
        expect(parseLocalizedNumber('2.5', 'en')).toBe(2.5)
    })

    test('rejects text that is not a number', () => {
        expect(parseLocalizedNumber('', 'en')).toBeNaN()
        expect(parseLocalizedNumber('ten', 'en')).toBeNaN()
        expect(parseLocalizedNumber('-3', 'en')).toBeNaN()
    })
})
