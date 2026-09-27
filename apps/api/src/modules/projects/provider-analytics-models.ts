import type { ProviderAnalyticsObservation } from '@herald/core'
import type { ProviderAnalyticsObservationPage } from '@herald/db'
import { Type } from 'typebox'

import type { BlueskyAnalyticsCollectionResponse } from './bluesky-analytics-service'
import type { DevtoAnalyticsCollectionResponse } from './devto-analytics-service'

const providerAnalyticsSubjectTypeSchema = Type.Union([
    Type.Literal('account'),
    Type.Literal('content'),
])

const providerAnalyticsEntityTypeSchema = Type.Union([
    Type.Literal('channel'),
    Type.Literal('publication'),
])

const providerAnalyticsAvailabilitySchema = Type.Union([
    Type.Literal('measured'),
    Type.Literal('not_reported'),
    Type.Literal('not_found'),
    Type.Literal('blocked'),
    Type.Literal('disabled'),
    Type.Literal('temporarily_unavailable'),
    Type.Literal('rate_limited'),
    Type.Literal('invalid_response'),
    Type.Literal('partial_response'),
    Type.Literal('not_configured'),
    Type.Literal('not_authorized'),
    Type.Literal('not_supported'),
])

const providerAnalyticsFreshnessSchema = Type.Union([
    Type.Literal('fresh'),
    Type.Literal('stale'),
    Type.Literal('unknown'),
])

export const providerAnalyticsObservationSchema = Type.Unsafe<ProviderAnalyticsObservation>(
    Type.Object({
        id: Type.String({ minLength: 1 }),
        projectId: Type.String({ minLength: 1 }),
        provider: Type.String({ minLength: 1 }),
        subjectType: providerAnalyticsSubjectTypeSchema,
        providerSubjectId: Type.String({ minLength: 1 }),
        providerSubjectLabel: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        providerContentRevisionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        heraldEntityType: Type.Union([providerAnalyticsEntityTypeSchema, Type.Null()]),
        heraldEntityId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        metricName: Type.String({ minLength: 1 }),
        value: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        unit: Type.String({ minLength: 1 }),
        aggregation: Type.String({ minLength: 1 }),
        reportingPeriodStart: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        reportingPeriodEnd: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        observedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        fetchedAt: Type.Integer({ minimum: 0 }),
        availability: providerAnalyticsAvailabilitySchema,
        freshness: providerAnalyticsFreshnessSchema,
        provenance: Type.String({ minLength: 1 }),
    })
)

export const providerAnalyticsQuery = Type.Object({
    subjectType: Type.Optional(providerAnalyticsSubjectTypeSchema),
    providerSubjectId: Type.Optional(Type.String({ minLength: 1 })),
    heraldEntityId: Type.Optional(Type.String({ minLength: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
})

export const blueskyAnalyticsCollectionBody = Type.Object({
    channelId: Type.String({ minLength: 1 }),
    publicationIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 25, uniqueItems: true })
    ),
})

export const devtoAnalyticsCollectionBody = Type.Object({
    channelId: Type.String({ minLength: 1 }),
    publicationId: Type.String({ minLength: 1 }),
})

export const providerAnalyticsObservationPageSchema = Type.Unsafe<ProviderAnalyticsObservationPage>(
    Type.Object({
        contractVersion: Type.Integer({ minimum: 1 }),
        projectId: Type.String({ minLength: 1 }),
        provider: Type.String({ minLength: 1 }),
        observations: Type.Array(providerAnalyticsObservationSchema),
        limit: Type.Integer({ minimum: 1, maximum: 500 }),
        hasMore: Type.Boolean(),
    })
)

const blueskyAnalyticsCoverageGapSchema = Type.Object({
    subjectType: providerAnalyticsSubjectTypeSchema,
    providerSubjectId: Type.String({ minLength: 1 }),
    heraldEntityId: Type.String({ minLength: 1 }),
    metricNames: Type.Array(Type.String({ minLength: 1 })),
    availability: Type.Union([
        Type.Literal('not_reported'),
        Type.Literal('not_found'),
        Type.Literal('blocked'),
        Type.Literal('disabled'),
        Type.Literal('temporarily_unavailable'),
        Type.Literal('rate_limited'),
        Type.Literal('invalid_response'),
        Type.Literal('partial_response'),
        Type.Literal('not_configured'),
        Type.Literal('not_authorized'),
        Type.Literal('not_supported'),
    ]),
})

const blueskyAnalyticsCoverageSchema = Type.Object({
    state: Type.Union([
        Type.Literal('complete'),
        Type.Literal('partial'),
        Type.Literal('unavailable'),
    ]),
    complete: Type.Boolean(),
    requestedAccountMetricCount: Type.Integer({ minimum: 0 }),
    measuredAccountMetricCount: Type.Integer({ minimum: 0 }),
    requestedContentCount: Type.Integer({ minimum: 0 }),
    returnedContentCount: Type.Integer({ minimum: 0 }),
    requestedContentMetricCount: Type.Integer({ minimum: 0 }),
    measuredContentMetricCount: Type.Integer({ minimum: 0 }),
    notReportedMetricCount: Type.Integer({ minimum: 0 }),
    unavailableMetricCount: Type.Integer({ minimum: 0 }),
    gaps: Type.Array(blueskyAnalyticsCoverageGapSchema),
})

export const blueskyAnalyticsCollectionResponseSchema =
    Type.Unsafe<BlueskyAnalyticsCollectionResponse>(
        Type.Object({
            contractVersion: Type.Integer({ minimum: 1 }),
            projectId: Type.String({ minLength: 1 }),
            provider: Type.Literal('bluesky'),
            fetchedAt: Type.Integer({ minimum: 0 }),
            inserted: Type.Integer({ minimum: 0 }),
            duplicates: Type.Integer({ minimum: 0 }),
            coverage: blueskyAnalyticsCoverageSchema,
            observations: Type.Array(providerAnalyticsObservationSchema),
        })
    )

export const devtoAnalyticsCollectionResponseSchema = Type.Unsafe<DevtoAnalyticsCollectionResponse>(
    Type.Object({
        contractVersion: Type.Integer({ minimum: 1 }),
        projectId: Type.String({ minLength: 1 }),
        provider: Type.Literal('devto'),
        fetchedAt: Type.Integer({ minimum: 0 }),
        inserted: Type.Integer({ minimum: 0 }),
        duplicates: Type.Integer({ minimum: 0 }),
        observations: Type.Array(providerAnalyticsObservationSchema),
    })
)
