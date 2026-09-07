import type { AnalyticsStore } from '@herald/db'

import { analyticsQuery, projectAnalyticsSchema } from './analytics-models'
import { errorResponse, projectParams } from './models'
import type { AuthenticatedElysia } from './types'

export function registerAnalyticsRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    analytics: AnalyticsStore
) {
    return app.get(
        '/api/projects/:projectId/analytics',
        {
            auth: true,
            params: projectParams,
            query: analyticsQuery,
            response: {
                200: projectAnalyticsSchema,
                400: errorResponse,
                401: errorResponse,
                404: errorResponse,
                422: errorResponse,
            },
            detail: {
                operationId: 'getProjectAnalytics',
                summary: 'Read provider-neutral publication analytics',
                tags: ['Analytics'],
            },
        },
        ({ params, query, status, user }) => {
            const result = analytics.getProjectAnalytics({
                projectId: params.projectId,
                subjectId: user.id,
                from: query.from,
                to: query.to,
                channelId: query.channelId,
                provider: query.provider,
                deliveryMode: query.deliveryMode,
            })
            return result === null
                ? status(404, { error: { code: 'not_found', message: 'Project not found' } })
                : result
        }
    )
}
