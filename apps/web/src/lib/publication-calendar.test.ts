import { describe, expect, test } from 'bun:test'

import type { PublicationSummary } from '@/lib/api'

import {
    createCalendarMonth,
    getUnscheduledPublications,
    groupScheduledPublications,
    shiftCalendarMonth,
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
    test('builds a stable Monday-first six-week month grid', () => {
        const month = createCalendarMonth(new Date(2026, 8, 1), [], new Date(2026, 8, 12))

        expect(month.label).toBe('September 2026')
        expect(month.days).toHaveLength(42)
        expect(month.days[0]?.dateKey).toBe('2026-08-31')
        expect(month.days[0]?.isCurrentMonth).toBe(false)
        expect(month.days[12]?.dateKey).toBe('2026-09-12')
        expect(month.days[12]?.isToday).toBe(true)
        expect(month.days.at(-1)?.dateKey).toBe('2026-10-11')
    })

    test('groups only scheduled publications by local date and sorts them', () => {
        const first = new Date(2026, 8, 12, 9, 0).getTime()
        const second = new Date(2026, 8, 12, 11, 0).getTime()
        const grouped = groupScheduledPublications([
            publication('later', second, 'Later'),
            publication('unscheduled', null),
            publication('earlier', first, 'Earlier'),
        ])

        expect(grouped.get('2026-09-12')?.map(item => item.id)).toEqual(['earlier', 'later'])
        expect(getUnscheduledPublications([...grouped.values()].flat())).toEqual([])
        expect(toDateKey(new Date(first))).toBe('2026-09-12')
    })

    test('keeps unscheduled work outside the calendar date map', () => {
        const unscheduled = publication('unscheduled', null)
        const scheduled = publication('scheduled', new Date(2026, 8, 12).getTime())
        const month = createCalendarMonth(new Date(2026, 8, 1), [unscheduled, scheduled])

        expect(getUnscheduledPublications([unscheduled, scheduled])).toEqual([unscheduled])
        expect(month.days.find(day => day.dateKey === '2026-09-12')?.publications).toEqual([
            scheduled,
        ])
    })

    test('shifts month cursors across year boundaries', () => {
        expect(shiftCalendarMonth(new Date(2026, 11, 1), 1)).toEqual(new Date(2027, 0, 1))
        expect(shiftCalendarMonth(new Date(2027, 0, 1), -1)).toEqual(new Date(2026, 11, 1))
    })
})
