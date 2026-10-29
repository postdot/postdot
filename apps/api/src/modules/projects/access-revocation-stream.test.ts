import { describe, expect, it } from 'bun:test'

import { createProjectEventStream } from './realtime-routes'
import { readFrame, readFrames as readFramesFrom } from './realtime-stream-reader'

// WEB-312 pins how the open project event stream reacts when a user's access to
// the project changes while the tab is connected. The gate is re-evaluated on
// every pull, and an idle stream is pulled again by the heartbeat, so losing
// access is reported within one heartbeat interval. An effective role change
// requests a membership recheck without closing an authorized stream (WEB-598).

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
    const text = await readFramesFrom(reader, frames)
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
        const first = await readFrame(reader)
        expect(first.done).toBe(false)
        expect(first.text).toBe(': heartbeat\n\n')
        expect(first.text).not.toContain('access-revoked')

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

    it('announces a changed role without closing the authorized stream', async () => {
        const role: { value: 'editor' | 'viewer' } = { value: 'editor' }
        const reader = createProjectEventStream({
            request: new Request(`http://localhost/api/projects/${projectId}/events`),
            projectId,
            journal: { readAfter: () => [] },
            after: null,
            isAuthorized: () => role.value,
            options: { heartbeatIntervalMs: shortHeartbeatIntervalMs, batchSize: 8 },
        }).getReader()
        await reader.read()
        await readFrame(reader)
        role.value = 'viewer'
        let text = ''
        while (!text.includes('project.access-changed')) {
            const next = await reader.read()
            expect(next.done).toBe(false)
            text += new TextDecoder().decode(next.value)
        }
        expect(text).toContain(`"projectId":"${projectId}"`)
        expect(text).not.toContain('access-revoked')
        expect(text).not.toContain('viewer')
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

    it('emits byte-identical frames for refusal and lookup failure', async () => {
        const refused = createProjectEventStream({
            request: new Request(`http://localhost/api/projects/${projectId}/events`),
            projectId,
            journal: { readAfter: () => [] },
            after: null,
            isAuthorized: () => false,
            options: { heartbeatIntervalMs: shortHeartbeatIntervalMs, batchSize: 8 },
        })
        const failed = createProjectEventStream({
            request: new Request(`http://localhost/api/projects/${projectId}/events`),
            projectId,
            journal: { readAfter: () => [] },
            after: null,
            isAuthorized: () => {
                throw new Error('authorization store unavailable')
            },
            options: { heartbeatIntervalMs: shortHeartbeatIntervalMs, batchSize: 8 },
        })

        // Neither path carries a cause: the client cannot tell them apart.
        expect(await readFrames(failed, 1)).toBe(await readFrames(refused, 1))
    })
})
