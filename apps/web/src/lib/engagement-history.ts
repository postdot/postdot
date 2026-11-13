import type { ProviderAnalyticsItem } from './api'

export function measuredSnapshot(item: ProviderAnalyticsItem): boolean {
    return item.availability === 'measured' && item.value !== null
}

function formatIdentity(item: ProviderAnalyticsItem): string {
    return JSON.stringify([
        item.provider,
        item.metricName,
        item.postdotEntityId,
        item.subjectType,
        item.providerSubjectId,
        item.providerContentRevisionId,
        item.unit,
        item.aggregation,
        item.reportingPeriodStart,
        item.reportingPeriodEnd,
    ])
}

/** A gap or a changed content/measurement identity cannot establish a change. */
export function snapshotDifference(
    newer: ProviderAnalyticsItem | undefined,
    older: ProviderAnalyticsItem | undefined
): number | null {
    return newer &&
        older &&
        measuredSnapshot(newer) &&
        measuredSnapshot(older) &&
        formatIdentity(newer) === formatIdentity(older)
        ? newer.value! - older.value!
        : null
}

export function engagementHistoryModel(observations: readonly ProviderAnalyticsItem[]) {
    const descending = [...new Map(observations.map(item => [item.id, item])).values()].sort(
        (a, b) => b.fetchedAt - a.fetchedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    )
    const ascending = [...descending].reverse()
    const measured = ascending.filter(measuredSnapshot)
    const compatible = new Set(measured.map(formatIdentity)).size <= 1
    const segments: ProviderAnalyticsItem[][] = []
    let segment: ProviderAnalyticsItem[] = []
    for (const item of ascending) {
        if (!measuredSnapshot(item)) {
            if (segment.length) segments.push(segment)
            segment = []
        } else segment.push(item)
    }
    if (segment.length) segments.push(segment)
    return {
        descending,
        ascending,
        measured,
        compatible,
        segments,
        difference: snapshotDifference(descending[0], descending[1]),
    }
}
