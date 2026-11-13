import type { StudioCloudflareBindings } from './worker-configuration'

const transportHeaders = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]

function responseHeaders(headers?: Headers): Headers {
    const result = new Headers(headers)
    for (const name of transportHeaders) result.delete(name)
    const privateResponse = /(?:^|,)\s*private\s*(?:,|$)/i.test(headers?.get('cache-control') ?? '')
    result.set('cache-control', privateResponse ? 'private, no-store' : 'no-store')
    result.set('x-robots-tag', 'noindex, nofollow')
    return result
}

function failure(status: number, error: string): Response {
    return Response.json({ error }, { status, headers: responseHeaders() })
}

function origin(value: string): URL {
    const url = new URL(value)
    // HTTP loopback is only useful to the local workerd qualification harness.
    const local = url.protocol === 'http:' && url.hostname === '127.0.0.1'
    if (
        (!local && url.protocol !== 'https:') ||
        url.username ||
        url.password ||
        url.origin !== value
    )
        throw new Error('Invalid origin')
    return url
}

function clientAddress(value: string | null): string | null {
    if (!value || value.includes('%')) return null
    if (/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value))
        return value.split('.').every(part => Number(part) <= 255) ? value : null
    if (!value.includes(':') || !/^[\da-f:.]+$/i.test(value)) return null
    try {
        new URL(`http://[${value}]`)
        return value
    } catch {
        return null
    }
}

/** Optional edge transport only: identity and authorization stay in Postdot's API. */
export async function proxyStudioRequest(
    request: Request,
    env: Omit<StudioCloudflareBindings, 'ASSETS'>,
    upstreamFetch: (request: Request) => Promise<Response> = fetch
): Promise<Response> {
    const incoming = new URL(request.url)
    if (!/^\/(api|oauth)(\/|$)/.test(incoming.pathname)) return failure(404, 'not_found')
    let target: URL
    try {
        const publicOrigin = origin(env.POSTDOT_PUBLIC_ORIGIN)
        target = origin(env.POSTDOT_API_ORIGIN)
        if (
            target.origin === publicOrigin.origin ||
            !/^[a-f\d]{64}$/.test(env.POSTDOT_INGRESS_SECRET)
        )
            return failure(503, 'invalid_proxy_configuration')
        if (incoming.origin !== publicOrigin.origin) return failure(421, 'unexpected_origin')
    } catch {
        return failure(503, 'invalid_proxy_configuration')
    }
    const address = clientAddress(request.headers.get('cf-connecting-ip'))
    if (address === null) return failure(503, 'missing_client_address')

    const headers = new Headers(request.headers)
    // Reject token-selected header removal instead of silently dropping Origin or cookies.
    const connectionTokens = (headers.get('connection') ?? '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
    if (connectionTokens.some(name => !transportHeaders.includes(name)))
        return failure(400, 'unsupported_connection_header')
    for (const name of transportHeaders) headers.delete(name)
    for (const name of [
        'host',
        'forwarded',
        'x-forwarded-for',
        'x-forwarded-host',
        'x-forwarded-proto',
        'x-real-ip',
        'cf-connecting-ip',
        'cf-connecting-ipv6',
        'x-postdot-client-ip',
    ])
        headers.delete(name)
    headers.set('x-postdot-ingress', env.POSTDOT_INGRESS_SECRET)
    headers.set('x-postdot-client-address', address)
    target.pathname = incoming.pathname
    target.search = incoming.search
    try {
        const response = await upstreamFetch(
            new Request(target, {
                method: request.method,
                headers,
                body: request.body,
                redirect: 'manual',
                cache: 'no-store',
                signal: request.signal,
            })
        )
        // Keep the original stream and separate Set-Cookie values. Never follow redirects
        // with the ingress secret, buffer media, or schedule work after the client leaves.
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders(response.headers),
        })
    } catch {
        return failure(502, 'upstream_unavailable')
    }
}

export default {
    fetch(request: Request, env: StudioCloudflareBindings) {
        const url = new URL(request.url)
        if (!/^\/(api|oauth)(\/|$)/.test(url.pathname)) {
            const navigation =
                request.headers.get('sec-fetch-mode') === 'navigate' ||
                request.headers.get('accept')?.includes('text/html')
            const page = !url.pathname.split('/').at(-1)?.includes('.')
            if ((request.method === 'GET' || request.method === 'HEAD') && navigation && page) {
                url.pathname = '/index.html'
                url.search = ''
                return env.ASSETS.fetch(url.href, {
                    method: request.method,
                    headers: Object.fromEntries(request.headers),
                })
            }
            return failure(404, 'not_found')
        }
        return proxyStudioRequest(request, env)
    },
}
