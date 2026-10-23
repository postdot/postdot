import { Type } from 'typebox'

import {
    providerAnalyticsSubjectTypeSchema,
    providerAnalyticsObservationSchema,
} from '../../modules/projects/provider-analytics-models'
import type { BlueskyAnalyticsCollectionResponse } from './analytics'
export const blueskyAnalyticsCollectionBody = Type.Object({
    channelId: Type.String({ minLength: 1 }),
    publicationIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 25, uniqueItems: true })
    ),
})

const blueskyAnalyticsCoverageGapSchema = Type.Object({
    subjectType: providerAnalyticsSubjectTypeSchema,
    providerSubjectId: Type.String({ minLength: 1 }),
    postbotEntityId: Type.String({ minLength: 1 }),
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
