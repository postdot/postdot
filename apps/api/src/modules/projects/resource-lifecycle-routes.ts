import {
    ResourceLifecycleError,
    type AccessStore,
    type ResourceKind,
    type ResourceLifecycleStore,
} from '@postdot/db'
import { Type } from 'typebox'

import { sessionSecurity } from '../../plugins/auth'
import { errorResponse } from './models'
import type { AuthenticatedElysia } from './types'

const stateSchema = Type.Union([
    Type.Literal('active'),
    Type.Literal('archiving'),
    Type.Literal('archived'),
    Type.Literal('deleting'),
    Type.Literal('deleted'),
])
export const resourceImpactSchema = Type.Object({
    kind: Type.Union([Type.Literal('project'), Type.Literal('workspace')]),
    id: Type.String(),
    name: Type.String(),
    state: stateSchema,
    revision: Type.Number(),
    isDefault: Type.Boolean(),
    fingerprint: Type.String(),
    cleanupPending: Type.Number(),
    changedAt: Type.Number(),
    projects: Type.Array(
        Type.Object({ id: Type.String(), name: Type.String(), state: stateSchema })
    ),
    counts: Type.Record(Type.String(), Type.Number()),
    publications: Type.Record(Type.String(), Type.Number()),
    pending: Type.Number(),
    uncertain: Type.Number(),
    active: Type.Number(),
    members: Type.Number(),
})
const inputSchema = Type.Object({
    fingerprint: Type.String({ minLength: 1 }),
    cancelPending: Type.Optional(Type.Boolean()),
    confirmName: Type.Optional(Type.String()),
    acknowledgeUncertain: Type.Optional(Type.Boolean()),
    replacementWorkspaceId: Type.Optional(Type.String()),
})
const projectParams = Type.Object({ projectId: Type.String({ minLength: 1 }) })
const workspaceParams = Type.Object({ workspaceId: Type.String({ minLength: 1 }) })
const response = {
    200: resourceImpactSchema,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
}
type Input = {
    fingerprint: string
    cancelPending?: boolean
    confirmName?: string
    acknowledgeUncertain?: boolean
    replacementWorkspaceId?: string
}
export function registerResourceLifecycleRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    access: AccessStore,
    lifecycle: ResourceLifecycleStore
) {
    function canManage(kind: ResourceKind, id: string, userId: string) {
        if (kind === 'workspace') return access.canManageWorkspace(id, userId)
        return (
            access.canAccessProject(id, userId, 'owner') ||
            (() => {
                const workspace = access.getProjectWorkspaceId(id)
                return workspace !== null && access.canManageWorkspace(workspace, userId)
            })()
        )
    }
    function read(kind: ResourceKind, id: string, userId: string) {
        if (!canManage(kind, id, userId) && !lifecycle.canReadReceipt(kind, id, userId))
            return {
                failure: true as const,
                code: 'forbidden',
                message: 'Resource management permission required',
            }
        const impact = lifecycle.impact(kind, id)
        return (
            impact ?? { failure: true as const, code: 'not_found', message: 'Resource not found' }
        )
    }
    function change(
        kind: ResourceKind,
        id: string,
        userId: string,
        action: 'archive' | 'restore' | 'delete',
        input: Input
    ) {
        try {
            return lifecycle.mutate({
                ...input,
                kind,
                id,
                action,
                actorId: userId,
                authorize: () =>
                    canManage(kind, id, userId) &&
                    (!input.replacementWorkspaceId ||
                        access.canManageWorkspace(input.replacementWorkspaceId, userId)),
            })
        } catch (error) {
            if (error instanceof ResourceLifecycleError)
                return { failure: true as const, code: error.code, message: error.message }
            throw error
        }
    }
    return app
        .get(
            '/api/resource-removals',
            {
                auth: true,
                response: {
                    200: Type.Object({ resources: Type.Array(resourceImpactSchema) }),
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'listResourceRetirements',
                    summary: 'List manageable archived resources and removal receipts',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            ({ user, authMethod, status }) =>
                authMethod === 'session'
                    ? {
                          resources: lifecycle
                              .retired()
                              .filter(
                                  item =>
                                      canManage(item.kind, item.id, user.id) ||
                                      lifecycle.canReadReceipt(item.kind, item.id, user.id)
                              )
                              .map(item => lifecycle.impact(item.kind, item.id)!)
                              .filter(item => item !== null),
                      }
                    : status(403, {
                          error: { code: 'forbidden', message: 'A human session is required' },
                      })
        )
        .get(
            '/api/projects/:projectId/lifecycle/state',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ state: stateSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getProjectLifecycleState',
                    summary: 'Read project activity state',
                    tags: ['Projects'],
                },
            },
            ({ params }) => ({ state: lifecycle.projectState(params.projectId) })
        )
        .get(
            '/api/projects/:projectId/lifecycle',
            {
                auth: true,
                params: projectParams,
                response,
                detail: {
                    operationId: 'getProjectLifecycleImpact',
                    summary: 'Preview project retirement impact',
                    tags: ['Projects'],
                },
            },
            ({ params, user, status }) => {
                const result = read('project', params.projectId, user.id)
                return 'failure' in result
                    ? status(result.code === 'not_found' ? 404 : 403, {
                          error: { code: result.code, message: result.message },
                      })
                    : result
            }
        )
        .post(
            '/api/projects/:projectId/lifecycle/archive',
            {
                auth: true,
                params: projectParams,
                body: inputSchema,
                response,
                detail: {
                    operationId: 'archiveProject',
                    summary: 'Archive a project with explicit pending-work cancellation',
                    tags: ['Projects'],
                },
            },
            ({ params, body, user, status }) => {
                const result = change('project', params.projectId, user.id, 'archive', body)
                return 'failure' in result
                    ? status(result.code === 'forbidden' ? 403 : 409, {
                          error: { code: result.code, message: result.message },
                      })
                    : result
            }
        )
        .post(
            '/api/projects/:projectId/lifecycle/restore',
            {
                auth: true,
                params: projectParams,
                body: inputSchema,
                response,
                detail: {
                    operationId: 'restoreProject',
                    summary: 'Restore a project without rescheduling work',
                    tags: ['Projects'],
                },
            },
            ({ params, body, user, status }) => {
                const result = change('project', params.projectId, user.id, 'restore', body)
                return 'failure' in result
                    ? status(result.code === 'forbidden' ? 403 : 409, {
                          error: { code: result.code, message: result.message },
                      })
                    : result
            }
        )
        .delete(
            '/api/projects/:projectId/lifecycle',
            {
                auth: true,
                params: projectParams,
                body: inputSchema,
                response,
                detail: {
                    operationId: 'deleteProject',
                    summary: 'Permanently delete owned data and queue media cleanup',
                    tags: ['Projects'],
                },
            },
            ({ params, body, user, status }) => {
                const result = change('project', params.projectId, user.id, 'delete', body)
                return 'failure' in result
                    ? status(result.code === 'forbidden' ? 403 : 409, {
                          error: { code: result.code, message: result.message },
                      })
                    : result
            }
        )
        .get(
            '/api/workspaces/:workspaceId/lifecycle',
            {
                auth: true,
                params: workspaceParams,
                response,
                detail: {
                    operationId: 'getWorkspaceLifecycleImpact',
                    summary: 'Preview workspace and project retirement impact',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            ({ params, user, status }) => {
                const result = read('workspace', params.workspaceId, user.id)
                return 'failure' in result
                    ? status(result.code === 'not_found' ? 404 : 403, {
                          error: { code: result.code, message: result.message },
                      })
                    : result
            }
        )
        .post(
            '/api/workspaces/:workspaceId/lifecycle/archive',
            {
                auth: true,
                params: workspaceParams,
                body: inputSchema,
                response,
                detail: {
                    operationId: 'archiveWorkspace',
                    summary: 'Archive a workspace and its projects',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            ({ params, body, user, status }) => {
                const result = change('workspace', params.workspaceId, user.id, 'archive', body)
                return 'failure' in result
                    ? status(result.code === 'forbidden' ? 403 : 409, {
                          error: { code: result.code, message: result.message },
                      })
                    : result
            }
        )
        .post(
            '/api/workspaces/:workspaceId/lifecycle/restore',
            {
                auth: true,
                params: workspaceParams,
                body: inputSchema,
                response,
                detail: {
                    operationId: 'restoreWorkspace',
                    summary: 'Restore a workspace without restoring projects',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            ({ params, body, user, status }) => {
                const result = change('workspace', params.workspaceId, user.id, 'restore', body)
                return 'failure' in result
                    ? status(result.code === 'forbidden' ? 403 : 409, {
                          error: { code: result.code, message: result.message },
                      })
                    : result
            }
        )
        .delete(
            '/api/workspaces/:workspaceId/lifecycle',
            {
                auth: true,
                params: workspaceParams,
                body: inputSchema,
                response,
                detail: {
                    operationId: 'deleteWorkspace',
                    summary: 'Permanently delete a workspace and its owned projects',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            ({ params, body, user, status }) => {
                const result = change('workspace', params.workspaceId, user.id, 'delete', body)
                return 'failure' in result
                    ? status(result.code === 'forbidden' ? 403 : 409, {
                          error: { code: result.code, message: result.message },
                      })
                    : result
            }
        )
}
