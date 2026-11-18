import { expect, test } from 'bun:test'

import { readBoundedRequestBytes } from './request-body'

test('bounds streamed bodies without trusting their declared length', async () => {
    let cancelled = false
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(9))
        },
        cancel() {
            cancelled = true
        },
    })
    const request = new Request('https://postdot.local/upload', {
        method: 'POST',
        headers: { 'content-length': '1' },
        body,
    })
    expect(await readBoundedRequestBytes(request, 8)).toEqual({ ok: false, reason: 'too_large' })
    expect(cancelled).toBe(true)
    const accepted = await readBoundedRequestBytes(
        new Request('https://postdot.local/upload', { method: 'POST', body: '12345678' }),
        8
    )
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(accepted.bytes.byteLength).toBe(8)
})
