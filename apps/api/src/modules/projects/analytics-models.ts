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

const stateCountSchema = Type.Object({
    state: publicationStateSchema,
    count: Type.Integer({ minimum: 0 }),
})

const deliveryModeCountSchema = Type.Object({
    deliveryMode: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
    count: Type.Integer({ minimum: 0 }),
})

const channelInventorySchema = Type.Object({
    channelId: Type.String({ minLength: 1 }),
    channelName: Type.String({ minLength: 1 }),
    provider: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    total: Type.Integer({ minimum: 0 }),
    byState: Type.Array(stateCountSchema),
    byDeliveryMode: Type.Array(deliveryModeCountSchema),
})

const inventorySchema = Type.Object({
    total: Type.Integer({ minimum: 0 }),
    byState: Type.Array(stateCountSchema),
    byDeliveryMode: Type.Array(deliveryModeCountSchema),
    byChannel: Type.Array(channelInventorySchema),
})

const eventCountsSchema = Type.Object({
    publicationsCreated: Type.Integer({ minimum: 0 }),
    publicationsPublished: Type.Integer({ minimum: 0 }),
    publicationsFailed: Type.Integer({ minimum: 0 }),
    publicationsAmbiguous: Type.Integer({ minimum: 0 }),
    executionClaims: Type.Integer({ minimum: 0 }),
    executionAttempts: Type.Integer({ minimum: 0 }),
    executionSucceeded: Type.Integer({ minimum: 0 }),
    executionRetriesScheduled: Type.Integer({ minimum: 0 }),
    executionFailed: Type.Integer({ minimum: 0 }),
    executionAmbiguous: Type.Integer({ minimum: 0 }),
    executionClaimRecoveries: Type.Integer({ minimum: 0 }),
    executionAmbiguityRecoveries: Type.Integer({ minimum: 0 }),
    executionCancelled: Type.Integer({ minimum: 0 }),
})

const dailyBucketSchema = Type.Object({
    date: Type.String({ minLength: 10 }),
    publicationsCreated: Type.Integer({ minimum: 0 }),
    publicationsPublished: Type.Integer({ minimum: 0 }),
    publicationsFailed: Type.Integer({ minimum: 0 }),
    publicationsAmbiguous: Type.Integer({ minimum: 0 }),
    executionAttempts: Type.Integer({ minimum: 0 }),
    executionRetriesScheduled: Type.Integer({ minimum: 0 }),
})

export const analyticsQuery = Type.Object({
    from: Type.Optional(Type.Integer({ minimum: 0 })),
    to: Type.Optional(Type.Integer({ minimum: 0 })),
})

export const projectAnalyticsSchema = Type.Unsafe<ProjectAnalytics>(
    Type.Object({
        projectId: Type.String({ minLength: 1 }),
        timeZone: Type.String({ minLength: 1 }),
        range: Type.Object({
            from: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
            to: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        }),
        inventory: inventorySchema,
        events: eventCountsSchema,
        daily: Type.Array(dailyBucketSchema),
    })
)
