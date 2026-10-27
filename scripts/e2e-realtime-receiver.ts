import { isSafeE2EDataDirectory } from './e2e-runtime'

interface Observation {
    deliveryId: string
    body: unknown
    headers: Record<string, string>
    released: boolean
}

/** A loopback-only destination whose response is gated by the acceptance test. */
export function createRealtimeReceiver(port: number) {
    const requests: Observation[] = []
    const pending = new Map<Observation, () => void>()
    const release = (observation: Observation) => {
        observation.released = true
        pending.get(observation)?.()
        pending.delete(observation)
    }
    const releaseAll = () => {
        for (const observation of pending.keys()) release(observation)
    }
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port,
        // The worker owns the delivery deadline; tests release in finally.
        idleTimeout: 60,
        maxRequestBodySize: 1_048_576,
        async fetch(request) {
            const path = new URL(request.url).pathname
            if (request.method === 'GET' && path === '/ready') return new Response('ready')
            if (request.method === 'GET' && path === '/observations')
                return Response.json({ requests })
            if (request.method === 'POST' && path === '/release-all') {
                releaseAll()
                return Response.json({})
            }
            if (request.method === 'POST' && path === '/release') {
                const body: unknown = await request.json()
                if (typeof body !== 'object' || body === null || !('deliveryId' in body))
                    return new Response('Expected deliveryId', { status: 400 })
                const matches = requests.filter(item => item.deliveryId === body.deliveryId)
                if (matches.length === 0) return new Response('Unknown delivery', { status: 404 })
                for (const item of matches) release(item)
                return Response.json({})
            }
            if (request.method !== 'POST' || path !== '/')
                return new Response('Not found', { status: 404 })
            const deliveryId = request.headers.get('x-postdot-delivery-id')
            if (!deliveryId) return new Response('Expected delivery header', { status: 400 })
            const observation: Observation = {
                deliveryId,
                body: await request.json(),
                headers: Object.fromEntries(request.headers.entries()),
                released: false,
            }
            const gate = new Promise<void>(resolve => pending.set(observation, resolve))
            requests.push(observation)
            await gate
            return Response.json({})
        },
    })
    return { server, releaseAll }
}

if (import.meta.main) {
    const port = Number(Bun.env.POSTDOT_E2E_RECEIVER_PORT)
    if (
        Bun.env.NODE_ENV !== 'test' ||
        !isSafeE2EDataDirectory(Bun.env.POSTDOT_E2E_DATA_DIRECTORY) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65_535
    ) {
        throw new Error('The isolated realtime receiver is not safely configured')
    }
    const { server, releaseAll } = createRealtimeReceiver(port)
    const stop = async () => {
        releaseAll()
        await server.stop()
        process.exit(0)
    }
    process.once('SIGINT', () => void stop())
    process.once('SIGTERM', () => void stop())
}
