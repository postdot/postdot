import { describe, expect, test } from 'bun:test'

import {
    getFirstVisibleTimedOccurrence,
    getInitialTimeGridAnchor,
} from './event-calendar-time-anchor'

const visibleRange = {
    end: new Date(Date.UTC(2026, 8, 14)),
    start: new Date(Date.UTC(2026, 8, 7)),
}

function occurrence(key: string, start: number, end: number, allDay = false) {
    return { allDay, end: new Date(end), key, start: new Date(start) }
}

describe('event calendar time anchor', () => {
    test('starts an empty range at the configured midnight baseline', () => {
        expect(
            getInitialTimeGridAnchor({
                endHour: 24,
                interval: 60,
                occurrences: [],
                startHour: 0,
                timeZone: 'UTC',
                visibleRange,
            })
        ).toBe(0)
    })

    test('keeps two time slots of context before the first timed publication', () => {
        const firstStart = Date.UTC(2026, 8, 12, 15, 54)
        const events = [
            occurrence('later', Date.UTC(2026, 8, 13, 16), Date.UTC(2026, 8, 13, 17)),
            occurrence('first', firstStart, Date.UTC(2026, 8, 12, 16)),
        ]

        expect(
            getInitialTimeGridAnchor({
                endHour: 24,
                interval: 60,
                occurrences: events,
                startHour: 0,
                timeZone: 'UTC',
                visibleRange,
            })
        ).toBe(13 * 60)
        expect(getFirstVisibleTimedOccurrence(events, visibleRange)?.key).toBe('first')
    })

    test('ignores all-day events and occurrences outside the visible range', () => {
        const events = [
            occurrence('outside', Date.UTC(2026, 8, 1, 10), Date.UTC(2026, 8, 1, 11)),
            occurrence('all-day', Date.UTC(2026, 8, 12), Date.UTC(2026, 8, 13), true),
        ]

        expect(getFirstVisibleTimedOccurrence(events, visibleRange)).toBeUndefined()
        expect(
            getInitialTimeGridAnchor({
                endHour: 24,
                interval: 60,
                occurrences: events,
                startHour: 0,
                timeZone: 'UTC',
                visibleRange,
            })
        ).toBe(0)
    })

    test('clamps early data to the start of the rendered range', () => {
        const events = [occurrence('early', Date.UTC(2026, 8, 7, 0, 15), Date.UTC(2026, 8, 7, 1))]

        expect(
            getInitialTimeGridAnchor({
                endHour: 24,
                interval: 30,
                occurrences: events,
                startHour: 0,
                timeZone: 'UTC',
                visibleRange,
            })
        ).toBe(0)
    })

    test('keeps context before an early-morning publication', () => {
        const events = [
            occurrence('early-morning', Date.UTC(2026, 8, 7, 5, 10), Date.UTC(2026, 8, 7, 6)),
        ]

        expect(
            getInitialTimeGridAnchor({
                endHour: 24,
                interval: 30,
                occurrences: events,
                startHour: 0,
                timeZone: 'UTC',
                visibleRange,
            })
        ).toBe(4 * 60)
    })

    test('keeps late-night publications in the same day and below the end bound', () => {
        const events = [
            occurrence('late-night', Date.UTC(2026, 8, 12, 23, 45), Date.UTC(2026, 8, 13)),
        ]

        expect(
            getInitialTimeGridAnchor({
                endHour: 24,
                interval: 60,
                occurrences: events,
                startHour: 0,
                timeZone: 'UTC',
                visibleRange,
            })
        ).toBe(21 * 60)
    })

    test('anchors using the publication hour in the display timezone', () => {
        const newYorkWeek = {
            end: new Date(Date.UTC(2026, 8, 14, 4)),
            start: new Date(Date.UTC(2026, 8, 7, 4)),
        }
        const events = [
            occurrence('new-york', Date.UTC(2026, 8, 12, 15, 54), Date.UTC(2026, 8, 12, 16, 30)),
        ]

        expect(
            getInitialTimeGridAnchor({
                endHour: 24,
                interval: 60,
                occurrences: events,
                startHour: 0,
                timeZone: 'America/New_York',
                visibleRange: newYorkWeek,
            })
        ).toBe(9 * 60)
    })

    test('anchors at the visible boundary when an occurrence crosses into the range', () => {
        const dayRange = {
            end: new Date(Date.UTC(2026, 8, 13)),
            start: new Date(Date.UTC(2026, 8, 12)),
        }
        const events = [
            occurrence('crossing-boundary', Date.UTC(2026, 8, 11, 22), Date.UTC(2026, 8, 12, 4)),
        ]

        expect(getFirstVisibleTimedOccurrence(events, dayRange)?.key).toBe('crossing-boundary')
        expect(
            getInitialTimeGridAnchor({
                endHour: 24,
                interval: 60,
                occurrences: events,
                startHour: 0,
                timeZone: 'UTC',
                visibleRange: dayRange,
            })
        ).toBe(0)
    })
})
