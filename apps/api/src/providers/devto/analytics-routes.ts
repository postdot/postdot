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
import type { DevtoAnalyticsService } from '../../providers/devto/analytics'
import {
    devtoAnalyticsCollectionBody,
    devtoAnalyticsCollectionResponseSchema,
} from './analytics-models'

export function registerDevtoAnalyticsRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    providerAnalytics: ProviderAnalyticsStore,
    devtoAnalytics: DevtoAnalyticsService,
    access: AccessStore
) {
    return app
        .get(
            '/api/projects/:projectId/analytics/provider/devto',
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
                    operationId: 'getDevtoProviderAnalytics',
                    summary: 'Read persisted DEV.to provider observations',
                    tags: ['Provider Analytics'],
                },
            },
            ({ params, query, status, user }) => {
                const result = providerAnalytics.listObservations({
                    projectId: params.projectId,
                    subjectId: user.id,
                    provider: 'devto',
                    subjectType: query.subjectType,
                    providerSubjectId: query.providerSubjectId,
                    postdotEntityId: query.postdotEntityId,
                    limit: query.limit,
                })
                return result === null
                    ? status(404, { error: { code: 'not_found', message: 'Project not found' } })
                    : result
            }
        )
        .get(
            '/api/projects/:projectId/analytics/provider/devto/latest',
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
                    operationId: 'getLatestDevtoProviderAnalytics',
                    summary: 'Read the latest persisted DEV.to observation per publication metric',
                    tags: ['Provider Analytics'],
                },
            },
            ({ params, query, status, user }) => {
                const result = providerAnalytics.listLatestContentObservations({
                    projectId: params.projectId,
                    subjectId: user.id,
                    provider: 'devto',
                    publicationIds: query.publicationIds,
                })
                return result === null
                    ? status(404, { error: { code: 'not_found', message: 'Project not found' } })
                    : result
            }
        )
        .post(
            '/api/projects/:projectId/analytics/provider/devto/collect',
            {
                auth: true,
                params: projectParams,
                body: devtoAnalyticsCollectionBody,
                response: {
                    200: devtoAnalyticsCollectionResponseSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'collectDevtoProviderAnalytics',
                    summary: 'Collect one bounded DEV.to publication snapshot',
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
                const result = await devtoAnalytics.collect({
                    projectId: params.projectId,
                    subjectId: user.id,
                    channelId: body.channelId,
                    publicationId: body.publicationId,
                })
                return result === null
                    ? status(404, {
                          error: { code: 'not_found', message: 'Publication not found' },
                      })
                    : result
            }
        )
}
