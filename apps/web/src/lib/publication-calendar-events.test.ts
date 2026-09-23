import { describe, expect, test } from 'bun:test'

import type { PublicationSummary } from '@/lib/api'

import {
    isPublicationCalendarView,
    toPublicationCalendarEvents,
} from './publication-calendar-events'

function publication(
    id: string,
    scheduledAt: number | null,
    overrides: Partial<PublicationSummary> = {}
) {
    return {
        channelName: `${id} channel`,
        id,
        postTitle: `${id} title`,
        scheduledAt,
        state: 'scheduled',
        ...overrides,
    } as unknown as PublicationSummary
}

describe('publication calendar adapter', () => {
    test('accepts only the reading modes exposed by the project overview', () => {
        expect(['month', 'week', 'day', 'agenda'].every(isPublicationCalendarView)).toBe(true)
        expect(isPublicationCalendarView('days')).toBe(false)
        expect(isPublicationCalendarView('resource')).toBe(false)
        expect(isPublicationCalendarView(undefined)).toBe(false)
    })

    test('excludes unscheduled publications and preserves point-in-time events', () => {
        const scheduledAt = Date.UTC(2026, 8, 12, 10, 30)
        const [event] = toPublicationCalendarEvents(
            [publication('scheduled', scheduledAt), publication('draft', null)],
            new Set()
        )

        expect(event).toMatchObject({
            end: new Date(scheduledAt),
            id: 'scheduled',
            start: new Date(scheduledAt),
        })
        expect(event?.data?.publication.id).toBe('scheduled')
        expect(event?.data?.due).toBe(false)
    })

    test('assigns state colors with attention taking precedence', () => {
        const scheduledAt = Date.UTC(2026, 8, 12, 10, 30)
        const events = toPublicationCalendarEvents(
            [
                publication('published', scheduledAt, { state: 'published' }),
                publication('due', scheduledAt + 1, { state: 'scheduled' }),
                publication('failed', scheduledAt + 2, { state: 'failed' }),
            ],
            new Set(['due'])
        )

        expect(events.map(event => event.color)).toEqual([
            'var(--color-state-published)',
            'var(--color-state-attention)',
            'var(--color-state-failed)',
        ])
    })

    test('sorts equal timestamps by stable publication id', () => {
        const scheduledAt = Date.UTC(2026, 8, 12, 10, 30)
        const events = toPublicationCalendarEvents(
            [publication('zulu', scheduledAt), publication('alpha', scheduledAt)],
            new Set()
        )

        expect(events.map(event => event.id)).toEqual(['alpha', 'zulu'])
    })
})
