import { Elysia } from 'elysia'
import { Type } from 'typebox'

export function createHealthRoutes() {
    return new Elysia({ name: 'herald-health' }).get(
        '/health',
        {
            response: Type.Object({ status: Type.Literal('ok') }),
            detail: {
                operationId: 'getHealth',
                summary: 'Check API health',
                tags: ['System'],
            },
        },
        () => ({ status: 'ok' as const })
    )
}
