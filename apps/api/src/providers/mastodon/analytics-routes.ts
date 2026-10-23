import type { AccessStore, ProviderAnalyticsStore } from '@postdot/db'
import { Type } from 'typebox'

import {
    canAccessProjectRole,
    forbiddenProjectMutation,
} from '../../modules/projects/authorization'
import { errorResponse, projectParams } from '../../modules/projects/models'
import {
    providerAnalyticsLatestQuery,
    providerAnalyticsObservationPageSchema,
    providerAnalyticsObservationSchema,
    providerAnalyticsQuery,
} from '../../modules/projects/provider-analytics-models'
import type { AuthenticatedElysia } from '../../modules/projects/types'
import type {
    MastodonAnalyticsService,
    MastodonAnalyticsCollectionResponse,
} from '../../providers/mastodon/analytics'

const mastodonAnalyticsCollectionBody = Type.Object({
    channelId: Type.String({ minLength: 1 }),
    publicationId: Type.String({ minLength: 1 }),
})
const mastodonAnalyticsCollectionResponseSchema = Type.Unsafe<MastodonAnalyticsCollectionResponse>(
    Type.Object({
        contractVersion: Type.Integer({ minimum: 1 }),
        projectId: Type.String({ minLength: 1 }),
        provider: Type.Literal('mastodon'),
        fetchedAt: Type.Integer({ minimum: 0 }),
        inserted: Type.Integer({ minimum: 0 }),
        duplicates: Type.Integer({ minimum: 0 }),
        observations: Type.Array(providerAnalyticsObservationSchema),
    })
)

export function registerMastodonAnalyticsRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    providerAnalytics: ProviderAnalyticsStore,
    mastodonAnalytics: MastodonAnalyticsService,
    access: AccessStore
) {
    return app
        .get(
            '/api/projects/:projectId/analytics/provider/mastodon',
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
                    operationId: 'getMastodonProviderAnalytics',
                    summary: 'Read persisted Mastodon provider observations',
                    tags: ['Provider Analytics'],
                },
            },
            ({ params, query, status, user }) => {
                const result = providerAnalytics.listObservations({
                    projectId: params.projectId,
                    subjectId: user.id,
                    provider: 'mastodon',
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
            '/api/projects/:projectId/analytics/provider/mastodon/latest',
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
                    operationId: 'getLatestMastodonProviderAnalytics',
                    summary:
                        'Read the latest persisted Mastodon observation per publication metric',
                    tags: ['Provider Analytics'],
                },
            },
            ({ params, query, status, user }) => {
                const result = providerAnalytics.listLatestContentObservations({
                    projectId: params.projectId,
                    subjectId: user.id,
                    provider: 'mastodon',
                    publicationIds: query.publicationIds,
                })
                return result === null
                    ? status(404, { error: { code: 'not_found', message: 'Project not found' } })
                    : result
            }
        )
        .post(
            '/api/projects/:projectId/analytics/provider/mastodon/collect',
            {
                auth: true,
                params: projectParams,
                body: mastodonAnalyticsCollectionBody,
                response: {
                    200: mastodonAnalyticsCollectionResponseSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'collectMastodonProviderAnalytics',
                    summary: 'Collect one bounded Mastodon publication snapshot',
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
                const result = await mastodonAnalytics.collect({
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
