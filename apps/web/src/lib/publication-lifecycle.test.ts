import { describe, expect, test } from 'bun:test'

import { canEditPublication, isManualPublicationDue } from './publication-lifecycle'

describe('publication lifecycle helpers', () => {
    test('keeps drafts, scheduled publications, and failed attempts editable', () => {
        expect(canEditPublication('draft')).toBe(true)
        expect(canEditPublication('scheduled')).toBe(true)
        expect(canEditPublication('failed')).toBe(true)
    })

    test('locks publications that have entered or completed delivery', () => {
        expect(canEditPublication('ready')).toBe(false)
        expect(canEditPublication('publishing')).toBe(false)
        expect(canEditPublication('published')).toBe(false)
        expect(canEditPublication('ambiguous')).toBe(false)
        expect(canEditPublication('cancelled')).toBe(false)
    })

    test('only marks due manual publications as ready for manual completion', () => {
        const due = {
            deliveryMode: 'manual' as const,
            scheduledAt: 1_000,
            state: 'scheduled' as const,
        }
        expect(isManualPublicationDue(due, 1_000)).toBe(true)
        expect(isManualPublicationDue(due, 999)).toBe(false)
        expect(isManualPublicationDue({ ...due, deliveryMode: 'automatic' }, 2_000)).toBe(false)
        expect(isManualPublicationDue({ ...due, state: 'draft' }, 2_000)).toBe(false)
        expect(isManualPublicationDue({ ...due, scheduledAt: null }, 2_000)).toBe(false)
    })
})
