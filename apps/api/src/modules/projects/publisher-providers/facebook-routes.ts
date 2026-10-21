import type { AccessStore, createManualStore } from '@postdot/db'
import { FacebookOAuthError } from '@postdot/facebook'
import { digestAuthorizationState } from '@postdot/oauth'
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
    async function resolveFlow(applicationId?: string | null) {
        const application = await publisher.resolveFacebookApplication(applicationId)
        if (!application) return undefined
        return createFacebookConnectionFlow({
            attempts: publisher.authorizationAttemptStore,
            credentials: publisher.credentialStore,
            publishers: publisher.publisherStore,
            channels: options.channels,
            access: options.access,
            ...application,
            now: publisher.now,
        })
    }
    async function flowForSelection(selection: string) {
        const attempt = publisher.authorizationAttemptStore.getAuthorizationAttempt(
            await digestAuthorizationState(selection)
        )
        if (
            !attempt ||
            attempt.providerId !== 'facebook' ||
            attempt.context.phase !== 'page-selection'
        )
            throw new FacebookConnectionError('invalid_attempt')
        return resolveFlow(attempt.providerApplicationId ?? null)
    }
    const unavailable = () => failure(new FacebookConnectionError('provider_unavailable'))
    return app
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/facebook/connect',
            {
                auth: true,
                params,
                body: Type.Optional(
                    Type.Object({
                        providerApplicationId: Type.Optional(Type.String({ minLength: 1 })),
                    })
                ),
                response: { 200: Type.Object({ url: Type.String() }), ...errors },
                detail: {
                    operationId: 'startFacebookPublisherConnection',
                    summary: 'Start Facebook Page authorization',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, body, user, set }) => {
                set.headers['cache-control'] = 'no-store'
                try {
                    const flow = await resolveFlow(body?.providerApplicationId)
                    if (!flow) return unavailable()
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
                let fallback = new URL('/dashboard', publisher.webOrigin)
                fallback.searchParams.set('publisher', 'invalid_callback')
                const redirect = (url: URL) =>
                    new Response(null, {
                        status: 303,
                        headers: {
                            location: url.toString(),
                            'cache-control': 'no-store',
                            'referrer-policy': 'no-referrer',
                        },
                    })
                if (authMethod !== 'session') return redirect(fallback)
                try {
                    // TLS may terminate at a proxy. The configured callback owns the public
                    // origin; forwarded headers must not choose the OAuth redirect identity.
                    const parameters = new URL(publisher.facebookCallbackUri)
                    parameters.search = new URL(request.url).search
                    if (parameters.searchParams.getAll('state').length !== 1)
                        return redirect(fallback)
                    const state = parameters.searchParams.get('state') ?? ''
                    if (!/^[\x21-\x7e]{32,512}$/.test(state)) return redirect(fallback)
                    const attempt = publisher.authorizationAttemptStore.getAuthorizationAttempt(
                        await digestAuthorizationState(state)
                    )
                    if (
                        !attempt ||
                        attempt.providerId !== 'facebook' ||
                        attempt.context.phase !== 'authorization'
                    )
                        return redirect(fallback)
                    if (
                        publisher.publisherStore.getProjectActorId(attempt.projectId, user.id) !==
                            attempt.connectedByActorId ||
                        !options.access.canAccessProject(attempt.projectId, user.id, 'editor')
                    )
                        return redirect(fallback)
                    fallback = new URL(attempt.returnPath, publisher.webOrigin)
                    fallback.searchParams.set('publisher', 'invalid_callback')
                    const flow = await resolveFlow(attempt.providerApplicationId ?? null)
                    if (!flow) return redirect(fallback)
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
                } catch (error) {
                    if (error instanceof FacebookOAuthError && error.code === 'access_denied')
                        fallback.searchParams.set('publisher', 'authorization_denied')
                    else if (
                        error instanceof FacebookConnectionError &&
                        error.code === 'provider_unavailable'
                    )
                        fallback.searchParams.set('publisher', 'provider_unavailable')
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
                try {
                    const flow = await flowForSelection(query.selection)
                    if (!flow) return unavailable()
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
                try {
                    const flow = await flowForSelection(body.selection)
                    if (!flow) return unavailable()
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
