import type { HeraldAuth } from '@herald/auth'
import { Elysia } from 'elysia'

interface ProjectApiKeyAuthentication {
    readonly projectId: string
    readonly subjectId: string
    readonly displayName: string
}

export function createAuthRoutes(auth: HeraldAuth) {
    return new Elysia({ name: 'herald-auth-routes' }).mount(auth.handler)
}

export interface AuthenticatedElysiaOptions {
    readonly authenticateBetterAuthProjectApiKey?: (
        token: string
    ) => Promise<ProjectApiKeyAuthentication | null>
    readonly authorizeProjectSessionAccess?: (projectId: string, userId: string) => boolean
}

type HeraldAuthSession = NonNullable<Awaited<ReturnType<HeraldAuth['api']['getSession']>>>
export type HeraldAuthenticatedUser = Pick<HeraldAuthSession['user'], 'id' | 'name'> & {
    readonly email: string | null
}
export type HeraldAuthenticationMethod = 'session' | 'project_token'

function createProjectTokenUser(
    authentication: ProjectApiKeyAuthentication
): HeraldAuthenticatedUser {
    return {
        id: authentication.subjectId,
        name: authentication.displayName,
        email: null,
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
                        email: session.user.email,
                    },
                    session: session.session as HeraldAuthSession['session'] | null,
                    authMethod: 'session' as HeraldAuthenticationMethod,
                    projectTokenProjectId: undefined,
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
    auth: HeraldAuth,
    options: AuthenticatedElysiaOptions = {}
): AuthenticatedElysiaBase {
    const authenticated = new Elysia().macro({
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
                    if (projectId !== null && authentication.projectId !== projectId) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project not found' },
                        })
                    }

                    return {
                        user: createProjectTokenUser(authentication),
                        session: null,
                        authMethod: 'project_token' as const,
                        projectTokenProjectId: authentication.projectId,
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
                    options.authorizeProjectSessionAccess !== undefined &&
                    !options.authorizeProjectSessionAccess(projectId, session.user.id)
                ) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                return {
                    user: {
                        id: session.user.id,
                        name: session.user.name,
                        email: session.user.email,
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
