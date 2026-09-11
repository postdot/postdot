import type { AccessStore, ProviderAnalyticsStore } from '@herald/db'

import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import type { BlueskyAnalyticsService } from './bluesky-analytics-service'
import { errorResponse, projectParams } from './models'
import {
    blueskyAnalyticsCollectionBody,
    blueskyAnalyticsCollectionResponseSchema,
    providerAnalyticsObservationPageSchema,
    providerAnalyticsQuery,
} from './provider-analytics-models'
import type { AuthenticatedElysia } from './types'

export function registerProviderAnalyticsRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    providerAnalytics: ProviderAnalyticsStore,
    blueskyAnalytics: BlueskyAnalyticsService,
    access: AccessStore
) {
    return app
        .get(
            '/api/projects/:projectId/analytics/provider/bluesky',
            {
                auth: true,
                params: projectParams,
                query: providerAnalyticsQuery,
                response: {
                    200: providerAnalyticsObservationPageSchema,
                    400: errorResponse,
                    401: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'getBlueskyProviderAnalytics',
                    summary: 'Read persisted Bluesky provider observations',
                    tags: ['Provider Analytics'],
                },
            },
            ({ params, query, status, user }) => {
                const result = providerAnalytics.listObservations({
                    projectId: params.projectId,
                    subjectId: user.id,
                    provider: 'bluesky',
                    subjectType: query.subjectType,
                    providerSubjectId: query.providerSubjectId,
                    heraldEntityId: query.heraldEntityId,
                    limit: query.limit,
                })
                return result === null
                    ? status(404, { error: { code: 'not_found', message: 'Project not found' } })
                    : result
            }
        )
        .post(
            '/api/projects/:projectId/analytics/provider/bluesky/collect',
            {
                auth: true,
                params: projectParams,
                body: blueskyAnalyticsCollectionBody,
                response: {
                    200: blueskyAnalyticsCollectionResponseSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'collectBlueskyProviderAnalytics',
                    summary: 'Collect a bounded Bluesky provider observation snapshot',
                    tags: ['Provider Analytics'],
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const result = await blueskyAnalytics.collect({
                    projectId: params.projectId,
                    subjectId: user.id,
                    channelId: body.channelId,
                    publicationIds: body.publicationIds,
                })
                return result === null
                    ? status(404, { error: { code: 'not_found', message: 'Project not found' } })
                    : result
            }
        )
}
