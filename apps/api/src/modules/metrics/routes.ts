import { timingSafeEqual } from 'node:crypto'

import type { Registry } from '@prometheus-io/client'
import { Elysia } from 'elysia'

export interface MetricsRouteOptions {
    readonly registry: Registry
    readonly bearerToken: string
}

function hasValidBearerToken(request: Request, expectedToken: string) {
    const authorization = request.headers.get('authorization')
    const match = authorization?.match(/^Bearer ([^\s]+)$/i)
    if (match === undefined || match === null) return false

    const provided = Buffer.from(match[1] ?? '', 'utf8')
    const expected = Buffer.from(expectedToken, 'utf8')
    return provided.length === expected.length && timingSafeEqual(provided, expected)
}

export function createMetricsRoutes(options?: MetricsRouteOptions) {
    const routes = new Elysia({ name: 'postdot-metrics' })
    if (options === undefined) return routes

    return routes.get(
        '/metrics',
        {
            detail: {
                operationId: 'getMetrics',
                summary: 'Scrape operational metrics',
                description: 'Returns Prometheus text exposition to an authenticated scraper.',
                tags: ['System'],
                security: [{ metricsBearerAuth: [] }],
                responses: {
                    200: {
                        description: 'Prometheus text exposition format.',
                        content: {
                            'text/plain': {
                                schema: { type: 'string' },
                            },
                        },
                    },
                    401: {
                        description: 'A valid monitoring bearer token is required.',
                    },
                },
            },
        },
        async ({ request }) => {
            if (!hasValidBearerToken(request, options.bearerToken)) {
                return new Response(null, {
                    status: 401,
                    headers: { 'www-authenticate': 'Bearer realm="Postdot metrics"' },
                })
            }

            return new Response(await options.registry.metrics(), {
                headers: { 'content-type': options.registry.contentType },
            })
        }
    )
}
