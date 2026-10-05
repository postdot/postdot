#!/usr/bin/env bun
/**
 * Fifth stage of the isolated SSE reproduction: does the user notification
 * stream open at all when there is nothing pending?
 *
 * The notification stream only writes once it has something to send, so before
 * the connection frame existed the response headers were never flushed and a
 * client saw a reset or a proxy error instead of an open stream. This stage
 * opens it against a session whose journal has no notification-worthy entry and
 * reports what arrived.
 *
 * Observation only: it changes no transport code and no product behaviour.
 *
 * Usage: bun scripts/sse-user-stream-open.ts <apiOrigin> <webOrigin> <cookie> [holdMs]
 */

const [apiOrigin, webOrigin, cookie, holdText] = process.argv.slice(2)

if (apiOrigin === undefined || webOrigin === undefined || cookie === undefined) {
    throw new Error('usage: sse-user-stream-open.ts <apiOrigin> <webOrigin> <cookie> [holdMs]')
}

const holdMs = Number(holdText ?? 6_000)
// Narrowed once so the closure below keeps a definite session cookie.
const sessionCookie: string = cookie

async function open(label: string, origin: string): Promise<void> {
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), holdMs)
    const frames: string[] = []

    try {
        const response = await fetch(`${origin}/api/notifications/events`, {
            headers: { cookie: sessionCookie, accept: 'text/event-stream' },
            signal: controller.signal,
        })
        console.log(`${label}: ${response.status} at ${Date.now() - started}ms`)
        console.log(`${label}: content-type ${response.headers.get('content-type') ?? '<none>'}`)
        if (response.body === null) {
            console.log(`${label}: no body`)
            return
        }

        const reader = response.body.getReader()
        for (;;) {
            const { done, value } = await reader.read()
            if (done) {
                console.log(`${label}: closed by server at ${Date.now() - started}ms`)
                return
            }
            const text = new TextDecoder().decode(value).trim()
            frames.push(text)
            console.log(`${label}: ${Date.now() - started}ms frame ${JSON.stringify(text)}`)
        }
    } catch (error) {
        const name = error instanceof Error ? error.name : 'Error'
        const code = error instanceof Error && 'code' in error ? ` ${String(error.code)}` : ''
        console.log(`${label}: threw ${name}${code} at ${Date.now() - started}ms`)
    } finally {
        clearTimeout(timer)
        controller.abort()
    }

    const businessFrames = frames.filter(frame => frame.startsWith('event:'))
    console.log(
        `${label}: verdict ${businessFrames.length === 0 ? 'opened with no business event' : `opened with ${String(businessFrames.length)} business event(s)`}`
    )
}

console.log('opening the user notification stream with nothing notification-worthy pending')
await open('direct', apiOrigin)
await open('proxied', webOrigin)
