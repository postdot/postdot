import type { HeraldAuth } from '@herald/auth'
import type { ProjectAccessTokenAuthentication } from '@herald/db'
import { Elysia } from 'elysia'

export function createAuthRoutes(auth: HeraldAuth) {
    return new Elysia({ name: 'herald-auth-routes' }).mount(auth.handler)
}

export interface AuthenticatedElysiaOptions {
    readonly authenticateProjectAccessToken?: (
        token: string
    ) => ProjectAccessTokenAuthentication | null
}

type HeraldAuthSession = NonNullable<Awaited<ReturnType<HeraldAuth['api']['getSession']>>>
export type HeraldAuthenticatedUser = Pick<HeraldAuthSession['user'], 'id' | 'name'>
export type HeraldAuthenticationMethod = 'session' | 'project_token'

function createProjectTokenUser(
    authentication: ProjectAccessTokenAuthentication
): HeraldAuthenticatedUser {
    return {
        id: authentication.subjectId,
        name: authentication.displayName,
    }
}

function parseBearerToken(authorization: string): string | null {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization)
    return match?.[1] ?? null
}

export const sessionSecurity = [{ sessionCookie: [] }]

/**
 * Keep the route-facing macro contract stable. Elysia beta's macro inference
 * cannot model the runtime union between a Better Auth session and a project
 * token without collapsing downstream route schemas to `never`.
 */
function createAuthenticatedElysiaContract(auth: HeraldAuth) {
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
                    },
                    session: session.session as HeraldAuthSession['session'] | null,
                    authMethod: 'session' as HeraldAuthenticationMethod,
                }
            },
        },
    })
}

type AuthenticatedElysiaBase = ReturnType<typeof createAuthenticatedElysiaContract>

export function createAuthenticatedElysia(
    auth: HeraldAuth,
    options: AuthenticatedElysiaOptions = {}
): AuthenticatedElysiaBase {
    const authenticated = new Elysia().macro({
        auth: {
            async derive({ request: { headers }, status }) {
                const authorization = headers.get('authorization')
                if (authorization !== null) {
                    const token = parseBearerToken(authorization)
                    const authentication =
                        token === null
                            ? null
                            : (options.authenticateProjectAccessToken?.(token) ?? null)
                    if (authentication === null) {
                        return status(401, {
                            error: {
                                code: 'unauthorized',
                                message: 'Authentication required',
                            },
                        })
                    }

                    return {
                        user: createProjectTokenUser(authentication),
                        session: null,
                        authMethod: 'project_token' as const,
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

                return {
                    user: {
                        id: session.user.id,
                        name: session.user.name,
                    },
                    session: session.session,
                    authMethod: 'session' as const,
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
