import { expect, test } from 'bun:test'

import {
    deliveryCoverageIncomplete,
    deliveryDays,
    deliveryDestinations,
    previousDeliveryRange,
} from './delivery-analytics'
import {
    parseDeliveryAnalyticsChannel,
    parseDeliveryAnalyticsPeriod,
} from './publication-performance-search'

test('fills project calendar days across a DST change and keeps real zeroes', () => {
    const report = {
        projectTimeZone: 'Europe/Paris',
        range: { from: Date.parse('2026-03-27T23:00:00Z'), to: Date.parse('2026-03-30T22:00:00Z') },
        historical: {
            buckets: [
                {
                    bucketDate: '2026-03-28',
                    metrics: {
                        publicationsPublished: 2,
                        publicationsFailed: 1,
                        publicationsAmbiguous: 0,
                    },
                },
                {
                    bucketDate: '2026-03-30',
                    metrics: {
                        publicationsPublished: 0,
                        publicationsFailed: 0,
                        publicationsAmbiguous: 1,
                    },
                },
            ],
        },
    } satisfies Parameters<typeof deliveryDays>[0]
    expect(deliveryDays(report)).toEqual([
        { date: '2026-03-28', published: 2, failed: 1, ambiguous: 0 },
        { date: '2026-03-29', published: 0, failed: 0, ambiguous: 0 },
        { date: '2026-03-30', published: 0, failed: 0, ambiguous: 1 },
    ])
    expect(previousDeliveryRange(report.range)).toEqual({
        from: report.range.from - (report.range.to - report.range.from),
        to: report.range.from,
    })
})

test('merges channel dimensions without conflating distinct destinations or outcome categories', () => {
    const dimension = (channelId: string | null, count: number) => ({
        channelId,
        channelName: channelId,
        provider: 'manual',
        deliveryMode: 'manual' as const,
        count,
    })
    const report = {
        historical: {
            publications: {
                byDimension: {
                    published: [
                        dimension('one', 4),
                        { ...dimension('one', 2), deliveryMode: 'automatic' as const },
                        dimension('two', 3),
                    ],
                    failed: [dimension('one', 1)],
                    ambiguous: [dimension(null, 1)],
                },
            },
        },
    } satisfies Parameters<typeof deliveryDestinations>[0]
    expect(deliveryDestinations(report)).toEqual([
        { channelId: 'one', name: 'one', published: 6, failed: 1, ambiguous: 0 },
        { channelId: 'two', name: 'two', published: 3, failed: 0, ambiguous: 0 },
        { channelId: null, name: null, published: 0, failed: 0, ambiguous: 1 },
    ])
})

test('treats skipped or malformed facts as incomplete without confusing latency gaps with missing totals', () => {
    const coverage = {
        skippedFactCount: 0,
        dataQuality: { invalidMetadata: 0, incompleteLatencyPairs: 3 },
    }
    expect(deliveryCoverageIncomplete(coverage)).toBe(false)
    expect(deliveryCoverageIncomplete({ ...coverage, skippedFactCount: 1 })).toBe(true)
    expect(
        deliveryCoverageIncomplete({
            ...coverage,
            dataQuality: { ...coverage.dataQuality, invalidMetadata: 1 },
        })
    ).toBe(true)
})

test('normalizes URL filters to bounded supported periods and a single destination', () => {
    expect(parseDeliveryAnalyticsPeriod('90')).toBe(90)
    expect(parseDeliveryAnalyticsPeriod(7)).toBe(7)
    expect(parseDeliveryAnalyticsPeriod('999999')).toBe(30)
    expect(parseDeliveryAnalyticsChannel(['one', 'two'])).toBeUndefined()
    expect(parseDeliveryAnalyticsChannel(' one ')).toBe('one')
})
