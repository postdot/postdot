import type { AccessStore, createManualStore } from '@postdot/db'
import { InstagramOAuthError } from '@postdot/instagram'
import { digestAuthorizationState } from '@postdot/oauth'
import { status as httpStatus } from 'elysia'
import { Type } from 'typebox'

import { errorResponse } from '../../modules/projects/models'
import { publisherChannelsReturnPath } from '../../modules/projects/publisher-providers/publisher-redirect'
import type { PublisherRuntime } from '../../modules/publishers/runtime'
import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'
import { createInstagramConnectionFlow, InstagramConnectionError } from './connection-flow'

function failure(error: unknown) {
    const code =
        error instanceof InstagramConnectionError || error instanceof InstagramOAuthError
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
                    : 'Instagram connection could not be completed',
        },
    })
}

export function registerInstagramPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly canManageChannel: (projectId: string, channelId: string, userId: string) => boolean
        readonly access: AccessStore
        readonly channels: Pick<ReturnType<typeof createManualStore>, 'listChannels'>
    }
) {
    async function resolveFlow(applicationId?: string | null) {
        const application = await publisher.resolveInstagramApplication(applicationId)
        if (!application) return undefined
        return createInstagramConnectionFlow({
            attempts: publisher.authorizationAttemptStore,
            credentials: publisher.credentialStore,
            publishers: publisher.publisherStore,
            channels: options.channels,
            access: options.access,
            canManageChannel: options.canManageChannel,
            ...application,
            now: publisher.now,
            applicationAvailable: async () => {
                const current = await publisher.resolveInstagramApplication(
                    application.applicationId
                )
                return current?.oauth.clientId === application.oauth.clientId
            },
        })
    }
    return app
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/instagram/connect',
            {
                auth: true,
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    channelId: Type.String({ minLength: 1 }),
                }),
                body: Type.Optional(
                    Type.Object({
                        providerApplicationId: Type.Optional(Type.String({ minLength: 1 })),
                    })
                ),
                response: {
                    200: Type.Object({ url: Type.String() }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'startInstagramPublisherConnection',
                    summary: 'Start direct Instagram professional account authorization',
                    tags: ['Channels'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, body, user, set }) => {
                set.headers['cache-control'] = 'no-store'
                try {
                    const flow = await resolveFlow(body?.providerApplicationId)
                    if (!flow) return failure(new InstagramConnectionError('provider_unavailable'))
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
            '/api/oauth/instagram/callback',
            {
                auth: true,
                detail: {
                    operationId: 'completeInstagramPublisherAuthorization',
                    summary: 'Complete direct Instagram account connection',
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
                    // The configured callback owns the public TLS identity behind a proxy.
                    const parameters = new URL(publisher.instagramCallbackUri)
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
                        attempt.providerId !== 'instagram' ||
                        attempt.context.phase !== 'authorization'
                    )
                        return redirect(fallback)
                    if (
                        publisher.publisherStore.getProjectActorId(attempt.projectId, user.id) !==
                            attempt.connectedByActorId ||
                        !options.access.canAccessProject(attempt.projectId, user.id, 'editor') ||
                        !options.canManageChannel(attempt.projectId, attempt.channelId, user.id)
                    )
                        return redirect(fallback)
                    fallback = new URL(attempt.returnPath, publisher.webOrigin)
                    fallback.searchParams.set('publisher', 'invalid_callback')
                    const flow = await resolveFlow(attempt.providerApplicationId ?? null)
                    if (!flow) return redirect(fallback)
                    const connected = await flow.complete(
                        {
                            projectId: attempt.projectId,
                            channelId: attempt.channelId,
                            subjectId: user.id,
                            authMethod,
                        },
                        parameters
                    )
                    const target = new URL(connected.returnPath, publisher.webOrigin)
                    target.searchParams.set('publisher', 'connected')
                    return redirect(target)
                } catch (error) {
                    if (error instanceof InstagramOAuthError && error.code === 'access_denied')
                        fallback.searchParams.set('publisher', 'authorization_denied')
                    else if (
                        error instanceof InstagramConnectionError &&
                        error.code === 'provider_unavailable'
                    )
                        fallback.searchParams.set('publisher', 'provider_unavailable')
                    return redirect(fallback)
                }
            }
        )
}
