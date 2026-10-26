import type { PostbotApiKeyRecord, PostbotAuth } from '@postdot/auth'
import type { ResourceLifecycleStore } from '@postdot/db'
import { Elysia } from 'elysia'

type PostbotApiKeyPermissions = PostbotApiKeyRecord['permissions']
export type PostbotAuthenticatedApiKeyPermissions = PostbotApiKeyPermissions

interface UserApiKeyAuthentication {
    /** null means all projects currently available to the key owner. */
    readonly projectIds: readonly string[] | null
    readonly ownerUserId: string
    readonly displayName: string
    readonly permissions: PostbotApiKeyPermissions
}

export function createAuthRoutes(auth: Pick<PostbotAuth, 'handler'>) {
    return (
        new Elysia({ name: 'postbot-auth-routes' })
            // A method-specific SPA fallback otherwise wins over the root ALL mount.
            .get('/api/auth/*', { parse: 'none', detail: { hide: true } }, ({ request }) =>
                auth.handler(request)
            )
            .mount(auth.handler)
    )
}

export interface AuthenticatedElysiaOptions {
    readonly resourceLifecycle?: ResourceLifecycleStore
    readonly authorizeRetirementReceipt?: (
        projectId: string,
        userId: string,
        path: string
    ) => boolean
    readonly authenticateBetterAuthProjectApiKey?: (
        token: string
    ) => Promise<UserApiKeyAuthentication | null>
    readonly authorizeUserApiKeyRequest?: (
        method: string,
        requestPath: string,
        permissions: PostbotApiKeyPermissions
    ) => boolean
    /**
     * Current project access for an authenticated caller. Session requests and
     * API-key requests share this single decision so machine access can never
     * drift from human access: both answer with the same hidden 404.
     */
    readonly authorizeProjectAccess?: (
        projectId: string,
        userId: string,
        requestPath: string
    ) => boolean
}

type PostbotAuthSession = NonNullable<Awaited<ReturnType<PostbotAuth['api']['getSession']>>>
export type PostbotAuthenticatedUser = Pick<PostbotAuthSession['user'], 'id' | 'name'> & {
    readonly email: string | null
}
export type PostbotAuthenticationMethod = 'session' | 'user_api_key'

function parseBearerToken(authorization: string): string | null {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization)
    return match?.[1] ?? null
}

export const sessionSecurity = [{ sessionCookie: [] }]

/**
 * Keep the route-facing macro contract stable. Elysia beta's macro inference
 * cannot model the runtime union between a Better Auth session and an API key
 * without collapsing downstream route schemas to `never`.
 */
function createAuthenticatedElysiaContract(auth: PostbotAuth) {
    return new Elysia().macro({
        auth: {
            async derive({ request: { headers }, status }) {
                const session = await auth.api.getSession({ headers })
                if (session === null) {
                    return status(401, {
                        error: {
                            code: 'unauthorized',
                            message: 'Authentication required',
                        },
                    })
                }

                return {
                    user: {
                        id: session.user.id,
                        name: session.user.name,
                        email: session.user.email,
                    },
                    session: session.session as PostbotAuthSession['session'] | null,
                    authMethod: 'session' as PostbotAuthenticationMethod,
                    apiKeyProjectIds: undefined as readonly string[] | null | undefined,
                    apiKeyPermissions: undefined as PostbotApiKeyPermissions | undefined,
                }
            },
        },
    })
}

function readProjectIdFromRequest(requestUrl: string): string | null {
    const segments = new URL(requestUrl).pathname.split('/').filter(Boolean)
    const projectIndex = segments.indexOf('projects')
    const projectId = projectIndex >= 0 ? segments[projectIndex + 1] : undefined
    return projectId === undefined || projectId.length === 0 ? null : projectId
}

type AuthenticatedElysiaBase = ReturnType<typeof createAuthenticatedElysiaContract>

