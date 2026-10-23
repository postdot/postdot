import type { AccessStore, ProviderAnalyticsStore } from '@postdot/db'

import {
    canAccessProjectRole,
    forbiddenProjectMutation,
} from '../../modules/projects/authorization'
import { errorResponse, projectParams } from '../../modules/projects/models'
import {
    providerAnalyticsLatestQuery,
    providerAnalyticsObservationPageSchema,
    providerAnalyticsQuery,
} from '../../modules/projects/provider-analytics-models'
import type { AuthenticatedElysia } from '../../modules/projects/types'
import type { BlueskyAnalyticsService } from '../../providers/bluesky/analytics'
import {
    blueskyAnalyticsCollectionBody,
    blueskyAnalyticsCollectionResponseSchema,
} from './analytics-models'

export function registerBlueskyAnalyticsRoutes<const Routes extends Record<string, unknown>>(
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
                    403: errorResponse,
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
                    postbotEntityId: query.postbotEntityId,
                    limit: query.limit,
                })
                return result === null
                    ? status(404, { error: { code: 'not_found', message: 'Project not found' } })
                    : result
            }
        )
        .get(
            '/api/projects/:projectId/analytics/provider/bluesky/latest',
            {
                auth: true,
                params: projectParams,
                query: providerAnalyticsLatestQuery,
                response: {
                    200: providerAnalyticsObservationPageSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'getLatestBlueskyProviderAnalytics',
                    summary: 'Read the latest persisted Bluesky observation per publication metric',
                    tags: ['Provider Analytics'],
                },
            },
            ({ params, query, status, user }) => {
                const result = providerAnalytics.listLatestContentObservations({
                    projectId: params.projectId,
                    subjectId: user.id,
                    provider: 'bluesky',
                    publicationIds: query.publicationIds,
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
