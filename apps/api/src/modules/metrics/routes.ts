import type { Registry } from '@prometheus-io/client'
import { Elysia } from 'elysia'

export function createMetricsRoutes(registry: Registry) {
    return new Elysia({ name: 'herald-metrics' }).get(
        '/metrics',
        {
            detail: {
                operationId: 'getMetrics',
                summary: 'Scrape operational metrics',
                description:
                    'Returns Prometheus text exposition. Restrict access to the monitoring network at the deployment boundary.',
                tags: ['System'],
                security: [],
                responses: {
                    200: {
                        description: 'Prometheus text exposition format.',
                        content: {
                            'text/plain': {
                                schema: { type: 'string' },
                            },
                        },
                    },
                },
            },
        },
        async () =>
            new Response(await registry.metrics(), {
                headers: { 'content-type': registry.contentType },
            })
    )
}
