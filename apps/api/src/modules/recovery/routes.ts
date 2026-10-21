import type { AccessStore } from '@postdot/db'
import { Type } from 'typebox'

import { sessionSecurity } from '../../plugins/auth'
import type { RecoveryService } from '../../recovery'
import { errorResponse } from '../projects/models'
import type { AuthenticatedElysia } from '../projects/types'

const recoverySchema = Type.Object({
    held: Type.Boolean(),
    hold: Type.Union([
        Type.Null(),
        Type.Object({
            version: Type.Literal(1),
            token: Type.String(),
            createdAt: Type.String(),
            reason: Type.Union([Type.Literal('restore'), Type.Literal('external_restore')]),
        }),
    ]),
})
const denied = {
    error: { code: 'forbidden', message: 'An instance administrator session is required' },
}

export function registerRecoveryRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    access: AccessStore,
    recovery?: RecoveryService
) {
    return app
        .get(
            '/api/settings/recovery',
            {
                auth: true,
                response: { 200: recoverySchema, 401: errorResponse, 403: errorResponse },
                detail: {
                    operationId: 'getRecoveryState',
                    tags: ['Settings'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, user, status }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id))
                    return status(403, denied)
                return recovery?.view() ?? { held: false, hold: null }
            }
        )
        .post(
            '/api/settings/recovery/resume',
            {
                auth: true,
                body: Type.Object({
                    token: Type.String({ minLength: 1 }),
                    confirm: Type.Literal(true),
                }),
                response: {
                    200: recoverySchema,
                    401: errorResponse,
                    403: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'resumeAfterRestore',
                    tags: ['Settings'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, user, body, status }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id))
                    return status(403, denied)
                try {
                    if (!recovery) throw new Error('Recovery unavailable')
                    recovery.resume(body.token)
                    return recovery.view()
                } catch {
                    return status(409, {
                        error: {
                            code: 'recovery_changed',
                            message: 'Recovery could not be resumed; reload its state',
                        },
                    })
                }
            }
        )
}
