import type { ProjectAnalytics } from '@herald/db'
import { Type } from 'typebox'

const publicationStateSchema = Type.Union([
    Type.Literal('draft'),
    Type.Literal('scheduled'),
    Type.Literal('ready'),
    Type.Literal('publishing'),
    Type.Literal('published'),
    Type.Literal('failed'),
    Type.Literal('ambiguous'),
    Type.Literal('cancelled'),
])

const deliveryModeSchema = Type.Union([Type.Literal('manual'), Type.Literal('automatic')])

const historicalDeliveryModeSchema = Type.Union([
    Type.Literal('manual'),
    Type.Literal('automatic'),
    Type.Literal('unknown'),
])

const analyticsDimensionSchema = Type.Object({
    channelId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    channelName: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    provider: Type.String({ minLength: 1 }),
    deliveryMode: historicalDeliveryModeSchema,
})

const dimensionCountSchema = Type.Intersect([
    analyticsDimensionSchema,
    Type.Object({ count: Type.Integer({ minimum: 0 }) }),
])

const stateCountSchema = Type.Object({
    state: publicationStateSchema,
    count: Type.Integer({ minimum: 0 }),
})

const deliveryModeCountSchema = Type.Object({
    deliveryMode: deliveryModeSchema,
    count: Type.Integer({ minimum: 0 }),
})

const publicationInventorySchema = Type.Object({
    total: Type.Integer({ minimum: 0 }),
    byState: Type.Array(stateCountSchema),
    byDeliveryMode: Type.Array(deliveryModeCountSchema),
    byDimension: Type.Array(dimensionCountSchema),
})

const currentExecutionSchema = Type.Object({
    scheduled: Type.Integer({ minimum: 0 }),
    due: Type.Integer({ minimum: 0 }),
    running: Type.Integer({ minimum: 0 }),
    retryablePending: Type.Integer({ minimum: 0 }),
    succeeded: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    ambiguous: Type.Integer({ minimum: 0 }),
})

const currentWorkloadSchema = Type.Object({
    manualDue: Type.Integer({ minimum: 0 }),
    ambiguousReconciliation: Type.Integer({ minimum: 0 }),
    oldestDueAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    nextRunAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    futureScheduled: Type.Integer({ minimum: 0 }),
    overdue: Type.Integer({ minimum: 0 }),
})

const currentSnapshotSchema = Type.Object({
    publications: publicationInventorySchema,
    executions: currentExecutionSchema,
    workload: currentWorkloadSchema,
})

const lifecycleTransitionsSchema = Type.Object({
    total: Type.Integer({ minimum: 0 }),
    byState: Type.Array(stateCountSchema),
    byDimension: Type.Array(dimensionCountSchema),
})

const publicationDimensionMetricsSchema = Type.Object({
    created: Type.Array(dimensionCountSchema),
    published: Type.Array(dimensionCountSchema),
    failed: Type.Array(dimensionCountSchema),
    ambiguous: Type.Array(dimensionCountSchema),
})

const historicalPublicationSchema = Type.Object({
    created: Type.Integer({ minimum: 0 }),
    published: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    ambiguous: Type.Integer({ minimum: 0 }),
    lifecycleTransitions: lifecycleTransitionsSchema,
    byDimension: publicationDimensionMetricsSchema,
})

const executionDimensionMetricsSchema = Type.Object({
    claimed: Type.Array(dimensionCountSchema),
    attempts: Type.Array(dimensionCountSchema),
    succeeded: Type.Array(dimensionCountSchema),
    failed: Type.Array(dimensionCountSchema),
    retryable: Type.Array(dimensionCountSchema),
    ambiguous: Type.Array(dimensionCountSchema),
    directAmbiguous: Type.Array(dimensionCountSchema),
    claimRecoveries: Type.Array(dimensionCountSchema),
    ambiguityRecoveries: Type.Array(dimensionCountSchema),
    cancelled: Type.Array(dimensionCountSchema),
})

const historicalExecutionSchema = Type.Object({
    claimed: Type.Integer({ minimum: 0 }),
    attempts: Type.Integer({ minimum: 0 }),
    succeeded: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    retryable: Type.Integer({ minimum: 0 }),
    ambiguous: Type.Integer({ minimum: 0 }),
    directAmbiguous: Type.Integer({ minimum: 0 }),
    claimRecoveries: Type.Integer({ minimum: 0 }),
    ambiguityRecoveries: Type.Integer({ minimum: 0 }),
    cancelled: Type.Integer({ minimum: 0 }),
    byDimension: executionDimensionMetricsSchema,
})

