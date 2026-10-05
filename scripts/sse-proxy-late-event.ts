#!/usr/bin/env bun
/**
 * Fourth stage of the isolated SSE reproduction: does a real event still cross
 * the connection after it has already gone quiet?
 *
 * The stream is opened, held past several heartbeats, and only then is a real
 * mutation performed on the same project. A healthy stream delivers that event
 * immediately; a stream that was torn down and never reopened delivers nothing.
 *
 * Observation only: it changes no transport code and no product behaviour.
 *
 * Usage: bun scripts/sse-proxy-late-event.ts <apiOrigin> <webOrigin> <projectId> <cookie> [quietSeconds]
 */

const [apiOrigin, webOrigin, projectId, cookie, quietSecondsText] = process.argv.slice(2)

if (
    apiOrigin === undefined ||
    webOrigin === undefined ||
    projectId === undefined ||
    cookie === undefined
) {
    throw new Error(
        'usage: sse-proxy-late-event.ts <apiOrigin> <webOrigin> <projectId> <cookie> [quietSeconds]'
    )
}

const quietSeconds = Number(quietSecondsText ?? 20)
// Narrowed once so the closures below keep a definite session cookie.
const sessionCookie: string = cookie

interface Segment {
    readonly arrivedAtMs: number
    readonly summary: string
    readonly isFrame: boolean
}

function describeFrame(text: string): { summary: string; isFrame: boolean } {
    if (text.startsWith(':'))
        return { summary: `comment ${JSON.stringify(text.trim())}`, isFrame: false }
    const eventName = /^event: (.+)$/m.exec(text)?.[1]
    const eventType = /"type":"([^"]+)"/.exec(text)?.[1]
    if (eventName === undefined)
        return { summary: `unlabelled frame ${JSON.stringify(text.slice(0, 40))}`, isFrame: true }
    return {
        summary: `event ${eventName}${eventType === undefined ? '' : ` (${eventType})`}`,
        isFrame: true,
    }
}

async function hold(label: string, origin: string): Promise<Segment[]> {
    const segments: Segment[] = []
    const started = Date.now()
    const controller = new AbortController()
    const url = `${origin}/api/projects/${projectId}/events`
    const record = (summary: string, isFrame: boolean): void => {
        segments.push({ arrivedAtMs: Date.now() - started, summary, isFrame })
        console.log(`  ${Date.now() - started}ms ${summary}`)
    }

    const pump = (async (): Promise<void> => {
        try {
            const response = await fetch(url, {
                headers: { cookie: sessionCookie, accept: 'text/event-stream' },
                signal: controller.signal,
            })
            record(
                `headers ${response.status} ${response.headers.get('content-type') ?? ''}`,
                false
            )
            if (response.body === null) return
            const reader = response.body.getReader()
            for (;;) {
                const { done, value } = await reader.read()
                if (done) {
                    record('closed by server', false)
                    return
                }
                const described = describeFrame(new TextDecoder().decode(value))
                record(described.summary, described.isFrame)
            }
        } catch (error) {
            const name = error instanceof Error ? error.name : 'Error'
            const code = error instanceof Error && 'code' in error ? ` ${String(error.code)}` : ''
            record(`threw ${name}${code}`, false)
        }
    })()

    // Stay quiet across at least one heartbeat so the runtime has every chance
    // to end the stream before the mutation happens.
    await Bun.sleep(quietSeconds * 1000)
    const suffix = Math.random().toString(36).slice(2, 8)
    const response = await fetch(`${apiOrigin}/api/projects/${projectId}/channels`, {
        method: 'POST',
        headers: { cookie: sessionCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: `Late ${suffix}` }),
    })
    console.log(
        `  -- mutation at ${Date.now() - started}ms: channel create http ${response.status} --`
    )

    // Wait past another heartbeat, so a frame that only shows up on the next
    // sweep is distinguishable from one delivered immediately.
    await Bun.sleep(quietSeconds * 1000)
    controller.abort()
    await pump
    void label
    return segments
}

console.log(`holding the stream quiet for ${quietSeconds}s on both sides of a real mutation`)
for (const [label, origin] of [
    ['direct', apiOrigin],
    ['proxied', webOrigin],
] as const) {
    console.log(`\n== ${label} (/api/projects/{projectId}/events) ==`)
    const segments = await hold(label, origin)
    const lateFrames = segments.filter(
        segment => segment.isFrame && segment.arrivedAtMs > quietSeconds * 1000
    )
    const firstLateFrame = lateFrames[0]
    const delay =
        firstLateFrame === undefined ? undefined : firstLateFrame.arrivedAtMs - quietSeconds * 1000
    console.log(
        `  verdict: ${firstLateFrame === undefined ? 'NO event after silence' : `event after silence, ${String(delay)}ms past the mutation`}`
    )
}
