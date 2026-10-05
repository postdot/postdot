import { describe, expect, it } from 'bun:test'

import { createProjectEventStream } from './realtime-routes'

// WEB-312 pins how the open project event stream reacts when a user's access to
// the project changes while the tab is connected. The gate is re-evaluated on
// every pull, and an idle stream is pulled again by the heartbeat, so losing
// access is reported within one heartbeat interval. Narrowing a role leaves the
// gate satisfied, so nothing is reported at all.

const projectId = 'web-312-project'
const shortHeartbeatIntervalMs = 25

function createStream(authorized: { value: boolean }) {
    return createProjectEventStream({
        request: new Request(`http://localhost/api/projects/${projectId}/events`),
        projectId,
        journal: { readAfter: () => [] },
        after: null,
        isAuthorized: () => authorized.value,
        options: { heartbeatIntervalMs: shortHeartbeatIntervalMs, batchSize: 8 },
    })
}

async function readFrames(stream: ReadableStream<Uint8Array>, frames: number) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (let index = 0; index < frames; index += 1) {
        const chunk = await reader.read()
        if (chunk.done) break
        text += decoder.decode(chunk.value)
    }
    reader.releaseLock()
    return text
}

describe('WEB-312 live access revocation on the project stream', () => {
    it('reports access loss on the next idle pull and closes the stream', async () => {
        const authorized = { value: true }
        const stream = createStream(authorized)
        const reader = stream.getReader()
        const decoder = new TextDecoder()

        // An idle connected stream only heartbeats; it never claims access changed.
        const first = await reader.read()
        expect(first.done).toBe(false)
        expect(decoder.decode(first.value)).toBe(': heartbeat\n\n')
        expect(decoder.decode(first.value)).not.toContain('access-revoked')

        // Access is removed while the tab stays connected.
        authorized.value = false

        let text = ''
        while (!text.includes('access-revoked')) {
            const chunk = await reader.read()
            if (chunk.done) break
            text += decoder.decode(chunk.value)
        }
        expect(text).toContain('event: project.access-revoked')
        expect(text).toContain(`"projectId":"${projectId}"`)

        const closed = await reader.read()
        expect(closed.done).toBe(true)
    })

    it('stays silent when the same user is only narrowed to a lower role', async () => {
        const authorized = { value: true }
        const stream = createStream(authorized)
        const reader = stream.getReader()
        const decoder = new TextDecoder()

        await reader.read()

        // A narrower role still satisfies the access gate, so the stream keeps
        // sends heartbeats and reports nothing: the client cannot learn the new role
        // from the stream.
        let text = ''
        for (let index = 0; index < 4; index += 1) {
            const chunk = await reader.read()
            expect(chunk.done).toBe(false)
            text += decoder.decode(chunk.value)
        }
        expect(text).not.toContain('access-revoked')
        expect(text).not.toContain('resync-required')
        await reader.cancel()
    })

    it('treats an authorization lookup failure as a revocation', async () => {
        const stream = createProjectEventStream({
            request: new Request(`http://localhost/api/projects/${projectId}/events`),
            projectId,
            journal: { readAfter: () => [] },
            after: null,
            isAuthorized: () => {
                throw new Error('authorization store unavailable')
            },
            options: { heartbeatIntervalMs: shortHeartbeatIntervalMs, batchSize: 8 },
        })

        const text = await readFrames(stream, 1)
        expect(text).toContain('event: project.access-revoked')
    })
})
