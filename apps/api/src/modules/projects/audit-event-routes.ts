import { Type } from 'typebox'

import { auditEventSchema, errorResponse, projectParams } from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

export function registerAuditEventRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore
) {
    return app.get(
        '/api/projects/:projectId/audit-events',
        {
            auth: true,
            params: projectParams,
            response: {
                200: Type.Object({ events: Type.Array(auditEventSchema) }),
                401: errorResponse,
                404: errorResponse,
            },
            detail: {
                operationId: 'listProjectAuditEvents',
                summary: 'List the audit events for a project',
                tags: ['Audit'],
            },
        },
        ({ params, status, user }) => {
            const events = manualStore.listAuditEvents(params.projectId, user.id)
            if (events === null) {
                return status(404, {
                    error: { code: 'not_found', message: 'Project not found' },
                })
            }
            return { events }
        }
    )
}
