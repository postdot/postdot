#!/usr/bin/env bun
/**
 * Fourth stage of the isolated SSE reproduction: does a real event still cross
 * the proxy after the connection has already gone quiet?
 *
 * The stream is opened, held past the point where the API closes an idle
 * connection, then a real mutation is performed. If the event arrives, the
 * proxy carries events and only loses liveness; if it does not, the connection
 * is already gone. Observation only.
 *
 * Usage: bun scripts/sse-proxy-late-event.ts <apiOrigin> <webOrigin> <cookie> [quietSeconds]
 */

const [apiOrigin, webOrigin, cookie, quietSecondsText] = process.argv.slice(2)

if (apiOrigin === undefined || webOrigin === undefined || cookie === undefined) {
    throw new Error(
        'usage: sse-proxy-late-event.ts <apiOrigin> <webOrigin> <cookie> [quietSeconds]'
    )
}

const quietSeconds = Number(quietSecondsText ?? 14)
// Narrowed once so the closures below keep a definite session cookie.
const sessionCookie: string = cookie

interface Segment {
    readonly label: string
    readonly arrivedAtMs: number
    readonly summary: string
}

async function hold(label: string, url: string): Promise<Segment[]> {
    const segments: Segment[] = []
    const started = Date.now()
    const controller = new AbortController()

    const pump = (async (): Promise<void> => {
        try {
            const response = await fetch(url, {
                headers: { cookie: sessionCookie, accept: 'text/event-stream' },
                signal: controller.signal,
            })
            segments.push({
                label,
                arrivedAtMs: Date.now() - started,
                summary: `headers ${response.status}`,
            })
            if (response.body === null) return
            const reader = response.body.getReader()
            for (;;) {
                const { done, value } = await reader.read()
                if (done) {
                    segments.push({
                        label,
                        arrivedAtMs: Date.now() - started,
                        summary: 'closed by server',
                    })
                    return
                }
                const text = new TextDecoder().decode(value)
                const eventName = /^event: (.+)$/m.exec(text)?.[1] ?? 'frame'
                segments.push({
                    label,
                    arrivedAtMs: Date.now() - started,
                    summary: `${eventName} (${value.byteLength} bytes)`,
                })
            }
        } catch (error) {
            const name = error instanceof Error ? error.name : 'Error'
            const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
            segments.push({
                label,
                arrivedAtMs: Date.now() - started,
                summary: `threw ${name}${code === undefined ? '' : ` ${code}`}`,
            })
        }
    })()

    await Bun.sleep(quietSeconds * 1000)
    const suffix = Math.random().toString(36).slice(2, 8)
    const response = await fetch(`${apiOrigin}/api/projects`, {
        method: 'POST',
        headers: { cookie: sessionCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: `Late ${suffix}` }),
    })
    console.log(`  mutation at ${Date.now() - started}ms: project create http ${response.status}`)

    await Bun.sleep(8_000)
    controller.abort()
    await pump
    return segments
}

console.log(`holding each stream quiet for ${quietSeconds}s, then creating a project`)
for (const [label, origin] of [
    ['direct', apiOrigin],
    ['proxied', webOrigin],
] as const) {
    console.log(`\n== ${label} (/api/notifications/events) ==`)
    const segments = await hold(label, `${origin}/api/notifications/events`)
    for (const segment of segments) {
        console.log(`  ${segment.arrivedAtMs}ms ${segment.summary}`)
    }
    if (segments.length === 0) console.log('  (nothing arrived at all)')
    const afterMutation = segments.filter(segment => segment.arrivedAtMs > quietSeconds * 1000)
    console.log(
        `  verdict: ${afterMutation.length > 0 ? 'event arrived after the quiet period' : 'nothing arrived after the quiet period'}`
    )
}
