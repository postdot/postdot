#!/usr/bin/env bun
/**
 * Runtime isolation probe for the SSE defect: does Bun's own HTTP server close
 * a quiet streaming response?
 *
 * This probe deliberately involves no Elysia, no Herald module, and no product
 * code. It writes one frame and then stays silent, so whatever closes the
 * connection belongs to the runtime, not to the application. It changes nothing
 * and listens on an operating-system-assigned loopback port.
 *
 * Usage: bun scripts/sse-runtime-idle-probe.ts
 */

interface Outcome {
    readonly path: string
    readonly statusMs: number
    readonly firstByteMs: number | undefined
    readonly terminalMs: number
    readonly terminal: string
}

async function hold(path: string): Promise<Outcome> {
    const origin = `http://127.0.0.1:${server.port}`
    const started = Date.now()
    let statusMs = Number.NaN
    let firstByteMs: number | undefined

    try {
        const response = await fetch(`${origin}${path}`)
        statusMs = Date.now() - started
        const reader = response.body!.getReader()
        for (;;) {
            const { done, value } = await reader.read()
            if (done) {
                return {
                    path,
                    statusMs,
                    firstByteMs,
                    terminalMs: Date.now() - started,
                    terminal: 'closed by server',
                }
            }
            firstByteMs ??= Date.now() - started
            console.log(`${path}: ${value.byteLength} bytes at ${Date.now() - started}ms`)
        }
    } catch (error) {
        const name = error instanceof Error ? error.name : 'Error'
        const code = error instanceof Error && 'code' in error ? ` ${String(error.code)}` : ''
        return {
            path,
            statusMs,
            firstByteMs,
            terminalMs: Date.now() - started,
            terminal: `threw ${name}${code}`,
        }
    }
}

const server = Bun.serve({
    port: 0,
    fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/quiet-sse') {
            let sent = false
            return new Response(
                new ReadableStream<Uint8Array>({
                    pull(controller) {
                        if (sent) return
                        sent = true
                        controller.enqueue(new TextEncoder().encode(': hello\n\n'))
                    },
                }),
                { headers: { 'content-type': 'text/event-stream' } }
            )
        }
        if (url.pathname === '/quiet-body') {
            return new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('first'))
                    },
                }),
                { headers: { 'content-type': 'text/plain' } }
            )
        }
        return new Response('not found', { status: 404 })
    },
})

console.log(`bun ${Bun.version}, probe on port ${server.port}`)
console.log('a healthy SSE stream would keep writing; these two write once and go silent')
const outcomes = [await hold('/quiet-sse'), await hold('/quiet-body')]
server.stop(true)

console.log('\nsummary')
for (const outcome of outcomes) {
    console.log(
        `${outcome.path}: status ${outcome.statusMs}ms, first byte ${outcome.firstByteMs ?? 'none'}ms, terminal ${outcome.terminal} at ${outcome.terminalMs}ms`
    )
}
const closed = outcomes.filter(outcome => outcome.terminalMs >= 5_000)
console.log(
    `\n${closed.length} of ${outcomes.length} quiet responses were torn down by the runtime rather than ending on their own`
)
