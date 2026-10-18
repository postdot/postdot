import type { AccessStore, createManualStore } from '@postbot/db'
import { FacebookOAuthError } from '@postbot/facebook'
import { digestAuthorizationState } from '@postbot/oauth'
import { status as httpStatus } from 'elysia'
import { Type } from 'typebox'

import { sessionSecurity, type AuthenticatedElysia } from '../../../plugins/auth'
import {
    createFacebookConnectionFlow,
    FacebookConnectionError,
} from '../../publishers/facebook-connection-flow'
import type { PublisherRuntime } from '../../publishers/runtime'
import { errorResponse, publisherConnectionSchema } from '../models'
import { publisherChannelsReturnPath } from './publisher-redirect'

const params = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    channelId: Type.String({ minLength: 1 }),
})
const selection = Type.String({ minLength: 32, maxLength: 512 })
const errors = {
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    503: errorResponse,
}
function failure(error: unknown) {
    const code =
        error instanceof FacebookConnectionError
            ? error.code
            : error instanceof FacebookOAuthError
              ? error.code
              : 'provider_unavailable'
    const status =
        code === 'not_found'
            ? 404
            : code === 'forbidden'
              ? 403
              : code === 'conflict'
                ? 409
                : code === 'provider_unavailable'
                  ? 503
                  : 400
    return httpStatus(status, {
        error: {
            code,
            message:
                code === 'not_found'
                    ? 'Project not found'
                    : 'Facebook connection could not be completed',
        },
    })
}

export function registerFacebookPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly access: AccessStore
        readonly channels: Pick<ReturnType<typeof createManualStore>, 'listChannels'>
        readonly onWorkScheduled?: () => void
    }
) {
    const flow =
        publisher.facebook === undefined
            ? undefined
            : createFacebookConnectionFlow({
                  attempts: publisher.authorizationAttemptStore,
                  credentials: publisher.credentialStore,
                  publishers: publisher.publisherStore,
                  channels: options.channels,
                  access: options.access,
                  ...publisher.facebook,
                  now: publisher.now,
              })
    const unavailable = () => failure(new FacebookConnectionError('provider_unavailable'))
    return app
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/facebook/connect',
            {
                auth: true,
                params,
                response: { 200: Type.Object({ url: Type.String() }), ...errors },
                detail: {
                    operationId: 'startFacebookPublisherConnection',
                    summary: 'Start Facebook Page authorization',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, user, set }) => {
                set.headers['cache-control'] = 'no-store'
                if (!flow) return unavailable()
                try {
                    return await flow.start(
                        { ...params, subjectId: user.id, authMethod },
                        publisherChannelsReturnPath(params.projectId, params.channelId)
                    )
                } catch (error) {
                    return failure(error)
                }
            }
        )
        .get(
            '/api/oauth/facebook/callback',
            {
                auth: true,
                detail: {
                    operationId: 'completeFacebookPublisherAuthorization',
                    summary: 'Complete Facebook authorization for Page selection',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, request, user }) => {
                const fallback = new URL('/dashboard', publisher.webOrigin)
                fallback.searchParams.set('publisher_error', 'invalid_callback')
                const redirect = (url: URL) =>
                    new Response(null, {
                        status: 303,
                        headers: {
                            location: url.toString(),
                            'cache-control': 'no-store',
                            'referrer-policy': 'no-referrer',
                        },
                    })
                if (!flow || authMethod !== 'session') return redirect(fallback)
                try {
                    const parameters = new URL(request.url)
                    if (parameters.searchParams.getAll('state').length !== 1)
                        return redirect(fallback)
                    const state = parameters.searchParams.get('state') ?? ''
                    if (!/^[\x21-\x7e]{32,512}$/.test(state)) return redirect(fallback)
                    const attempt = publisher.authorizationAttemptStore.getAuthorizationAttempt(
                        await digestAuthorizationState(state)
                    )
                    if (!attempt) return redirect(fallback)
                    const pending = await flow.complete(
                        {
                            projectId: attempt.projectId,
                            channelId: attempt.channelId,
                            subjectId: user.id,
                            authMethod,
                        },
                        parameters
                    )
                    const target = new URL(pending.returnPath, publisher.webOrigin)
                    target.searchParams.set('facebook_selection', pending.selection)
                    return redirect(target)
                } catch {
                    return redirect(fallback)
                }
            }
        )
        .get(
            '/api/projects/:projectId/channels/:channelId/publisher/facebook/pages',
            {
                auth: true,
                params,
                query: Type.Object({
                    selection,
                    after: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
                }),
                response: {
                    200: Type.Object({
                        pages: Type.Array(
                            Type.Object({
                                id: Type.String(),
                                name: Type.String(),
                                hasPublishTask: Type.Boolean(),
                            })
                        ),
                        nextCursor: Type.Union([Type.String(), Type.Null()]),
                    }),
                    ...errors,
                },
                detail: {
                    operationId: 'listFacebookPublisherPages',
                    summary: 'List authorized Facebook Page choices',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, query, user, set }) => {
                set.headers['cache-control'] = 'no-store'
                if (!flow) return unavailable()
                try {
                    return httpStatus(
                        200,
                        await flow.listPages(
                            { ...params, subjectId: user.id, authMethod },
                            query.selection,
                            query.after
                        )
                    )
                } catch (error) {
                    return failure(error)
                }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/facebook/select',
            {
                auth: true,
                params,
                body: Type.Object({
                    selection,
                    pageId: Type.String({ pattern: '^[1-9][0-9]*$' }),
                    after: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
                }),
                response: {
                    200: Type.Object({ connection: publisherConnectionSchema }),
                    ...errors,
                },
                detail: {
                    operationId: 'selectFacebookPublisherPage',
                    summary: 'Connect an explicitly selected Facebook Page',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, body, user, set }) => {
                set.headers['cache-control'] = 'no-store'
                if (!flow) return unavailable()
                try {
                    const connected = await flow.selectPage(
                        { ...params, subjectId: user.id, authMethod },
                        body.selection,
                        body.pageId,
                        body.after
                    )
                    options.onWorkScheduled?.()
                    return httpStatus(200, connected)
                } catch (error) {
                    return failure(error)
                }
            }
        )
}
