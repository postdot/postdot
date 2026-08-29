import type { HeraldAuth } from '@herald/auth'
import { Elysia } from 'elysia'

export function createAuthRoutes(auth: HeraldAuth) {
    return new Elysia({ name: 'herald-auth-routes' }).mount(auth.handler)
}

export function createAuthenticatedElysia(auth: HeraldAuth) {
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
                    user: session.user,
                    session: session.session,
                }
            },
        },
    })
}

type AuthenticatedElysiaBase = ReturnType<typeof createAuthenticatedElysia>

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