export function createAuthenticatedElysia(
    auth: PostbotAuth,
    options: AuthenticatedElysiaOptions = {}
): AuthenticatedElysiaBase {
    const releases = new WeakMap<Request, () => void>()
    function guardResource(request: Request): boolean {
        const lifecycle = options.resourceLifecycle
        if (!lifecycle) return false
        const path = new URL(request.url).pathname
        if (/\/lifecycle(?:\/|$)/.test(path)) return false
        const projectId = readProjectIdFromRequest(request.url)
        const workspaceId = path.match(/^\/api\/workspaces\/([^/]+)/)?.[1]
        const state = projectId
            ? lifecycle.projectState(projectId)
            : workspaceId
              ? lifecycle.state('workspace', workspaceId)
              : 'active'
        const writing = request.method !== 'GET' && request.method !== 'HEAD'
        if (state === 'deleting' || state === 'deleted' || (writing && state !== 'active'))
            return true
        if (writing && projectId) releases.set(request, lifecycle.beginRequest(projectId))
        return false
    }
    const authenticated = new Elysia()
        .afterResponse(({ request }) => {
            releases.get(request)?.()
            releases.delete(request)
        })
        .as('global')
        .macro({
            auth: {
                async derive({ request: { headers }, status, request }) {
                    const authorization = headers.get('authorization')
                    const token =
                        authorization === null
                            ? headers.get('x-api-key')
                            : parseBearerToken(authorization)
                    if (token !== null) {
                        const authentication =
                            (await options.authenticateBetterAuthProjectApiKey?.(token)) ?? null
                        if (authentication === null) {
                            return status(401, {
                                error: {
                                    code: 'unauthorized',
                                    message: 'Authentication required',
                                },
                            })
                        }

                        const projectId = readProjectIdFromRequest(request.url)
                        if (
                            projectId !== null &&
                            authentication.projectIds !== null &&
                            !authentication.projectIds.includes(projectId)
                        ) {
                            return status(404, {
                                error: { code: 'not_found', message: 'Project not found' },
                            })
                        }

                        if (
                            options.authorizeUserApiKeyRequest?.(
                                request.method,
                                new URL(request.url).pathname,
                                authentication.permissions
                            ) !== true
                        ) {
                            return status(403, {
                                error: {
                                    code: 'insufficient_api_key_permissions',
                                    message: 'This API key is not allowed to perform this action',
                                },
                            })
                        }

                        // A key never outlives the access its owner currently holds:
                        // the stored scope is intersected with the owner's live
                        // project access by the same callback the session path
                        // uses, so revocation is enforced for machine access too.
                        if (
                            projectId !== null &&
                            options.authorizeProjectAccess !== undefined &&
                            !options.authorizeProjectAccess(
                                projectId,
                                authentication.ownerUserId,
                                new URL(request.url).pathname
                            )
                        ) {
                            return status(404, {
                                error: { code: 'not_found', message: 'Project not found' },
                            })
                        }

                        const refusal = guardResource(request)
                        if (refusal)
                            return status(409, {
                                error: {
                                    code: 'resource_read_only',
                                    message: 'Resource is archived or retirement is in progress',
                                },
                            })
                        return {
                            user: {
                                id: authentication.ownerUserId,
                                name: authentication.displayName,
                                email: null,
                            },
                            session: null,
                            authMethod: 'user_api_key' as const,
                            apiKeyProjectIds: authentication.projectIds,
                            apiKeyPermissions: authentication.permissions,
                        }
                    }

                    const session = await auth.api.getSession({ headers })
                    if (session === null) {
                        return status(401, {
                            error: {
                                code: 'unauthorized',
                                message: 'Authentication required',
                            },
                        })
                    }

                    const projectId = readProjectIdFromRequest(request.url)
                    if (
                        projectId !== null &&
                        options.authorizeProjectAccess !== undefined &&
                        !options.authorizeProjectAccess(
                            projectId,
                            session.user.id,
                            new URL(request.url).pathname
                        ) &&
                        !(
                            request.method === 'GET' &&
                            options.authorizeRetirementReceipt?.(
                                projectId,
                                session.user.id,
                                new URL(request.url).pathname
                            )
                        )
                    ) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project not found' },
                        })
                    }

                    if (guardResource(request))
                        return status(409, {
                            error: {
                                code: 'resource_read_only',
                                message: 'Resource is archived or retirement is in progress',
                            },
                        })
                    return {
                        user: {
                            id: session.user.id,
                            name: session.user.name,
                            email: session.user.email,
                        },
                        session: session.session,
                        authMethod: 'session' as const,
                        apiKeyPermissions: undefined,
                    }
                },
            },
        })

    return authenticated as unknown as AuthenticatedElysiaBase
}

// Route modules receive an app that already contains routes from previous
// modules. Keeping the route accumulator open preserves Elysia's contextual
// inference without making every module depend on the exact previous module.
export type AuthenticatedElysia<Routes extends Record<string, unknown> = {}> = Elysia<
    AuthenticatedElysiaBase['~Prefix'],
    AuthenticatedElysiaBase['~Scope'],
    AuthenticatedElysiaBase['~Singleton'],
    AuthenticatedElysiaBase['~Definitions'],
    AuthenticatedElysiaBase['~Metadata'],
    Routes,
    AuthenticatedElysiaBase['~Ephemeral'],
    AuthenticatedElysiaBase['~Volatile']
>
