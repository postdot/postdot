import { describe, expect, it } from 'bun:test'

import {
    keepResponseAliveBeyondIdleTimeout,
    registerServingHandle,
    type ServingHandle,
} from './serving'

function createHandleSpy() {
    const calls: { request: Request; seconds: number }[] = []
    const handle: ServingHandle = {
        timeout(request, seconds) {
            calls.push({ request, seconds })
        },
    }
    return { calls, handle }
}

describe('SSE-318 serving handle', () => {
    it('disables the idle ceiling for the given request only', () => {
        const { calls, handle } = createHandleSpy()
        registerServingHandle(handle)
        const request = new Request('http://localhost/api/projects/project-1/events')

        keepResponseAliveBeyondIdleTimeout(request)

        expect(calls).toHaveLength(1)
        expect(calls[0]?.request).toBe(request)
        // Zero disables the ceiling. The server default is never widened.
        expect(calls[0]?.seconds).toBe(0)
        registerServingHandle(undefined)
    })

    it('is a no-op when no server publishes a handle', () => {
        registerServingHandle(undefined)
        const request = new Request('http://localhost/api/projects/project-1/events')

        expect(() => keepResponseAliveBeyondIdleTimeout(request)).not.toThrow()
    })

    it('can hand the handle back when the server stops', () => {
        const { calls, handle } = createHandleSpy()
        registerServingHandle(handle)
        registerServingHandle(undefined)

        keepResponseAliveBeyondIdleTimeout(new Request('http://localhost/api/ready'))

        expect(calls).toHaveLength(0)
    })
})
