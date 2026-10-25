import type { SchedulerState } from '@postdot/core'
import type { PostbotDatabase } from '@postdot/db'
import { Elysia } from 'elysia'
import { Type } from 'typebox'

import { readReleaseInfo } from '../../release'
import type { MediaReconciliationRuntimeState } from '../media/runtime'
import type { NotificationProjectionRuntimeState } from '../notifications/runtime'

const runtimeStateSchema = Type.Union([
    Type.Literal('not_configured'),
    Type.Literal('idle'),
    Type.Literal('started'),
    Type.Literal('running'),
    Type.Literal('recovering'),
    Type.Literal('stopped'),
    Type.Literal('failed'),
])

const readinessChecksSchema = Type.Object({
    checks: Type.Object({
        database: Type.Union([Type.Literal('ok'), Type.Literal('failed')]),
        scheduler: runtimeStateSchema,
        mediaMaintenance: runtimeStateSchema,
        notifications: runtimeStateSchema,
        recovery: Type.Optional(Type.Union([Type.Literal('held'), Type.Literal('normal')])),
    }),
})

const readyResponseSchema = Type.Intersect([
    Type.Object({ status: Type.Literal('ready') }),
    readinessChecksSchema,
])

const notReadyResponseSchema = Type.Intersect([
    Type.Object({ status: Type.Literal('not_ready') }),
    readinessChecksSchema,
])

type ReadinessChecks = {
    readonly recovery?: 'held' | 'normal'
    readonly database: 'ok' | 'failed'
    readonly scheduler: SchedulerState | 'not_configured'
    readonly mediaMaintenance: MediaReconciliationRuntimeState | 'not_configured'
    readonly notifications: NotificationProjectionRuntimeState | 'not_configured'
}

type HealthRuntime = {
    readonly recovery?: { held(): boolean }
    readonly scheduler?: { readonly state: SchedulerState }
    readonly mediaMaintenance?: { readonly state: MediaReconciliationRuntimeState }
    readonly notifications?: { readonly state: NotificationProjectionRuntimeState }
}

export interface HealthRoutesOptions {
    readonly database: PostbotDatabase
    readonly runtime?: HealthRuntime
}

export function createHealthRoutes({ database, runtime }: HealthRoutesOptions) {
    return new Elysia({ name: 'postbot-health' })
        .get(
            '/api/version',
            {
                response: Type.Object({
                    version: Type.Union([Type.String(), Type.Null()]),
                    revision: Type.Union([Type.String(), Type.Null()]),
                }),
                detail: {
                    operationId: 'getReleaseInfo',
                    summary: 'Identify the packaged application release',
                    tags: ['System'],
                    security: [],
                },
            },
            () => readReleaseInfo()
        )
        .get(
            '/health',
            {
                response: Type.Object({ status: Type.Literal('ok') }),
                detail: {
                    operationId: 'getHealth',
                    summary: 'Check API liveness',
                    tags: ['System'],
                    security: [],
                },
            },
            () => ({ status: 'ok' as const })
        )
        .get(
            '/ready',
            {
                response: {
                    200: readyResponseSchema,
                    503: notReadyResponseSchema,
                },
                detail: {
                    operationId: 'getReadiness',
                    summary: 'Check runtime readiness',
                    tags: ['System'],
                    security: [],
                    responses: {
                        503: {
                            description: 'The process is live but not ready for durable work',
                        },
                    },
                },
            },
            ({ status }) => {
                const checks: ReadinessChecks = {
                    ...(runtime?.recovery
                        ? {
                              recovery: runtime.recovery.held()
                                  ? ('held' as const)
                                  : ('normal' as const),
                          }
                        : {}),
                    database: readDatabaseStatus(database),
                    scheduler: runtime?.scheduler?.state ?? 'not_configured',
                    mediaMaintenance: runtime?.mediaMaintenance?.state ?? 'not_configured',
                    notifications: runtime?.notifications?.state ?? 'not_configured',
                }
                if (isReady(checks)) return { status: 'ready' as const, checks }
                return status(503, { status: 'not_ready' as const, checks })
            }
        )
}

function readDatabaseStatus(database: PostbotDatabase): 'ok' | 'failed' {
    try {
        database.$client.query('select 1').get()
        return 'ok'
    } catch {
        return 'failed'
    }
}

function isReady(checks: ReadinessChecks) {
    return (
        checks.database === 'ok' &&
        (isActiveRuntime(checks.scheduler) ||
            (checks.recovery === 'held' && checks.scheduler === 'idle')) &&
        (isActiveRuntime(checks.mediaMaintenance) ||
            (checks.recovery === 'held' && checks.mediaMaintenance === 'idle')) &&
        isActiveRuntime(checks.notifications)
    )
}

function isActiveRuntime(
    state:
        | SchedulerState
        | MediaReconciliationRuntimeState
        | NotificationProjectionRuntimeState
        | 'not_configured'
) {
    return state === 'started' || state === 'running'
}
