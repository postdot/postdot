import { Elysia } from 'elysia'

import { inheritRequestPeerAddress } from '../serving'

/** Instance-wide transport behavior, including mounted handlers and static assets. */
export function createHttpPolicy(dispatch: (request: Request) => Promise<Response>) {
    return new Elysia({ name: 'postdot-http-policy' })
        .headers({ 'x-robots-tag': 'noindex, nofollow' })
        .request(async ({ request, set }) => {
            set.headers['x-robots-tag'] = 'noindex, nofollow'
            if (request.method !== 'HEAD') return

            // Reuse GET routing and authorization without buffering files or streams.
            const response = await dispatch(
                inheritRequestPeerAddress(request, new Request(request, { method: 'GET' }))
            )
            void response.body?.cancel().catch(() => {})
            return new Response(null, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            })
        })
        .get(
            '/robots.txt',
            () =>
                new Response('User-agent: *\nDisallow: /\n', {
                    headers: { 'content-type': 'text/plain; charset=utf-8' },
                })
        )
        .as('global')
}