const retryMetricsSchema = Type.Object({
    scheduled: Type.Integer({ minimum: 0 }),
    rate: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
    attemptsPerPublication: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
})

const latencySummarySchema = Type.Object({
    count: Type.Integer({ minimum: 1 }),
    totalMs: Type.Integer({ minimum: 0 }),
    minMs: Type.Integer({ minimum: 0 }),
    maxMs: Type.Integer({ minimum: 0 }),
    averageMs: Type.Number({ minimum: 0 }),
})

const historicalLatencySchema = Type.Object({
    queueDelay: Type.Union([latencySummarySchema, Type.Null()]),
    effectDuration: Type.Union([latencySummarySchema, Type.Null()]),
    scheduledToOutcome: Type.Union([latencySummarySchema, Type.Null()]),
    manualCompletion: Type.Union([latencySummarySchema, Type.Null()]),
})

const bucketMetricsSchema = Type.Object({
    publicationsCreated: Type.Integer({ minimum: 0 }),
    publicationsPublished: Type.Integer({ minimum: 0 }),
    publicationsFailed: Type.Integer({ minimum: 0 }),
    publicationsAmbiguous: Type.Integer({ minimum: 0 }),
    publicationLifecycleTransitions: Type.Integer({ minimum: 0 }),
    executionClaimed: Type.Integer({ minimum: 0 }),
    executionAttempts: Type.Integer({ minimum: 0 }),
    executionSucceeded: Type.Integer({ minimum: 0 }),
    executionFailed: Type.Integer({ minimum: 0 }),
    executionRetryable: Type.Integer({ minimum: 0 }),
    executionAmbiguous: Type.Integer({ minimum: 0 }),
    executionClaimRecoveries: Type.Integer({ minimum: 0 }),
    executionAmbiguityRecoveries: Type.Integer({ minimum: 0 }),
    executionCancelled: Type.Integer({ minimum: 0 }),
})

const bucketDimensionSchema = Type.Intersect([
    analyticsDimensionSchema,
    Type.Object({ metrics: bucketMetricsSchema }),
])

const dailyBucketSchema = Type.Object({
    bucketDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    bucketStartUtc: Type.Integer({ minimum: 0 }),
    bucketEndUtc: Type.Integer({ minimum: 0 }),
    metrics: bucketMetricsSchema,
    dimensions: Type.Array(bucketDimensionSchema),
})

const dataQualitySchema = Type.Object({
    unknownEventVersions: Type.Integer({ minimum: 0 }),
    unsupportedFacts: Type.Integer({ minimum: 0 }),
    invalidMetadata: Type.Integer({ minimum: 0 }),
    missingLifecycleState: Type.Integer({ minimum: 0 }),
    missingAttemptMetadata: Type.Integer({ minimum: 0 }),
    missingHistoricalDimensions: Type.Integer({ minimum: 0 }),
    incompleteLatencyPairs: Type.Integer({ minimum: 0 }),
    incompleteQueueDelayPairs: Type.Integer({ minimum: 0 }),
    contradictoryAttempts: Type.Integer({ minimum: 0 }),
    duplicateFacts: Type.Integer({ minimum: 0 }),
    duplicateAttemptFacts: Type.Integer({ minimum: 0 }),
})

const coverageSchema = Type.Object({
    supportedFactVersions: Type.Array(Type.Integer({ minimum: 1 })),
    skippedFactCount: Type.Integer({ minimum: 0 }),
    dataQuality: dataQualitySchema,
})

export const analyticsQuery = Type.Object({
    from: Type.Optional(Type.Integer({ minimum: 0 })),
    to: Type.Optional(Type.Integer({ minimum: 0 })),
    channelId: Type.Optional(Type.String({ minLength: 1 })),
    provider: Type.Optional(Type.String({ minLength: 1 })),
    deliveryMode: Type.Optional(deliveryModeSchema),
})

export const projectAnalyticsSchema = Type.Unsafe<ProjectAnalytics>(
    Type.Object({
        contractVersion: Type.Integer({ minimum: 1 }),
        projectId: Type.String({ minLength: 1 }),
        projectTimeZone: Type.String({ minLength: 1 }),
        observedAt: Type.Integer({ minimum: 0 }),
        range: Type.Object({
            from: Type.Integer({ minimum: 0 }),
            to: Type.Integer({ minimum: 0 }),
        }),
        current: currentSnapshotSchema,
        historical: Type.Object({
            publications: historicalPublicationSchema,
            executions: historicalExecutionSchema,
            retries: retryMetricsSchema,
            latency: historicalLatencySchema,
            buckets: Type.Array(dailyBucketSchema),
        }),
        coverage: coverageSchema,
    })
)
