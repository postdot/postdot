import type { ProjectAnalytics } from './api'
import { getZonedDateTimeParts } from './date-time'

export interface DeliveryDay {
    readonly date: string
    readonly published: number
    readonly failed: number
    readonly ambiguous: number
}

function civilDate(timestamp: number, timeZone: string) {
    const { year, month, day } = getZonedDateTimeParts(timestamp, timeZone)
    return Date.UTC(year, month - 1, day)
}

/** Fill calendar dates, not 24-hour steps in the project's timezone. */
export function deliveryDays(
    report: Pick<ProjectAnalytics, 'range' | 'projectTimeZone'> & {
        readonly historical: {
            readonly buckets: readonly {
                readonly bucketDate: string
                readonly metrics: Pick<
                    ProjectAnalytics['historical']['buckets'][number]['metrics'],
                    'publicationsPublished' | 'publicationsFailed' | 'publicationsAmbiguous'
                >
            }[]
        }
    }
): DeliveryDay[] {
    const buckets = new Map(
        report.historical.buckets.map(bucket => [bucket.bucketDate, bucket.metrics])
    )
    const end = civilDate(Math.max(report.range.from, report.range.to - 1), report.projectTimeZone)
    const result: DeliveryDay[] = []
    for (
        let at = civilDate(report.range.from, report.projectTimeZone);
        at <= end;
        at += 86_400_000
    ) {
        const date = new Date(at).toISOString().slice(0, 10)
        const metrics = buckets.get(date)
        result.push({
            date,
            published: metrics?.publicationsPublished ?? 0,
            failed: metrics?.publicationsFailed ?? 0,
            ambiguous: metrics?.publicationsAmbiguous ?? 0,
        })
    }
    return result
}

export function previousDeliveryRange(range: ProjectAnalytics['range']) {
    return { from: Math.max(0, range.from - (range.to - range.from)), to: range.from }
}

export function deliveryCoverageIncomplete(coverage: {
    readonly skippedFactCount: number
    readonly dataQuality: Pick<ProjectAnalytics['coverage']['dataQuality'], 'invalidMetadata'>
}): boolean {
    return coverage.skippedFactCount > 0 || coverage.dataQuality.invalidMetadata > 0
}

export function deliveryCounters(report: ProjectAnalytics) {
    return {
        published: report.historical.publications.published,
        failed: report.historical.publications.failed,
        ambiguous: report.historical.publications.ambiguous,
        retries: report.historical.retries.scheduled,
    }
}

export function deliveryDestinations(report: {
    readonly historical: {
        readonly publications: {
            readonly byDimension: Pick<
                ProjectAnalytics['historical']['publications']['byDimension'],
                'published' | 'failed' | 'ambiguous'
            >
        }
    }
}) {
    const rows = new Map<
        string,
        {
            channelId: string | null
            name: string | null
            published: number
            failed: number
            ambiguous: number
        }
    >()
    for (const metric of ['published', 'failed', 'ambiguous'] as const) {
        for (const dimension of report.historical.publications.byDimension[metric]) {
            const key = dimension.channelId ?? `unknown:${dimension.provider}`
            const row = rows.get(key) ?? {
                channelId: dimension.channelId,
                name: dimension.channelName,
                published: 0,
                failed: 0,
                ambiguous: 0,
            }
            row[metric] += dimension.count
            rows.set(key, row)
        }
    }
    return [...rows.values()].sort(
        (a, b) => b.published - a.published || (a.name ?? '').localeCompare(b.name ?? '')
    )
}
