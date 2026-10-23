import { Type } from 'typebox'

import { providerAnalyticsObservationSchema } from '../../modules/projects/provider-analytics-models'
import type { DevtoAnalyticsCollectionResponse } from './analytics'
export const devtoAnalyticsCollectionBody = Type.Object({
    channelId: Type.String({ minLength: 1 }),
    publicationId: Type.String({ minLength: 1 }),
})

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
