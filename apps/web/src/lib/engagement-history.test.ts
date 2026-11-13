import { expect, test } from 'bun:test'

import type { ProviderAnalyticsItem } from './api'
import { engagementHistoryModel, snapshotDifference } from './engagement-history'

function snapshot(id: string, fetchedAt: number, value: number | null): ProviderAnalyticsItem {
    return {
        id,
        fetchedAt,
        value,
        provider: 'bluesky',
        projectId: 'project',
        subjectType: 'content',
        providerSubjectId: 'post',
        providerSubjectLabel: null,
        providerContentRevisionId: 'revision',
        postdotEntityType: 'publication',
        postdotEntityId: 'publication',
        metricName: 'likeCount',
        unit: value === null ? '' : 'count',
        aggregation: value === null ? '' : 'cumulative_snapshot',
        reportingPeriodStart: null,
        reportingPeriodEnd: null,
        observedAt: null,
        availability: value === null ? 'not_reported' : 'measured',
        freshness: 'unknown',
        provenance: 'test',
    }
}

test('keeps zero and negative changes and never turns an unavailable snapshot into zero', () => {
    const newer = snapshot('three', 3, 0)
    const older = snapshot('one', 1, 5)
    expect(snapshotDifference(newer, older)).toBe(-5)
    expect(snapshotDifference(newer, snapshot('gap', 2, null))).toBeNull()
    const model = engagementHistoryModel([newer, snapshot('gap', 2, null), older])
    expect(model.measured.map(item => item.value)).toEqual([5, 0])
    expect(model.segments.map(segment => segment.map(item => item.id))).toEqual([
        ['one'],
        ['three'],
    ])
    expect(model.difference).toBeNull()
})

test('refuses a continuous chart and pairwise comparison across changed revisions, subjects, units or reporting windows', () => {
    const older = snapshot('one', 1, 5)
    const newer = snapshot('two', 2, 7)
    for (const change of [
        { providerContentRevisionId: 'new-revision' },
        { providerSubjectId: 'other-post' },
        { unit: 'percent' },
        { aggregation: 'period_total' },
        { reportingPeriodStart: 1 },
        { reportingPeriodEnd: 2 },
    ]) {
        const changed = { ...newer, ...change }
        expect(snapshotDifference(changed, older)).toBeNull()
        expect(engagementHistoryModel([changed, older]).compatible).toBe(false)
    }
})

test('sorts by timestamp and stable identifier, removes repeated IDs and compares only the newest adjacent pair', () => {
    const older = snapshot('a', 1, 1)
    const newer = snapshot('b', 2, 7)
    const newest = snapshot('c', 2, 9)
    const model = engagementHistoryModel([older, newer, newest, newest])
    expect(model.descending.map(item => item.id)).toEqual(['c', 'b', 'a'])
    expect(model.difference).toBe(2)
    expect(model.compatible).toBe(true)
})
