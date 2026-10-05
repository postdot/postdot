#!/usr/bin/env bun
/**
 * Third stage of the isolated SSE reproduction: timestamped chunk arrivals.
 *
 * Reads the same event stream from the API origin and from the Vite dev origin
 * and prints when each chunk lands, so a heartbeat that never crosses the proxy
 * is distinguishable from a stream that closes early. Observation only: it
 * changes no transport code and no product behaviour.
 *
 * Usage: bun scripts/sse-proxy-chunks.ts <apiOrigin> <webOrigin> <projectId> <cookie> [seconds]
 */

const [apiOrigin, webOrigin, projectId, cookie, secondsText] = process.argv.slice(2)

if (
    apiOrigin === undefined ||
    webOrigin === undefined ||
    projectId === undefined ||
    cookie === undefined
) {
    throw new Error(
        'usage: sse-proxy-chunks.ts <apiOrigin> <webOrigin> <projectId> <cookie> [seconds]'
    )
}

const seconds = Number(secondsText ?? 40)
// Narrowed once so the closures below keep a definite session cookie.
const sessionCookie: string = cookie

interface ChunkRecord {
    readonly atMs: number
    readonly label: string
    readonly bytes: number
}

async function probe(label: string, url: string): Promise<ChunkRecord[]> {
    const records: ChunkRecord[] = []
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), seconds * 1000)

    const relative = (): number => Date.now() - started
    let response: Response
    try {
        response = await fetch(url, {
            headers: { cookie: sessionCookie, accept: 'text/event-stream' },
            signal: controller.signal,
        })
    } catch (error) {
        records.push({
            atMs: relative(),
            label,
            bytes: -1,
        })
        console.log(`${label}: request failed at ${relative()}ms: ${String(error)}`)
        clearTimeout(timer)
        return records
    }

    records.push({ atMs: relative(), label: `${label} headers`, bytes: 0 })
    console.log(
        `${label}: ${response.status} ${response.headers.get('content-type')} at ${relative()}ms`
    )

    if (response.body === null) {
        console.log(`${label}: no body`)
        clearTimeout(timer)
        return records
    }

    const reader = response.body.getReader()
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) {
                records.push({ atMs: relative(), label: `${label} closed-by-server`, bytes: 0 })
                console.log(`${label}: stream closed by server at ${relative()}ms`)
                break
            }
            records.push({ atMs: relative(), label: `${label} chunk`, bytes: value.byteLength })
            console.log(
                `${label}: ${value.byteLength} bytes at ${relative()}ms :: ${JSON.stringify(
                    new TextDecoder().decode(value).slice(0, 90)
                )}`
            )
        }
    } catch (error) {
        const name = error instanceof Error ? error.name : 'Error'
        records.push({ atMs: relative(), label: `${label} error-${name}`, bytes: 0 })
        console.log(`${label}: stream threw ${name} at ${relative()}ms: ${String(error)}`)
    } finally {
        clearTimeout(timer)
        controller.abort()
    }

    console.log(`${label}: total ${relative()}ms`)
    return records
}

const direct = await probe('direct', `${apiOrigin}/api/projects/${projectId}/events`)
const proxied = await probe('proxied', `${webOrigin}/api/projects/${projectId}/events`)

console.log('\nsummary')
for (const [label, records] of [
    ['direct', direct],
    ['proxied', proxied],
] as const) {
    const chunks = records.filter(record => record.label.endsWith('chunk'))
    const heartbeats = records.filter(record => record.label.includes('chunk'))
    console.log(
        `${label}: ${chunks.length} chunks, arrivals ${heartbeats
            .map(record => `${record.atMs}ms`)
            .join(', ')}, terminal ${records.at(-1)?.label ?? 'none'}`
    )
}
